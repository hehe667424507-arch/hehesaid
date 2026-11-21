// 「今天」页：按最后做题时间倒序列出今天做过的题，点开可以回看、改判、存图。

import { el, toast } from './ui.js'
import { getAll } from './db.js'
import { STATUS } from './repo.js'
import { openPreview } from './preview.js'
import { getThumbURL } from './thumb.js'

const RESULT_LABEL = { right: '做对', wrong: '做错', skip: '跳过' }

function timeOf(ms) {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

export function createTodayView({ refreshStats, onDataChanged }) {
  const summary = el('div', { class: 'list-summary' })
  const listBox = el('div', { class: 'today-list' })
  const root = el('div', { class: 'today' }, summary, listBox)

  let observer = null
  const pending = new WeakMap()

  function ensureObserver() {
    if (observer) return observer
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const img = entry.target
          observer.unobserve(img)
          const imageId = pending.get(img)
          if (!imageId) continue
          getThumbURL(imageId)
            .then((url) => {
              if (url) img.src = url
            })
            .catch(() => img.classList.add('thumb-fail'))
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0.01 },
    )
    return observer
  }

  function renderEmpty() {
    listBox.replaceChildren(
      el(
        'div',
        { class: 'empty' },
        el('div', { class: 'empty-emoji', text: '🌤️' }),
        el('p', { class: 'empty-title', text: '今天还没刷题' }),
        el('p', { class: 'empty-sub', text: '去「刷题」抽一题，做完就会出现在这里。' }),
      ),
    )
  }

  async function load() {
    const [groups, categories, subs] = await Promise.all([
      getAll('groups'),
      getAll('categories'),
      getAll('subcategories'),
    ])

    const since = startOfToday()
    const today = groups
      .filter((group) => (group.lastAt || 0) >= since)
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))

    const categoryName = new Map(categories.map((row) => [row.id, row.name]))
    const subName = new Map(subs.map((row) => [row.id, row.name]))

    const right = today.filter((group) => group.lastResult === 'right').length
    const wrong = today.filter((group) => group.lastResult === 'wrong').length
    const skipped = today.filter((group) => group.lastResult === 'skip').length

    summary.replaceChildren(
      el('span', {
        text: today.length
          ? `今天做了 ${today.length} 题 · 做对 ${right} · 做错 ${wrong} · 跳过 ${skipped}`
          : '今天还没有记录',
      }),
    )

    if (!today.length) {
      renderEmpty()
      return
    }

    const rows = today.map((group) => {
      const img = el('img', { class: 'thumb-img', alt: '', loading: 'lazy' })
      pending.set(img, group.questionImageId)
      ensureObserver().observe(img)

      const statusText =
        group.status === STATUS.DONE ? '已做对' : group.status === STATUS.WRONG ? '错题' : '未看'
      const resultText = RESULT_LABEL[group.lastResult] || '—'

      return el(
        'div',
        {
          class: 'today-item',
          onclick: () =>
            openPreview(group, {
              onChanged: async () => {
                await load()
                await refreshStats()
                await onDataChanged?.()
              },
            }),
        },
        el('div', { class: 'thumb-frame' }, img),
        el(
          'div',
          { class: 'today-body' },
          el('div', {
            class: 'today-title',
            text: `${categoryName.get(group.categoryId) || '未分类'} · ${subName.get(group.subcategoryId) || '未分类'}`,
          }),
          el('div', {
            class: 'today-meta',
            text: `${timeOf(group.lastAt)} · ${resultText} · ${statusText} · 做过 ${group.attempts || 0} 次`,
          }),
        ),
        el('span', { class: `today-badge ${group.lastResult || ''}`, text: resultText }),
      )
    })

    listBox.replaceChildren(...rows)
  }

  return {
    el: root,
    async onShow() {
      await load()
    },
    async reload() {
      await load()
    },
    destroy() {
      observer?.disconnect()
    },
  }
}
