// 列表缩略图：按小尺寸解码，避免把原图整张塞进内存。
// 同一张图的缩略图会缓存起来，滚回去不用重新解码。

import { getImageBlob } from './storage.js'

const cache = new Map()
const MAX_CACHE = 300
const THUMB_WIDTH = 240

export async function getThumbURL(imageId) {
  if (!imageId) return null
  const hit = cache.get(imageId)
  if (hit) return hit

  let blob = null
  try {
    blob = await getImageBlob(imageId)
  } catch {
    return null
  }
  if (!blob) return null

  let url = null
  try {
    const bitmap = await createImageBitmap(blob, {
      resizeWidth: THUMB_WIDTH,
      resizeQuality: 'medium',
    })
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    ctx.drawImage(bitmap, 0, 0)
    if (typeof bitmap.close === 'function') bitmap.close()
    const small = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.72))
    canvas.width = 0
    canvas.height = 0
    if (small) url = URL.createObjectURL(small)
  } catch {
    // 浏览器不支持解码时缩放，退回原图。
  }
  if (!url) url = URL.createObjectURL(blob)

  cache.set(imageId, url)
  if (cache.size > MAX_CACHE) {
    const oldest = cache.keys().next().value
    const old = cache.get(oldest)
    if (old) URL.revokeObjectURL(old)
    cache.delete(oldest)
  }
  return url
}

