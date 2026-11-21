// IndexedDB：只存题目组、类目和图片登记信息，图片本身不放在这里。

export const STATUS = { NEW: 'new', WRONG: 'wrong', DONE: 'done' }

const DB_NAME = 'picture-quiz'
const DB_VERSION = 1

let dbPromise = null

export function openDB() {
  if (dbPromise) return dbPromise
  dbPromise = new Promise((resolve, reject) => {
    let request
    try {
      request = indexedDB.open(DB_NAME, DB_VERSION)
    } catch (error) {
      reject(error)
      return
    }
    request.onupgradeneeded = () => {
      const db = request.result
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
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('无法打开本地数据库'))
    request.onblocked = () => reject(new Error('本地数据库被其他标签页占用，请关掉其它刷题页面后重试'))
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
  const result = run(store)
  if (result && typeof result.then === 'function') return result
  return result
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
  const db = await openDB()
  const tx = db.transaction('groups', 'readonly')
  const index = tx.objectStore('groups').index('categoryId')
  return requestToPromise(index.getAll(categoryId))
}

export function newId(prefix = 'id') {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}
