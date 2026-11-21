// IndexedDB：只存题目组、类目和图片登记信息，图片本身不放在这里。
//
// v2 起是两级分类：categories（大类目）→ subcategories（小类目）→ groups。
// 升级时会给每个已有大类目建一个「未分类」小类目，把旧题目挂进去，保证不丢。

export const STATUS = { NEW: 'new', WRONG: 'wrong', DONE: 'done' }

const DB_NAME = 'picture-quiz'
const DB_VERSION = 2

/** 旧数据 / 删除小类目时的兜底小类目名字。 */
export const FALLBACK_SUBCATEGORY = '未分类'

let dbPromise = null

function migrateToV2(tx, subStore, groupsStore) {
  const defaultSubFor = {}

  const catRequest = tx.objectStore('categories').openCursor()
  catRequest.onsuccess = () => {
    const cursor = catRequest.result
    if (cursor) {
      const category = cursor.value
      const subId = `sub_${category.id}_default`
      defaultSubFor[category.id] = subId
      subStore.put({
        id: subId,
        categoryId: category.id,
        name: FALLBACK_SUBCATEGORY,
        createdAt: category.createdAt || Date.now(),
        isDefault: true,
      })
      cursor.continue()
      return
    }

    // 大类目遍历完了，再把没有小类目的旧题目补上。
    const groupRequest = groupsStore.openCursor()
    groupRequest.onsuccess = () => {
      const groupCursor = groupRequest.result
      if (!groupCursor) return
      const group = groupCursor.value
      if (!group.subcategoryId && defaultSubFor[group.categoryId]) {
        group.subcategoryId = defaultSubFor[group.categoryId]
        groupCursor.update(group)
      }
      groupCursor.continue()
    }
  }
}

export function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    let request
    // 浏览器卡住不返回时，别让应用一直空白。
    const timer = setTimeout(() => {
      reject(new Error('本地数据库打开超时，可能是这个浏览器限制了存储'))
    }, 8000)
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      clearTimeout(timer)
      reject(error)
      return
    }
    request.onupgradeneeded = (event) => {
      const db = request.result
      const tx = request.transaction
      const oldVersion = event.oldVersion || 0

      if (!db.objectStoreNames.contains('categories')) {
        db.createObjectStore('categories', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('groups')) {
        const store = db.createObjectStore('groups', { keyPath: 'id' })
        store.createIndex('categoryId', 'categoryId', { unique: false })
      }
      if (!db.objectStoreNames.contains('images')) {
        db.createObjectStore('images', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('blobs')) {
        db.createObjectStore('blobs', { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'key' })
      }

      let subStore
      if (!db.objectStoreNames.contains('subcategories')) {
        subStore = db.createObjectStore('subcategories', { keyPath: 'id' })
        subStore.createIndex('categoryId', 'categoryId', { unique: false })
      } else {
        subStore = tx.objectStore('subcategories')
      }

      const groupsStore = tx.objectStore('groups')
      if (!groupsStore.indexNames.contains('subcategoryId')) {
        groupsStore.createIndex('subcategoryId', 'subcategoryId', { unique: false })
      }

      if (oldVersion < 2) {
        migrateToV2(tx, subStore, groupsStore)
      }
    }
    request.onsuccess = () => {
      clearTimeout(timer)
      resolve(request.result)
    }
    request.onerror = () => {
      clearTimeout(timer)
      reject(request.error || new Error('无法打开本地数据库'))
    }
    request.onblocked = () => {
      clearTimeout(timer)
      reject(new Error('本地数据库被其他标签页占用，请关掉其它刷题页面后重试'))
    }
  })
  return dbPromise
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

async function withStore(name, mode, run) {
  const db = await openDB()
  const tx = db.transaction(name, mode)
  const store = tx.objectStore(name)
  return run(store)
}

export async function getAll(name) {
  return withStore(name, 'readonly', (store) => requestToPromise(store.getAll()))
}

export async function getOne(name, key) {
  return withStore(name, 'readonly', (store) => requestToPromise(store.get(key)))
}

export async function putOne(name, value) {
  return withStore(name, 'readwrite', (store) =>
    requestToPromise(store.put(value)).then(() => value),
  )
}

export async function putMany(name, values) {
  if (!values.length) return []
  const db = await openDB()
  await new Promise((resolve, reject) => {
    const tx = db.transaction(name, 'readwrite')
    const store = tx.objectStore(name)
    for (const value of values) store.put(value)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.onabort = () => reject(tx.error || new Error('写入被中止'))
  })
  return values
}

export async function deleteOne(name, key) {
  return withStore(name, 'readwrite', (store) => requestToPromise(store.delete(key)))
}

export async function clearStore(name) {
  return withStore(name, 'readwrite', (store) => requestToPromise(store.clear()))
}

export async function getMeta(key, fallback = null) {
  const row = await getOne('meta', key)
  return row ? row.value : fallback
}

export async function setMeta(key, value) {
  return putOne('meta', { key, value })
}

export async function groupsOfCategory(categoryId) {
  return withStore('groups', 'readonly', (store) =>
    requestToPromise(store.index('categoryId').getAll(categoryId)),
  )
}

export async function subcategoriesOfCategory(categoryId) {
  return withStore('subcategories', 'readonly', (store) =>
    requestToPromise(store.index('categoryId').getAll(categoryId)),
  )
}

export function newId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}
