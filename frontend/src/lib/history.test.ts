import { describe, expect, it, vi } from 'vitest'
import { emptyDraft, loadProtectDraft, saveProtectDraft } from './draft'
import { canRedo, canUndo, emptyHistory, HISTORY_LIMIT, pushHistory, redoHistory, undoHistory } from './history'
import { LANDMARK_DEFAULT_LIMIT, mergeLandmarks, sanitizeAiPoints } from './landmarks'
import { createMemoryStore } from './storage'
import type { Mask, RoomObject, SceneGraph } from './types'

function point(name: string, x: number, y: number): RoomObject {
  return { name, x, y, width: 0, height: 0, pointOrigin: 'manual', confirmed: true }
}

function box(name: string, x: number, y: number, width: number, height: number): RoomObject {
  return { name, x, y, width, height }
}

const MASK: Mask = { x: 0.34, y: 0.1, w: 0.32, h: 0.72 }
const graphOf = (room_objects: RoomObject[]): SceneGraph => ({ room_objects })

describe('undo/redo history (delete, move, relabel)', () => {
  it('starts empty and reports availability', () => {
    const history = emptyHistory()
    expect(canUndo(history)).toBe(false)
    expect(canRedo(history)).toBe(false)
    expect(undoHistory(history, graphOf([]))).toBeNull()
    expect(redoHistory(history, graphOf([]))).toBeNull()
  })

  it('restores the exact pre-edit graph, including review flags', () => {
    const before = graphOf([point('bed', 120, 450), box('window', 700, 100, 120, 160)])
    const afterDelete = graphOf([point('bed', 120, 450)])
    let history = pushHistory(emptyHistory(), before)
    expect(canUndo(history)).toBe(true)
    const undone = undoHistory(history, afterDelete)
    expect(undone?.graph).toEqual(before)
    expect(canRedo(undone!.history)).toBe(true)
    const redone = redoHistory(undone!.history, undone!.graph)
    expect(redone?.graph).toEqual(afterDelete)
    expect(canRedo(redone!.history)).toBe(false)
  })

  it('clears the redo stack on a new edit and caps depth', () => {
    let history = pushHistory(emptyHistory(), graphOf([]))
    const undone = undoHistory(history, graphOf([point('bed', 120, 450)]))!
    expect(canRedo(undone.history)).toBe(true)
    history = pushHistory(undone.history, undone.graph)
    expect(canRedo(history)).toBe(false)
    for (let i = 0; i < HISTORY_LIMIT + 10; i += 1) {
      history = pushHistory(history, graphOf([point(`p${i}`, i, i)]))
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT)
  })
})

describe('restore without Meta (deleted points come back offline)', () => {
  const bed = point('bed', 120, 450)
  const snapshot = [box('window', 700, 100, 120, 160), point('door', 850, 520)];

  function restore(existing: RoomObject[]) {
    const { kept } = sanitizeAiPoints(snapshot, {
      mask: MASK,
      limit: LANDMARK_DEFAULT_LIMIT,
      existing,
    })
    return mergeLandmarks(graphOf(existing), kept)
  }

  it('restores a deleted AI suggestion locally and never duplicates it', () => {
    const fetchSpy = typeof fetch === 'function' ? vi.spyOn(globalThis, 'fetch') : null
    try {
      // Intake: both suggestions merge in.
      const first = restore([bed])
      expect(first.added).toBe(2)
      // The user deletes one by accident.
      const afterDelete = first.graph.room_objects.filter((obj) => obj.name !== 'window')
      expect(afterDelete.map((obj) => obj.name).sort()).toEqual(['bed', 'door'])
      // Restore brings exactly the missing one back.
      const second = restore(afterDelete)
      expect(second.added).toBe(1)
      expect(second.graph.room_objects.map((obj) => obj.name).sort()).toEqual(['bed', 'door', 'window'])
      // Restoring again is a no-op, not a duplicate.
      const third = restore(second.graph.room_objects)
      expect(third.added).toBe(0)
      expect(third.graph.room_objects).toHaveLength(3)
      if (fetchSpy) expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy?.mockRestore()
    }
  })

  it('undoes a deletion without contacting Meta', () => {
    const fetchSpy = typeof fetch === 'function' ? vi.spyOn(globalThis, 'fetch') : null
    try {
      const before = graphOf([bed, box('window', 700, 100, 120, 160)])
      const afterDelete = graphOf([bed])
      const history = pushHistory(emptyHistory(), before)
      expect(undoHistory(history, afterDelete)?.graph).toEqual(before)
      if (fetchSpy) expect(fetchSpy).not.toHaveBeenCalled()
    } finally {
      fetchSpy?.mockRestore()
    }
  })
})

describe('draft keeps the AI snapshot and undo history across navigation', () => {
  it('round-trips snapshot and stacks through save and load', () => {
    const storage = createMemoryStore()
    const past = graphOf([point('bed', 120, 450)])
    const future = graphOf([point('bed', 120, 450), point('door', 850, 520)])
    saveProtectDraft(storage, {
      ...emptyDraft(),
      fileName: 'room.jpg',
      graph: future,
      aiSnapshot: [box('window', 700, 100, 120, 160)],
      historyPast: [graphOf([]), past],
      historyFuture: [future],
    })
    const restored = loadProtectDraft(storage)
    expect(restored?.aiSnapshot).toHaveLength(1)
    expect(restored?.aiSnapshot?.[0]).toMatchObject({ name: 'window' })
    expect(restored?.historyPast).toHaveLength(2)
    expect(restored?.historyPast[1].room_objects).toHaveLength(1)
    expect(restored?.historyFuture).toHaveLength(1)
  })

  it('drops malformed snapshots and history entries, keeping the draft', () => {
    const storage = createMemoryStore()
    storage.setItem(
      'stillpoint.protect.draft.v1',
      JSON.stringify({
        ...emptyDraft(),
        fileName: 'room.jpg',
        aiSnapshot: [{ name: 'bed', x: -5, y: 0, width: 1, height: 1 }],
        historyPast: [{ room_objects: [] }, { room_objects: [{ name: 'x' }] }, 'junk'],
        historyFuture: 'junk',
      }),
    )
    const restored = loadProtectDraft(storage)
    expect(restored?.fileName).toBe('room.jpg')
    expect(restored?.aiSnapshot).toBeNull()
    expect(restored?.historyPast).toEqual([{ room_objects: [] }])
    expect(restored?.historyFuture).toEqual([])
  })
})
