/**
 * Landmark pipeline for the Protect workflow.
 *
 * Coordinate contract (single source of truth):
 * - Scene-graph coordinates are 0–1000 fractions of the whole image, relative
 *   to the image the model received. They are resolution-independent: the
 *   redacted upload is aspect-preserving, so no dimension-dependent rescaling
 *   is ever applied here. Do not convert through pixels and back.
 * - A landmark's position is its CENTER (x + width/2, y + height/2), the same
 *   point the alignment engine scores and every diagram draws. Rendering a
 *   box's top-left corner as the dot is a bug this module exists to prevent:
 *   use landmarkCenter() for display, hit-testing, and mask checks.
 * - The photo overlay positions dots with CSS percentages of the displayed
 *   image box (no object-fit, no letterboxing), and click/drag math inverts
 *   that same mapping. One transform each way, applied exactly once.
 */
import { COORD_MAX, COORD_MIN, FORBIDDEN_NAMES, getCenter } from './align'
import type { Mask, PointOrigin, RoomObject, SceneGraph } from './types'

/** Sensible default: enough for a decisive comparison with spares to discard. */
export const LANDMARK_DEFAULT_LIMIT = 12
export const LANDMARK_MIN_LIMIT = 4
export const LANDMARK_MAX_LIMIT = 24

/** Points closer than this (0–1000 units) to a mask edge are rejected. */
export const MASK_EXCLUSION_MARGIN = 20
/** Points closer than this to an existing point count as spatial duplicates. */
export const MIN_POINT_SEPARATION = 8
/** Upper bound for a landmark box edge; larger boxes are not landmarks. */
export const MAX_LANDMARK_EDGE = 600

export function clampLimit(value: number): number {
  if (!Number.isFinite(value)) return LANDMARK_DEFAULT_LIMIT
  return Math.min(LANDMARK_MAX_LIMIT, Math.max(LANDMARK_MIN_LIMIT, Math.round(value)))
}

/** The scored position of a landmark: its box center. Always render this. */
export function landmarkCenter(obj: Pick<RoomObject, 'x' | 'y' | 'width' | 'height'>): { x: number; y: number } {
  const [x, y] = getCenter(obj as RoomObject)
  return { x, y }
}

/** Center as CSS percentages of the displayed image box. */
export function landmarkToPercent(obj: Pick<RoomObject, 'x' | 'y' | 'width' | 'height'>): { left: number; top: number } {
  const center = landmarkCenter(obj)
  return { left: center.x / 10, top: center.y / 10 }
}

/**
 * Invert the overlay mapping: a pointer position inside the displayed image
 * box becomes 0–1000 image coordinates. Pure so drag math stays testable.
 */
export function clientToImageCoords(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
): { x: number; y: number } {
  if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0 }
  const x = ((clientX - rect.left) / rect.width) * 1000
  const y = ((clientY - rect.top) / rect.height) * 1000
  return {
    x: Math.min(COORD_MAX, Math.max(COORD_MIN, x)),
    y: Math.min(COORD_MAX, Math.max(COORD_MIN, y)),
  }
}

export function isConfirmed(obj: RoomObject): boolean {
  return obj.confirmed !== false
}

export function pointOriginOf(obj: RoomObject): PointOrigin {
  return obj.pointOrigin ?? 'manual'
}

/** True when a 0–1000 point falls inside the mask grown by margin units. */
export function pointInMaskWithMargin(
  x: number,
  y: number,
  mask: Mask | null,
  margin = MASK_EXCLUSION_MARGIN,
): boolean {
  if (!mask) return false
  const left = mask.x * 1000 - margin
  const top = mask.y * 1000 - margin
  const right = (mask.x + mask.w) * 1000 + margin
  const bottom = (mask.y + mask.h) * 1000 + margin
  return x >= left && x <= right && y >= top && y <= bottom
}

/** Mask check on the scored center, with a boundary margin. */
export function centerInMaskWithMargin(obj: RoomObject, mask: Mask | null, margin = MASK_EXCLUSION_MARGIN): boolean {
  const center = landmarkCenter(obj)
  return pointInMaskWithMargin(center.x, center.y, mask, margin)
}

function validCoords(obj: RoomObject): boolean {
  return (
    [obj.x, obj.y, obj.width, obj.height].every(
      (value) => typeof value === 'number' && Number.isFinite(value) && value >= COORD_MIN && value <= COORD_MAX,
    ) && obj.width <= MAX_LANDMARK_EDGE && obj.height <= MAX_LANDMARK_EDGE
  )
}

function cleanName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().replace(/\s+/g, ' ')
  if (!name || name.length > 80) return null
  return name
}

export type SanitizeResult = {
  kept: RoomObject[]
  dropped: { outOfBounds: number; inMask: number; duplicate: number; personNamed: number; overLimit: number }
}

/**
 * Filter raw AI-proposed landmarks before they join the graph. Drops (never
 * invents or moves) points that are out of bounds, person-named, inside the
 * mask margin, spatial/name duplicates, or beyond the remaining limit.
 * Existing user-confirmed points always win name conflicts.
 */
export function sanitizeAiPoints(
  candidates: RoomObject[],
  opts: { mask: Mask | null; limit: number; existing: RoomObject[] },
): SanitizeResult {
  const dropped = { outOfBounds: 0, inMask: 0, duplicate: 0, personNamed: 0, overLimit: 0 }
  const kept: RoomObject[] = []
  const takenNames = new Set(opts.existing.map((item) => item.name.trim().toLowerCase()))
  const takenPoints = [...opts.existing.map(landmarkCenter)]
  const room = Math.max(0, clampLimit(opts.limit) - opts.existing.length)

  for (const candidate of candidates) {
    const name = cleanName(candidate.name)
    if (!name) {
      dropped.outOfBounds += 1
      continue
    }
    if (FORBIDDEN_NAMES.has(name.toLowerCase())) {
      dropped.personNamed += 1
      continue
    }
    if (!validCoords(candidate)) {
      dropped.outOfBounds += 1
      continue
    }
    if (centerInMaskWithMargin(candidate, opts.mask)) {
      dropped.inMask += 1
      continue
    }
    const center = landmarkCenter(candidate)
    const dupe =
      takenNames.has(name.toLowerCase()) ||
      takenPoints.some((point) => Math.hypot(point.x - center.x, point.y - center.y) < MIN_POINT_SEPARATION)
    if (dupe) {
      dropped.duplicate += 1
      continue
    }
    if (kept.length >= room) {
      dropped.overLimit += 1
      continue
    }
    takenNames.add(name.toLowerCase())
    takenPoints.push(center)
    kept.push({ ...candidate, name, pointOrigin: 'ai', confirmed: false })
  }
  return { kept, dropped }
}

export type MergeResult = {
  graph: SceneGraph
  added: number
  skipped: number
}

/**
 * Merge sanitized AI landmarks into the working graph without touching
 * existing points. Existing manual/confirmed work is never overwritten.
 */
export function mergeLandmarks(current: SceneGraph, incoming: RoomObject[]): MergeResult {
  const taken = new Set(current.room_objects.map((item) => item.name.trim().toLowerCase()))
  const room_objects = [...current.room_objects]
  let added = 0
  let skipped = 0
  for (const obj of incoming) {
    if (taken.has(obj.name.trim().toLowerCase())) {
      skipped += 1
      continue
    }
    taken.add(obj.name.trim().toLowerCase())
    room_objects.push(obj)
    added += 1
  }
  return { graph: { ...current, room_objects }, added, skipped }
}

export type LandmarkIssue = { level: 'error' | 'warning' | 'info'; message: string }

/**
 * Human-readable validation for the current landmark set. Pure; the page
 * renders these next to the editor.
 */
export function assessLandmarks(graph: SceneGraph, mask: Mask | null, minUsable = 4): LandmarkIssue[] {
  const issues: LandmarkIssue[] = []
  const outside = graph.room_objects.filter((obj) => !centerInMaskWithMargin(obj, mask))
  const inside = graph.room_objects.length - outside.length
  if (graph.room_objects.length === 0) {
    issues.push({ level: 'info', message: 'No background points yet. Add some by hand or with AI assistance.' })
    return issues
  }
  if (inside > 0) {
    issues.push({
      level: 'warning',
      message: `${inside} point(s) sit inside the person cover or too close to its edge and will not be saved. Move them outward.`,
    })
  }
  if (outside.length < minUsable) {
    issues.push({
      level: 'error',
      message: `Only ${outside.length} usable point(s). A reliable comparison needs at least ${minUsable} outside the cover.`,
    })
  }
  const unconfirmed = outside.filter((obj) => !isConfirmed(obj)).length
  if (unconfirmed > 0) {
    issues.push({
      level: 'warning',
      message: `${unconfirmed} AI-suggested point(s) still need review. Confirm, drag, or remove each one.`,
    })
  }
  // Distribution: every point's nearest neighbor distance; tight clusters warn.
  const centers = outside.map(landmarkCenter)
  if (centers.length >= 2) {
    let nearestSum = 0
    for (let i = 0; i < centers.length; i += 1) {
      let best = Infinity
      for (let j = 0; j < centers.length; j += 1) {
        if (i === j) continue
        best = Math.min(best, Math.hypot(centers[i].x - centers[j].x, centers[i].y - centers[j].y))
      }
      nearestSum += best
    }
    const meanNearest = nearestSum / centers.length
    if (meanNearest < 60) {
      issues.push({
        level: 'warning',
        message: 'The points are clustered tightly. Spread them across the visible background for a stronger map.',
      })
    }
  }
  // Quadrant coverage on the unmasked area.
  const quadrants = new Set<number>()
  for (const center of centers) {
    quadrants.add((center.x >= 500 ? 1 : 0) + (center.y >= 500 ? 2 : 0))
  }
  if (centers.length >= 4 && quadrants.size < 2) {
    issues.push({
      level: 'warning',
      message: 'All points sit in one quarter of the photo. Cover more of the room when the background allows it.',
    })
  }
  if (issues.length === 0) {
    issues.push({ level: 'info', message: `${outside.length} reviewed points cover the background. Ready to continue.` })
  }
  return issues
}

/** Short stable signature of a mask for consent scoping. */
export function maskSignature(mask: Mask | null): string {
  if (!mask) return 'no-mask'
  const parts = [mask.x, mask.y, mask.w, mask.h].map((value) => Math.round(value * 1000))
  return parts.join('.')
}

/**
 * Scope token for one explicit consent. Consent is only valid for the exact
 * image (content hash), request kind, and — for redacted analysis — the exact
 * mask fractions at consent time. Any change invalidates it.
 */
export function consentScope(fileHash: string | null, kind: 'analyze' | 'segment', mask: Mask | null): string {
  const maskPart = kind === 'analyze' ? maskSignature(mask) : 'full-photo'
  return `${kind}:${fileHash ?? 'no-file'}:${maskPart}`
}
