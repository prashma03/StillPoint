/**
 * Persistent workflow drafts for Protect and Check.
 *
 * Back/Continue inside a workflow never unmounts the page, but navigation,
 * reloads, and tab closes do — and the photo File plus object URL cannot
 * survive those. This store keeps every *descriptive* bit of progress (mask,
 * landmarks, labels, AI results, workflow step) in localStorage so returning
 * restores it, while image pixels are refused outright by
 * {@link assertNoImagePayload}: unless the user explicitly enabled persistent
 * photo storage, re-selecting the photo re-verifies by content hash.
 *
 * Never persisted here: consents, viewing acknowledgments, and credentials.
 * Every consent checkbox starts unchecked after a resume, and AI runs only
 * through its own explicit buttons — restoring a draft never repeats a paid
 * model call.
 */
import type { SegmentRect } from './ai'
import { clampLimit } from './landmarks'
import { readGraph } from './graphs'
import { assertNoImagePayload } from './storage'
import type { MappingOrigin, Mask, SceneGraph } from './types'

export const PROTECT_DRAFT_KEY = 'stillpoint.protect.draft.v1'
export const CHECK_DRAFT_KEY = 'stillpoint.check.draft.v1'

/** Reference to a photo the user explicitly kept in the local photo vault. */
export type VaultRef = {
  id: string
  name: string
  type: string
}

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
  photoVault: VaultRef | null
  savedAt: string
}

export type CheckDraft = {
  version: 1
  suspectName: string | null
  suspectHash: string | null
  suspectKind: 'graph' | 'image' | 'other' | null
  suspectGraph: SceneGraph | null
  sourceId: string
  sourceName: string
  sourceGraph: SceneGraph | null
  photoMask: Mask
  photoMaskConfirmed: boolean
  suggested: SegmentRect[] | null
  photoGraph: SceneGraph | null
  photoOrigin: MappingOrigin
  photoModel: string | null
  photoNote: string
  photoVault: VaultRef | null
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
    photoVault: null,
    savedAt: new Date().toISOString(),
  }
}

export function emptyCheckDraft(): CheckDraft {
  return {
    version: 1,
    suspectName: null,
    suspectHash: null,
    suspectKind: null,
    suspectGraph: null,
    sourceId: '',
    sourceName: '',
    sourceGraph: null,
    photoMask: { x: 0.34, y: 0.1, w: 0.32, h: 0.72 },
    photoMaskConfirmed: false,
    suggested: null,
    photoGraph: null,
    photoOrigin: 'manual',
    photoModel: null,
    photoNote: '',
    photoVault: null,
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
    if (typeof localStorage !== 'undefined') return localStorage
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

/** True when the Check draft holds progress worth restoring or warning about. */
export function checkDraftHasWork(draft: CheckDraft | null): boolean {
  if (!draft) return false
  return (
    draft.suspectName !== null ||
    draft.sourceGraph !== null ||
    (draft.photoGraph !== null && draft.photoGraph.room_objects.length > 0) ||
    draft.photoMaskConfirmed ||
    draft.suggested !== null
  )
}

export function saveProtectDraft(storage: Memory, draft: ProtectDraft): void {
  assertNoImagePayload(draft)
  storage.setItem(PROTECT_DRAFT_KEY, JSON.stringify({ ...draft, version: 1, savedAt: new Date().toISOString() }))
}

export function saveCheckDraft(storage: Memory, draft: CheckDraft): void {
  assertNoImagePayload(draft)
  storage.setItem(CHECK_DRAFT_KEY, JSON.stringify({ ...draft, version: 1, savedAt: new Date().toISOString() }))
}

function readMask(value: unknown): Mask | null {
  if (!value || typeof value !== 'object') return null
  const mask = value as Record<string, unknown>
  if (!['x', 'y', 'w', 'h'].every((key) => typeof mask[key] === 'number')) return null
  return mask as unknown as Mask
}

function readVaultRef(value: unknown): VaultRef | null {
  if (!value || typeof value !== 'object') return null
  const ref = value as Record<string, unknown>
  if (typeof ref.id !== 'string' || typeof ref.name !== 'string' || typeof ref.type !== 'string') return null
  if (!ref.id || !ref.name) return null
  return { id: ref.id, name: ref.name, type: ref.type }
}

function readOptionalGraph(value: unknown): SceneGraph | null {
  if (value === null || value === undefined) return null
  const read = readGraph(value)
  return read.ok ? read.graph : null
}

function readSuggested(value: unknown): SegmentRect[] | null {
  if (!Array.isArray(value)) return null
  if (!value.every((item) => item && typeof item === 'object')) return null
  return value as SegmentRect[]
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

  // An empty landmark list is valid mid-wizard (photo chosen, nothing
  // mapped); only structurally invalid graphs reject the whole draft.
  const rawGraph = data.graph as { room_objects?: unknown } | null
  const graph: SceneGraph =
    rawGraph && typeof rawGraph === 'object' && Array.isArray(rawGraph.room_objects) && rawGraph.room_objects.length === 0
      ? { room_objects: [] }
      : (() => {
          const read = readGraph(data.graph)
          if (!read.ok) return null
          return read.graph
        })()
  if (!graph) return null

  const step = typeof data.step === 'number' ? Math.min(4, Math.max(1, Math.floor(data.step))) : 1
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
    mask: readMask(data.mask) ?? emptyDraft().mask,
    maskConfirmed: data.maskConfirmed === true,
    personAck: data.personAck === true,
    suggested: readSuggested(data.suggested),
    suggestModel: typeof data.suggestModel === 'string' ? data.suggestModel : null,
    selectedName: typeof data.selectedName === 'string' ? data.selectedName : 'bed',
    landmarkLimit: typeof data.landmarkLimit === 'number' ? clampLimit(data.landmarkLimit) : 12,
    photoVault: readVaultRef(data.photoVault),
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : new Date().toISOString(),
  }
}

export function loadCheckDraft(storage: Memory): CheckDraft | null {
  const raw = storage.getItem(CHECK_DRAFT_KEY)
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const data = parsed as Record<string, unknown>
  const kind = data.suspectKind
  return {
    version: 1,
    suspectName: typeof data.suspectName === 'string' ? data.suspectName : null,
    suspectHash: typeof data.suspectHash === 'string' ? data.suspectHash : null,
    suspectKind: kind === 'graph' || kind === 'image' || kind === 'other' ? kind : null,
    suspectGraph: readOptionalGraph(data.suspectGraph),
    sourceId: typeof data.sourceId === 'string' ? data.sourceId : '',
    sourceName: typeof data.sourceName === 'string' ? data.sourceName : '',
    sourceGraph: readOptionalGraph(data.sourceGraph),
    photoMask: readMask(data.photoMask) ?? emptyCheckDraft().photoMask,
    photoMaskConfirmed: data.photoMaskConfirmed === true,
    suggested: readSuggested(data.suggested),
    photoGraph: readOptionalGraph(data.photoGraph),
    photoOrigin: data.photoOrigin === 'ai-assist' ? 'ai-assist' : 'manual',
    photoModel: typeof data.photoModel === 'string' ? data.photoModel : null,
    photoNote: typeof data.photoNote === 'string' ? data.photoNote : '',
    photoVault: readVaultRef(data.photoVault),
    savedAt: typeof data.savedAt === 'string' ? data.savedAt : new Date().toISOString(),
  }
}

export function clearProtectDraft(storage: Memory): void {
  storage.removeItem(PROTECT_DRAFT_KEY)
}

export function clearCheckDraft(storage: Memory): void {
  storage.removeItem(CHECK_DRAFT_KEY)
}

export type UnloadRisk = {
  /** The workflow already reached its saved outcome (scene saved / compared). */
  saved: boolean
  /** Photo pixels currently live in memory only. */
  photoInMemory: boolean
  /** The photo was explicitly kept in the local photo vault. */
  photoPersisted: boolean
  /** The last draft autosave reached storage. */
  persistOk: boolean
  /** The workflow holds progress worth keeping. */
  hasWork: boolean
}

/**
 * True only when closing the tab would actually lose work: unpersisted photo
 * pixels, or progress whose autosave never reached storage. Draft metadata
 * that autosaved cleanly needs no warning.
 */
export function needsUnloadWarning(risk: UnloadRisk): boolean {
  if (risk.saved) return false
  if (risk.photoInMemory && !risk.photoPersisted) return true
  if (risk.hasWork && !risk.persistOk) return true
  return false
}

export type ReattachState = 'none' | 'ready' | 'needs-reselect'

/**
 * Whether a resumed photo workflow can continue: imported graphs and fresh
 * starts need nothing; a photo workflow is ready with its file or vault copy,
 * otherwise the user must re-select the file for hash re-verification.
 */
export function photoReattachState(opts: {
  fileName: string | null
  imported: boolean
  hasFile: boolean
  vaultHasPhoto: boolean
}): ReattachState {
  if (opts.fileName === null || opts.imported) return 'none'
  if (opts.hasFile || opts.vaultHasPhoto) return 'ready'
  return 'needs-reselect'
}
