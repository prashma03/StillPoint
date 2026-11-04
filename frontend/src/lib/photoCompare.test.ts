import { describe, expect, it, vi } from 'vitest'
import { backgroundOnly, matchPhotographs, photoFileError, type Pixels } from './photoCompare'
import { runCheck } from './check'
import { clearCheckSession, emptyCheck, getCheckSession, saveCheckSession, getProofMedia, setProofMedia, proofNeedsViewingChoice } from './checkSession'
import { reportText } from './report'

// Harmless generated pixels, not a real-photo accuracy evaluation.
function textured(): Pixels {
  const width = 256, height = 256, data = new Uint8ClampedArray(width * height * 4)
  let seed = 417
  for (let i = 0; i < width * height; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    data[i * 4] = seed % 256; data[i * 4 + 1] = seed >>> 8 & 255; data[i * 4 + 2] = seed >>> 16 & 255; data[i * 4 + 3] = 255
  }
  return { width, height, data }
}
describe('local photo comparison', () => {
  it('requires a Proof viewing choice unless viewing was explicitly acknowledged with Blind Mode off', () => {
    expect(proofNeedsViewingChoice({ blind: true, viewing: false })).toBe(true)
    expect(proofNeedsViewingChoice({ blind: false, viewing: false })).toBe(true)
    expect(proofNeedsViewingChoice({ blind: true, viewing: true })).toBe(true)
    expect(proofNeedsViewingChoice({ blind: false, viewing: true })).toBe(false)
  })
  it('rejects unsupported, empty, and oversized files before decoding', () => {
    expect(photoFileError({ type: 'image/svg+xml', size: 100 })).not.toBeNull()
    expect(photoFileError({ type: 'image/png', size: 0 })).not.toBeNull()
    expect(photoFileError({ type: 'image/png', size: 21 * 1024 * 1024 })).not.toBeNull()
    expect(photoFileError({ type: 'image/jpeg', size: 100 })).toBeNull()
  })
  it('makes private pixel changes irrelevant to proposed correspondences', () => {
    const image = textured(), changed = { ...image, data: image.data.slice() }
    const masks = [{ x: .25, y: .25, w: .5, h: .5 }]
    for (let y = 64; y < 192; y++) for (let x = 64; x < 192; x++) changed.data.fill(0, (y * 256 + x) * 4, (y * 256 + x) * 4 + 4)
    expect(matchPhotographs(image, image, masks, masks)).toEqual(matchPhotographs(changed, image, masks, masks))
  })
  it('excludes automatic and brush-created pixel masks before feature detection', () => {
    const image = textured(), changed = { ...image, data: image.data.slice() }
    const data = new Uint8Array(image.width * image.height)
    for (let y = 64; y < 192; y++) for (let x = 64; x < 192; x++) {
      data[y * image.width + x] = 1
      changed.data.fill(0, (y * image.width + x) * 4, (y * image.width + x) * 4 + 4)
    }
    const pixelMask = { width: image.width, height: image.height, data }
    expect(matchPhotographs(image, image, [], [], pixelMask, pixelMask)).toEqual(matchPhotographs(changed, image, [], [], pixelMask, pixelMask))
  })
  it('finds actual patch pairs after a harmless edit and feeds the real Check/Proof record', async () => {
    const original = textured(), compared = { ...original, data: original.data.slice() }
    for (let y = 100; y < 150; y++) for (let x = 100; x < 150; x++) compared.data.fill(150, (y * 256 + x) * 4, (y * 256 + x) * 4 + 3)
    const matched = matchPhotographs(original, compared, [], [])
    expect(matched.source.room_objects.length).toBeGreaterThanOrEqual(4)
    vi.stubGlobal('crypto', { randomUUID: () => 'photo-test' })
    const result = await runCheck({ source: matched.source, suspect: matched.suspect, sourceLabel: 'original', suspectLabel: 'edited', sourceHash: null, suspectHash: null, sourceMask: null, maskApplied: false, blind: true, sample: false, allowEmpty: true }, () => {})
    vi.unstubAllGlobals()
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.record.result.aligned_points).toBeGreaterThanOrEqual(4)
      expect(result.record.sample).toBe(false)
      expect(reportText(result.record)).toContain('Reference points')
    }
  })
  it('excludes private pixels before detection and all intersecting edited regions before analysis', () => {
    const image = textured(), mask = { x: 0, y: 0, w: 1, h: 1 }
    expect(matchPhotographs(image, image, [mask], [mask]).source.room_objects).toEqual([])
    const graph = { room_objects: [{ name: 'private', x: 100, y: 100, width: 100, height: 100 }, { name: 'public', x: 800, y: 800, width: 0, height: 0 }] }
    expect(backgroundOnly(graph, [{ x: .15, y: .15, w: .1, h: .1 }]).room_objects.map(p => p.name)).toEqual(['public'])
  })
  it('filters manually placed graph details that overlap confirmed pixel masks before alignment', () => {
    const graph = { room_objects: [{ name: 'covered', x: 500, y: 500, width: 0, height: 0 }, { name: 'background', x: 900, y: 900, width: 0, height: 0 }] }
    const data = new Uint8Array(100 * 100); data.fill(1, 49 * 100 + 49, 49 * 100 + 52)
    expect(backgroundOnly(graph, [], { width: 100, height: 100, data }).room_objects.map(point => point.name)).toEqual(['background'])
  })
  it('returns inconclusive for flat images and empty feature lists rather than inventing matches', async () => {
    const flat: Pixels = { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4) }
    const matched = matchPhotographs(flat, flat, [], [])
    expect(matched.source.room_objects).toEqual([])
    vi.stubGlobal('crypto', { randomUUID: () => 'empty-test' })
    const result = await runCheck({ source: matched.source, suspect: matched.suspect, sourceLabel: 'flat', suspectLabel: 'flat', sourceHash: null, suspectHash: null, sourceMask: null, maskApplied: false, blind: true, sample: false, allowEmpty: true }, () => {})
    vi.unstubAllGlobals()
    expect(result.ok && result.record.result.verdict).toBe('Cannot determine')
  })
  it('uses actual feature edits and exclusions in the subsequent result', async () => {
    const graph = { room_objects: ['a', 'b', 'c', 'd'].map((name, i) => ({ name, x: i * 100, y: 100, width: 0, height: 0 })) }
    const edited = { room_objects: graph.room_objects.map(p => ({ ...p, x: p.x + 200 })) }
    vi.stubGlobal('crypto', { randomUUID: () => 'edit-test' })
    const result = await runCheck({ source: graph, suspect: edited, sourceLabel: 'a', suspectLabel: 'b', sourceHash: null, suspectHash: null, sourceMask: null, maskApplied: false, blind: false, sample: false }, () => {})
    vi.unstubAllGlobals()
    expect(result.ok && result.record.result.aligned_points).toBe(0)
  })
  it('retains a tab-memory draft for returning from Proof and clears draft/media explicitly', () => {
    const draft = { ...emptyCheck(), step: 5, caseId: 'case-1' }
    saveCheckSession(draft)
    setProofMedia({ caseId: 'case-1', original: new Blob(['fixture']), suspicious: null, blind: true })
    expect(getCheckSession()).toBe(draft)
    expect(getProofMedia('different-case')).toBeNull()
    clearCheckSession()
    expect(getCheckSession().step).toBe(1)
    expect(getProofMedia('case-1')).toBeNull()
  })
})
