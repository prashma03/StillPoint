/**
 * Session-scoped Protect draft. Back/Next within the wizard never unmounts
 * the page, but browser navigation, tab switches, and reloads do — and the
 * photo File plus object URL cannot survive those. This store keeps every
 * *descriptive* bit of progress (mask, landmarks, labels, consents' scope,
 * step) in sessionStorage so revisiting restores it, while image pixels are
 * refused outright: re-selecting the photo re-verifies by content hash.
 *
 * sessionStorage is tab-scoped and dies with the tab: in-progress data stays
 * within the current session and never lands in permanent browser storage.
 */
import type { SegmentRect } from './ai'
import { clampLimit } from './landmarks'
import { readGraph } from './graphs'
import { assertNoImagePayload } from './storage'
import type { MappingOrigin, Mask, SceneGraph } from './types'

export const PROTECT_DRAFT_KEY = 'stillpoint.protect.draft.v1'

export type ProtectDraft = {
  version: 1
  step: number
  label: string
  fileName: string | null
  fileHash: string | null
  imageWidth: number | null
  imageHeight: number | null
  imported: boolean
  graph: SceneGraph
  origin: MappingOrigin
  model: string | null
  aiNote: string
  mask: Mask
  maskConfirmed: boolean
  personAck: boolean
  suggested: SegmentRect[] | null
  suggestModel: string | null
  selectedName: string
  landmarkLimit: number
  savedAt: string
}

export function emptyDraft(): ProtectDraft {
  return {
    version: 1,
    step: 1,
    label: 'Protected scene',
    fileName: null,
    fileHash: null,
    imageWidth: null,
    imageHeight: null,
    imported: false,
    graph: { room_objects: [] },
    origin: 'manual',
    model: null,
    aiNote: '',
    mask: { x: 0.34, y: 0.1, w: 0.32, h: 0.72 },
    maskConfirmed: false,
    personAck: false,
    suggested: null,
    suggestModel: null,
    selectedName: 'bed',
    landmarkLimit: 12,
    savedAt: new Date().toISOString(),
  }
}

type Memory = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const fallback = new Map<string, string>()

export function draftMemory(): Memory {
  try {
    if (typeof sessionStorage !== 'undefined') return sessionStorage
  } catch {
    // Private browsing or disabled storage: fall through to memory.
  }
  return {
    getItem: (key) => (fallback.has(key) ? fallback.get(key)! : null),
    setItem: (key, value) => fallback.set(key, value),
    removeItem: (key) => fallback.delete(key),
  }
}

/** True when the draft holds any user work worth restoring or warning about. */
export function draftHasWork(draft: ProtectDraft | null): boolean {
  if (!draft) return false
  return (
    draft.fileName !== null ||
    draft.graph.room_objects.length > 0 ||
    draft.maskConfirmed ||
    draft.personAck ||
    draft.suggested !== null
  )
}

export function saveProtectDraft(storage: Memory, draft: ProtectDraft): void {
  assertNoImagePayload(draft)
  storage.setItem(PROTECT_DRAFT_KEY, JSON.stringify({ ...draft, version: 1, savedAt: new Date().toISOString() }))
}

export function loadProtectDraft(storage: Memory): ProtectDraft | null {
  const raw = storage.getItem(PROTECT_DRAFT_KEY)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const data = parsed as Record<string, unknown>

  // An empty landmark list is valid mid-wizard (photo chosen, nothing mapped
  // yet); only a malformed or non-empty-but-invalid graph rejects the draft.
  const rawGraph = data.graph as { room_objects?: unknown } | null
  if (!rawGraph || !Array.isArray(rawGraph.room_objects)) return null
  let graph: SceneGraph = { room_objects: [] }
  if (rawGraph.room_objects.length > 0) {
    const read = readGraph(data.graph)
    if (!read.ok) return null
    graph = read.graph
  }

  const mask = data.mask as Partial<Mask> | null
  const maskOk =
    mask !== null &&
    typeof mask === 'object' &&
    ['x', 'y', 'w', 'h'].every((key) => typeof (mask as Record<string, unknown>)[key] === 'number')

  const step = typeof data.step === 'number' ? Math.min(3, Math.max(1, Math.floor(data.step))) : 1
  return {
    version: 1,
    step,
    label: typeof data.label === 'string' ? data.label : 'Protected scene',
    fileName: typeof data.fileName === 'string' ? data.fileName : null,
    fileHash: typeof data.fileHash === 'string' ? data.fileHash : null,
    imageWidth: typeof data.imageWidth === 'number' ? data.imageWidth : null,
    imageHeight: typeof data.imageHeight === 'number' ? data.imageHeight : null,
    imported: data.imported === true,
    graph,
    origin: data.origin === 'ai-assist' ? 'ai-assist' : 'manual',
    model: typeof data.model === 'string' ? data.model : null,
    aiNote: typeof data.aiNote === 'string' ? data.aiNote : '',
    mask: maskOk ? (mask as Mask) : emptyDraft().mask,
    maskConfirmed: data.maskConfirmed === true,
    personAck: data.personAck === true,
    suggested: Array.isArray(data.suggested) ? (data.suggested as SegmentRect[]) : null,
    suggestModel: typeof data.suggestModel === 'string' ? data.suggestModel : null,
    selectedName: typeof data.selectedName === 'string' ? data.selectedName : 'window',
    landmarkLimit: typeof data.landmarkLimit === 'number' ? clampLimit(data.landmarkLimit) : 12,
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : new Date().toISOString(),
  }
}

export function clearProtectDraft(storage: Memory): void {
  storage.removeItem(PROTECT_DRAFT_KEY)
}
