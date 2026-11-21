// 题库页：未看 / 错题 / 已做对 三个列表，缩略图懒加载，可重置或删除单题。

import { el, toast, confirmDialog, dialog, formatTime } from './ui.js'
import { createShot } from './viewer.js'
import { STATUS, listGroups, resetGroup, resetCategory, deleteGroup } from './repo.js'
import { getImageURL } from './storage.js'

const TABS = [
  { key: 'new', label: '未看' },
  { key: 'wrong', label: '错题' },
  { key: 'done', label: '已做对' },
]

export function createListsView({ getCategoryId, refreshStats, onDataChanged, goQuiz }) {
  let activeTab = 'new'
  let groups = []
  let observer = null
  const urls = new Map() // imageId -> objectURL

  const tabBar = el('div', { class: 'seg' })
  const listBox = el('div', { class: 'list-box' })
  const summary = el('div', { class: 'list-summary' })

  const root = el('div', { class: 'lists' }, summary, tabBar, listBox)

  function freeUrls() {
    for (const url of urls.values()) URL.revokeObjectURL(url)
    urls.clear()
  }

  function ensureObserver() {
    if (observer) return observer
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          const img = entry.target
          observer.unobserve(img)
          loadThumb(img)
        }
      },
      { root: null, rootMargin: '300px 0px', threshold: 0.01 },
    )
    return observer
  }

  async function loadThumb(img) {
    const id = img.dataset.imageId
    if (!id || img.getAttribute('src')) return
    try {
      let url = urls.get(id)
      if (!url) {
        url = await getImageURL(id)
        if (!url) {
          img.classList.add('thumb-fail')
          img.alt = '图片丢失'
          return
        }
        urls.set(id, url)
      }
      img.src = url
    } catch {
      img.classList.add('thumb-fail')
    }
  }

  async function openPreview(group) {
    const dlg = el('dialog', { class: 'dlg dlg-preview' })
    const content = el('div', { class: 'preview-body' })
    const tempUrls = []
    const shotList = []
    const add = async (imageId, label) => {
      const url = await getImageURL(imageId)
      if (!url) {
        content.append(el('div', { class: 'missing-image', text: `${label} 图片丢失` }))
        return
      }
      tempUrls.push(url)
      const shot = createShot()
      shot.setSrc(url)
      shotList.push(shot)
      content.append(el('div', { class: 'shot-label', text: label }), shot.el)
    }
    await add(group.questionImageId, '题目')
    const ids = group.explanationImageIds || []
    for (const [index, id] of ids.entries()) await add(id, `解析 ${index + 1}`)
    if (!ids.length) content.append(el('div', { class: 'no-explanation', text: '本题没有解析图' }))

    dlg.append(
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
            onclick: () => dlg.close(),
          }),
        ),
        content,
      ),
    )
    dlg.addEventListener('close', () => {
      for (const url of tempUrls) URL.revokeObjectURL(url)
      dlg.remove()
    })
    document.body.append(dlg)
    dlg.showModal()
  }

  function renderTabs() {
    tabBar.replaceChildren(
      ...TABS.map((tab) => {
        const count = groups.filter((group) => group.status === tab.key).length
        return el('button', {
          class: `seg-btn ${activeTab === tab.key ? 'active' : ''}`,
          text: `${tab.label} ${count}`,
          onclick: () => {
            if (activeTab === tab.key) return
            activeTab = tab.key
            freeUrls()
            renderTabs()
            renderList()
          },
        })
      }),
    )
  }

  function itemFor(group, index) {
    const explanationCount = (group.explanationImageIds || []).length
    const img = el('img', {
      class: 'thumb-img',
      alt: '',
      loading: 'lazy',
      dataset: { imageId: group.questionImageId },
    })

    const row = el(
      'div',
      { class: 'list-item' },
      el('div', { class: 'thumb-frame' }, img),
      el(
        'div',
        { class: 'list-info' },
        el('div', { class: 'list-title', text: `第 ${index + 1} 题 · 解析 ${explanationCount} 张` }),
        el('div', {
          class: 'list-meta',
          text: `做过 ${group.attempts || 0} 次 · 最后 ${
            group.lastAt ? formatTime(group.lastAt) : '—'
          }`,
        }),
        el('div', {
          class: 'list-sub',
          text:
            group.lastResult === 'right'
              ? '上次结果：做对'
              : group.lastResult === 'wrong'
                ? '上次结果：做错'
                : group.lastResult === 'skip'
                  ? '上次结果：跳过'
                  : '还没做过',
        }),
      ),
      el(
        'div',
        { class: 'list-actions' },
        el('button', {
          class: 'btn btn-sm',
          text: '预览',
          onclick: () => openPreview(group),
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

    ensureObserver().observe(img)
    return row
  }

  function renderList() {
    const filtered = groups.filter((group) => group.status === activeTab)
    if (!filtered.length) {
      listBox.replaceChildren(
        el(
          'div',
          { class: 'empty' },
          el('div', { class: 'empty-emoji', text: activeTab === 'new' ? '📥' : activeTab === 'wrong' ? '🎯' : '✅' }),
          el('p', {
            class: 'empty-title',
            text:
              activeTab === 'new'
                ? '没有未看的题'
                : activeTab === 'wrong'
                  ? '没有错题，挺厉害'
                  : '还没有做对的题',
          }),
          el('p', { class: 'empty-sub', text: activeTab === 'new' ? '去「录入」页加题吧。' : '' }),
        ),
      )
      return
    }
    listBox.replaceChildren(...filtered.map((group, index) => itemFor(group, groups.indexOf(group))))
  }

  async function refreshAll() {
    const categoryId = getCategoryId()
    groups = categoryId ? await listGroups(categoryId) : []
    freeUrls()
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
    const total = groups.length
    const bytes = groups.reduce((sum, group) => sum + (group.attempts || 0), 0)
    summary.replaceChildren(
      el('span', { text: `本类目 ${total} 题 · 累计作答 ${bytes} 次` }),
      el('button', {
        class: 'btn btn-sm btn-danger-ghost',
        text: '重置整个类目进度',
        onclick: async () => {
          const ok = await confirmDialog(
            `把「当前类目」下全部 ${total} 道题都重置为未看？做题次数会清零，题目和图片不会删除。`,
            { title: '重置类目进度', okText: '全部重置', danger: true },
          )
          if (!ok) return
          const count = await resetCategory(categoryId)
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
      freeUrls()
      observer?.disconnect()
    },
    goQuiz,
  }
}
