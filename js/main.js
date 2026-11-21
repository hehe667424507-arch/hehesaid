// 应用入口：大类目 / 小类目选择、统计、四个页面的切换。

import { el, toast, askText } from './ui.js'
import { initStorage, storageMode } from './storage.js'
import {
  ALL_SUBCATEGORIES,
  ensureDefaultCategory,
  listCategories,
  createCategory,
  deleteCategory,
  listSubcategories,
  subcategoryGroupCounts,
  createSubcategory,
  deleteSubcategory,
  categoryStats,
  getSettings,
} from './repo.js'
import { createQuizView } from './quiz.js'
import { createTodayView } from './today.js'
import { createIngestView } from './ingest.js'
import { createListsView } from './lists.js'
import { createSettingsView } from './settings.js'

const KEY_CATEGORY = 'quiz.currentCategory'
const KEY_SUBCATEGORY = 'quiz.currentSubcategory'

const categorySelect = document.getElementById('categorySelect')
const subcategorySelect = document.getElementById('subcategorySelect')
const addCategoryBtn = document.getElementById('btnAddCategory')
const statsBox = document.getElementById('stats')
const tabBar = document.getElementById('tabbar')
const sections = {
  quiz: document.getElementById('view-quiz'),
  today: document.getElementById('view-today'),
  ingest: document.getElementById('view-ingest'),
  lists: document.getElementById('view-lists'),
  settings: document.getElementById('view-settings'),
}

let categories = []
let subcategories = []
let currentCategoryId = localStorage.getItem(KEY_CATEGORY) || null
let currentSubcategoryId = localStorage.getItem(KEY_SUBCATEGORY) || ALL_SUBCATEGORIES
let activeTab = 'quiz'
let views = {}

function getCategoryId() {
  return currentCategoryId
}

function getSubcategoryId() {
  return currentSubcategoryId
}

function currentCategoryName() {
  const row = categories.find((item) => item.id === currentCategoryId)
  return row ? row.name : ''
}

function currentSubcategoryName() {
  const row = subcategories.find((item) => item.id === currentSubcategoryId)
  return row ? row.name : ''
}

async function refreshStats() {
  if (!currentCategoryId) {
    statsBox.replaceChildren(el('span', { class: 'stat', text: '还没有大类目' }))
    return
  }
  const stats = await categoryStats(currentCategoryId, currentSubcategoryId)
  const scope = currentSubcategoryId ? currentSubcategoryName() : '全部小类目'
  statsBox.replaceChildren(
    el('span', { class: 'stat stat-scope', title: `统计范围：${scope}`, text: scope }),
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
    categorySelect.append(el('option', { value: '', text: '（还没有大类目）' }))
  }
  if (!currentCategoryId || !categories.some((row) => row.id === currentCategoryId)) {
    currentCategoryId = categories[0] ? categories[0].id : null
    localStorage.setItem(KEY_CATEGORY, currentCategoryId || '')
  }
  if (currentCategoryId) categorySelect.value = currentCategoryId
}

function renderSubcategorySelect() {
  const options = [el('option', { value: ALL_SUBCATEGORIES, text: '全部小类目' })]
  for (const row of subcategories) {
    options.push(el('option', { value: row.id, text: row.name }))
  }
  if (!subcategories.length) {
    options.push(el('option', { value: '', text: '（还没有小类目，去「录入」或「设置」里建）' }))
  }
  subcategorySelect.replaceChildren(...options)
  subcategorySelect.value = currentSubcategoryId || ALL_SUBCATEGORIES
  subcategorySelect.disabled = !subcategories.length
}

async function reloadCategories() {
  categories = await listCategories()
  renderCategorySelect()
  await reloadSubcategories()
  await refreshStats()
}

async function reloadSubcategories() {
  subcategories = currentCategoryId ? await listSubcategories(currentCategoryId) : []
  if (
    currentSubcategoryId &&
    !subcategories.some((row) => row.id === currentSubcategoryId)
  ) {
    currentSubcategoryId = ALL_SUBCATEGORIES
    localStorage.setItem(KEY_SUBCATEGORY, '')
  }
  renderSubcategorySelect()
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

async function reloadActiveView() {
  const view = views[activeTab]
  if (view && typeof view.reload === 'function') {
    await view.reload().catch(() => {})
  }
}

async function setSubcategoryId(id) {
  currentSubcategoryId = id || ALL_SUBCATEGORIES
  localStorage.setItem(KEY_SUBCATEGORY, currentSubcategoryId)
  subcategorySelect.value = currentSubcategoryId || ALL_SUBCATEGORIES
  await refreshStats()
}

async function onScopeChanged() {
  localStorage.setItem(KEY_CATEGORY, currentCategoryId || '')
  localStorage.setItem(KEY_SUBCATEGORY, currentSubcategoryId || '')
  await refreshStats()
  for (const [key, view] of Object.entries(views)) {
    if (key === 'settings') continue
    if (typeof view.reload === 'function') await view.reload().catch(() => {})
  }
}

function buildViews() {
  const common = {
    getCategoryId,
    getSubcategoryId,
    refreshStats,
    refreshSubcategories: reloadSubcategories,
    setSubcategoryId,
    onDataChanged: refreshStats,
    goQuiz: () => setTab('quiz'),
    goSettings: () => setTab('settings'),
    onScopeChanged,
  }
  views = {
    quiz: createQuizView(common),
    today: createTodayView({
      refreshStats,
      onDataChanged: async () => {
        await refreshStats()
      },
    }),
    ingest: createIngestView(common),
    lists: createListsView(common),
    settings: createSettingsView({
      ...common,
      refreshAll: async () => {
        await reloadCategories()
        if (views.quiz) await views.quiz.reload().catch(() => {})
        if (views.lists) await views.lists.reload().catch(() => {})
        await refreshStats()
      },
    }),
  }

  for (const [key, view] of Object.entries(views)) {
    sections[key].replaceChildren(view.el)
  }
}

async function boot() {
  // 尽早注册 Service Worker：它负责让应用壳离线可用、让手机能装到主屏幕。
  // updateViaCache:'none' 让浏览器每次都去核对 sw.js，不被 HTTP 缓存挡住。
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    const hadController = Boolean(navigator.serviceWorker.controller)
    let reloading = false

    // 新版本接管并开始控制页面时，自动刷新一次，这样更新完打开就是新版，
    // 不用用户自己去清缓存。首次安装不会触发刷新。
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return
      reloading = true
      location.reload()
    })

    navigator.serviceWorker
      .register('sw.js', { updateViaCache: 'none' })
      .then((registration) => {
        const check = () => registration.update().catch(() => {})
        // 回到前台时、以及每小时检查一次有没有新版本。
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'visible') check()
        })
        setInterval(check, 60 * 60 * 1000)
      })
      .catch(() => {
        // 注册失败不影响正常使用，只是不能离线打开。
      })
  }

  await initStorage()
  if (storageMode() === 'idb') {
    toast('这台浏览器不支持本地文件存储，图片改存在数据库里（仍然只在本机）', 'info')
  }

  categories = await ensureDefaultCategory()
  renderCategorySelect()
  await reloadSubcategories()

  buildViews()

  categorySelect.addEventListener('change', async () => {
    currentCategoryId = categorySelect.value || null
    // 换大类目时小类目回到「全部」，避免看到别的类目的选项。
    currentSubcategoryId = ALL_SUBCATEGORIES
    await reloadSubcategories()
    await onScopeChanged()
    await reloadActiveView()
  })

  subcategorySelect.addEventListener('change', async () => {
    currentSubcategoryId = subcategorySelect.value || ALL_SUBCATEGORIES
    await onScopeChanged()
    await reloadActiveView()
  })

  addCategoryBtn.addEventListener('click', async () => {
    const name = await askText('新建大类目', { placeholder: '比如：数学、竞赛、英语' })
    if (!name) return
    try {
      const category = await createCategory(name)
      await reloadCategories()
      currentCategoryId = category.id
      currentSubcategoryId = ALL_SUBCATEGORIES
      categorySelect.value = category.id
      await onScopeChanged()
      await reloadActiveView()
      toast(`已新建大类目「${category.name}」，记得在「设置」里加小类目`, 'ok')
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

// 供设置页复用。
window.__quizApp = {
  reloadCategories,
  reloadSubcategories,
  getCategoryId,
  getSubcategoryId,
  get currentCategoryId() {
    return currentCategoryId
  },
  get currentSubcategoryId() {
    return currentSubcategoryId
  },
  async listCategories() {
    return listCategories()
  },
  async listSubcategories(categoryId) {
    return listSubcategories(categoryId)
  },
  async subcategoryCounts(categoryId) {
    return subcategoryGroupCounts(categoryId)
  },
  async createSubcategory(categoryId, name) {
    const sub = await createSubcategory(categoryId, name)
    await reloadSubcategories()
    await refreshStats()
    return sub
  },
  async deleteSubcategory(subId) {
    const result = await deleteSubcategory(subId)
    await reloadSubcategories()
    await refreshStats()
    return result
  },
  async deleteCategoryById(id) {
    await deleteCategory(id)
    await reloadCategories()
    await onScopeChanged()
  },
  async refreshStats() {
    await refreshStats()
  },
}
