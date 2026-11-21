// 图片文件存储。优先用浏览器的本地文件系统（OPFS），不可用时退回到
// IndexedDB 的 Blob 存储，并在设置页和首次导入时提示用户。
//
// 约定：图片文件按 `<图片id>.jpg` 存放，IndexedDB 的 images 表只登记
// id / 字节数 / 存放位置，真正的字节在磁盘上。

import { getOne, putOne, deleteOne, getAll, newId } from './db.js'

const DIR_NAME = 'images'

let mode = 'unknown'
let dirHandle = null

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

export async function initStorage() {
  if (mode !== 'unknown') return mode
  try {
    if (!navigator.storage || typeof navigator.storage.getDirectory !== 'function') {
      throw new Error('当前浏览器没有文件系统接口')
    }
    // 有些浏览器（尤其手机 Edge）在这里会卡住不返回，超时就降级，绝不白屏。
    const root = await withTimeout(navigator.storage.getDirectory(), 3000, 'OPFS 打开超时')
    dirHandle = await withTimeout(
      root.getDirectoryHandle(DIR_NAME, { create: true }),
      3000,
      'OPFS 目录创建超时',
    )
    mode = 'opfs'
  } catch {
    dirHandle = null
    mode = 'idb'
  }
  return mode
}

export function storageMode() {
  return mode
}

export function storageModeLabel() {
  if (mode === 'opfs') return '本地文件（OPFS）'
  if (mode === 'idb') return '浏览器数据库（降级模式）'
  return '未初始化'
}

async function writeOpfs(id, blob) {
  const fileHandle = await dirHandle.getFileHandle(`${id}.jpg`, { create: true })
  const writable = await fileHandle.createWritable()
  try {
    await writable.write(blob)
  } finally {
    await writable.close()
  }
}

async function readOpfs(id) {
  const fileHandle = await dirHandle.getFileHandle(`${id}.jpg`)
  return fileHandle.getFile()
}

async function deleteOpfs(id) {
  try {
    await dirHandle.removeEntry(`${id}.jpg`)
  } catch {
    // 文件本来就不在，忽略。
  }
}

/**
 * 保存一张图片，返回图片 id。
 * 返回 { id, bytes, store, degraded }，degraded 表示从 OPFS 掉到了数据库。
 */
export async function putImage(blob) {
  const id = newId('img')
  const bytes = blob.size
  const record = { id, bytes, at: Date.now() }

  if (!dirHandle || mode !== 'opfs') {
    await putOne('blobs', { id, blob })
    await putOne('images', { ...record, store: 'idb' })
    return { id, bytes, store: 'idb', degraded: mode === 'opfs' }
  }

  try {
    await writeOpfs(id, blob)
  } catch (error) {
    // 文件系统写不进去（配额、权限、隐私模式等）：整库降级到数据库存储。
    mode = 'idb'
    dirHandle = null
    await putOne('blobs', { id, blob })
    await putOne('images', { ...record, store: 'idb' })
    return { id, bytes, store: 'idb', degraded: true, error }
  }

  await putOne('images', { ...record, store: 'opfs' })
  return { id, bytes, store: 'opfs', degraded: false }
}

export async function getImageBlob(id) {
  const record = await getOne('images', id)
  const store = record ? record.store : null

  if (store === 'opfs' || (store == null && dirHandle && mode === 'opfs')) {
    try {
      return await readOpfs(id)
    } catch {
      // 文件丢了，看看数据库里有没有备份。
    }
  }
  const row = await getOne('blobs', id)
  if (row && row.blob) return row.blob
  return null
}

export async function getImageURL(id) {
  const blob = await getImageBlob(id)
  if (!blob) return null
  return URL.createObjectURL(blob)
}

export async function deleteImage(id) {
  const record = await getOne('images', id)
  if (record && record.store === 'opfs') await deleteOpfs(id)
  await deleteOne('blobs', id)
  await deleteOne('images', id)
}

export async function imageExists(id) {
  if (!id) return false
  const record = await getOne('images', id)
  return Boolean(record)
}

export async function listImages() {
  return getAll('images')
}

export async function imageBytesTotal() {
  const rows = await getAll('images')
  return rows.reduce((sum, row) => sum + (row.bytes || 0), 0)
}

/** 备份恢复时按原 id 写回图片，保持题目组里的引用不变。 */
export async function restoreImage(id, blob) {
  const bytes = blob.size
  if (dirHandle && mode === 'opfs') {
    try {
      await writeOpfs(id, blob)
      await putOne('images', { id, bytes, at: Date.now(), store: 'opfs' })
      return { id, store: 'opfs' }
    } catch {
      mode = 'idb'
      dirHandle = null
    }
  }
  await putOne('blobs', { id, blob })
  await putOne('images', { id, bytes, at: Date.now(), store: 'idb' })
  return { id, store: 'idb' }
}
