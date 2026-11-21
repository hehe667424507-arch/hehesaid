// 应用入口：类目选择、统计、四个页面的切换。

import { el, toast, askText } from './ui.js'
import { initStorage, storageMode } from './storage.js'
import {
  ensureDefaultCategory,
  listCategories,
  createCategory,
  deleteCategory,
  categoryStats,
  getSettings,
} from './repo.js'
import { createQuizView } from './quiz.js'
import { createIngestView } from './ingest.js'
import { createListsView } from './lists.js'
import { createSettingsView } from './settings.js'

const STORAGE_KEY = 'quiz.currentCategory'

const categorySelect = document.getElementById('categorySelect')
const addCategoryBtn = document.getElementById('btnAddCategory')
const statsBox = document.getElementById('stats')
const tabBar = document.getElementById('tabbar')
const sections = {
  quiz: document.getElementById('view-quiz'),
  ingest: document.getElementById('view-ingest'),
  lists: document.getElementById('view-lists'),
  settings: document.getElementById('view-settings'),
}

let categories = []
let currentCategoryId = localStorage.getItem(STORAGE_KEY) || null
let activeTab = 'quiz'
let views = {}

function getCategoryId() {
  return currentCategoryId
}

async function refreshStats() {
  if (!currentCategoryId) {
    statsBox.replaceChildren(el('span', { class: 'stat', text: '还没有类目' }))
    return
  }
  const stats = await categoryStats(currentCategoryId)
  statsBox.replaceChildren(
    el('span', { class: 'stat' }, el('b', { text: String(stats.new) }), ' 未看'),
    el('span', { class: 'stat' }, el('b', { text: String(stats.wrong) }), ' 错题'),
    el('span', { class: 'stat' }, el('b', { text: String(stats.done) }), ' 已做对'),
  )
}

function renderCategorySelect() {
  categorySelect.replaceChildren(
    ...categories.map((row) => el('option', { value: row.id, text: row.name })),
  )
  if (!categories.length) {
    categorySelect.append(el('option', { value: '', text: '（还没有类目）' }))
  }
  if (!currentCategoryId || !categories.some((row) => row.id === currentCategoryId)) {
    currentCategoryId = categories[0] ? categories[0].id : null
    if (currentCategoryId) localStorage.setItem(STORAGE_KEY, currentCategoryId)
  }
  if (currentCategoryId) categorySelect.value = currentCategoryId
}

async function reloadCategories() {
  categories = await listCategories()
  renderCategorySelect()
  await refreshStats()
}

function setTab(name) {
  activeTab = name
  for (const [key, section] of Object.entries(sections)) {
    section.hidden = key !== name
  }
  for (const button of tabBar.querySelectorAll('.tab')) {
    button.classList.toggle('active', button.dataset.tab === name)
  }
  const view = views[name]
  if (view && typeof view.onShow === 'function') {
    view.onShow().catch((error) => toast(error.message || '页面加载失败', 'error'))
  }
}

async function onCategoryChanged() {
  localStorage.setItem(STORAGE_KEY, currentCategoryId || '')
  await refreshStats()
  for (const [key, view] of Object.entries(views)) {
    if (key !== 'settings' && typeof view.reload === 'function') {
      await view.reload().catch(() => {})
    }
  }
}

function buildViews() {
  const common = {
    getCategoryId,
    refreshStats,
    onDataChanged: refreshStats,
    goQuiz: () => setTab('quiz'),
  }
  views = {
    quiz: createQuizView(common),
    ingest: createIngestView(common),
    lists: createListsView(common),
    settings: createSettingsView({
      onDataChanged: refreshAll,
      refreshAll: async () => {
        await reloadCategories()
        if (views.quiz) await views.quiz.reload().catch(() => {})
        if (views.lists) await views.lists.reload().catch(() => {})
        await refreshStats()
      },
      onCategoriesChanged: async () => {
        await reloadCategories()
        if (views.quiz) await views.quiz.reload().catch(() => {})
        if (views.lists) await views.lists.reload().catch(() => {})
      },
    }),
  }

  for (const [key, view] of Object.entries(views)) {
    sections[key].replaceChildren(view.el)
  }
}

async function refreshAll() {
  await refreshStats()
}

async function boot() {
  // 尽早注册 Service Worker：它负责让应用壳离线可用、让手机能装到主屏幕。
  // 不能等 load 事件——模块脚本执行时 load 可能已经过去了。
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {
      // 注册失败不影响正常使用，只是不能离线打开。
    })
  }

  await initStorage()
  if (storageMode() === 'idb') {
    toast('这台浏览器不支持本地文件存储，图片改存在数据库里（仍然只在本机）', 'info')
  }

  categories = await ensureDefaultCategory()
  renderCategorySelect()

  buildViews()

  categorySelect.addEventListener('change', async () => {
    currentCategoryId = categorySelect.value || null
    await onCategoryChanged()
  })

  addCategoryBtn.addEventListener('click', async () => {
    const name = await askText('新建类目', { placeholder: '比如：数学、竞赛、英语' })
    if (!name) return
    try {
      const category = await createCategory(name)
      await reloadCategories()
      currentCategoryId = category.id
      categorySelect.value = category.id
      await onCategoryChanged()
      toast(`已新建「${category.name}」`, 'ok')
    } catch (error) {
      toast(error.message || '新建失败', 'error')
    }
  })

  tabBar.addEventListener('click', (event) => {
    const button = event.target.closest('.tab')
    if (!button) return
    setTab(button.dataset.tab)
  })

  await refreshStats()
  setTab('quiz')

  document.body.classList.add('ready')
  const settings = await getSettings()
  document.documentElement.dataset.quality = settings.quality
}

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  toast(reason && reason.message ? reason.message : '出现了一个错误，请重试', 'error')
})

boot().catch((error) => {
  console.error(error)
  document.body.append(
    el(
      'div',
      { class: 'fatal' },
      el('h1', { text: '启动失败' }),
      el('p', { text: error && error.message ? error.message : String(error) }),
      el('p', {
        text: '请确认是通过 http://127.0.0.1:8080 打开本应用，而不是直接双击 index.html。',
      }),
    ),
  )
})

// 供设置页删除类目后复用。
window.__quizApp = {
  reloadCategories,
  get currentCategoryId() {
    return currentCategoryId
  },
  async deleteCategoryById(id) {
    await deleteCategory(id)
    await reloadCategories()
    await onCategoryChanged()
  },
  async listCategories() {
    return listCategories()
  },
}
