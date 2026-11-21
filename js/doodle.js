// 涂抹笔迹：在图片上用手指/鼠标涂白色，盖住手写痕迹。
// 笔画只记坐标，撤销时重绘，内存占用很小。

const MAX_EDGE = 2600

const BRUSHES = {
  small: { label: '细', ratio: 0.012 },
  medium: { label: '中', ratio: 0.024 },
  large: { label: '粗', ratio: 0.045 },
}

const COLORS = [
  { label: '白', value: '#ffffff' },
  { label: '米白', value: '#f7f4ec' },
  { label: '浅灰', value: '#e9e9e9' },
]

function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这张图打不开，没法涂抹'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/jpeg', quality)
  })
}

/**
 * 打开涂抹界面。返回涂抹后的 Blob；取消返回 null。
 */
export async function openDoodle(blob, { title = '涂掉笔迹' } = {}) {
  const img = await loadImage(blob)

  const scale = Math.min(1, MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight))
  const width = Math.max(1, Math.round(img.naturalWidth * scale))
  const height = Math.max(1, Math.round(img.naturalHeight * scale))

  return new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    canvas.className = 'doodle-canvas'

    const ctx = canvas.getContext('2d', { alpha: false })

    const strokes = []
    let current = null
    let brush = 'medium'
    let color = COLORS[0].value
    let done = false

    function paintBase() {
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, width, height)
      ctx.drawImage(img, 0, 0, width, height)
    }

    function drawStroke(stroke) {
      const points = stroke.points
      ctx.strokeStyle = stroke.color
      ctx.fillStyle = stroke.color
      ctx.lineWidth = stroke.size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      if (points.length === 1) {
        ctx.beginPath()
        ctx.arc(points[0].x, points[0].y, stroke.size / 2, 0, Math.PI * 2)
        ctx.fill()
        return
      }
      ctx.beginPath()
      ctx.moveTo(points[0].x, points[0].y)
      for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y)
      ctx.stroke()
    }

    function redraw() {
      paintBase()
      for (const stroke of strokes) drawStroke(stroke)
      undoButton.disabled = strokes.length === 0
      clearButton.disabled = strokes.length === 0
    }

    function toCanvasPoint(event) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: ((event.clientX - rect.left) / rect.width) * width,
        y: ((event.clientY - rect.top) / rect.height) * height,
      }
    }

    canvas.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      try {
        canvas.setPointerCapture(event.pointerId)
      } catch {
        // 某些环境（或合成事件）不支持捕获，忽略即可。
      }
      current = {
        size: width * BRUSHES[brush].ratio,
        color,
        points: [toCanvasPoint(event)],
      }
      strokes.push(current)
      drawStroke(current)
      undoButton.disabled = false
      clearButton.disabled = false
    })

    canvas.addEventListener('pointermove', (event) => {
      if (!current) return
      event.preventDefault()
      const point = toCanvasPoint(event)
      const last = current.points[current.points.length - 1]
      // 太密的点丢掉，减少负担。
      if (Math.hypot(point.x - last.x, point.y - last.y) < 2) return
      current.points.push(point)

      ctx.strokeStyle = current.color
      ctx.lineWidth = current.size
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(last.x, last.y)
      ctx.lineTo(point.x, point.y)
      ctx.stroke()
    })

    const endStroke = (event) => {
      if (!current) return
      current = null
      try {
        canvas.releasePointerCapture(event.pointerId)
      } catch {
        // 忽略。
      }
    }
    canvas.addEventListener('pointerup', endStroke)
    canvas.addEventListener('pointercancel', endStroke)
    canvas.addEventListener('pointerleave', endStroke)

    // —— 工具栏 ——
    const sizeButtons = Object.keys(BRUSHES).map((key) => {
      const button = document.createElement('button')
      button.className = `btn btn-sm doodle-size ${key === brush ? 'active' : ''}`
      button.type = 'button'
      button.textContent = BRUSHES[key].label
      button.dataset.size = key
      button.onclick = () => {
        brush = key
        for (const other of sizeButtons) other.classList.toggle('active', other === button)
      }
      return button
    })

    const colorButtons = COLORS.map((item) => {
      const button = document.createElement('button')
      button.className = `btn btn-sm doodle-color ${item.value === color ? 'active' : ''}`
      button.type = 'button'
      button.textContent = item.label
      button.style.background = item.value
      button.onclick = () => {
        color = item.value
        for (const other of colorButtons) other.classList.toggle('active', other === button)
      }
      return button
    })

    const undoButton = Object.assign(document.createElement('button'), {
      className: 'btn btn-sm',
      type: 'button',
      textContent: '撤销',
      disabled: true,
      onclick: () => {
        strokes.pop()
        redraw()
      },
    })

    const clearButton = Object.assign(document.createElement('button'), {
      className: 'btn btn-sm',
      type: 'button',
      textContent: '清空',
      disabled: true,
      onclick: () => {
        strokes.length = 0
        redraw()
      },
    })

    const tools = document.createElement('div')
    tools.className = 'doodle-tools'
    tools.append(
      Object.assign(document.createElement('span'), {
        className: 'crop-tools-label',
        textContent: '笔头',
      }),
      ...sizeButtons,
      Object.assign(document.createElement('span'), {
        className: 'crop-tools-label',
        textContent: '　颜色',
      }),
      ...colorButtons,
      Object.assign(document.createElement('span'), { className: 'doodle-spacer' }),
      undoButton,
      clearButton,
    )

    const cancelButton = Object.assign(document.createElement('button'), {
      className: 'btn btn-ghost',
      type: 'button',
      textContent: '取消',
      onclick: () => finish(null),
    })
    const saveButton = Object.assign(document.createElement('button'), {
      className: 'btn btn-primary',
      type: 'button',
      textContent: '保存涂抹',
      onclick: async () => {
        const out = await canvasToBlob(canvas, 0.92)
        finish(out || null)
      },
    })

    const actions = document.createElement('div')
    actions.className = 'crop-actions'
    actions.append(cancelButton, saveButton)

    const stage = document.createElement('div')
    stage.className = 'doodle-stage'
    stage.append(canvas)

    const inner = document.createElement('div')
    inner.className = 'dlg-inner dlg-inner-doodle'
    inner.append(
      Object.assign(document.createElement('h2'), { className: 'dlg-title', textContent: title }),
      Object.assign(document.createElement('p'), {
        className: 'card-sub',
        textContent: '用手指在要遮住的笔迹上涂一下，可以换粗细和颜色、撤销或清空。',
      }),
      stage,
      tools,
      actions,
    )

    const dialog = document.createElement('dialog')
    dialog.className = 'dlg dlg-doodle'
    dialog.append(inner)
    document.body.append(dialog)

    function finish(value) {
      if (done) return
      done = true
      dialog.remove()
      resolve(value)
    }

    dialog.addEventListener('cancel', (event) => {
      event.preventDefault()
      finish(null)
    })
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) finish(null)
    })

    paintBase()
    dialog.showModal()
  })
}
