// 导出 / 导入备份。备份是一个 zip：backup.json + images/*.jpg（含图片本身）。

import { dumpData, replaceAllData, mergeData } from './repo.js'
import { getImageBlob, restoreImage, listImages, deleteImage } from './storage.js'

const APP_TAG = 'picture-quiz'
const BACKUP_VERSION = 1

function getZip() {
  const zip = window.JSZip
  if (!zip) {
    throw new Error('打包组件没加载成功（vendor/jszip.min.js），请刷新页面后重试')
  }
  return zip
}

function referencedImageIds(groups) {
  const ids = new Set()
  for (const group of groups) {
    if (group.questionImageId) ids.add(group.questionImageId)
    for (const id of group.explanationImageIds || []) ids.add(id)
  }
  return [...ids]
}

function timestampName() {
  const now = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

/**
 * 导出完整备份（含图片）。onProgress(done, total) 可选。
 */
export async function exportBackup(onProgress = () => {}) {
  const JSZip = getZip()
  const data = await dumpData()
  const zip = new JSZip()

  const ids = referencedImageIds(data.groups)
  const manifest = {
    app: APP_TAG,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    categories: data.categories,
    groups: data.groups,
    settings: data.settings,
  }
  zip.file('backup.json', JSON.stringify(manifest, null, 2))

  let done = 0
  let missing = 0
  for (const id of ids) {
    const blob = await getImageBlob(id)
    if (blob) zip.file(`images/${id}.jpg`, blob)
    else missing += 1
    done += 1
    onProgress(done, ids.length)
  }

  const out = await zip.generateAsync(
    { type: 'blob', compression: 'STORE' },
    (meta) => onProgress(ids.length, ids.length, meta.percent),
  )

  const filename = `刷题备份-${timestampName()}.zip`
  download(out, filename)

  return {
    filename,
    bytes: out.size,
    groups: data.groups.length,
    categories: data.categories.length,
    images: ids.length - missing,
    missingImages: missing,
  }
}

function validateManifest(manifest) {
  if (!manifest || manifest.app !== APP_TAG) {
    throw new Error('这不是本应用导出的备份文件（缺少 backup.json 或标记不对）')
  }
  if (!Array.isArray(manifest.categories) || !Array.isArray(manifest.groups)) {
    throw new Error('备份文件内容不完整，无法导入')
  }
}

async function readManifest(file) {
  const JSZip = getZip()
  let zip
  try {
    zip = await JSZip.loadAsync(file)
  } catch {
    throw new Error('这个文件不是有效的 zip 备份，或者已经损坏')
  }
  const entry = zip.file('backup.json')
  if (!entry) throw new Error('备份里没有 backup.json，可能选错了文件')
  const text = await entry.async('string')
  let manifest
  try {
    manifest = JSON.parse(text)
  } catch {
    throw new Error('备份里的 backup.json 不是有效的 JSON')
  }
  validateManifest(manifest)
  return { zip, manifest }
}

/**
 * 导入备份。
 * mode: 'merge' 只补缺失的；'replace' 先清空再导入。
 */
export async function importBackup(file, mode, onProgress = () => {}) {
  const { zip, manifest } = await readManifest(file)

  const imageEntries = Object.keys(zip.files).filter(
    (name) => name.startsWith('images/') && !zip.files[name].dir,
  )

  if (mode === 'replace') {
    const existing = await listImages()
    for (const row of existing) {
      try {
        await deleteImage(row.id)
      } catch {
        // 忽略删不掉的旧图。
      }
    }
    await replaceAllData({
      categories: manifest.categories,
      groups: manifest.groups,
      settings: manifest.settings,
    })
  } else {
    await mergeData({ categories: manifest.categories, groups: manifest.groups })
  }

  const needed = new Set(referencedImageIds(manifest.groups))
  let done = 0
  let restored = 0
  let failed = 0

  for (const name of imageEntries) {
    const id = name.slice('images/'.length).replace(/\.jpg$/i, '')
    // 合并模式下只补当前题库真正引用的图片。
    if (mode === 'merge' && !needed.has(id)) {
      done += 1
      continue
    }
    try {
      const blob = await zip.files[name].async('blob')
      await restoreImage(id, blob)
      restored += 1
    } catch {
      failed += 1
    }
    done += 1
    onProgress(done, imageEntries.length)
  }

  return {
    mode,
    categories: manifest.categories.length,
    groups: manifest.groups.length,
    images: restored,
    failedImages: failed,
    exportedAt: manifest.exportedAt || null,
  }
}
