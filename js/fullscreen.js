// 全屏看图：整屏只剩一个「×」，其余全交给手势。
//  - 左右滑切上一张 / 下一张（题目 ↔ 解析）
//  - 上下滑看长图
//  - 双指缩放、双击放大
//  - 短图居中，长图从顶部开始

import { createShot } from './viewer.js'

/**
 * images: [{ url, label }]
 * startIndex: 从第几张开始看
 */
export function openGallery(images, startIndex = 0) {
  const list = (images || []).filter((item) => item && item.url)
  if (!list.length) return null

  const dialog = document.createElement('dialog')
  dialog.className = 'dlg dlg-fullscreen'

  const closeButton = document.createElement('button')
  closeButton.className = 'fs-close'
  closeButton.type = 'button'
  closeButton.textContent = '×'
  closeButton.setAttribute('aria-label', '关闭')

  const track = document.createElement('div')
  track.className = 'fs-track'

  const shots = []
  for (const item of list) {
    const shot = createShot({ horizontalPan: true })
    shot.setSrc(item.url)
    shots.push(shot)

    const page = document.createElement('div')
    page.className = 'fs-page'
    page.append(shot.el)
    track.append(page)
  }

  dialog.append(track, closeButton)
  document.body.append(dialog)

  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    dialog.close()
  }

  closeButton.addEventListener('click', close)

  dialog.addEventListener('close', () => {
    for (const shot of shots) shot.reset()
    dialog.remove()
  })
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    close()
  })

  dialog.showModal()

  // 跳到指定的那张
  const target = Math.min(Math.max(startIndex, 0), list.length - 1)
  if (target > 0) {
    requestAnimationFrame(() => {
      track.scrollLeft = track.clientWidth * target
    })
  }

  return dialog
}
