// 练习卷：挑一批题拼成一套，按顺序做，或者导出 PDF 拿去平板上做。
// 卷子里的自评只记在这一次里，不写回题库（不影响错题状态和做题次数）。

import { el, toast, dialog } from './ui.js'
import { getImageURL } from './storage.js'
import { createShot } from './viewer.js'

/** 组卷设置对话框。返回 { list, action } 或 null。 */
export async function openPaperSetup({ groups, subcategories }) {
  if (!groups.length) {
    toast('当前范围没有题目', 'info')
    return null
  }

  const picked = new Set(subcategories.map((row) => row.id))
  const chips = el('div', { class: 'chips' })

  const modeOptions = [
    { key: 'wrong', label: '错题' },
    { key: 'star', label: '难题（星标）' },
    { key: 'missed', label: '曾做错' },
    { key: 'all', label: '全部' },
  ]
  let mode = 'wrong'
  const modeRow = el('div', { class: 'seg' })

  let limit = 0 // 0 = 全部
  const limitRow = el('div', { class: 'seg' })
  let order = 'random'
  const orderRow = el('div', { class: 'seg' })

  function renderChips() {
    chips.replaceChildren(
      ...subcategories.map((sub) =>
        el('button', {
          class: `chip ${picked.has(sub.id) ? 'active' : ''}`,
          text: sub.name,
          onclick: () => {
            if (picked.has(sub.id)) picked.delete(sub.id)
            else picked.add(sub.id)
            renderChips()
          },
        }),
      ),
    )
  }

  function renderSegs() {
    modeRow.replaceChildren(
      ...modeOptions.map((item) =>
        el('button', {
          class: `seg-btn ${mode === item.key ? 'active' : ''}`,
          text: item.label,
          onclick: () => {
            mode = item.key
            renderSegs()
          },
        }),
      ),
    )
    limitRow.replaceChildren(
      ...[0, 10, 20, 30].map((value) =>
        el('button', {
          class: `seg-btn ${limit === value ? 'active' : ''}`,
          text: value ? `${value} 题` : '全部',
          onclick: () => {
            limit = value
            renderSegs()
          },
        }),
      ),
    )
    orderRow.replaceChildren(
      ...[
        { key: 'random', label: '随机' },
        { key: 'hard', label: '错得多先做' },
      ].map((item) =>
        el('button', {
          class: `seg-btn ${order === item.key ? 'active' : ''}`,
          text: item.label,
          onclick: () => {
            order = item.key
            renderSegs()
          },
        }),
      ),
    )
  }

  renderChips()
  renderSegs()

  const body = el(
    'div',
    { class: 'paper-setup' },
    el('div', { class: 'paper-label', text: '哪些小类目' }),
    chips,
    el('div', { class: 'paper-label', text: '出哪些题' }),
    modeRow,
    el('div', { class: 'paper-label', text: '出多少题' }),
    limitRow,
    el('div', { class: 'paper-label', text: '顺序' }),
    orderRow,
  )

  const answer = await dialog({
    title: '生成一张卷子',
    body,
    actions: [
      { label: '取消', value: null, kind: 'ghost' },
      { label: '导出 PDF', value: 'pdf', kind: 'ghost' },
      { label: '开始做', value: 'start', kind: 'primary' },
    ],
  })
  if (!answer) return null

  // 过滤
  const pool = groups.filter((group) => {
    if (!picked.has(group.subcategoryId)) return false
    if (mode === 'wrong') return group.status === 'wrong'
    if (mode === 'star') return Boolean(group.starred)
    if (mode === 'missed') return (group.wrongCount || 0) > 0
    return true
  })

  if (!pool.length) {
    toast('这个条件下没有题目', 'info')
    return null
  }

  const sorted = [...pool]
  if (order === 'hard') {
    sorted.sort((a, b) => (b.wrongCount || 0) - (a.wrongCount || 0))
  } else {
    for (let i = sorted.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[sorted[i], sorted[j]] = [sorted[j], sorted[i]]
    }
  }

  const list = limit ? sorted.slice(0, limit) : sorted
  return { list, action: answer }
}

/** 在应用里按顺序做这一套。 */
export function startPaper(list) {
  if (!list.length) {
    toast('这套卷子是空的', 'info')
    return
  }

  let index = 0
  let revealed = false
  let finished = false
  const results = []
  const urls = []
  const shots = []

  const scroll = el('div', { class: 'paper-scroll' })
  const progress = el('span', { class: 'paper-progress' })
  const judgeRow = el('div', { class: 'row row-judge' })
  const revealRow = el('div', { class: 'row row-left' })

  const closeButton = el('button', {
    class: 'dlg-x',
    text: '×',
    title: '关闭',
    onclick: () => overlay.remove(),
  })

  const finishBox = el('div', { class: 'paper-finish', hidden: true })

  const bar = el(
    'div',
    { class: 'paper-bar' },
    revealRow,
    judgeRow,
    el('div', { class: 'row row-nav' }, el('span', { class: 'quiz-hint', text: '卷子里不计入做题记录' })),
  )

  const overlay = el(
    'div',
    { class: 'paper-overlay' },
    el('div', { class: 'paper-head' }, progress, closeButton),
    scroll,
    bar,
    finishBox,
  )

  function release() {
    for (const url of urls) URL.revokeObjectURL(url)
    urls.length = 0
    for (const shot of shots) shot.reset()
    shots.length = 0
    scroll.replaceChildren()
  }

  async function show() {
    release()
    revealed = false
    const group = list[index]
    progress.textContent = `${index + 1} / ${list.length}`

    const url = await getImageURL(group.questionImageId)
    if (!url) {
      scroll.append(el('div', { class: 'missing-image', text: '这张图找不到了' }))
      return
    }
    urls.push(url)
    const shot = createShot()
    shot.setSrc(url)
    shots.push(shot)

    scroll.append(
      el('div', { class: 'shot-label', text: `第 ${index + 1} 题` }),
      shot.el,
    )
    scroll.scrollTop = 0

    revealRow.replaceChildren(
      el('button', {
        class: 'btn btn-sm',
        text: '显示解析',
        onclick: () => reveal(),
      }),
    )
    revealRow.hidden = false

    judgeRow.replaceChildren(
      ...[
        { key: 'right', label: '做对', cls: 'btn btn-lg btn-ok' },
        { key: 'wrong', label: '做错', cls: 'btn btn-lg btn-warn' },
        { key: 'skip', label: '跳过', cls: 'btn btn-lg' },
      ].map((item) =>
        el('button', {
          class: item.cls,
          text: item.label,
          onclick: () => judge(item.key),
        }),
      ),
    )
  }

  async function reveal() {
    if (revealed) return
    revealed = true
    const group = list[index]
    const ids = group.explanationImageIds || []
    if (!ids.length) {
      scroll.append(el('div', { class: 'no-explanation', text: '本题无解析' }))
      return
    }
    scroll.append(el('div', { class: 'shot-label', text: '解析' }))
    for (const [i, imageId] of ids.entries()) {
      const url = await getImageURL(imageId)
      if (!url) continue
      urls.push(url)
      const shot = createShot()
      shot.setSrc(url)
      shots.push(shot)
      scroll.append(shot.el)
    }
    const labels = scroll.querySelectorAll('.shot-label')
    if (labels.length > 1) labels[1].scrollIntoView({ block: 'start' })
  }

  function judge(result) {
    results.push(result)
    if (index + 1 >= list.length) {
      finish()
      return
    }
    index += 1
    show()
  }

  function finish() {
    finished = true
    release()
    scroll.replaceChildren()
    bar.hidden = true
    progress.textContent = '完成'
    const right = results.filter((r) => r === 'right').length
    const wrong = results.filter((r) => r === 'wrong').length
    const skip = results.filter((r) => r === 'skip').length
    finishBox.hidden = false
    finishBox.replaceChildren(
      el('div', { class: 'empty-emoji', text: '🎉' }),
      el('p', { class: 'empty-title', text: '这套做完了' }),
      el('p', {
        class: 'empty-sub',
        text: `共 ${list.length} 题 · 做对 ${right} · 做错 ${wrong} · 跳过 ${skip}`,
      }),
      el('p', { class: 'hint', text: '卷子里的对错不计入题库，错题状态保持不变。' }),
      el('button', {
        class: 'btn btn-sm',
        text: '关闭',
        onclick: () => overlay.remove(),
      }),
    )
  }

  document.body.append(overlay)
  show()
  return overlay
}

/** 生成打印页并调起系统打印（可选"另存为 PDF"）。 */
export async function exportPaperPDF(list) {
  if (!list.length) return
  toast('正在准备 PDF…', 'info')

  const root = el('div', { class: 'print-root' })
  const urls = []

  async function makeImage(imageId) {
    const url = await getImageURL(imageId)
    if (!url) return null
    urls.push(url)
    const img = el('img', { class: 'print-img', alt: '' })
    img.src = url
    await new Promise((resolve) => {
      if (img.complete) resolve()
      else {
        img.onload = resolve
        img.onerror = resolve
      }
    })
    return img
  }

  // 题目页
  for (const [i, group] of list.entries()) {
    const img = await makeImage(group.questionImageId)
    root.append(
      el(
        'section',
        { class: 'print-item' },
        el('div', { class: 'print-title', text: `第 ${i + 1} 题` }),
        img || el('div', { class: 'print-missing', text: '图片丢失' }),
      ),
    )
  }

  // 最后统一放解析
  const hasAny = list.some((group) => (group.explanationImageIds || []).length > 0)
  if (hasAny) {
    root.append(el('h2', { class: 'print-heading', text: '解析' }))
    for (const [i, group] of list.entries()) {
      const ids = group.explanationImageIds || []
      if (!ids.length) continue
      root.append(el('div', { class: 'print-sub', text: `第 ${i + 1} 题` }))
      for (const imageId of ids) {
        const img = await makeImage(imageId)
        if (img) root.append(el('div', { class: 'print-item' }, img))
      }
    }
  }

  document.body.append(root)
  await new Promise((resolve) => setTimeout(resolve, 300))

  try {
    window.print()
  } finally {
    setTimeout(() => {
      root.remove()
      for (const url of urls) URL.revokeObjectURL(url)
    }, 3000)
  }
}
