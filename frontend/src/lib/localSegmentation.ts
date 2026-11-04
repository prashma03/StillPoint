import type { PixelMask } from './checkSession'
import { decodeToPixels } from './redact'
import type { SegmentRect } from './ai'

export const LOCAL_MASK_MODEL = 'MediaPipe SelfieSegmenter · on-device'
export function maskBounds(mask: PixelMask): SegmentRect[] {
  let left = mask.width, top = mask.height, right = -1, bottom = -1
  for (let y = 0; y < mask.height; y++) for (let x = 0; x < mask.width; x++) if (mask.data[y * mask.width + x]) {
    left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y)
  }
  if (right < left) return []
  return [{ x: left / mask.width * 1000, y: top / mask.height * 1000, width: (right + 1 - left) / mask.width * 1000, height: (bottom + 1 - top) / mask.height * 1000 }]
}

/** Same-origin model assets only. No image bytes are sent to an HTTP endpoint. */
export async function segmentLocally(file: Blob, signal: AbortSignal): Promise<PixelMask> {
  signal.throwIfAborted()
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') throw new Error('On-device masking is unavailable in this browser. Manual masking is available; no image was sent externally.')
  const pixels = await decodeToPixels(file, 1024)
  signal.throwIfAborted()
  const bitmap = await createImageBitmap(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height))
  if (signal.aborted) { bitmap.close(); signal.throwIfAborted() }
  return new Promise((resolve, reject) => {
    let worker: Worker
    try { worker = new Worker(new URL('./localSegmentation.worker.ts', import.meta.url), { type: 'module' }) }
    catch { bitmap.close(); reject(new Error('This browser could not start local masking. Use manual masking.')); return }
    const dispose = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate() }
    const cancel = () => { dispose(); reject(new DOMException('Masking cancelled.', 'AbortError')) }
    const timer = setTimeout(() => { dispose(); reject(new Error('On-device masking timed out. Use manual masking. No image was sent externally.')) }, 45000)
    signal.addEventListener('abort', cancel, { once: true })
    worker.onerror = () => { dispose(); reject(new Error('The local masking model could not load. Use manual masking; no external fallback was attempted.')) }
    worker.onmessage = (event: MessageEvent<PixelMask & { error?: string; diagnostic?: string }>) => {
      dispose()
      const mask = event.data
      if (mask.error || !mask.width || !mask.height || !(mask.data instanceof Uint8Array) || mask.data.length !== mask.width * mask.height) reject(Object.assign(new Error(mask.error || 'Invalid local mask. Use manual masking.'), { diagnostic: mask.diagnostic }))
      else resolve({ width: mask.width, height: mask.height, data: mask.data })
    }
    try { worker.postMessage({ bitmap, assets: new URL(`${import.meta.env.BASE_URL}models/person`, window.location.origin).href }, [bitmap]) }
    catch { bitmap.close(); dispose(); reject(new Error('This browser could not transfer pixels to the local worker. Use manual masking.')) }
  })
}
