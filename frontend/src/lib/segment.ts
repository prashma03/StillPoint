/**
 * Person-mask checks and segmentation helpers.
 *
 * Two paths cover the person, and both end in the same manual confirmation:
 * manual drawing (always available) and automatic person detection through
 * the local backend when a model key is configured. Detection only
 * *suggests* a mask: the user previews it, corrects missed regions by hand,
 * and confirms before anything is analyzed. A suggestion is never
 * auto-confirmed, and an empty suggestion keeps analysis blocked until the
 * user draws a mask.
 */
import type { Mask } from './types'
import type { SegmentMask } from './ai'
import type { PixelMask } from './checkSession'

export type PersonRect = { x: number; y: number; width: number; height: number }

export const AUTO_SEGMENTATION_NOTE =
  'Automatic person detection needs the local backend and a configured model key. ' +
  'Without it, draw the mask yourself — that path always works.'

export const MASKING_LIMITS = [
  'Masking hides the person from scene analysis. It does not guarantee complete anonymization.',
  'Visible backgrounds, objects, and other image details may still be identifying.',
  'The mask rectangle is saved. The pixels under it are not.',
] as const

/** Minimum mask edge as a fraction of the photo, matching the on-screen clamp. */
export const MIN_MASK_EDGE = 0.12

export function checkMask(mask: Mask | null): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (!mask) {
    return { ok: false, problems: ['No person mask is drawn.'] }
  }
  for (const key of ['x', 'y', 'w', 'h'] as const) {
    const value = mask[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return { ok: false, problems: ['The mask rectangle is not readable.'] }
    }
  }
  if (mask.x < 0 || mask.y < 0 || mask.w <= 0 || mask.h <= 0 || mask.x + mask.w > 1 || mask.y + mask.h > 1) {
    problems.push('The mask must sit inside the photograph.')
  }
  if (mask.w < MIN_MASK_EDGE || mask.h < MIN_MASK_EDGE) {
    problems.push('The mask is very small. Expand it until the person is fully inside.')
  }
  if (mask.w * mask.h > 0.9) {
    problems.push('The mask covers almost the whole photograph, leaving no background to analyze.')
  }
  return { ok: problems.length === 0, problems }
}

/**
 * Merge suggested person rectangles (0–1000 scale) into one mask fraction.
 * Returns null when there is nothing to merge. The caller must still ask
 * the user to review and confirm the result.
 */
export function mergeRectsToMask(rects: PersonRect[]): Mask | null {
  const sane = rects.filter(
    (rect) =>
      rect &&
      [rect.x, rect.y, rect.width, rect.height].every((value) => typeof value === 'number' && Number.isFinite(value)) &&
      rect.width > 0 &&
      rect.height > 0,
  )
  if (sane.length === 0) return null
  const left = Math.max(0, Math.min(...sane.map((rect) => rect.x)))
  const top = Math.max(0, Math.min(...sane.map((rect) => rect.y)))
  const right = Math.min(1000, Math.max(...sane.map((rect) => rect.x + rect.width)))
  const bottom = Math.min(1000, Math.max(...sane.map((rect) => rect.y + rect.height)))
  if (right <= left || bottom <= top) return null
  return { x: left / 1000, y: top / 1000, w: (right - left) / 1000, h: (bottom - top) / 1000 }
}

const MAX_MASK_SIDE = 1400
export function emptyPixelMask(width: number, height: number): PixelMask {
  const scale = Math.min(1, MAX_MASK_SIDE / Math.max(width, height))
  const w = Math.max(1, Math.round(width * scale)), h = Math.max(1, Math.round(height * scale))
  return { width: w, height: h, data: new Uint8Array(w * h) }
}

/** Project SAM's per-person binary rasters into one image-aligned mask. */
export function combineSegmentMasks(width: number, height: number, regions: SegmentMask[]): PixelMask {
  const output = emptyPixelMask(width, height)
  for (const region of regions) for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    if (!region.data[y * region.width + x]) continue
    const left = Math.max(0, Math.floor((region.left + x / region.width * region.boxWidth) / width * output.width))
    const right = Math.min(output.width, Math.ceil((region.left + (x + 1) / region.width * region.boxWidth) / width * output.width))
    const top = Math.max(0, Math.floor((region.top + y / region.height * region.boxHeight) / height * output.height))
    const bottom = Math.min(output.height, Math.ceil((region.top + (y + 1) / region.height * region.boxHeight) / height * output.height))
    for (let targetY = top; targetY < bottom; targetY++) for (let targetX = left; targetX < right; targetX++) output.data[targetY * output.width + targetX] = 1
  }
  return output
}
