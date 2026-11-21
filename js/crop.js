// 拍照后的裁剪对话框（Cropper.js）。
//
// 支持：
//  - 左转 / 右转 90°（横着拍竖排题目时用）
//  - 一张原图连续裁多块（题目和解析在同一页时，不用拍两次）
//
// 旋转的做法是把图片真正转好再交给 Cropper，而不是用 Cropper 内部的 rotate，
// 这样裁剪框和输出结果的方向一定是对的。
//
// 返回：裁剪结果 Blob 数组；用户取消返回 null。

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

  // 即使不需要缩放也重编码一次，把 EXIF 方向固化下来。
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

/** 把整张图旋转 90 的倍数，返回新的 Blob。 */
async function rotateBlob(blob, degrees) {
  const img = await loadBitmap(blob)
  const width = img.width || img.naturalWidth
  const height = img.height || img.naturalHeight
  const swap = Math.abs(degrees % 180) === 90
  const canvas = document.createElement('canvas')
  canvas.width = swap ? height : width
  canvas.height = swap ? width : height
  const ctx = canvas.getContext('2d', { alpha: false })
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.translate(canvas.width / 2, canvas.height / 2)
  ctx.rotate((degrees * Math.PI) / 180)
  ctx.drawImage(img, -width / 2, -height / 2, width, height)
  if (typeof img.close === 'function') img.close()
  const out = await canvasToBlob(canvas, 0.95)
  canvas.width = 0
  canvas.height = 0
  return out || blob
}

/**
 * 打开裁剪框。
 * 返回 Blob 数组（可能多张）；用户取消返回 null。
 */
export async function openCropper(sourceBlob, { title = '裁剪照片', maxEdge = CROP_MAX_EDGE } = {}) {
  const Cropper = window.Cropper
  if (!Cropper) {
    throw new Error('裁剪组件没加载出来（vendor/cropper.min.js），请刷新页面重试')
  }

  const prepared = await downscaleForCrop(sourceBlob, maxEdge)
  return new Promise((resolve) => {
    let currentBlob = prepared
    let currentUrl = URL.createObjectURL(prepared)
    let cropper = null
    let done = false
    let rotating = false

    const img = document.createElement('img')
    img.className = 'crop-image'
    img.alt = ''

    const stage = document.createElement('div')
    stage.className = 'crop-stage'
    stage.append(img)

    const results = []

    const hint = document.createElement('div')
    hint.className = 'crop-hint'
    hint.textContent = '拖动边框框住要保留的部分'

    const ratioButtons = [
      { label: '自由', value: NaN },
      { label: '1:1', value: 1 },
      { label: '3:4', value: 3 / 4 },
      { label: '4:3', value: 4 / 3 },
    ].map((item) => {
      const button = document.createElement('button')
      button.className = 'btn btn-sm crop-ratio'
      button.type = 'button'
      button.textContent = item.label
      button.onclick = () => {
        cropper?.setAspectRatio(item.value)
        for (const other of ratioButtons) other.classList.toggle('active', other === button)
      }
      return button
    })

    const rotateLeft = document.createElement('button')
    rotateLeft.className = 'btn btn-sm'
    rotateLeft.type = 'button'
    rotateLeft.textContent = '↺ 左转'
    rotateLeft.onclick = () => rotateBy(-90)

    const rotateRight = document.createElement('button')
    rotateRight.className = 'btn btn-sm'
    rotateRight.type = 'button'
    rotateRight.textContent = '↻ 右转'
    rotateRight.onclick = () => rotateBy(90)

    const tools = document.createElement('div')
    tools.className = 'crop-tools'
    tools.append(
      Object.assign(document.createElement('span'), {
        className: 'crop-tools-label',
        textContent: '比例',
      }),
      ...ratioButtons,
      Object.assign(document.createElement('span'), {
        className: 'crop-tools-label',
        textContent: '　转正',
      }),
      rotateLeft,
      rotateRight,
    )

    const cancelButton = Object.assign(document.createElement('button'), {
      className: 'btn btn-ghost',
      type: 'button',
      textContent: '取消',
    })
    const againButton = Object.assign(document.createElement('button'), {
      className: 'btn',
      type: 'button',
      textContent: '继续裁下一块',
    })
    const confirmButton = Object.assign(document.createElement('button'), {
      className: 'btn btn-primary',
      type: 'button',
      textContent: '保存并结束',
    })

    const actions = document.createElement('div')
    actions.className = 'crop-actions'
    actions.append(cancelButton, againButton, confirmButton)

    const inner = document.createElement('div')
    inner.className = 'dlg-inner dlg-inner-crop'
    inner.append(
      Object.assign(document.createElement('h2'), { className: 'dlg-title', textContent: title }),
      Object.assign(document.createElement('p'), {
        className: 'card-sub',
        textContent:
          '拖动边框框住要保留的部分；双指捏合或滚轮可以缩放。题目和解析在同一页时，可以裁完一块点「继续裁下一块」。',
      }),
      stage,
      tools,
      hint,
      actions,
    )

    const dialog = document.createElement('dialog')
    dialog.className = 'dlg dlg-crop'
    dialog.append(inner)
    document.body.append(dialog)

    function cleanup() {
      if (cropper) {
        cropper.destroy()
        cropper = null
      }
      URL.revokeObjectURL(currentUrl)
      dialog.remove()
    }

    function finish(value) {
      if (done) return
      done = true
      cleanup()
      resolve(value)
    }

    function updateHint() {
      if (!results.length) {
        hint.textContent = '拖动边框框住要保留的部分'
      } else {
        hint.textContent = `已经裁好 ${results.length} 块，继续框下一块，或者点「保存并结束」`
      }
      confirmButton.textContent = results.length
        ? `保存并结束（共 ${results.length + 1} 块）`
        : '保存并结束'
    }

    function grabCurrent() {
      return new Promise((resolveBlob) => {
        let canvas
        try {
          canvas = cropper.getCroppedCanvas({
            maxWidth: 3000,
            maxHeight: 12000,
            imageSmoothingEnabled: true,
            imageSmoothingQuality: 'high',
            fillColor: '#ffffff',
          })
        } catch {
          resolveBlob(null)
          return
        }
        if (!canvas) {
          resolveBlob(null)
          return
        }
        canvas.toBlob(
          (blob) => {
            canvas.width = 0
            canvas.height = 0
            resolveBlob(blob)
          },
          'image/jpeg',
          0.95,
        )
      })
    }

    async function rotateBy(degrees) {
      if (!cropper || rotating) return
      rotating = true
      rotateLeft.disabled = true
      rotateRight.disabled = true
      try {
        const rotated = await rotateBlob(currentBlob, degrees)
        URL.revokeObjectURL(currentUrl)
        currentBlob = rotated
        currentUrl = URL.createObjectURL(rotated)
        cropper.replace(currentUrl)
        hint.textContent = '已转正，重新框一下要保留的部分'
      } catch (error) {
        hint.textContent = error.message || '旋转失败'
      } finally {
        rotating = false
        rotateLeft.disabled = false
        rotateRight.disabled = false
      }
    }

    cancelButton.addEventListener('click', () => finish(null))

    againButton.addEventListener('click', async () => {
      if (!cropper) return
      const blob = await grabCurrent()
      if (!blob) {
        hint.textContent = '这块没取到图，换个框再试'
        return
      }
      results.push(blob)
      cropper.reset()
      updateHint()
    })

    confirmButton.addEventListener('click', async () => {
      if (!cropper) {
        finish(null)
        return
      }
      const blob = await grabCurrent()
      if (blob) results.push(blob)
      if (!results.length) {
        finish(null)
        return
      }
      finish(results)
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
        if (cropper) return
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
        ratioButtons[0].classList.add('active')
        updateHint()
      },
      { once: true },
    )

    img.src = currentUrl
    dialog.showModal()
  })
}
