// 浏览器端图片压缩：把用户选的图缩放并重编码成 JPEG。

export const PRESETS = {
  clear: {
    key: 'clear',
    label: '清晰优先',
    maxWidth: 3000,
    maxHeight: 12000,
    maxPixels: 40_000_000,
    quality: 0.9,
    hint: '宽度最多 3000 像素，JPEG 质量 0.9（默认，长截图不会被压扁）',
  },
  compact: {
    key: 'compact',
    label: '省空间',
    maxWidth: 2000,
    maxHeight: 8000,
    maxPixels: 24_000_000,
    quality: 0.8,
    hint: '宽度最多 2000 像素，JPEG 质量 0.8',
  },
}

export function getPreset(key) {
  return PRESETS[key] || PRESETS.clear
}

/** 压缩后仍然超过这个大小就提醒用户：保留原图会更占空间。 */
export const BIG_FILE_BYTES = 3 * 1024 * 1024

/** 8×8 灰度指纹：用来发现"这张可能录过了"。 */
export async function imageFingerprint(blob) {
  try {
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    ctx.drawImage(bitmap, 0, 0, 8, 8)
    bitmap.close?.()
    const data = ctx.getImageData(0, 0, 8, 8).data
    const gray = []
    for (let i = 0; i < data.length; i += 4) {
      gray.push(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2])
    }
    const avg = gray.reduce((sum, value) => sum + value, 0) / gray.length
    return gray.map((value) => (value >= avg ? '1' : '0')).join('')
  } catch {
    return ''
  }
}

/** 两个指纹有几个位不一样（越小越像）。 */
export function fingerprintDistance(a, b) {
  if (!a || !b || a.length !== b.length) return 64
  let diff = 0
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) diff += 1
  }
  return diff
}

async function loadBitmap(file) {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file, { imageOrientation: 'from-image' })
    } catch {
      // 下面的 <img> 兜底会自己处理 EXIF。
    }
  }
  return await new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('这张图片无法读取，可能格式不受浏览器支持'))
    }
    img.src = url
  })
}

/**
 * 计算压缩后的尺寸。
 *
 * 关键点：长截图（高远大于宽）如果按「长边」缩放，宽度会被压到 200 多像素，
 * 屏幕上的字就看不清了。屏幕上图片是宽度撑满显示的，所以清晰度由**宽度**决定。
 * 这里按宽度限制，高度按比例保留，再用最大高度和总像素兜底，避免画布爆内存。
 */
function fitForScreen(width, height, preset) {
  let scale = 1
  if (width > preset.maxWidth) scale = preset.maxWidth / width
  if (height * scale > preset.maxHeight) {
    scale = Math.min(scale, preset.maxHeight / height)
  }
  const pixels = width * scale * height * scale
  if (pixels > preset.maxPixels) {
    scale = Math.min(scale, Math.sqrt(preset.maxPixels / (width * height)))
  }
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

function canvasToBlob(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('图片压缩失败（浏览器没有返回文件），请换一张图或改用其它浏览器'))
      },
      'image/jpeg',
      quality,
    )
  })
}

/**
 * 压缩一张图片。
 * 返回 { blob, width, height, originalBytes, keptOriginal }
 */
export async function compressImage(file, presetKey) {
  const preset = getPreset(presetKey)
  const source = await loadBitmap(file)
  const sourceWidth = source.width || source.naturalWidth
  const sourceHeight = source.height || source.naturalHeight
  const target = fitForScreen(sourceWidth, sourceHeight, preset)

  const canvas = document.createElement('canvas')
  canvas.width = target.width
  canvas.height = target.height
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('浏览器不支持画布，无法压缩图片')

  // 透明背景铺白，避免转 JPEG 后变黑。
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  if (typeof source.close === 'function') source.close()

  let blob = await canvasToBlob(canvas, preset.quality)
  canvas.width = 0
  canvas.height = 0

  let keptOriginal = false
  // 小图重编码后反而更大时，保留原文件。
  if (blob.size >= file.size && file.type === 'image/jpeg') {
    blob = file
    keptOriginal = true
  }

  return {
    blob,
    width: target.width,
    height: target.height,
    originalBytes: file.size,
    keptOriginal,
  }
}

/** 从文件名里取一个可读的说明，仅用于提示，不参与任何识别。 */
export function filesSummary(files) {
  const count = files.length
  const bytes = files.reduce((sum, file) => sum + file.size, 0)
  return { count, bytes }
}
