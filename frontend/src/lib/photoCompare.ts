/** Experimental local corner/patch matching, not object or person recognition.
 * No external service. Not invariant to substantial rotation, crop or perspective.
 * Coordinates feed the existing center-distance engine, not a homography claim.
 */
import { harrisResponse, rgbaToGrayscale } from './detect'
import { verifyHomography, type PlanePoint } from './homography'
import type { DetectionSnapshot, ImageCorrespondence, Mask, RoomObject, SceneGraph } from './types'
import type { PixelMask } from './checkSession'

export type Pixels = { data: Uint8ClampedArray; width: number; height: number }
type Corner = { x: number; y: number; descriptor: number[] }

export function photoFileError(file: { type: string; size: number }): string | null {
  return !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20 * 1024 * 1024 || !file.size
    ? 'Choose a JPEG, PNG, or WebP image up to 20 MB.' : null
}

export function overlapsMask(point: RoomObject, masks: Mask[]) {
  return masks.some(m => point.x <= (m.x + m.w) * 1000 && point.x + point.width >= m.x * 1000 &&
    point.y <= (m.y + m.h) * 1000 && point.y + point.height >= m.y * 1000)
}
export function overlapsPixelMask(point: RoomObject, mask?: PixelMask | null) {
  if (!mask || mask.data.length !== mask.width * mask.height) return false
  const px = point.x / 1000 * mask.width, py = point.y / 1000 * mask.height
  const marginX = Math.max(point.width / 2000 * mask.width, 8), marginY = Math.max(point.height / 2000 * mask.height, 8)
  const left = Math.max(0, Math.floor(px - marginX)), right = Math.min(mask.width - 1, Math.ceil(px + marginX))
  const top = Math.max(0, Math.floor(py - marginY)), bottom = Math.min(mask.height - 1, Math.ceil(py + marginY))
  for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) if (mask.data[y * mask.width + x]) return true
  return false
}
export function backgroundOnly(graph: SceneGraph, masks: Mask[], pixelMask?: PixelMask | null): SceneGraph {
  return { room_objects: graph.room_objects.filter(p => !overlapsMask(p, masks) && !overlapsPixelMask(p, pixelMask)) }
}

function corners(image: Pixels, masks: Mask[], pixelMask?: PixelMask | null): Corner[] {
  const { width: w, height: h } = image
  const gray = rgbaToGrayscale(image.data, w, h)
  // Remove private pixels BEFORE computing gradients or descriptors.
  for (const mask of masks) for (let y = Math.max(0, Math.floor(mask.y * h)); y < Math.min(h, Math.ceil((mask.y + mask.h) * h)); y++) {
    for (let x = Math.max(0, Math.floor(mask.x * w)); x < Math.min(w, Math.ceil((mask.x + mask.w) * w)); x++) gray[y * w + x] = 0
  }
  if (pixelMask && pixelMask.data.length === pixelMask.width * pixelMask.height) {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const mx = Math.min(pixelMask.width - 1, Math.floor(x / w * pixelMask.width))
      const my = Math.min(pixelMask.height - 1, Math.floor(y / h * pixelMask.height))
      if (pixelMask.data[my * pixelMask.width + mx]) gray[y * w + x] = 0
    }
  }
  const responses = harrisResponse(gray, w, h)
  const candidates: { x: number; y: number; score: number }[] = []
  const radius = 12
  for (let y = radius + 2; y < h - radius - 2; y += 2) for (let x = radius + 2; x < w - radius - 2; x += 2) {
    const score = responses[y * w + x]
    const region = { name: '', x: (x - radius - 2) / w * 1000, y: (y - radius - 2) / h * 1000, width: (radius + 2) * 2 / w * 1000, height: (radius + 2) * 2 / h * 1000 }
    if (score <= 0 || overlapsMask(region, masks) || overlapsPixelMask(region, pixelMask)) continue
    if (score >= responses[y * w + x - 1] && score >= responses[y * w + x + 1] && score >= responses[(y - 1) * w + x] && score >= responses[(y + 1) * w + x]) candidates.push({ x, y, score })
  }
  candidates.sort((a, b) => b.score - a.score)
  const selected: Corner[] = []
  for (const candidate of candidates) {
    if (selected.some(p => Math.hypot(p.x - candidate.x, p.y - candidate.y) < 24)) continue
    const values: number[] = []
    for (let dy = -10; dy <= 11; dy += 3) for (let dx = -10; dx <= 11; dx += 3) values.push(gray[(candidate.y + dy) * w + candidate.x + dx])
    const mean = values.reduce((a, b) => a + b, 0) / values.length
    const norm = Math.sqrt(values.reduce((sum, v) => sum + (v - mean) ** 2, 0))
    if (norm < 100) continue
    selected.push({ x: candidate.x, y: candidate.y, descriptor: values.map(v => (v - mean) / norm) })
    if (selected.length >= 100) break
  }
  return selected
}

const RENDER_LIMIT = 64

function near(point: PlanePoint, kept: PlanePoint[]) {
  return kept.some((other) => Math.hypot(other.x - point.x, other.y - point.y) < 0.02)
}

export function buildCorrespondence(source: SceneGraph, suspect: SceneGraph, detection: DetectionSnapshot | null): ImageCorrespondence {
  const byName = new Map(suspect.room_objects.map((point) => [point.name.toLowerCase(), point]))
  const pairs = source.room_objects.flatMap((point) => {
    const other = byName.get(point.name.toLowerCase())
    return other ? [{ name: point.name, source: point, suspect: other }] : []
  })
  const width = detection?.suspectWidth ?? 1000
  const height = detection?.suspectHeight ?? 1000
  const fit = verifyHomography(
    pairs.map((pair) => ({ x: (pair.source.x + pair.source.width / 2) / 1000, y: (pair.source.y + pair.source.height / 2) / 1000 })),
    pairs.map((pair) => ({ x: (pair.suspect.x + pair.suspect.width / 2) / 1000, y: (pair.suspect.y + pair.suspect.height / 2) / 1000 })),
    width,
    height,
  )
  const keptSource = pairs.map((pair) => ({ x: (pair.source.x + pair.source.width / 2) / 1000, y: (pair.source.y + pair.source.height / 2) / 1000 }))
  const keptSuspect = pairs.map((pair) => ({ x: (pair.suspect.x + pair.suspect.width / 2) / 1000, y: (pair.suspect.y + pair.suspect.height / 2) / 1000 }))
  const scaleNote = detection
    ? `Errors are forward reprojection error in the ${width}×${height} analysis image of the suspected photograph. The map is a 2D homography between image planes, not measured room depth.`
    : 'Pixel dimensions were not recorded, so the fit uses the 0–1000 scene map as its pixel space. It is still a 2D homography, not measured room depth.'
  return {
    model: fit.matrix ? 'homography' : 'none',
    method: fit.method,
    thresholdPx: fit.thresholdPx,
    sourceFeatures: detection?.sourceFeatures ?? source.room_objects.length,
    suspectFeatures: detection?.suspectFeatures ?? suspect.room_objects.length,
    candidates: fit.candidates,
    verified: fit.verified,
    rejected: fit.rejected,
    meanVerifiedErrorPx: fit.meanVerifiedErrorPx,
    matrix: fit.matrix,
    matches: pairs.map((pair, index) => ({
      name: pair.name,
      sourceX: (pair.source.x + pair.source.width / 2) / 1000,
      sourceY: (pair.source.y + pair.source.height / 2) / 1000,
      suspectX: (pair.suspect.x + pair.suspect.width / 2) / 1000,
      suspectY: (pair.suspect.y + pair.suspect.height / 2) / 1000,
      status: fit.statuses[index] ?? 'candidate',
      errorPx: fit.errorPx[index] ?? null,
    })),
    unmatchedSource: (detection?.sourceCorners ?? []).filter((point) => !near(point, keptSource)).slice(0, 40),
    unmatchedSuspect: (detection?.suspectCorners ?? []).filter((point) => !near(point, keptSuspect)).slice(0, 40),
    renderedLimit: RENDER_LIMIT,
    limitation: `${scaleNote} A consistent homography can support shared scene structure. It cannot establish manipulation, identity, consent, or who created an image.`,
  }
}

export function matchPhotographs(original: Pixels, compared: Pixels, originalMasks: Mask[], comparedMasks: Mask[], originalPixelMask?: PixelMask | null, comparedPixelMask?: PixelMask | null) {
  const a = corners(original, originalMasks, originalPixelMask), b = corners(compared, comparedMasks, comparedPixelMask)
  const distance = (p: Corner, q: Corner) => p.descriptor.reduce((sum, v, i) => sum + (v - q.descriptor[i]) ** 2, 0)
  const source: RoomObject[] = [], suspect: RoomObject[] = []
  for (const p of a) {
    const ranked = b.map((q, index) => ({ index, distance: distance(p, q) })).sort((x, y) => x.distance - y.distance)
    const best = ranked[0]
    if (!best || ranked.length < 2 || best.distance > 0.18 || best.distance >= ranked[1].distance * 0.65) continue
    const q = b[best.index]
    if (a.some(other => other !== p && distance(other, q) <= best.distance)) continue
    const name = `Detail ${source.length + 1}`
    const point = (corner: Corner, image: Pixels): RoomObject => ({ name, x: corner.x / image.width * 1000, y: corner.y / image.height * 1000, width: 0, height: 0, pointOrigin: 'local', confirmed: false })
    source.push(point(p, original)); suspect.push(point(q, compared))
    if (source.length >= 48) break
  }
  const detection: DetectionSnapshot = {
    sourceWidth: original.width,
    sourceHeight: original.height,
    suspectWidth: compared.width,
    suspectHeight: compared.height,
    sourceFeatures: a.length,
    suspectFeatures: b.length,
    sourceCorners: a.map((corner) => ({ x: corner.x / original.width, y: corner.y / original.height })),
    suspectCorners: b.map((corner) => ({ x: corner.x / compared.width, y: corner.y / compared.height })),
  }
  return { source: { room_objects: source }, suspect: { room_objects: suspect }, detected: [a.length, b.length] as [number, number], detection, correspondence: buildCorrespondence({ room_objects: source }, { room_objects: suspect }, detection) }
}
