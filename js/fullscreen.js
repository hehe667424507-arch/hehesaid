// 全屏看图：点一下题目图，图片占满整个屏幕，能滚、能双击放大。
// 点左上角关闭，或者点图片外面的黑边退出。

import { createShot } from './viewer.js'

export function openFullscreen(url, { title = '题目' } = {}) {
  const shot = createShot()
  shot.setSrc(url)

  const scroller = document.createElement('div')
  scroller.className = 'fs-scroll'
  scroller.append(shot.el)

  const closeButton = document.createElement('button')
  closeButton.className = 'fs-close'
  closeButton.type = 'button'
  closeButton.textContent = '×'
  closeButton.setAttribute('aria-label', '关闭')

  const label = document.createElement('div')
  label.className = 'fs-label'
  label.textContent = title

  const wrap = document.createElement('div')
  wrap.className = 'fs-wrap'
  wrap.append(label, closeButton, scroller)

  const dialog = document.createElement('dialog')
  dialog.className = 'dlg dlg-fullscreen'
  dialog.append(wrap)
  document.body.append(dialog)

  const close = () => {
    dialog.close()
  }

  closeButton.addEventListener('click', close)
  dialog.addEventListener('close', () => {
    dialog.remove()
    shot.reset()
  })
  dialog.addEventListener('cancel', (event) => {
    event.preventDefault()
    close()
  })

  // 点图片以外的黑边退出；点图片本身不退出（那样没法拖动了）。
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog || event.target === scroller || event.target === wrap) close()
  })

  dialog.showModal()
  return dialog
}
