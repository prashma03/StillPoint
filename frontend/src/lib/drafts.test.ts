import { describe, expect, it } from 'vitest'
import {
  CHECK_DRAFT_KEY,
  PROTECT_DRAFT_KEY,
  checkDraftHasWork,
  clearCheckDraft,
  clearProtectDraft,
  draftHasWork,
  emptyCheckDraft,
  emptyDraft,
  loadCheckDraft,
  loadProtectDraft,
  needsUnloadWarning,
  photoReattachState,
  saveCheckDraft,
  saveProtectDraft,
} from './draft'
import { sha256 } from './hash'
import { createMemoryBackend, createPhotoVault } from './images'
import { createMemoryStore } from './storage'
import type { RoomObject } from './types'

function point(name: string, x: number, y: number): RoomObject {
  return { name, x, y, width: 0, height: 0, pointOrigin: 'manual', confirmed: true }
}

describe('Back/Continue preservation (step carries full workflow state)', () => {
  it('round-trips every step with mask, points, flags, and vault reference intact', () => {
    for (const step of [1, 2, 3, 4]) {
      const storage = createMemoryStore()
      saveProtectDraft(storage, {
        ...emptyDraft(),
        step,
        label: 'Bedroom',
        fileName: 'room.jpg',
        fileHash: 'abc123',
        graph: { room_objects: [point('bed', 120, 450), point('window', 700, 100)] },
        origin: 'ai-assist',
        model: 'muse-wonder-1.0',
        mask: { x: 0.3, y: 0.1, w: 0.4, h: 0.7 },
        maskConfirmed: true,
        suggested: [{ x: 300, y: 100, width: 320, height: 700 }],
        suggestModel: 'sam-3.1',
        landmarkLimit: 16,
        photoVault: { id: 'protect:abc123', name: 'room.jpg', type: 'image/jpeg' },
      })
      const restored = loadProtectDraft(storage)
      expect(restored?.step).toBe(step)
      expect(restored?.maskConfirmed).toBe(true)
      expect(restored?.graph.room_objects).toHaveLength(2)
      expect(restored?.origin).toBe('ai-assist')
      expect(restored?.suggested).toHaveLength(1)
      expect(restored?.photoVault).toEqual({ id: 'protect:abc123', name: 'room.jpg', type: 'image/jpeg' })
    }
  })

  it('clamps out-of-range steps instead of losing the draft', () => {
    const storage = createMemoryStore()
    saveProtectDraft(storage, { ...emptyDraft(), fileName: 'a.jpg', step: 9 })
    expect(loadProtectDraft(storage)?.step).toBe(4)
    saveProtectDraft(storage, { ...emptyDraft(), fileName: 'a.jpg', step: -2 })
    expect(loadProtectDraft(storage)?.step).toBe(1)
  })
})

describe('refresh recovery (Check draft round-trip)', () => {
  it('restores suspect, source, mask, mapping, and vault reference', () => {
    const storage = createMemoryStore()
    saveCheckDraft(storage, {
      ...emptyCheckDraft(),
      suspectName: 'suspect.jpg',
      suspectHash: 'def456',
      suspectKind: 'image',
      sourceId: 'scene-1',
      sourceName: 'original.json',
      sourceGraph: { room_objects: [point('bed', 100, 450)] },
      photoMask: { x: 0.3, y: 0.1, w: 0.4, h: 0.7 },
      photoMaskConfirmed: true,
      suggested: [{ x: 10, y: 10, width: 100, height: 200 }],
      photoGraph: { room_objects: [point('door', 750, 200)] },
      photoOrigin: 'ai-assist',
      photoModel: 'muse-wonder-1.0',
      photoNote: 'AI-mapped 1 background point(s).',
      photoVault: { id: 'check:def456', name: 'suspect.jpg', type: 'image/jpeg' },
    })
    const restored = loadCheckDraft(storage)
    expect(restored?.suspectName).toBe('suspect.jpg')
    expect(restored?.suspectKind).toBe('image')
    expect(restored?.sourceGraph?.room_objects).toHaveLength(1)
    expect(restored?.photoMaskConfirmed).toBe(true)
    expect(restored?.photoGraph?.room_objects).toHaveLength(1)
    expect(restored?.photoOrigin).toBe('ai-assist')
    expect(restored?.photoVault?.id).toBe('check:def456')
  })

  it('recovers safely from corrupt or hostile Check drafts', () => {
    const storage = createMemoryStore()
    storage.setItem(CHECK_DRAFT_KEY, 'not json')
    expect(loadCheckDraft(storage)).toBeNull()
    storage.setItem(CHECK_DRAFT_KEY, JSON.stringify({ suspectName: 'x', suspectGraph: { room_objects: [{ nope: 1 }] } }))
    const restored = loadCheckDraft(storage)
    expect(restored?.suspectName).toBe('x')
    expect(restored?.suspectGraph).toBeNull()
    expect(restored?.suspectKind).toBeNull()
    expect(loadCheckDraft(createMemoryStore())).toBeNull()
  })

  it('refuses image pixels in Check drafts', () => {
    const storage = createMemoryStore()
    expect(() =>
      saveCheckDraft(storage, { ...emptyCheckDraft(), photoNote: 'data:image/png;base64,AA' }),
    ).toThrow(/image data/)
  })

  it('reports Check work without counting mere scene selection', () => {
    expect(checkDraftHasWork(null)).toBe(false)
    expect(checkDraftHasWork(emptyCheckDraft())).toBe(false)
    expect(checkDraftHasWork({ ...emptyCheckDraft(), sourceId: 'scene-1' })).toBe(false)
    expect(checkDraftHasWork({ ...emptyCheckDraft(), suspectName: 's.jpg' })).toBe(true)
    expect(checkDraftHasWork({ ...emptyCheckDraft(), photoMaskConfirmed: true })).toBe(true)
  })
})

describe('browser closing (unload warning only when work is at risk)', () => {
  const clean = { saved: false, photoInMemory: false, photoPersisted: false, persistOk: true, hasWork: false }
  it('stays silent with nothing to lose', () => {
    expect(needsUnloadWarning(clean)).toBe(false)
    expect(needsUnloadWarning({ ...clean, saved: true, photoInMemory: true, hasWork: true })).toBe(false)
  })
  it('stays silent when autosaved metadata is safe', () => {
    expect(needsUnloadWarning({ ...clean, hasWork: true })).toBe(false)
    expect(needsUnloadWarning({ ...clean, hasWork: true, photoInMemory: true, photoPersisted: true })).toBe(false)
  })
  it('warns for memory-only photo pixels or failed autosave', () => {
    expect(needsUnloadWarning({ ...clean, photoInMemory: true, hasWork: true })).toBe(true)
    expect(needsUnloadWarning({ ...clean, hasWork: true, persistOk: false })).toBe(true)
  })
})

describe('reopening (resume restores state, never pixels or consents)', () => {
  it('decides photo readiness without claiming pixels survived', () => {
    expect(photoReattachState({ fileName: null, imported: false, hasFile: false, vaultHasPhoto: false })).toBe('none')
    expect(photoReattachState({ fileName: 'g.json', imported: true, hasFile: false, vaultHasPhoto: false })).toBe('none')
    expect(photoReattachState({ fileName: 'r.jpg', imported: false, hasFile: true, vaultHasPhoto: false })).toBe('ready')
    expect(photoReattachState({ fileName: 'r.jpg', imported: false, hasFile: false, vaultHasPhoto: true })).toBe('ready')
    expect(photoReattachState({ fileName: 'r.jpg', imported: false, hasFile: false, vaultHasPhoto: false })).toBe(
      'needs-reselect',
    )
  })

  it('re-verifies a re-selected photo by content hash', async () => {
    const first = new Blob(['same-bytes'], { type: 'image/jpeg' })
    const second = new Blob(['same-bytes'], { type: 'image/jpeg' })
    const other = new Blob(['different-bytes'], { type: 'image/jpeg' })
    const expected = await sha256(first)
    expect(expected).toMatch(/^[0-9a-f]{64}$/)
    expect(await sha256(second)).toBe(expected)
    expect(await sha256(other)).not.toBe(expected)
  })

  it('sanitizes the vault reference and never restores consent state', () => {
    const storage = createMemoryStore()
    storage.setItem(
      PROTECT_DRAFT_KEY,
      JSON.stringify({ ...emptyDraft(), fileName: 'r.jpg', photoVault: { id: 42, name: 'r.jpg' }, consent: true, viewAck: true }),
    )
    const restored = loadProtectDraft(storage)
    expect(restored?.photoVault).toBeNull()
    expect(restored && 'consent' in restored).toBe(false)
    expect(restored && 'viewAck' in restored).toBe(false)
  })
})

describe('draft deletion (drafts and vault photos clear together)', () => {
  it('removes both drafts from storage', () => {
    const storage = createMemoryStore()
    saveProtectDraft(storage, { ...emptyDraft(), fileName: 'a.jpg' })
    saveCheckDraft(storage, { ...emptyCheckDraft(), suspectName: 'b.jpg' })
    expect(draftHasWork(loadProtectDraft(storage))).toBe(true)
    clearProtectDraft(storage)
    expect(loadProtectDraft(storage)).toBeNull()
    // Clearing one workflow never touches the other.
    expect(checkDraftHasWork(loadCheckDraft(storage))).toBe(true)
    clearCheckDraft(storage)
    expect(loadCheckDraft(storage)).toBeNull()
  })

  it('round-trips vault photos through save, load, delete, and clear', async () => {
    const vault = createPhotoVault(createMemoryBackend())
    const blob = new Blob(['pixels'], { type: 'image/jpeg' })
    await vault.savePhoto('protect:abc', blob, 'room.jpg', 'image/jpeg')
    const loaded = await vault.loadPhoto('protect:abc')
    expect(loaded?.name).toBe('room.jpg')
    expect(loaded?.type).toBe('image/jpeg')
    expect(await loaded?.blob.text()).toBe('pixels')
    await vault.deletePhoto('protect:abc')
    expect(await vault.loadPhoto('protect:abc')).toBeNull()
    await vault.savePhoto('check:def', blob, 's.jpg', 'image/jpeg')
    await vault.clear()
    expect(await vault.loadPhoto('check:def')).toBeNull()
  })
})
