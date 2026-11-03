import { describe, expect, it } from 'vitest'
import { analyzeBuffer, checkImageFile } from './analysis'
import { proposeRegions, rgbaToGrayscale, sobelScores } from './detect'
import { readGraph } from './graphs'
import { AUTO_SEGMENTATION_NOTE, checkMask, mergeRectsToMask } from './segment'
import { validateGraph } from './validate'

function obj(name: string, extra: Record<string, unknown> = {}) {
  return { name, x: 100, y: 450, width: 380, height: 300, ...extra }
}

function graph(count = 4) {
  const names = ['bed', 'poster', 'door', 'rug', 'desk', 'shelf']
  return { room_objects: names.slice(0, count).map((name) => obj(name)) }
}

describe('strict validation', () => {
  it('accepts a clean graph', () => {
    const checked = validateGraph(graph())
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.report.object_count).toBe(4)
    expect(checked.report.sufficient_for_comparison).toBe(true)
  })

  it('rejects malformed, out-of-range, and duplicate data', () => {
    expect(validateGraph(null).ok).toBe(false)
    expect(validateGraph({ room_objects: [] }).ok).toBe(false)
    const outOfRange = validateGraph({ room_objects: [obj('bed', { x: -5 })] })
    expect(outOfRange.ok).toBe(false)
    if (outOfRange.ok) return
    expect(outOfRange.errors[0].code).toBe('bad_coordinates')
    const dupe = validateGraph({ room_objects: [obj('Bed'), obj('  BED '), obj('door')] })
    expect(dupe.ok).toBe(false)
    if (dupe.ok) return
    expect(dupe.errors[0].code).toBe('duplicate_name')
  })

  it('excludes people with a warning and rejects person-only graphs', () => {
    const checked = validateGraph({ room_objects: [obj('Face'), obj('bed'), obj('PERSON')] })
    expect(checked.ok).toBe(true)
    if (!checked.ok) return
    expect(checked.report.excluded_people).toBe(2)
    expect(checked.graph.room_objects.map((item) => item.name)).toEqual(['bed'])
    expect(checked.warnings[0].code).toBe('people_excluded')
    const peopleOnly = validateGraph({ room_objects: [obj('face'), obj('body')] })
    expect(peopleOnly.ok).toBe(false)
  })

  it('warns on insufficient detail and keeps relationships flagged', () => {
    const thin = validateGraph(graph(2))
    expect(thin.ok).toBe(true)
    if (!thin.ok) return
    expect(thin.report.sufficient_for_comparison).toBe(false)
    expect(thin.warnings.map((item) => item.code)).toContain('insufficient_detail')
    const rels = validateGraph({ room_objects: [obj('bed', { occludes: ['rug'] })] })
    expect(rels.ok).toBe(true)
    if (!rels.ok) return
    expect(rels.report.has_relationships).toBe(true)
    expect(validateGraph({ room_objects: [obj('bed', { occludes: 'rug' })] }).ok).toBe(false)
  })

  it('rejects out-of-range graphs at import time', () => {
    const read = readGraph({ room_objects: [obj('bed', { x: 5000 })] })
    expect(read.ok).toBe(false)
  })
})

describe('segmentation helpers', () => {
  it('describes the manual fallback path', () => {
    expect(AUTO_SEGMENTATION_NOTE).toMatch(/draw the mask yourself/)
  })

  it('checks mask plausibility conservatively', () => {
    expect(checkMask(null).ok).toBe(false)
    expect(checkMask({ x: 0.34, y: 0.1, w: 0.32, h: 0.72 }).ok).toBe(true)
    expect(checkMask({ x: 0.4, y: 0.4, w: 0.01, h: 0.01 }).ok).toBe(false)
    expect(checkMask({ x: 0, y: 0, w: 1, h: 0.95 }).ok).toBe(false)
  })

  it('merges suggested rectangles into one mask fraction', () => {
    expect(mergeRectsToMask([])).toBeNull()
    expect(mergeRectsToMask([{ x: 100, y: 100, width: 200, height: 400 }])).toEqual({
      x: 0.1,
      y: 0.1,
      w: 0.2,
      h: 0.4,
    })
    expect(
      mergeRectsToMask([
        { x: 100, y: 100, width: 200, height: 200 },
        { x: 500, y: 400, width: 200, height: 200 },
      ]),
    ).toEqual({ x: 0.1, y: 0.1, w: 0.6, h: 0.5 })
    expect(mergeRectsToMask([{ x: 900, y: 900, width: 500, height: 500 }])).toEqual({
      x: 0.9,
      y: 0.9,
      w: 0.1,
      h: 0.1,
    })
  })
})

function flatBuffer(width: number, height: number, value = 128): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = value
    data[i * 4 + 1] = value
    data[i * 4 + 2] = value
    data[i * 4 + 3] = 255
  }
  return data
}

function verticalEdge(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const value = x < width / 2 ? 0 : 255
      const i = (y * width + x) * 4
      data[i] = value
      data[i + 1] = value
      data[i + 2] = value
      data[i + 3] = 255
    }
  }
  return data
}

describe('proposal detector', () => {
  it('finds no detail in a flat image', () => {
    const gray = rgbaToGrayscale(flatBuffer(32, 32), 32, 32)
    const scores = sobelScores(gray, 32, 32)
    expect(Math.max(...scores)).toBe(0)
    const report = proposeRegions(scores, 32, 32, null, { grid: 4, maxProposals: 6 })
    expect(report.proposals).toEqual([])
    expect(report.coverage_percent).toBe(0)
  })

  it('proposes the detailed columns of a split image', () => {
    const gray = rgbaToGrayscale(verticalEdge(64, 64), 64, 64)
    const scores = sobelScores(gray, 64, 64)
    const report = proposeRegions(scores, 64, 64, null, { grid: 8, maxProposals: 6 })
    // The edge falls in columns 3–4 across all 8 rows: 16 detailed cells.
    expect(report.cells_with_detail).toBe(16)
    expect(report.coverage_percent).toBe(25)
    expect(report.proposals).toHaveLength(6)
    expect(report.proposals.every((item) => item.score > 0)).toBe(true)
    const again = proposeRegions(scores, 64, 64, null, { grid: 8, maxProposals: 6 })
    expect(again).toEqual(report)
  })

  it('excludes masked cells from proposals', () => {
    const gray = rgbaToGrayscale(verticalEdge(64, 64), 64, 64)
    const scores = sobelScores(gray, 64, 64)
    const report = proposeRegions(scores, 64, 64, { x: 0, y: 0, w: 0.5, h: 1 }, { grid: 8, maxProposals: 6 })
    // Columns 0–3 are masked; column 4 keeps its edge detail.
    expect(report.cells_masked).toBe(32)
    expect(report.proposals).toHaveLength(6)
  })
})

describe('analysis pipeline', () => {
  const mask = { x: 0.34, y: 0.1, w: 0.32, h: 0.72 }

  it('refuses to analyze before the mask is confirmed', () => {
    const flat = flatBuffer(64, 64)
    const result = analyzeBuffer(flat, 64, 64, mask, false)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('mask_unconfirmed')
  })

  it('rejects oversized and undecodable input', () => {
    const flat = flatBuffer(32, 32)
    const tooBig = analyzeBuffer(flat, 2000, 2000, mask, true)
    expect(tooBig.ok).toBe(false)
    if (tooBig.ok) return
    expect(tooBig.error.code).toBe('too_large')
    const tiny = analyzeBuffer(new Uint8ClampedArray(16), 8, 8, mask, true)
    expect(tiny.ok).toBe(false)
    if (tiny.ok) return
    expect(tiny.error.code).toBe('decode_failed')
  })

  it('fails loudly on images without background detail', () => {
    const result = analyzeBuffer(flatBuffer(64, 64), 64, 64, mask, true)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('no_detail')
  })

  it('proposes regions for a detailed image', () => {
    const result = analyzeBuffer(verticalEdge(64, 64), 64, 64, mask, true)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.proposals.length).toBeGreaterThan(0)
    expect(typeof result.coverage_percent).toBe('number')
  })

  it('checks image files before decoding', () => {
    expect(checkImageFile({ size: 100, type: 'image/jpeg', name: 'room.jpg' })).toBeNull()
    expect(checkImageFile({ size: 100, type: '', name: 'room.png' })).toBeNull()
    expect(checkImageFile({ size: 21 * 1024 * 1024, type: 'image/png', name: 'big.png' })?.code).toBe('too_large')
    expect(checkImageFile({ size: 100, type: 'application/pdf', name: 'doc.pdf' })?.code).toBe('unsupported_format')
  })
})
