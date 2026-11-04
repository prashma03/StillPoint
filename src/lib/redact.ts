/** Client-side redaction: opaque mask, downscale, metadata strip. No uploads. */

export const MAX_DIMENSION = 1600
export const REDACT_QUALITY = 0.92

const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export function allowedImageType(type: string, name: string): boolean {
  if (ALLOWED_TYPES.has(type)) return true
  return /\.(jpe?g|png|webp)$/i.test(name)
}

/** Scale w/h to fit within maxDim, preserving aspect ratio. Never upscales. */
export function scaledSize(w: number, h: number, maxDim = MAX_DIMENSION): { w: number; h: number } {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return { w: 0, h: 0 }
  const scale = Math.min(1, maxDim / Math.max(w, h))
  return { w: Math.round(w * scale), h: Math.round(h * scale) }
}

export function maskToPixels(
  mask: { x: number; y: number; w: number; h: number },
  width: number,
  height: number,
): { x: number; y: number; w: number; h: number } {
  const x = Math.round(mask.x * width)
  const y = Math.round(mask.y * height)
  return {
    x: Math.min(Math.max(x, 0), width),
    y: Math.min(Math.max(y, 0), height),
    w: Math.round(mask.w * width),
    h: Math.round(mask.h * height),
  }
}

function loadBitmap(file: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file)
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      if (typeof createImageBitmap === 'function') {
        createImageBitmap(img).then(resolve, reject)
      } else {
        reject(new Error('This browser cannot decode the image.'))
      }
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('That file could not be read as an image.'))
    }
    img.src = url
  })
}

/**
 * Decode a photo to raw pixels for on-device analysis. Browser-only.
 * Pixels stay in this tab; the caller must exclude masked regions.
 */
export async function decodeToPixels(
  file: Blob,
  maxDim = MAX_DIMENSION,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  const bitmap = await loadBitmap(file)
  try {
    const { w, h } = scaledSize(bitmap.width, bitmap.height, maxDim)
    if (w < 16 || h < 16) throw new Error('That photograph could not be decoded.')
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) throw new Error('This browser cannot process the image.')
    ctx.drawImage(bitmap, 0, 0, w, h)
    const pixels = ctx.getImageData(0, 0, w, h)
    canvas.width = 0
    canvas.height = 0
    return { data: pixels.data, width: w, height: h }
  } finally {
    bitmap.close()
  }
}

/**
 * Draw the photo to a canvas, paint the mask rectangle fully opaque,
 * downscale, and re-encode as JPEG. Re-encoding drops EXIF metadata.
 * The person region stays covered: masking hides the area from analysis
 * but cannot guarantee anonymization.
 */
export async function redactImage(
  file: Blob,
  mask: { x: number; y: number; w: number; h: number } | null,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const bitmap = await loadBitmap(file)
  try {
    const { w, h } = scaledSize(bitmap.width, bitmap.height)
    if (w <= 0 || h <= 0) throw new Error('That image has no usable pixels.')
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This browser cannot process the image.')
    ctx.drawImage(bitmap, 0, 0, w, h)
    if (mask) {
      const rect = maskToPixels(mask, w, h)
      ctx.fillStyle = '#000000'
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h)
    }
    const dataUrl = canvas.toDataURL('image/jpeg', REDACT_QUALITY)
    canvas.width = 0
    canvas.height = 0
    return { dataUrl, width: w, height: h }
  } finally {
    bitmap.close()
  }
}
