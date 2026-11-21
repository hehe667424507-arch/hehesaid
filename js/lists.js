// 题库页：今天 / 未看 / 错题 / 已做对 四个列表。
// 除「今天」外都按当前大类目 + 小类目筛选；「今天」按大类目显示今天做过的题。

import { el, toast, confirmDialog, formatTime } from './ui.js'
import { openPreview } from './preview.js'
import { getThumbURL } from './thumb.js'
import {
  STATUS,
  listGroups,
  listSubcategories,
  resetGroup,
  resetCategory,
  deleteGroup,
} from './repo.js'

const TABS = [
  { key: 'today', label: '今天' },
  { key: 'new', label: '未看' },
  { key: 'wrong', label: '错题' },
  { key: 'done', label: '已做对' },
]

const RESULT_LABEL = { right: '做对', wrong: '做错', skip: '跳过' }

function startOfToday() {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function timeOf(ms) {
  const date = new Date(ms)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

export function createListsView({ getCategoryId, getSubcategoryId, refreshStats, onDataChanged }) {
  let activeTab = 'new'
  let groups = []
  let todayGroups = []
  let subcategoryNames = new Map()
  let observer = null
  const pending = new WeakMap()

  const tabBar = el('div', { class: 'seg seg-4' })
  const listBox = el('div', { class: 'list-box' })
  const summary = el('div', { class: 'list-summary' })

  const root = el('div', { class: 'lists' }, summary, tabBar, listBox)

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
              else {
                img.classList.add('thumb-fail')
                img.alt = '图片丢失'
              }
            })
            .catch(() => img.classList.add('thumb-fail'))
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0.01 },
    )
    return observer
  }

  function thumbFor(group) {
    const img = el('img', { class: 'thumb-img', alt: '', loading: 'lazy' })
    pending.set(img, group.questionImageId)
    ensureObserver().observe(img)
    return img
  }

  function renderTabs() {
    tabBar.replaceChildren(
      ...TABS.map((tab) => {
        const count =
          tab.key === 'today'
            ? todayGroups.length
            : groups.filter((group) => group.status === tab.key).length
        return el('button', {
          class: `seg-btn ${activeTab === tab.key ? 'active' : ''}`,
          text: `${tab.label} ${count}`,
          onclick: () => {
            if (activeTab === tab.key) return
            activeTab = tab.key
            renderTabs()
            renderList()
            renderSummary()
          },
        })
      }),
    )
  }

  function openItem(group) {
    return openPreview(group, {
      onChanged: async () => {
        await refreshAll()
      },
    })
  }

  function todayItemFor(group) {
    const subName = subcategoryNames.get(group.subcategoryId) || '未分类'
    const statusText =
      group.status === STATUS.DONE ? '已做对' : group.status === STATUS.WRONG ? '错题' : '未看'
    return el(
      'div',
      { class: 'list-item', onclick: () => openItem(group) },
      el('div', { class: 'thumb-frame' }, thumbFor(group)),
      el(
        'div',
        { class: 'list-info' },
        el('div', { class: 'list-title', text: subName }),
        el('div', {
          class: 'list-meta',
          text: `${timeOf(group.lastAt)} · ${RESULT_LABEL[group.lastResult] || '—'} · ${statusText}`,
        }),
        el('div', { class: 'list-sub', text: `做过 ${group.attempts || 0} 次` }),
      ),
      el('span', { class: `today-badge ${group.lastResult || ''}`, text: RESULT_LABEL[group.lastResult] || '' }),
    )
  }

  function itemFor(group) {
    const explanationCount = (group.explanationImageIds || []).length
    const subName = subcategoryNames.get(group.subcategoryId) || '未分类'

    return el(
      'div',
      { class: 'list-item' },
      el('div', { class: 'thumb-frame', onclick: () => openItem(group) }, thumbFor(group)),
      el(
        'div',
        { class: 'list-info', onclick: () => openItem(group) },
        el('div', { class: 'list-title', text: subName }),
        el('div', {
          class: 'list-meta',
          text: `解析 ${explanationCount} 张 · 做过 ${group.attempts || 0} 次`,
        }),
        el('div', {
          class: 'list-sub',
          text: group.lastAt
            ? `最后 ${formatTime(group.lastAt)} · ${RESULT_LABEL[group.lastResult] || '—'}`
            : '还没做过',
        }),
      ),
      el(
        'div',
        { class: 'list-actions' },
        el('button', {
          class: 'btn btn-sm',
          text: '预览',
          onclick: () => openItem(group),
        }),
        el('button', {
          class: 'btn btn-sm',
          text: '重置',
          onclick: async () => {
            const ok = await confirmDialog('把这道题重置为「未看」，次数清零？', {
              title: '重置单题',
              okText: '重置',
            })
            if (!ok) return
            await resetGroup(group.id)
            toast('已重置', 'ok')
            await refreshAll()
          },
        }),
        el('button', {
          class: 'btn btn-sm btn-danger-ghost',
          text: '删除',
          onclick: async () => {
            const ok = await confirmDialog('删除这道题？题目图和解析图会一起删掉，不能恢复。', {
              title: '删除题目',
              okText: '删除',
              danger: true,
            })
            if (!ok) return
            await deleteGroup(group.id)
            toast('已删除', 'ok')
            await refreshAll()
          },
        }),
      ),
    )
  }

  function emptyState() {
    const map = {
      today: { emoji: '🌤️', title: '今天还没刷题', sub: '去「刷题」抽一题，做完就会出现在这里。' },
      new: { emoji: '📥', title: '没有未看的题', sub: '去「录入」页加题，或者换个范围看看。' },
      wrong: { emoji: '🎯', title: '没有错题，挺厉害', sub: '' },
      done: { emoji: '✅', title: '还没有做对的题', sub: '' },
    }
    const item = map[activeTab]
    return el(
      'div',
      { class: 'empty' },
      el('div', { class: 'empty-emoji', text: item.emoji }),
      el('p', { class: 'empty-title', text: item.title }),
      item.sub ? el('p', { class: 'empty-sub', text: item.sub }) : null,
    )
  }

  function renderList() {
    if (activeTab === 'today') {
      if (!todayGroups.length) {
        listBox.replaceChildren(emptyState())
        return
      }
      listBox.replaceChildren(...todayGroups.map((group) => todayItemFor(group)))
      return
    }

    const filtered = groups.filter((group) => group.status === activeTab)
    if (!filtered.length) {
      listBox.replaceChildren(emptyState())
      return
    }
    listBox.replaceChildren(...filtered.map((group) => itemFor(group)))
  }

  async function refreshAll() {
    const categoryId = getCategoryId()
    const [rangeGroups, categoryGroups, subs] = await Promise.all([
      categoryId ? listGroups(categoryId, getSubcategoryId()) : Promise.resolve([]),
      categoryId ? listGroups(categoryId) : Promise.resolve([]),
      categoryId ? listSubcategories(categoryId) : Promise.resolve([]),
    ])

    groups = rangeGroups
    subcategoryNames = new Map(subs.map((row) => [row.id, row.name]))

    // 「今天」看整个大类目，不受小类目筛选影响。
    const since = startOfToday()
    todayGroups = categoryGroups
      .filter((group) => (group.lastAt || 0) >= since)
      .sort((a, b) => (b.lastAt || 0) - (a.lastAt || 0))

    renderTabs()
    renderList()
    await renderSummary()
    await refreshStats()
    await onDataChanged?.()
  }

  async function renderSummary() {
    const categoryId = getCategoryId()
    if (!categoryId) {
      summary.replaceChildren()
      return
    }

    if (activeTab === 'today') {
      const right = todayGroups.filter((group) => group.lastResult === 'right').length
      const wrong = todayGroups.filter((group) => group.lastResult === 'wrong').length
      const skipped = todayGroups.filter((group) => group.lastResult === 'skip').length
      summary.replaceChildren(
        el('span', {
          text: todayGroups.length
            ? `今天做了 ${todayGroups.length} 题 · 做对 ${right} · 做错 ${wrong} · 跳过 ${skipped}`
            : '今天还没有记录',
        }),
      )
      return
    }

    const attempts = groups.reduce((sum, group) => sum + (group.attempts || 0), 0)
    const scope = getSubcategoryId()
      ? `小类目「${subcategoryNames.get(getSubcategoryId()) || '?'}」`
      : '整个大类目'
    summary.replaceChildren(
      el('span', { text: `${scope} · ${groups.length} 题 · 累计作答 ${attempts} 次` }),
      el('button', {
        class: 'btn btn-sm btn-danger-ghost',
        text: '重置当前范围进度',
        onclick: async () => {
          const ok = await confirmDialog(
            `把${scope}下全部 ${groups.length} 道题都重置为未看？做题次数会清零，题目和图片不会删除。`,
            { title: '重置进度', okText: '全部重置', danger: true },
          )
          if (!ok) return
          const count = await resetCategory(categoryId, getSubcategoryId())
          toast(`已重置 ${count} 道题`, 'ok')
          await refreshAll()
        },
      }),
    )
  }

  return {
    el: root,
    async onShow() {
      await refreshAll()
    },
    async reload() {
      await refreshAll()
    },
    destroy() {
      observer?.disconnect()
    },
  }
}
