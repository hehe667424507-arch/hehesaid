// 业务层：类目、题目组、抽题、统计。视图只通过这里读写数据。

import {
  STATUS,
  getAll,
  getOne,
  putOne,
  putMany,
  deleteOne,
  clearStore,
  groupsOfCategory,
  newId,
  getMeta,
  setMeta,
} from './db.js'
import { deleteImage, putImage } from './storage.js'

export { STATUS }

const SETTINGS_KEY = 'settings'
const DEFAULT_SETTINGS = {
  quality: 'clear',
  wrongOnly: false,
  lastPicked: {}, // categoryId -> groupId
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

export async function listCategories() {
  const rows = await getAll('categories')
  return rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function ensureDefaultCategory() {
  const rows = await listCategories()
  if (rows.length) return rows
  const category = { id: newId('cat'), name: '数学', createdAt: Date.now() }
  await putOne('categories', category)
  return [category]
}

export async function createCategory(name) {
  const clean = String(name || '').trim()
  if (!clean) throw new Error('类目名不能为空')
  const exists = (await listCategories()).some((row) => row.name === clean)
  if (exists) throw new Error(`已经有一个叫「${clean}」的类目了`)
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

  // 一次性算出要删的图片，避免在循环里反复扫全表。
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
  await deleteOne('categories', categoryId)
}

export async function listGroups(categoryId) {
  const rows = await groupsOfCategory(categoryId)
  return rows.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
}

export async function getGroup(groupId) {
  return getOne('groups', groupId)
}

export async function createGroup({ categoryId, questionImageId, explanationImageIds = [] }) {
  if (!categoryId) throw new Error('请先选择类目')
  if (!questionImageId) throw new Error('这道题还没有题目图')
  const group = {
    id: newId('grp'),
    categoryId,
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
  const result = await putImage(blob)
  return result
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
        // 图片删不掉不该挡住删除题目，忽略即可。
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

export async function resetCategory(categoryId) {
  const groups = await groupsOfCategory(categoryId)
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

export async function categoryStats(categoryId) {
  const groups = await groupsOfCategory(categoryId)
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

/** 备份用：所有数据（不含图片字节）。 */
export async function dumpData() {
  const [categories, groups, settings] = await Promise.all([
    getAll('categories'),
    getAll('groups'),
    getSettings(),
  ])
  return { categories, groups, settings }
}

export async function replaceAllData({ categories, groups, settings }) {
  await clearStore('categories')
  await clearStore('groups')
  await putMany('categories', categories)
  await putMany('groups', groups)
  if (settings) await setMeta(SETTINGS_KEY, { ...DEFAULT_SETTINGS, ...settings })
}

export async function mergeData({ categories, groups }) {
  const currentCategories = await getAll('categories')
  const currentGroups = await getAll('groups')
  const knownCategoryIds = new Set(currentCategories.map((row) => row.id))
  const knownGroupIds = new Set(currentGroups.map((row) => row.id))

  const newCategories = categories.filter((row) => !knownCategoryIds.has(row.id))
  const newGroups = groups.filter((row) => !knownGroupIds.has(row.id))

  await putMany('categories', newCategories)
  await putMany('groups', newGroups)

  return {
    categories: newCategories.length,
    groups: newGroups.length,
    skippedCategories: categories.length - newCategories.length,
    skippedGroups: groups.length - newGroups.length,
  }
}
