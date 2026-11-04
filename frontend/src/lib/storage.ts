import { readGraph } from './graphs'
import type { ReviewNote, Settings, StoredScene } from './types'

type Memory = {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

const SCENES = 'stillpoint.scenes.v1'
const SETTINGS = 'stillpoint.settings.v1'
const REVIEWS = 'stillpoint.reviews.v1'
const CASE = 'stillpoint.case.v1'
const IMAGE_MARK = /data:image\/|data:video\//i

export function createMemoryStore(): Memory {
  const map = new Map<string, string>()
  return {
    getItem: (key) => (map.has(key) ? map.get(key)! : null),
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  }
}

function browserMemory(): Memory | null {
  try {
    if (typeof localStorage === 'undefined') return null
    return localStorage
  } catch {
    return null
  }
}

function browserSessionMemory(): Memory | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage
  } catch {
    return null
  }
}

/** Keep guest scene and note data only for this tab; migrate older local data. */
function guestSessionMemory(key: string): Memory {
  const session = browserSessionMemory()
  if (!session) return createMemoryStore()
  try {
    if (!session.getItem(key)) {
      const persistent = browserMemory()
      const legacy = persistent?.getItem(key)
      if (legacy) {
        session.setItem(key, legacy)
        persistent?.removeItem(key)
      }
    }
  } catch {
    // Keep the current session usable if storage is restricted or full.
  }
  return session
}

export function assertNoImagePayload(value: unknown): void {
  const text = JSON.stringify(value)
  if (IMAGE_MARK.test(text)) throw new Error('Refusing to store image data.')
}

function readJson<T>(storage: Memory, key: string): T | null {
  const raw = storage.getItem(key)
  if (!raw) return null
  if (IMAGE_MARK.test(raw)) {
    storage.removeItem(key)
    return null
  }
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function createSceneStore(storage: Memory) {
  return {
    list(): StoredScene[] {
      const parsed = readJson<unknown>(storage, SCENES)
      if (!Array.isArray(parsed)) return []
      return parsed.flatMap((item) => {
        const scene = sanitizeScene(item)
        return scene ? [scene] : []
      })
    },
    save(scene: StoredScene) {
      assertNoImagePayload(scene)
      const next = [scene, ...this.list().filter((item) => item.id !== scene.id)]
      storage.setItem(SCENES, JSON.stringify(next))
    },
    remove(id: string) {
      storage.setItem(SCENES, JSON.stringify(this.list().filter((item) => item.id !== id)))
    },
    clear() {
      storage.removeItem(SCENES)
    },
    get(id: string) {
      return this.list().find((item) => item.id === id) ?? null
    },
  }
}

function sanitizeScene(value: unknown): StoredScene | null {
  if (!value || typeof value !== 'object') return null
  const item = { ...(value as Record<string, unknown>) }
  for (const key of ['dataUrl', 'image', 'photo', 'pixels', 'blob', 'src']) delete item[key]
  if (typeof item.id !== 'string' || typeof item.label !== 'string' || typeof item.createdAt !== 'string') return null
  const read = readGraph(item.graph)
  if (!read.ok) return null
  return {
    id: item.id,
    label: item.label,
    createdAt: item.createdAt,
    fileHash: typeof item.fileHash === 'string' ? item.fileHash : null,
    mask: isMask(item.mask) ? item.mask : null,
    maskConfirmed: item.maskConfirmed === true,
    personExcludedConfirmed: item.personExcludedConfirmed === true,
    graph: read.graph,
    origin: item.origin === 'ai-assist' ? 'ai-assist' : 'manual',
    model: typeof item.model === 'string' ? item.model : null,
  }
}

function isMask(value: unknown): value is StoredScene['mask'] {
  if (!value || typeof value !== 'object') return false
  const mask = value as Record<string, unknown>
  return ['x', 'y', 'w', 'h'].every((key) => typeof mask[key] === 'number')
}

export function createSettingsStore(storage: Memory) {
  return {
    load(): Settings {
      const parsed = readJson<Partial<Settings>>(storage, SETTINGS)
      return {
        blindMode: parsed?.blindMode !== false,
        pythonEngine: parsed?.pythonEngine === true,
        maskingPreference: parsed?.maskingPreference === 'manual' ? 'manual' : 'local',
        externalImagesEnabled: parsed?.externalImagesEnabled === true,
      }
    },
    save(settings: Settings) {
      storage.setItem(SETTINGS, JSON.stringify(settings))
    },
  }
}

export function createReviewStore(storage: Memory) {
  return {
    list(): ReviewNote[] {
      const parsed = readJson<unknown>(storage, REVIEWS)
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isReview)
    },
    save(note: ReviewNote) {
      assertNoImagePayload(note)
      storage.setItem(REVIEWS, JSON.stringify([note, ...this.list()]))
    },
    clear() {
      storage.removeItem(REVIEWS)
    },
  }
}

function isReview(value: unknown): value is ReviewNote {
  if (!value || typeof value !== 'object') return false
  const note = value as ReviewNote
  return (
    typeof note.id === 'string' &&
    typeof note.createdAt === 'string' &&
    typeof note.note === 'string' &&
    (note.kind === 'review' || note.kind === 'appeal' || note.kind === 'counter-notice') &&
    (note.caseId === null || typeof note.caseId === 'string')
  )
}

export function loadCaseRaw(storage: Memory): unknown {
  return readJson(storage, CASE)
}

export function saveCaseRaw(storage: Memory, value: unknown) {
  assertNoImagePayload(value)
  storage.setItem(CASE, JSON.stringify(value))
}

export function clearCaseRaw(storage: Memory) {
  storage.removeItem(CASE)
}

let localScenes: ReturnType<typeof createSceneStore> | null = null
let localSettings: ReturnType<typeof createSettingsStore> | null = null
let localReviews: ReturnType<typeof createReviewStore> | null = null

/** Identity boundaries never migrate guest records into a different account. */
export function resetPrivateStores() {
  localScenes?.clear()
  localReviews?.clear()
  for (const memory of [browserMemory(), browserSessionMemory()]) {
    for (const key of [SCENES, REVIEWS, CASE, 'stillpoint.protect.draft.v1', 'stillpoint.trust.v1', 'stillpoint.trust.owner.v1']) memory?.removeItem(key)
  }
  localScenes = null
  localReviews = null
}

export function sceneStore() {
  if (!localScenes) localScenes = createSceneStore(guestSessionMemory(SCENES))
  return localScenes
}

export function settingsStore() {
  if (!localSettings) localSettings = createSettingsStore(browserMemory() ?? createMemoryStore())
  return localSettings
}

export function reviewStore() {
  if (!localReviews) localReviews = createReviewStore(guestSessionMemory(REVIEWS))
  return localReviews
}

export function sessionMemory(): Memory | null {
  try {
    if (typeof sessionStorage === 'undefined') return null
    return sessionStorage
  } catch {
    return null
  }
}
