// 题目预览：叉固定在右上角，改判按钮固定在底部，中间图片可滚动、点开全屏。
// 题库页（含「今天」和错题本）都复用这一个。

import { el, toast } from './ui.js'
import { createShot } from './viewer.js'
import { openGallery } from './fullscreen.js'
import { getImageURL } from './storage.js'
import { STATUS, updateGroup } from './repo.js'

/**
 * options.onChanged: 改判成功后回调（用来刷新列表）
 * options.showRetag: 是否显示改判按钮，默认 true
 * options.actions: 额外的底部按钮，如 [{ label, onClick }]
 */
export async function openPreview(group, { onChanged, showRetag = true, actions = [] } = {}) {
  const dialogEl = el('dialog', { class: 'dlg dlg-preview' })
  const body = el('div', { class: 'preview-body' })
  const retagRow = el('div', { class: 'retag-row' })
  let current = { ...group }

  const images = []
  const shots = []

  async function addImage(imageId, label) {
    const url = await getImageURL(imageId)
    if (!url) {
      body.append(el('div', { class: 'missing-image', text: `${label} 图片丢失` }))
      return
    }
    const index = images.length
    images.push({ url, label })

    const shot = createShot({ onTap: () => openGallery(images, index) })
    shot.setSrc(url)
    shots.push(shot)

    body.append(el('div', { class: 'shot-label', text: label }), shot.el)
  }

  await addImage(current.questionImageId, '题目')
  const ids = current.explanationImageIds || []
  for (const [index, id] of ids.entries()) {
    await addImage(id, `解析 ${index + 1}`)
  }
  if (!ids.length) body.append(el('div', { class: 'no-explanation', text: '本题没有解析图' }))

  function statusText() {
    return current.status === STATUS.DONE ? '已做对' : current.status === STATUS.WRONG ? '错题' : '未看'
  }

  function renderRetag() {
    const buttons = []
    if (showRetag) {
      buttons.push(
        el('button', {
          class: 'btn btn-sm btn-ok',
          text: '做对',
          onclick: () => retag('right'),
        }),
        el('button', {
          class: 'btn btn-sm btn-warn',
          text: '做错',
          onclick: () => retag('wrong'),
        }),
        el('button', {
          class: 'btn btn-sm',
          text: '跳过',
          onclick: () => retag('skip'),
        }),
      )
    }
    for (const action of actions) {
      buttons.push(
        el('button', {
          class: 'btn btn-sm',
          text: action.label,
          onclick: () => action.onClick(current, () => dialogEl.close()),
        }),
      )
    }
    retagRow.replaceChildren(
      el('span', { class: 'retag-label', text: `当前：${statusText()}` }),
      ...buttons,
    )
    retagRow.hidden = buttons.length === 0
  }

  async function retag(result) {
    try {
      const status =
        result === 'right' ? STATUS.DONE : result === 'wrong' ? STATUS.WRONG : current.status
      current = await updateGroup(current.id, {
        status,
        lastAt: Date.now(),
        lastResult: result,
        // 改判不算又做了一次，attempts 不变；但记错次数要跟着变。
        wrongCount: Math.max(0, (current.wrongCount || 0) + (result === 'wrong' ? 1 : 0)),
      })
      renderRetag()
      toast('已改判', 'ok')
      await onChanged?.()
    } catch (error) {
      toast(error.message || '改判失败', 'error')
    }
  }

  renderRetag()

  const closeButton = el('button', {
    class: 'dlg-x',
    text: '×',
    title: '关闭',
    onclick: () => dialogEl.close(),
  })

  dialogEl.append(
    el(
      'div',
      { class: 'dlg-inner dlg-inner-preview' },
      el('div', { class: 'dlg-head' }, el('h2', { class: 'dlg-title', text: '题目预览' }), closeButton),
      body,
      retagRow,
    ),
  )

  dialogEl.addEventListener('close', () => {
    for (const shot of shots) shot.reset()
    dialogEl.remove()
  })
  dialogEl.addEventListener('cancel', (event) => {
    event.preventDefault()
    dialogEl.close()
  })
  document.body.append(dialogEl)
  dialogEl.showModal()
  return dialogEl
}
