// 拍照后的裁剪对话框（Cropper.js）。
//
// 流程：先把相机原图缩到长边 2500px 以内（低端手机内存很紧），
// 再交给 Cropper 让用户框选，确认后输出裁剪结果，取消就丢弃。

const CROP_MAX_EDGE = 2500

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // 走下面的 <img> 兜底。
    }
  }
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这张照片读不出来，可能格式不受支持'))
    }
    img.src = url
  })
}

/** 裁剪前先缩小，避免大图把手机浏览器撑爆。 */
async function downscaleForCrop(file, maxEdge) {
  const source = await loadBitmap(file)
  const width = source.width || source.naturalWidth
  const height = source.height || source.naturalHeight
  const longest = Math.max(width, height)

  // 即使不需要缩放也重编码一次，把 EXIF 方向固化下来，
  // 否则裁剪结果可能被转 90 度。
  const ratio = longest > maxEdge ? maxEdge / longest : 1
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * ratio))
  canvas.height = Math.max(1, Math.round(height * ratio))
  const ctx = canvas.getContext('2d', { alpha: false })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  if (typeof source.close === 'function') source.close()

  const blob = await canvasToBlob(canvas, 0.92)
  canvas.width = 0
  canvas.height = 0
  return blob || file
}

/**
 * 打开裁剪框。
 * 返回裁剪后的 Blob；用户取消返回 null。
 */
export async function openCropper(sourceBlob, { title = '裁剪照片', maxEdge = CROP_MAX_EDGE } = {}) {
  const Cropper = window.Cropper
  if (!Cropper) {
    throw new Error('裁剪组件没加载出来（vendor/cropper.min.js），请刷新页面重试')
  }

  const prepared = await downscaleForCrop(sourceBlob, maxEdge)
  const url = URL.createObjectURL(prepared)

  return new Promise((resolve) => {
    const img = document.createElement('img')
    img.className = 'crop-image'
    img.alt = ''

    const stage = document.createElement('div')
    stage.className = 'crop-stage'
    stage.append(img)

    const ratioButtons = [
      { label: '自由', value: NaN },
      { label: '1:1', value: 1 },
      { label: '3:4', value: 3 / 4 },
      { label: '4:3', value: 4 / 3 },
    ].map((item) =>
      Object.assign(document.createElement('button'), {
        className: 'btn btn-sm crop-ratio',
        type: 'button',
        textContent: item.label,
        onclick: () => {
          cropper.setAspectRatio(item.value)
          for (const button of stage.parentElement.querySelectorAll('.crop-ratio')) {
            button.classList.toggle('active', button === item)
          }
        },
      }),
    )

    const cancelButton = Object.assign(document.createElement('button'), {
      className: 'btn btn-ghost',
      type: 'button',
      textContent: '取消',
    })
    const confirmButton = Object.assign(document.createElement('button'), {
      className: 'btn btn-primary',
      type: 'button',
      textContent: '用这张',
    })

    const tools = document.createElement('div')
    tools.className = 'crop-tools'
    tools.append(
      Object.assign(document.createElement('span'), { className: 'crop-tools-label', textContent: '比例' }),
      ...ratioButtons,
    )

    const actions = document.createElement('div')
    actions.className = 'crop-actions'
    actions.append(cancelButton, confirmButton)

    const inner = document.createElement('div')
    inner.className = 'dlg-inner dlg-inner-crop'
    inner.append(
      Object.assign(document.createElement('h2'), { className: 'dlg-title', textContent: title }),
      Object.assign(document.createElement('p'), {
        className: 'card-sub',
        textContent: '拖动裁剪框框住题目；双指或滚轮可以缩放，框外面拖动可以移动图片。',
      }),
      stage,
      tools,
      actions,
    )

    const dialog = document.createElement('dialog')
    dialog.className = 'dlg dlg-crop'
    dialog.append(inner)
    document.body.append(dialog)

    let cropper = null
    let done = false

    const cleanup = () => {
      if (cropper) {
        cropper.destroy()
        cropper = null
      }
      URL.revokeObjectURL(url)
      dialog.remove()
    }

    const finish = (value) => {
      if (done) return
      done = true
      cleanup()
      resolve(value)
    }

    cancelButton.addEventListener('click', () => finish(null))
    confirmButton.addEventListener('click', () => {
      if (!cropper) {
        finish(null)
        return
      }
      try {
        const canvas = cropper.getCroppedCanvas({
          maxWidth: 3000,
          maxHeight: 12000,
          imageSmoothingEnabled: true,
          imageSmoothingQuality: 'high',
          fillColor: '#ffffff',
        })
        if (!canvas) {
          finish(null)
          return
        }
        canvas.toBlob(
          (blob) => {
            canvas.width = 0
            canvas.height = 0
            finish(blob || null)
          },
          'image/jpeg',
          0.95,
        )
      } catch (error) {
        console.error(error)
        finish(null)
      }
    })

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(null)
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null)
    })

    img.addEventListener(
      'load',
      () => {
        cropper = new Cropper(img, {
          viewMode: 1,
          dragMode: 'move',
          autoCropArea: 0.85,
          responsive: true,
          restore: false,
          background: false,
          modal: true,
          guides: true,
          center: true,
          highlight: false,
          aspectRatio: NaN,
          toggleDragModeOnDblclick: false,
        })
        // 默认选中「自由」。
        ratioButtons[0].classList.add('active')
      },
      { once: true },
    )

    img.src = url
    dialog.showModal()
  })
}
