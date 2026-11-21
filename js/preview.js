// 题目预览对话框：看题目图 + 全部解析图，可以改判，也可以把图片存到手机。
// 题库页、今日记录都复用这一个。

import { el, toast } from './ui.js'
import { createShot } from './viewer.js'
import { getImageURL, getImageBlob } from './storage.js'
import { STATUS, updateGroup } from './repo.js'

function pad(n) {
  return String(n).padStart(2, '0')
}

function fileName(base, index) {
  const now = new Date()
  const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
  return `${base}-${stamp}${index ? '-' + index : ''}.jpg`
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

async function saveImage(imageId, name) {
  try {
    const blob = await getImageBlob(imageId)
    if (!blob) {
      toast('这张图的文件找不到了', 'error')
      return
    }
    saveBlob(blob, name)
    toast('已保存到下载目录', 'ok')
  } catch (error) {
    toast(error.message || '保存失败', 'error')
  }
}

/**
 * 打开预览。
 * options.onChanged: 改判成功后回调（用来刷新列表）
 * options.showRetag: 是否显示改判按钮，默认 true
 */
export async function openPreview(group, { onChanged, showRetag = true } = {}) {
  const dialogEl = el('dialog', { class: 'dlg dlg-preview' })
  const content = el('div', { class: 'preview-body' })
  const tempUrls = []
  const retagRow = el('div', { class: 'retag-row' })
  let current = { ...group }

  async function addImage(imageId, label, nameBase, index) {
    const url = await getImageURL(imageId)
    if (!url) {
      content.append(el('div', { class: 'missing-image', text: `${label} 图片丢失` }))
      return
    }
    tempUrls.push(url)
    const shot = createShot()
    shot.setSrc(url)

    const head = el(
      'div',
      { class: 'shot-head' },
      el('span', { class: 'shot-label', text: label }),
      el('button', {
        class: 'btn btn-sm',
        text: '⬇ 保存图片',
        onclick: () => saveImage(imageId, fileName(nameBase, index)),
      }),
    )

    content.append(head, shot.el)
  }

  await addImage(current.questionImageId, '题目', '题目', 0)
  const ids = current.explanationImageIds || []
  for (const [index, id] of ids.entries()) {
    await addImage(id, `解析 ${index + 1}`, '解析', index + 1)
  }
  if (!ids.length) content.append(el('div', { class: 'no-explanation', text: '本题没有解析图' }))

  function renderRetag() {
    if (!showRetag) {
      retagRow.replaceChildren()
      return
    }
    const statusText =
      current.status === STATUS.DONE ? '已做对' : current.status === STATUS.WRONG ? '错题' : '未看'
    retagRow.replaceChildren(
      el('span', { class: 'retag-label', text: `当前：${statusText}` }),
      el('button', {
        class: 'btn btn-sm btn-ok',
        text: '改判做对',
        onclick: () => retag('right'),
      }),
      el('button', {
        class: 'btn btn-sm btn-warn',
        text: '改判做错',
        onclick: () => retag('wrong'),
      }),
      el('button', {
        class: 'btn btn-sm',
        text: '改判跳过',
        onclick: () => retag('skip'),
      }),
    )
  }

  async function retag(result) {
    try {
      const status =
        result === 'right' ? STATUS.DONE : result === 'wrong' ? STATUS.WRONG : current.status
      current = await updateGroup(current.id, {
        status,
        lastAt: Date.now(),
        lastResult: result,
        // 改判不算又做了一次，所以不动 attempts。
      })
      renderRetag()
      toast('已改判', 'ok')
      await onChanged?.()
    } catch (error) {
      toast(error.message || '改判失败', 'error')
    }
  }

  renderRetag()

  dialogEl.append(
    el(
      'div',
      { class: 'dlg-inner dlg-inner-preview' },
      el(
        'div',
        { class: 'dlg-head' },
        el('h2', { class: 'dlg-title', text: '题目预览' }),
        el('button', {
          class: 'btn btn-sm btn-ghost',
          text: '关闭',
          onclick: () => dialogEl.close(),
        }),
      ),
      content,
      retagRow,
    ),
  )

  dialogEl.addEventListener('close', () => {
    for (const url of tempUrls) URL.revokeObjectURL(url)
    dialogEl.remove()
  })
  document.body.append(dialogEl)
  dialogEl.showModal()
  return dialogEl
}
