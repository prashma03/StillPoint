/**
 * On-device port of backend/align.py.
 * Verdict strings and thresholds must stay identical to the Python engine.
 * This engine measures background-layout agreement only. It does not prove
 * image derivation, identity, or consent.
 */
import type { AlignResult, RoomObject, SceneGraph, Verdict } from './types'

export const ALIGN_DISTANCE = 25
export const MIN_USABLE_FOR_VERDICT = 4
/** Kept for backward compatibility; identical to MIN_USABLE_FOR_VERDICT. */
export const MIN_USABLE_FOR_DERIVATIVE = MIN_USABLE_FOR_VERDICT
export const DERIVATIVE_AGREEMENT = 80
export const NO_LINK_AGREEMENT = 40

export const COORD_MIN = 0
export const COORD_MAX = 1000

export const FORBIDDEN_NAMES = new Set([
  'person',
  'face',
  'body',
  'hair',
  'skin',
  'clothes',
  'head',
])

/** Python 3 round: halves go to the even digit. */
export function roundTo(value: number, places: number): number {
  const factor = 10 ** places
  const scaled = value * factor
  const sign = scaled < 0 ? -1 : 1
  const abs = Math.abs(scaled)
  const floor = Math.floor(abs)
  const diff = abs - floor
  const rounded = Math.abs(diff - 0.5) < 1e-9 ? (floor % 2 === 0 ? floor : floor + 1) : Math.round(abs)
  return (sign * rounded) / factor
}

export function getCenter(obj: RoomObject): [number, number] {
  return [obj.x + obj.width / 2, obj.y + obj.height / 2]
}

/** Canonical form is trimmed and lowercased; anything else is invalid. */
function normalizeName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim().toLowerCase()
  return name || null
}

function isValidCoord(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= COORD_MIN && value <= COORD_MAX
}

function isValidObject(obj: RoomObject): boolean {
  return isValidCoord(obj.x) && isValidCoord(obj.y) && isValidCoord(obj.width) && isValidCoord(obj.height)
}

type Prepared = {
  objects: Map<string, RoomObject>
  excluded: number
  invalid: number
  duplicates: number
}

function prepareObjects(graph: SceneGraph): Prepared {
  const objects = new Map<string, RoomObject>()
  let excluded = 0
  let invalid = 0
  let duplicates = 0
  const items = (graph as { room_objects?: unknown } | null)?.room_objects
  if (!Array.isArray(items)) return { objects, excluded, invalid, duplicates }
  for (const item of items) {
    if (!item || typeof item !== 'object') {
      invalid += 1
      continue
    }
    const obj = item as RoomObject
    const name = normalizeName(obj.name)
    if (name === null) {
      invalid += 1
      continue
    }
    if (FORBIDDEN_NAMES.has(name)) {
      excluded += 1
      continue
    }
    if (!isValidObject(obj)) {
      invalid += 1
      continue
    }
    if (objects.has(name)) {
      duplicates += 1
      continue
    }
    objects.set(name, obj)
  }
  return { objects, excluded, invalid, duplicates }
}

function coverage(graph: SceneGraph): number | null {
  if (!Object.prototype.hasOwnProperty.call(graph, 'coverage_percent')) return null
  const value = graph.coverage_percent
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export function compareGraphs(graph1: SceneGraph, graph2: SceneGraph): AlignResult {
  const first = prepareObjects(graph1)
  const second = prepareObjects(graph2)

  const commonNames = [...first.objects.keys()].filter((name) => second.objects.has(name))
  const usablePoints = commonNames.length
  let alignedPoints = 0
  const residuals = []
  const rawDistances: number[] = []

  for (const name of commonNames) {
    const [cx1, cy1] = getCenter(first.objects.get(name)!)
    const [cx2, cy2] = getCenter(second.objects.get(name)!)
    const distance = Math.hypot(cx1 - cx2, cy1 - cy2)
    rawDistances.push(distance)
    const aligned = distance < ALIGN_DISTANCE
    if (aligned) alignedPoints += 1
    residuals.push({
      name,
      distance: roundTo(distance, 2),
      aligned,
    })
  }

  let agreement = 0
  let meanResidual: number | null = null
  if (usablePoints > 0) {
    agreement = (alignedPoints / usablePoints) * 100
    meanResidual = roundTo(rawDistances.reduce((sum, value) => sum + value, 0) / usablePoints, 2)
  }

  let verdict: Verdict
  if (usablePoints >= MIN_USABLE_FOR_VERDICT && agreement >= DERIVATIVE_AGREEMENT) {
    verdict = 'Likely derivative'
  } else if (usablePoints >= MIN_USABLE_FOR_VERDICT && agreement <= NO_LINK_AGREEMENT) {
    verdict = 'No link found'
  } else {
    verdict = 'Cannot determine'
  }

  return {
    usable_points: usablePoints,
    aligned_points: alignedPoints,
    agreement_percent: roundTo(agreement, 1),
    verdict,
    residuals,
    mean_residual: meanResidual,
    alignment_threshold: ALIGN_DISTANCE,
    excluded_person_objects: first.excluded + second.excluded,
    invalid_objects: first.invalid + second.invalid,
    duplicate_objects: first.duplicates + second.duplicates,
    source_coverage_percent: coverage(graph1),
    suspect_coverage_percent: coverage(graph2),
  }
}
