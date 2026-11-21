// 业务层：大类目 / 小类目、题目组、抽题、统计。视图只通过这里读写数据。
//
// 两级分类：
//   categories（大类目，如「竞赛」）
//     └─ subcategories（小类目，如「第一章 极限」）
//          └─ groups（题目组）
// 每道题必须挂在一个小类目上；「全部」用一个空字符串表示，不在数据里存。

import {
  STATUS,
  FALLBACK_SUBCATEGORY,
  getAll,
  getOne,
  putOne,
  putMany,
  deleteOne,
  clearStore,
  groupsOfCategory,
  subcategoriesOfCategory,
  newId,
  getMeta,
  setMeta,
} from './db.js'
import { deleteImage, putImage } from './storage.js'

export { STATUS, FALLBACK_SUBCATEGORY }

/** 表示「整个大类目混抽 / 全部小类目」的空值。 */
export const ALL_SUBCATEGORIES = ''

const SETTINGS_KEY = 'settings'
const DEFAULT_SETTINGS = {
  quality: 'clear',
  wrongOnly: false,
  lastPicked: {}, // `${categoryId}:${subcategoryId}` -> groupId
}

export async function getSettings() {
  const saved = await getMeta(SETTINGS_KEY, null)
  return { ...DEFAULT_SETTINGS, ...(saved || {}) }
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch }
  await setMeta(SETTINGS_KEY, next)
  return next
}

// ———————————————— 大类目 ————————————————

export async function listCategories() {
  const rows = await getAll('categories')
  return rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function ensureDefaultCategory() {
  const rows = await listCategories()
  if (rows.length) return rows
  const category = { id: newId('cat'), name: '数学', createdAt: Date.now() }
  await putOne('categories', category)
  // 默认类目给一个「未分类」，这样第一次打开就能直接录题。
  await createSubcategory(category.id, FALLBACK_SUBCATEGORY, { silent: true })
  return [category]
}

export async function createCategory(name) {
  const clean = String(name || '').trim()
  if (!clean) throw new Error('大类目名不能为空')
  const exists = (await listCategories()).some((row) => row.name === clean)
  if (exists) throw new Error(`已经有一个叫「${clean}」的大类目了`)
  const category = { id: newId('cat'), name: clean, createdAt: Date.now() }
  await putOne('categories', category)
  return category
}

export async function deleteCategory(categoryId) {
  const groups = await groupsOfCategory(categoryId)
  const allGroups = await getAll('groups')
  const doomed = new Set(groups.map((group) => group.id))
  const others = allGroups.filter((group) => !doomed.has(group.id))
  const stillUsed = new Set(others.flatMap(referencedImageIds))

  const imageIds = new Set(groups.flatMap(referencedImageIds))
  for (const imageId of imageIds) {
    if (stillUsed.has(imageId)) continue
    try {
      await deleteImage(imageId)
    } catch {
      // 图片删不掉不该挡住删除类目。
    }
  }
  for (const group of groups) await deleteOne('groups', group.id)

  const subs = await subcategoriesOfCategory(categoryId)
  for (const sub of subs) await deleteOne('subcategories', sub.id)

  await deleteOne('categories', categoryId)
}

// ———————————————— 小类目 ————————————————

export async function listSubcategories(categoryId) {
  if (!categoryId) return []
  const rows = await subcategoriesOfCategory(categoryId)
  // 「未分类」排在最后，其余按创建时间。
  return rows.sort((a, b) => {
    if (Boolean(a.isDefault) !== Boolean(b.isDefault)) return a.isDefault ? 1 : -1
    return (a.createdAt || 0) - (b.createdAt || 0)
  })
}

export async function createSubcategory(categoryId, name, { silent = false } = {}) {
  if (!categoryId) throw new Error('请先选择大类目')
  const clean = String(name || '').trim()
  if (!clean) throw new Error('小类目名不能为空')
  if (clean.length > 30) throw new Error('小类目名太长了（最多 30 个字）')

  const rows = await listSubcategories(categoryId)
  const exists = rows.find((row) => row.name === clean)
  if (exists) {
    if (silent) return exists
    throw new Error(`「${clean}」已经存在了`)
  }
  const sub = {
    id: newId('sub'),
    categoryId,
    name: clean,
    createdAt: Date.now(),
    isDefault: clean === FALLBACK_SUBCATEGORY,
  }
  await putOne('subcategories', sub)
  return sub
}

/**
 * 删除小类目。若它下面还有题目，自动挪到同类目下的另一个小类目，
 * 一个都没有时拒绝删除，避免题目变成「无归属」。
 */
export async function deleteSubcategory(subId) {
  const sub = await getOne('subcategories', subId)
  if (!sub) return { moved: 0 }

  const groups = await getAll('groups')
  const affected = groups.filter((group) => group.subcategoryId === subId)

  if (affected.length) {
    const others = (await listSubcategories(sub.categoryId)).filter((row) => row.id !== subId)
    const target =
      others.find((row) => row.isDefault) ||
      others.find((row) => row.name === FALLBACK_SUBCATEGORY) ||
      others[0]
    if (!target) {
      throw new Error(
        `「${sub.name}」下还有 ${affected.length} 道题。请先在同一个大类目里新建一个小类目，把题目挪过去之后再删。`,
      )
    }
    await putMany(
      'groups',
      affected.map((group) => ({ ...group, subcategoryId: target.id })),
    )
  }

  await deleteOne('subcategories', subId)
  return { moved: affected.length }
}

/** 小类目下有多少道题。 */
export async function subcategoryGroupCounts(categoryId) {
  const groups = await groupsOfCategory(categoryId)
  const counts = new Map()
  for (const group of groups) {
    const key = group.subcategoryId || ''
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  return counts
}

// ———————————————— 题目组 ————————————————

export async function listGroups(categoryId, subcategoryId = ALL_SUBCATEGORIES) {
  const rows = await groupsOfCategory(categoryId)
  const filtered = subcategoryId
    ? rows.filter((group) => group.subcategoryId === subcategoryId)
    : rows
  return filtered.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function getGroup(groupId) {
  return getOne('groups', groupId)
}

export async function createGroup({
  categoryId,
  subcategoryId,
  questionImageId,
  explanationImageIds = [],
}) {
  if (!categoryId) throw new Error('请先选择大类目')
  if (!subcategoryId) throw new Error('请先选择小类目')
  if (!questionImageId) throw new Error('这道题还没有题目图')
  const group = {
    id: newId('grp'),
    categoryId,
    subcategoryId,
    questionImageId,
    explanationImageIds: [...explanationImageIds],
    status: STATUS.NEW,
    attempts: 0,
    lastAt: null,
    lastResult: null,
    createdAt: Date.now(),
  }
  await putOne('groups', group)
  return group
}

/** 保存图片并返回 id。失败会抛出带说明的错误。 */
export async function saveImageBlob(blob) {
  return putImage(blob)
}

function referencedImageIds(group) {
  const ids = []
  if (group.questionImageId) ids.push(group.questionImageId)
  for (const id of group.explanationImageIds || []) ids.push(id)
  return ids
}

export async function deleteGroup(groupId) {
  const group = await getOne('groups', groupId)
  if (!group) return
  const others = (await getAll('groups')).filter((row) => row.id !== groupId)
  const stillUsed = new Set(others.flatMap(referencedImageIds))
  for (const imageId of referencedImageIds(group)) {
    if (!stillUsed.has(imageId)) {
      try {
        await deleteImage(imageId)
      } catch {
        // 图片删不掉不该挡住删除题目。
      }
    }
  }
  await deleteOne('groups', groupId)
}

export async function updateGroup(groupId, patch) {
  const group = await getOne('groups', groupId)
  if (!group) return null
  const next = { ...group, ...patch }
  await putOne('groups', next)
  return next
}

export async function resetGroup(groupId) {
  return updateGroup(groupId, {
    status: STATUS.NEW,
    attempts: 0,
    lastAt: null,
    lastResult: null,
  })
}

export async function resetCategory(categoryId, subcategoryId = ALL_SUBCATEGORIES) {
  const groups = await listGroups(categoryId, subcategoryId)
  const next = groups.map((group) => ({
    ...group,
    status: STATUS.NEW,
    attempts: 0,
    lastAt: null,
    lastResult: null,
  }))
  await putMany('groups', next)
  return next.length
}

export async function recordResult(group, result) {
  const status = result === 'right' ? STATUS.DONE : result === 'wrong' ? STATUS.WRONG : group.status
  return updateGroup(group.id, {
    status,
    attempts: (group.attempts || 0) + 1,
    lastAt: Date.now(),
    lastResult: result,
  })
}

export async function categoryStats(categoryId, subcategoryId = ALL_SUBCATEGORIES) {
  const groups = await listGroups(categoryId, subcategoryId)
  const stats = { total: groups.length, new: 0, wrong: 0, done: 0 }
  for (const group of groups) {
    if (group.status === STATUS.DONE) stats.done += 1
    else if (group.status === STATUS.WRONG) stats.wrong += 1
    else stats.new += 1
  }
  stats.pool = stats.new + stats.wrong
  return stats
}

/** 抽取池：未看 + 错题；只抽错题时只有错题。 */
export function pickGroup(groups, { wrongOnly = false, excludeId = null } = {}) {
  const pool = groups.filter((group) =>
    wrongOnly ? group.status === STATUS.WRONG : group.status !== STATUS.DONE,
  )
  if (!pool.length) return { group: null, poolSize: 0 }
  let candidates = pool
  if (pool.length > 1 && excludeId) {
    const filtered = pool.filter((group) => group.id !== excludeId)
    if (filtered.length) candidates = filtered
  }
  const group = candidates[Math.floor(Math.random() * candidates.length)]
  return { group, poolSize: pool.length }
}

// ———————————————— 备份 ————————————————

export async function dumpData() {
  const [categories, subcategories, groups, settings] = await Promise.all([
    getAll('categories'),
    getAll('subcategories'),
    getAll('groups'),
    getSettings(),
  ])
  return { categories, subcategories, groups, settings }
}

export async function replaceAllData({ categories, subcategories = [], groups, settings }) {
  await clearStore('categories')
  await clearStore('subcategories')
  await clearStore('groups')
  await putMany('categories', categories)
  await putMany('subcategories', subcategories)
  await putMany('groups', groups)
  if (settings) await setMeta(SETTINGS_KEY, { ...DEFAULT_SETTINGS, ...settings })
}

export async function mergeData({ categories, subcategories = [], groups }) {
  const currentCategories = await getAll('categories')
  const currentSubs = await getAll('subcategories')
  const currentGroups = await getAll('groups')

  const knownCategoryIds = new Set(currentCategories.map((row) => row.id))
  const knownSubIds = new Set(currentSubs.map((row) => row.id))
  const knownGroupIds = new Set(currentGroups.map((row) => row.id))

  const newCategories = categories.filter((row) => !knownCategoryIds.has(row.id))
  const newSubs = subcategories.filter((row) => !knownSubIds.has(row.id))
  const newGroups = groups.filter((row) => !knownGroupIds.has(row.id))

  await putMany('categories', newCategories)
  await putMany('subcategories', newSubs)
  await putMany('groups', newGroups)

  return {
    categories: newCategories.length,
    subcategories: newSubs.length,
    groups: newGroups.length,
    skippedCategories: categories.length - newCategories.length,
    skippedGroups: groups.length - newGroups.length,
  }
}

/**
 * 导入旧备份（没有 subcategories 的老格式）时，给每个大类目补一个「未分类」，
 * 并把没有小类目的题目挂上去。
 */
export async function repairSubcategories({ categories, groups }) {
  const existing = await getAll('subcategories')
  const byCategory = new Map()
  for (const sub of existing) {
    const list = byCategory.get(sub.categoryId) || []
    list.push(sub)
    byCategory.set(sub.categoryId, list)
  }

  const created = []
  const fallbackFor = new Map()
  for (const category of categories) {
    const list = byCategory.get(category.id) || []
    let fallback = list.find((row) => row.isDefault) || list.find((row) => row.name === FALLBACK_SUBCATEGORY)
    if (!fallback) {
      fallback = {
        id: newId('sub'),
        categoryId: category.id,
        name: FALLBACK_SUBCATEGORY,
        createdAt: category.createdAt || Date.now(),
        isDefault: true,
      }
      created.push(fallback)
      byCategory.set(category.id, [...list, fallback])
    }
    fallbackFor.set(category.id, fallback.id)
  }

  await putMany('subcategories', created)

  const patched = groups.filter((group) => !group.subcategoryId && fallbackFor.has(group.categoryId))
  if (patched.length) {
    await putMany(
      'groups',
      patched.map((group) => ({ ...group, subcategoryId: fallbackFor.get(group.categoryId) })),
    )
  }

  return { created: created.length, patched: patched.length, fallbackFor }
}
