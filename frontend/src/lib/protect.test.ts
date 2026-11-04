import { describe, expect, it } from 'vitest'
import { compareGraphs } from './align'
import { harrisResponse, rgbaToGrayscale, snapToCorner } from './detect'
import { clearProtectDraft, draftHasWork, emptyDraft, loadProtectDraft, saveProtectDraft } from './draft'
import { replacedBackground } from './graphs'
import {
  LANDMARK_DEFAULT_LIMIT,
  MIN_POINT_SEPARATION,
  assessLandmarks,
  centerInMaskWithMargin,
  clampLimit,
  clientToImageCoords,
  consentScope,
  landmarkCenter,
  landmarkToPercent,
  maskSignature,
  mergeLandmarks,
  sanitizeAiPoints,
  validateRename,
} from './landmarks'
import { present } from './present'
import { sampleDerivative, sampleMoved, sampleOriginal } from './samples'
import { createMemoryStore } from './storage'
import { validateGraph } from './validate'
import type { Mask, RoomObject } from './types'

function point(name: string, x: number, y: number, extra: Partial<RoomObject> = {}): RoomObject {
  return { name, x, y, width: 0, height: 0, ...extra }
}

function box(name: string, x: number, y: number, width: number, height: number, extra: Partial<RoomObject> = {}): RoomObject {
  return { name, x, y, width, height, ...extra }
}

const MASK: Mask = { x: 0.34, y: 0.1, w: 0.32, h: 0.72 }

describe('protect draft (Back/Next state preservation)', () => {
  it('round-trips the full workflow state through the session store', () => {
    const storage = createMemoryStore()
    const draft = {
      ...emptyDraft(),
      step: 3,
      label: 'Bedroom',
      fileName: 'room.jpg',
      fileHash: 'abc123',
      imageWidth: 1600,
      imageHeight: 900,
      graph: {
        room_objects: [
          point('bed', 120, 450, { pointOrigin: 'manual', confirmed: true }),
          box('window', 700, 100, 120, 160, { pointOrigin: 'ai', confirmed: false }),
        ],
      },
      origin: 'ai-assist' as const,
      model: 'muse-wonder-1.0',
      aiNote: 'AI suggested 1 point(s).',
      mask: { ...MASK },
      maskConfirmed: true,
      suggested: [{ x: 300, y: 100, width: 320, height: 700 }],
      suggestModel: 'sam-3.1',
      selectedName: 'door',
      landmarkLimit: 16,
    }
    saveProtectDraft(storage, draft)
    const restored = loadProtectDraft(storage)
    expect(restored).not.toBeNull()
    expect(restored?.step).toBe(3)
    expect(restored?.label).toBe('Bedroom')
    expect(restored?.fileHash).toBe('abc123')
    expect(restored?.imageWidth).toBe(1600)
    expect(restored?.mask).toEqual(MASK)
    expect(restored?.maskConfirmed).toBe(true)
    expect(restored?.graph.room_objects).toHaveLength(2)
    expect(restored?.graph.room_objects[1]).toMatchObject({ name: 'window', pointOrigin: 'ai', confirmed: false })
    expect(restored?.origin).toBe('ai-assist')
    expect(restored?.model).toBe('muse-wonder-1.0')
    expect(restored?.suggested).toHaveLength(1)
    expect(restored?.landmarkLimit).toBe(16)
  })

  it('refuses image pixels and recovers safely from corrupt drafts', () => {
    const storage = createMemoryStore()
    expect(() => saveProtectDraft(storage, { ...emptyDraft(), label: 'x', aiNote: 'data:image/png;base64,AA' })).toThrow(/image data/)
    storage.setItem('stillpoint.protect.draft.v1', 'not json')
    expect(loadProtectDraft(storage)).toBeNull()
    storage.setItem('stillpoint.protect.draft.v1', JSON.stringify({ ...emptyDraft(), graph: { room_objects: null } }))
    expect(loadProtectDraft(storage)).toBeNull()
    storage.setItem(
      'stillpoint.protect.draft.v1',
      JSON.stringify({ ...emptyDraft(), graph: { room_objects: [{ name: 'bed', x: -1, y: 0, width: 1, height: 1 }] } }),
    )
    expect(loadProtectDraft(storage)).toBeNull()
    // An empty landmark list is fine mid-wizard: photo chosen, nothing mapped.
    storage.setItem('stillpoint.protect.draft.v1', JSON.stringify({ ...emptyDraft(), fileName: 'a.jpg' }))
    expect(loadProtectDraft(storage)?.fileName).toBe('a.jpg')
    expect(loadProtectDraft(createMemoryStore())).toBeNull()
  })

  it('clamps the step and limit, and reports whether work exists', () => {
    const storage = createMemoryStore()
    expect(draftHasWork(null)).toBe(false)
    expect(draftHasWork(emptyDraft())).toBe(false)
    expect(draftHasWork({ ...emptyDraft(), fileName: 'a.jpg' })).toBe(true)
    saveProtectDraft(storage, { ...emptyDraft(), fileName: 'a.jpg', step: 9, landmarkLimit: 99 })
    const restored = loadProtectDraft(storage)
    expect(restored?.step).toBe(3)
    expect(restored?.landmarkLimit).toBeLessThanOrEqual(24)
    clearProtectDraft(storage)
    expect(loadProtectDraft(storage)).toBeNull()
  })
})

describe('coordinate transforms (single-transform contract)', () => {
  it('scores and renders the box center, never the top-left corner', () => {
    // Regression: dots were drawn at (x, y) while the engine scored the
    // center, so AI boxes appeared on unrelated walls.
    const obj = box('poster', 100, 200, 200, 100)
    expect(landmarkCenter(obj)).toEqual({ x: 200, y: 250 })
    expect(landmarkToPercent(obj)).toEqual({ left: 20, top: 25 })
    const manual = point('bed', 120, 450)
    expect(landmarkToPercent(manual)).toEqual({ left: 12, top: 45 })
  })

  it('inverts the overlay mapping exactly once and clamps to the frame', () => {
    const rect = { left: 100, top: 50, width: 800, height: 600 }
    expect(clientToImageCoords(100, 50, rect)).toEqual({ x: 0, y: 0 })
    expect(clientToImageCoords(900, 650, rect)).toEqual({ x: 1000, y: 1000 })
    expect(clientToImageCoords(500, 350, rect)).toEqual({ x: 500, y: 500 })
    expect(clientToImageCoords(-50, 9999, rect)).toEqual({ x: 0, y: 1000 })
    expect(clientToImageCoords(0, 0, { left: 0, top: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0 })
  })

  it('round-trips display percent back to image coordinates', () => {
    const rect = { left: 0, top: 0, width: 640, height: 480 }
    for (const obj of [point('a', 123, 456), box('b', 700, 100, 120, 160)]) {
      const shown = landmarkToPercent(obj)
      const back = clientToImageCoords(
        (shown.left / 100) * rect.width,
        (shown.top / 100) * rect.height,
        rect,
      )
      const center = landmarkCenter(obj)
      expect(back.x).toBeCloseTo(center.x, 6)
      expect(back.y).toBeCloseTo(center.y, 6)
    }
  })
})

describe('mask exclusion with boundary margin', () => {
  it('rejects centers inside the mask and near its edges', () => {
    // Mask spans x 340–660, y 100–820; margin 20 grows it to 320–680 / 80–840.
    expect(centerInMaskWithMargin(point('a', 500, 400), MASK)).toBe(true)
    expect(centerInMaskWithMargin(point('b', 330, 400), MASK)).toBe(true)
    expect(centerInMaskWithMargin(point('c', 319, 400), MASK)).toBe(false)
    expect(centerInMaskWithMargin(point('d', 120, 450), MASK)).toBe(false)
    // Box centers, not corners, decide.
    expect(centerInMaskWithMargin(box('e', 0, 0, 700, 900), MASK)).toBe(true)
    expect(centerInMaskWithMargin(point('f', 500, 400), null)).toBe(false)
    // An explicit zero margin restores the strict check.
    expect(centerInMaskWithMargin(point('b', 330, 400), MASK, 0)).toBe(false)
  })
})

describe('landmark sanitize and merge (AI suggestions never overwrite)', () => {
  const existing = [point('bed', 120, 450, { pointOrigin: 'manual', confirmed: true })]

  it('keeps good points and marks them unconfirmed AI suggestions', () => {
    const { kept, dropped } = sanitizeAiPoints([box('window', 700, 100, 120, 160)], {
      mask: MASK,
      limit: LANDMARK_DEFAULT_LIMIT,
      existing,
    })
    expect(kept).toHaveLength(1)
    expect(kept[0]).toMatchObject({ name: 'window', pointOrigin: 'ai', confirmed: false })
    expect(dropped).toEqual({ outOfBounds: 0, inMask: 0, duplicate: 0, personNamed: 0, overLimit: 0 })
  })

  it('drops out-of-bounds, masked, duplicate, person-named, and over-limit points', () => {
    const candidates = [
      box('poster', 5000, 100, 60, 60), // out of bounds
      point('rug', 500, 400), // inside the mask
      point('bed', 800, 800), // name taken by the user's confirmed point
      point('chair', 120 + MIN_POINT_SEPARATION - 1, 450), // spatial duplicate
      point('face', 100, 100), // person-named
      point('door', 100, 100), // fits…
      point('desk', 200, 200), // …fits…
      point('shelf', 850, 750), // …fits…
      point('table', 850, 150), // …but the 1 existing + 3 kept already spend the limit of 4
    ]
    const { kept, dropped } = sanitizeAiPoints(candidates, { mask: MASK, limit: 4, existing })
    expect(kept.map((obj) => obj.name)).toEqual(['door', 'desk', 'shelf'])
    expect(dropped).toEqual({ outOfBounds: 1, inMask: 1, duplicate: 2, personNamed: 1, overLimit: 1 })
  })

  it('merges without touching existing manual work', () => {
    const incoming = [
      point('bed', 900, 900, { pointOrigin: 'ai', confirmed: false }),
      point('door', 750, 200, { pointOrigin: 'ai', confirmed: false }),
    ]
    const { graph, added, skipped } = mergeLandmarks({ room_objects: existing }, incoming)
    expect(added).toBe(1)
    expect(skipped).toBe(1)
    expect(graph.room_objects.find((obj) => obj.name === 'bed')).toMatchObject({ x: 120, pointOrigin: 'manual' })
    expect(graph.room_objects.find((obj) => obj.name === 'door')).toMatchObject({ pointOrigin: 'ai' })
  })

  it('validates landmark sets for the editor', () => {
    expect(assessLandmarks({ room_objects: [] }, MASK)[0].level).toBe('info')
    const thin = assessLandmarks({ room_objects: [point('bed', 120, 450)] }, MASK)
    expect(thin.some((issue) => issue.level === 'error' && issue.message.includes('at least 4'))).toBe(true)
    const masked = assessLandmarks({ room_objects: [point('bed', 500, 400, { confirmed: true })] }, MASK)
    expect(masked.some((issue) => issue.message.includes('will not be saved'))).toBe(true)
    const pending = assessLandmarks(
      { room_objects: [point('a', 100, 100), point('b', 800, 100), point('c', 100, 800), point('d', 800, 800, { confirmed: false })] },
      null,
    )
    expect(pending.some((issue) => issue.message.includes('need review'))).toBe(true)
    const clustered = assessLandmarks(
      { room_objects: [point('a', 100, 100), point('b', 110, 105), point('c', 105, 115), point('d', 115, 110)].map((obj) => ({ ...obj, confirmed: true })) },
      null,
    )
    expect(clustered.some((issue) => issue.message.includes('clustered'))).toBe(true)
    const spread = assessLandmarks(
      {
        room_objects: [point('a', 100, 100), point('b', 800, 100), point('c', 100, 800), point('d', 800, 800)].map((obj) => ({ ...obj, confirmed: true })),
      },
      null,
    )
    expect(spread).toHaveLength(1)
    expect(spread[0].message).toMatch(/Ready to continue/)
  })
})

describe('landmark relabeling', () => {
  const graph = { room_objects: [point('bed', 120, 450), point('door', 750, 200)] }

  it('accepts a fresh label and keeps the identity otherwise', () => {
    expect(validateRename(graph, 'bed', '  window ')).toEqual({ ok: true, name: 'window' })
    expect(validateRename(graph, 'bed', 'bed')).toEqual({ ok: true, name: 'bed' })
  })

  it('refuses person names, duplicates, and empty labels', () => {
    expect(validateRename(graph, 'bed', 'Face')).toEqual({
      ok: false,
      error: 'People are never reference points. Pick a background label.',
    })
    const dupe = validateRename(graph, 'bed', 'door')
    expect(dupe.ok).toBe(false)
    if (dupe.ok) return
    expect(dupe.error).toMatch(/already used/)
    expect(validateRename(graph, 'bed', '   ').ok).toBe(false)
    expect(validateRename(graph, 'bed', 'x'.repeat(81)).ok).toBe(false)
  })
})

describe('consent scope (one checkbox, one transfer)', () => {
  it('changes with image, kind, or mask — and nothing else', () => {
    const base = consentScope('hash-a', 'analyze', MASK)
    expect(consentScope('hash-a', 'analyze', MASK)).toBe(base)
    expect(consentScope('hash-b', 'analyze', MASK)).not.toBe(base)
    expect(consentScope('hash-a', 'segment', MASK)).not.toBe(base)
    expect(consentScope('hash-a', 'analyze', { ...MASK, x: 0.35 })).not.toBe(base)
    // Segmentation sees the full photo: the mask is not part of its scope.
    expect(consentScope('hash-a', 'segment', null)).toBe(consentScope('hash-a', 'segment', MASK))
    expect(maskSignature(null)).toBe('no-mask')
  })

  it('clamps the landmark limit to the supported range', () => {
    expect(clampLimit(12)).toBe(12)
    expect(clampLimit(1)).toBe(4)
    expect(clampLimit(99)).toBe(24)
    expect(clampLimit(Number.NaN)).toBe(LANDMARK_DEFAULT_LIMIT)
  })
})

describe('validation provenance carry-through', () => {
  it('keeps well-formed origin flags and rejects malformed ones', () => {
    const good = validateGraph({
      room_objects: [point('bed', 100, 450, { pointOrigin: 'ai', confirmed: false })],
    })
    expect(good.ok).toBe(true)
    if (!good.ok) return
    expect(good.graph.room_objects[0]).toMatchObject({ pointOrigin: 'ai', confirmed: false })
    const legacy = validateGraph({ room_objects: [{ name: 'bed', x: 100, y: 450, width: 380, height: 300 }] })
    expect(legacy.ok).toBe(true)
    const badOrigin = validateGraph({ room_objects: [point('bed', 100, 450, { pointOrigin: 'model' as never })] })
    expect(badOrigin.ok).toBe(false)
    if (badOrigin.ok) return
    expect(badOrigin.errors[0].code).toBe('bad_point_meta')
    expect(validateGraph({ room_objects: [point('bed', 100, 450, { confirmed: 'yes' as never })] }).ok).toBe(false)
  })
})

function cornerBuffer(size: number): { data: Uint8ClampedArray; width: number; height: number } {
  // White square on black: one strong corner at (size/2, size/2).
  const data = new Uint8ClampedArray(size * size * 4)
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const on = x >= size / 2 && y >= size / 2 ? 255 : 0
      const i = (y * size + x) * 4
      data[i] = on
      data[i + 1] = on
      data[i + 2] = on
      data[i + 3] = 255
    }
  }
  return { data, width: size, height: size }
}

describe('corner snapping (measured refinement only)', () => {
  it('leaves flat neighborhoods untouched', () => {
    const flat = new Uint8ClampedArray(32 * 32 * 4).fill(128)
    const gray = rgbaToGrayscale(flat, 32, 32)
    expect(Math.max(...harrisResponse(gray, 32, 32))).toBe(0)
    expect(snapToCorner(gray, 32, 32, 500, 500)).toBeNull()
  })

  it('moves a nearby point onto the measured corner, deterministically', () => {
    const { data, width, height } = cornerBuffer(64)
    const gray = rgbaToGrayscale(data, width, height)
    expect(Math.max(...harrisResponse(gray, width, height))).toBeGreaterThan(0)
    const first = snapToCorner(gray, width, height, 490, 490)
    expect(first).not.toBeNull()
    expect(first!.moved).toBeGreaterThan(0)
    expect(first!.moved).toBeLessThanOrEqual(30)
    expect(snapToCorner(gray, width, height, 490, 490)).toEqual(first)
    expect(snapToCorner(gray, width, height, 100, 100)).toBeNull()
  })
})

describe('matching quality (geometry, not point counts)', () => {
  it('scores agreement as a ratio: more points do not inflate it', () => {
    const names = ['bed', 'poster', 'door', 'rug', 'desk', 'shelf', 'window', 'table', 'chair', 'wardrobe']
    const source = { room_objects: names.map((name, i) => point(name, 100 + i * 80, 200)) }
    const aligned8 = { room_objects: source.room_objects.map((obj, i) => (i < 8 ? obj : { ...obj, x: obj.x - 300 })) }
    const result = compareGraphs(source, aligned8)
    expect(result.usable_points).toBe(10)
    expect(result.agreement_percent).toBe(80)
    expect(result.verdict).toBe('Likely derivative')
    const fewer = { room_objects: source.room_objects.slice(0, 5) }
    const fewerMoved = { room_objects: fewer.room_objects.map((obj, i) => (i < 4 ? obj : { ...obj, x: obj.x + 300 })) }
    const small = compareGraphs(fewer, fewerMoved)
    expect(small.agreement_percent).toBe(80)
    expect(small.verdict).toBe('Likely derivative')
    // And extra non-shared points never join the score at all.
    const padded = { room_objects: [...aligned8.room_objects, point('lamp', 1, 1), point('curtain', 2, 2)] }
    expect(compareGraphs(source, padded).agreement_percent).toBe(80)
  })

  it('distinguishes edited source, moved viewpoint, and replaced background', () => {
    const edited = compareGraphs(sampleOriginal, sampleDerivative)
    expect(edited.verdict).toBe('Likely derivative')
    expect(edited.uniform_shift).toBe(true)
    const moved = compareGraphs(sampleOriginal, sampleMoved)
    expect(moved.verdict).toBe('No link found')
    expect(moved.uniform_shift).toBe(false)
    const replaced = compareGraphs(sampleOriginal, replacedBackground())
    expect(replaced.usable_points).toBe(0)
    expect(replaced.verdict).toBe('Cannot determine')
  })

  it('labels uniform middle-evidence as crop-consistent without touching the verdict', () => {
    const names = ['bed', 'poster', 'door', 'rug']
    const source = { room_objects: names.map((name, i) => box(name, 100 + i * 100, 200, 60, 60)) }
    // Two aligned, two shifted together by (30, 0): 50% agreement, uniform shift.
    const suspect = {
      room_objects: source.room_objects.map((obj, i) => (i < 2 ? { ...obj } : { ...obj, x: obj.x + 30 })),
    }
    const result = compareGraphs(source, suspect)
    expect(result.verdict).toBe('Cannot determine')
    expect(result.uniform_shift).toBe(true)
    expect(present(result).note).toMatch(/crop or resize/)
    const scattered = compareGraphs(sampleOriginal, {
      room_objects: sampleOriginal.room_objects.map((obj, i) => (i < 2 ? obj : { ...obj, x: obj.x + 80 })),
    })
    expect(scattered.uniform_shift).toBe(false)
    expect(present(scattered).note).toBeNull()
  })
})
