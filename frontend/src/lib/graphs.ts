import { FORBIDDEN_NAMES } from './align'
import type { RoomObject, SceneGraph } from './types'

export const STABLE_OBJECTS = [
  'bed',
  'poster',
  'door',
  'window',
  'desk',
  'rug',
  'shelf',
  'wardrobe',
  'table',
  'chair',
] as const

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function readGraph(
  data: unknown,
): { ok: true; graph: SceneGraph; excludedPeople: number } | { ok: false; error: string } {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, error: 'This file is not a scene graph.' }
  }
  const record = data as Record<string, unknown>
  if (!Array.isArray(record.room_objects)) {
    return { ok: false, error: 'Expected room_objects with name, x, y, width, and height.' }
  }

  const room_objects: RoomObject[] = []
  let excludedPeople = 0
  for (const item of record.room_objects) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'A room object was not readable.' }
    }
    const obj = item as Record<string, unknown>
    const name = typeof obj.name === 'string' ? obj.name.trim() : ''
    if (!name) return { ok: false, error: 'Every room object needs a name.' }
    if (!isFiniteNumber(obj.x) || !isFiniteNumber(obj.y) || !isFiniteNumber(obj.width) || !isFiniteNumber(obj.height)) {
      return { ok: false, error: `“${name}” needs numeric x, y, width, and height.` }
    }
    if (FORBIDDEN_NAMES.has(name.toLowerCase())) {
      excludedPeople += 1
      continue
    }
    room_objects.push({
      name,
      x: obj.x,
      y: obj.y,
      width: obj.width,
      height: obj.height,
      occludes: stringList(obj.occludes),
      is_above: stringList(obj.is_above),
      is_below: stringList(obj.is_below),
    })
  }

  const graph: SceneGraph = { room_objects }
  if (isFiniteNumber(record.coverage_percent)) graph.coverage_percent = record.coverage_percent
  if (isFiniteNumber(record.total_stable_points)) graph.total_stable_points = record.total_stable_points
  return { ok: true, graph, excludedPeople }
}

function stringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value.filter((item): item is string => typeof item === 'string')
  return names.length ? names : undefined
}

export function shiftGraph(graph: SceneGraph, dx: number, dy: number): SceneGraph {
  return {
    ...graph,
    room_objects: graph.room_objects.map((obj) => ({ ...obj, x: obj.x + dx, y: obj.y + dy })),
  }
}

/** Scale about the center of the 0–1000 frame and drop objects that leave it. */
export function zoomAndCrop(graph: SceneGraph, scale = 1.5): SceneGraph {
  const origin = 500
  const room_objects: RoomObject[] = []
  for (const obj of graph.room_objects) {
    const cx = obj.x + obj.width / 2
    const cy = obj.y + obj.height / 2
    const nx = origin + (cx - origin) * scale
    const ny = origin + (cy - origin) * scale
    if (nx < 0 || nx > 1000 || ny < 0 || ny > 1000) continue
    const width = obj.width * scale
    const height = obj.height * scale
    room_objects.push({ ...obj, x: nx - width / 2, y: ny - height / 2, width, height })
  }
  return { room_objects }
}

/** A suspect graph with none of the stable room names. */
export function replacedBackground(): SceneGraph {
  return {
    room_objects: [
      { name: 'curtain', x: 40, y: 40, width: 220, height: 320, occludes: [], is_above: [], is_below: [] },
      { name: 'lamp', x: 640, y: 180, width: 90, height: 180, occludes: [], is_above: [], is_below: [] },
    ],
  }
}

export function centerInsideMask(
  obj: RoomObject,
  mask: { x: number; y: number; w: number; h: number } | null,
): boolean {
  if (!mask) return false
  const cx = (obj.x + obj.width / 2) / 1000
  const cy = (obj.y + obj.height / 2) / 1000
  return cx >= mask.x && cx <= mask.x + mask.w && cy >= mask.y && cy <= mask.y + mask.h
}

export function excludeMasked(graph: SceneGraph, mask: { x: number; y: number; w: number; h: number } | null) {
  const room_objects = graph.room_objects.filter((obj) => !centerInsideMask(obj, mask))
  return {
    graph: { ...graph, room_objects },
    removed: graph.room_objects.length - room_objects.length,
  }
}
