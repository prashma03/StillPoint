/**
 * On-device port of backend/align.py.
 * Verdict strings and thresholds must stay identical to the Python engine.
 */
import type { AlignResult, RoomObject, SceneGraph, Verdict } from './types'

export const ALIGN_DISTANCE = 25
export const MIN_USABLE_FOR_DERIVATIVE = 4
export const DERIVATIVE_AGREEMENT = 80
export const NO_LINK_AGREEMENT = 40

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

function splitPeople(graph: SceneGraph): { kept: RoomObject[]; excluded: number } {
  const kept: RoomObject[] = []
  let excluded = 0
  for (const obj of graph.room_objects ?? []) {
    const name = String(obj.name ?? '').trim().toLowerCase()
    if (FORBIDDEN_NAMES.has(name)) {
      excluded += 1
      continue
    }
    kept.push(obj)
  }
  return { kept, excluded }
}

function coverage(graph: SceneGraph): number | null {
  if (!Object.prototype.hasOwnProperty.call(graph, 'coverage_percent')) return null
  const value = graph.coverage_percent
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return value
}

export function compareGraphs(graph1: SceneGraph, graph2: SceneGraph): AlignResult {
  const first = splitPeople(graph1)
  const second = splitPeople(graph2)
  const objects1 = new Map<string, RoomObject>()
  const objects2 = new Map<string, RoomObject>()
  for (const obj of first.kept) objects1.set(obj.name, obj)
  for (const obj of second.kept) objects2.set(obj.name, obj)

  const commonNames = [...objects1.keys()].filter((name) => objects2.has(name))
  const usablePoints = commonNames.length
  let alignedPoints = 0
  const residuals = []
  const rawDistances: number[] = []

  for (const name of commonNames) {
    const [cx1, cy1] = getCenter(objects1.get(name)!)
    const [cx2, cy2] = getCenter(objects2.get(name)!)
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
  if (usablePoints >= MIN_USABLE_FOR_DERIVATIVE && agreement >= DERIVATIVE_AGREEMENT) {
    verdict = 'Likely derivative'
  } else if (agreement <= NO_LINK_AGREEMENT) {
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
    source_coverage_percent: coverage(graph1),
    suspect_coverage_percent: coverage(graph2),
  }
}
