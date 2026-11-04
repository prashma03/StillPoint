import type { RoomObject, SceneGraph } from './types'
import { validateGraph } from './validate'

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

export function readGraph(
  data: unknown,
): { ok: true; graph: SceneGraph; excludedPeople: number } | { ok: false; error: string } {
  const checked = validateGraph(data)
  if (!checked.ok) {
    return { ok: false, error: checked.errors[0]?.message ?? 'This file is not a scene graph.' }
  }
  return { ok: true, graph: checked.graph, excludedPeople: checked.report.excluded_people }
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
