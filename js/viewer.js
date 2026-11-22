// 长图显示：宽度撑满、页面纵向滚动看完整张、双击放大、双指捏合、放大后拖动。
// 每张图独立缩放，不会把相邻的解析图一起推走。

const MIN_SCALE = 1
const MAX_SCALE = 5
const DOUBLE_TAP_SCALE = 2.5

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function distance(a, b) {
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

function midpoint(a, b) {
  return { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 }
}

/**
 * 创建一张可缩放的长图。
 * options.onTap: 单击（不是双击、不是在拖动）时调用，用来打开全屏。
 * 用法：const shot = createShot(); container.append(shot.el); shot.setSrc(url)
 */
export function createShot({ onTap, horizontalPan = false } = {}) {
  const img = document.createElement('img')
  img.className = 'shot-img'
  img.alt = ''
  img.draggable = false
  img.decoding = 'async'

  const box = document.createElement('div')
  box.className = 'shot'
  box.append(img)

  const state = { scale: 1, x: 0, y: 0, dragging: false, lastTap: 0 }
  let tapTimer = null

  function cancelTap() {
    if (tapTimer) {
      clearTimeout(tapTimer)
      tapTimer = null
    }
  }

  function scheduleTap() {
    if (!onTap) return
    cancelTap()
    tapTimer = setTimeout(() => {
      tapTimer = null
      onTap()
    }, 300)
  }

  function paint() {
    img.style.transform = `translate(${state.x}px, ${state.y}px) scale(${state.scale})`
    box.classList.toggle('is-zoomed', state.scale > 1)
  }

  function maxOffset() {
    const boxWidth = box.clientWidth
    const boxHeight = box.clientHeight
    const imgWidth = img.clientWidth * state.scale
    const imgHeight = img.clientHeight * state.scale
    return {
      minX: Math.min(0, boxWidth - imgWidth),
      minY: Math.min(0, boxHeight - imgHeight),
      maxX: 0,
      maxY: 0,
    }
  }

  function clampPosition() {
    const limit = maxOffset()
    state.x = clamp(state.x, limit.minX, limit.maxX)
    state.y = clamp(state.y, limit.minY, limit.maxY)
  }

  function zoomTo(nextScale, focus) {
    const next = clamp(nextScale, MIN_SCALE, MAX_SCALE)
    if (next === state.scale) return
    const boxRect = box.getBoundingClientRect()
    const fx = focus ? focus.x - boxRect.left : boxRect.width / 2
    const fy = focus ? focus.y - boxRect.top : boxRect.height / 2

    if (next <= 1) {
      state.scale = 1
      state.x = 0
      state.y = 0
    } else {
      const ratio = next / state.scale
      state.x = fx - (fx - state.x) * ratio
      state.y = fy - (fy - state.y) * ratio
      state.scale = next
      clampPosition()
    }
    paint()
    updateTouchAction()
  }

  function updateTouchAction() {
    // 放大后单指拖动用于移动图片；未放大时把滚动交还给页面。
    // horizontalPan=true 时（全屏看图）额外放行左右滑动，让外层能翻页。
    if (state.scale > 1) {
      box.style.touchAction = 'none'
    } else {
      box.style.touchAction = horizontalPan ? 'pan-x pan-y' : 'pan-y'
    }
  }

  function reset() {
    cancelTap()
    state.scale = 1
    state.x = 0
    state.y = 0
    paint()
    updateTouchAction()
  }

  // —— 双击（鼠标/触屏统一）——
  box.addEventListener('pointerdown', (event) => {
    if (state.scale <= 1) return
    state.dragging = true
    state.moved = false
    state.startX = event.clientX - state.x
    state.startY = event.clientY - state.y
    try {
      box.setPointerCapture(event.pointerId)
    } catch {
      // 合成事件或特殊环境不支持捕获，忽略。
    }
  })

  box.addEventListener('pointermove', (event) => {
    if (!state.dragging) return
    const nextX = event.clientX - state.startX
    const nextY = event.clientY - state.startY
    if (Math.abs(nextX - state.x) + Math.abs(nextY - state.y) > 4) state.moved = true
    state.x = nextX
    state.y = nextY
    clampPosition()
    paint()
  })

  const endDrag = (event) => {
    if (!state.dragging) return
    state.dragging = false
    try {
      box.releasePointerCapture(event.pointerId)
    } catch {
      // 忽略。
    }
  }
  box.addEventListener('pointerup', endDrag)
  box.addEventListener('pointercancel', endDrag)

  // 双击放大 / 还原。触屏上没有可靠的 dblclick，这里用两次 pointerup 的间隔判断；
  // 拖动过就不算点击，避免放大后拖图时误触发还原。
  box.addEventListener('pointerup', (event) => {
    if (state.dragging || state.moved) {
      state.lastTap = 0
      cancelTap()
      return
    }
    if (event.pointerType === 'mouse' && event.button !== 0) return
    const now = Date.now()
    if (now - state.lastTap < 320) {
      state.lastTap = 0
      cancelTap()
      zoomTo(state.scale > 1 ? 1 : DOUBLE_TAP_SCALE, { x: event.clientX, y: event.clientY })
    } else {
      state.lastTap = now
      // 只有没放大时才把单击当成「打开全屏」，放大状态下单击留给拖动。
      if (state.scale <= 1) scheduleTap()
    }
  })

  box.addEventListener('dblclick', (event) => {
    event.preventDefault()
    cancelTap()
  })

  // —— 双指捏合 ——
  let pinch = null

  box.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length === 2) {
        event.preventDefault()
        pinch = { distance: distance(event.touches[0], event.touches[1]), scale: state.scale }
        state.dragging = false
      }
    },
    { passive: false },
  )

  box.addEventListener(
    'touchmove',
    (event) => {
      if (!pinch || event.touches.length !== 2) return
      event.preventDefault()
      const factor = distance(event.touches[0], event.touches[1]) / pinch.distance
      zoomTo(pinch.scale * factor, midpoint(event.touches[0], event.touches[1]))
    },
    { passive: false },
  )

  box.addEventListener(
    'touchend',
    (event) => {
      if (event.touches.length < 2) pinch = null
    },
    { passive: true },
  )

  // 桌面：Ctrl + 滚轮缩放
  box.addEventListener(
    'wheel',
    (event) => {
      if (!event.ctrlKey) return
      event.preventDefault()
      const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15
      zoomTo(state.scale * factor, { x: event.clientX, y: event.clientY })
    },
    { passive: false },
  )

  function setSrc(url) {
    reset()
    box.classList.remove('loaded', 'failed')
    img.onload = () => {
      box.classList.add('loaded')
    }
    img.onerror = () => {
      box.classList.add('failed')
    }
    img.src = url
  }

  updateTouchAction()

  return {
    el: box,
    img,
    setSrc,
    reset,
    zoomTo,
    get scale() {
      return state.scale
    },
  }
}

/** 单张图片查看器（录入预览用，不显示多余控件）。 */
export function createPreview(url) {
  const shot = createShot()
  shot.setSrc(url)
  return shot
}
