import { describe, expect, it } from 'vitest'
import { compareGraphs } from './align'
import { readGraph, shiftGraph, zoomAndCrop } from './graphs'
import { present } from './present'
import { scenePose } from './pose'
import { hashComparison, reportText } from './report'
import { buildSample } from './sampleCase'
import { sampleDerivative, sampleMoved, sampleOriginal } from './samples'
import { assertNoImagePayload, createMemoryStore, createSceneStore } from './storage'
import { runProtectionTests } from './tests'
import type { StoredScene } from './types'

describe('alignment parity with backend/align.py', () => {
  it('matches the edited-derivative sample', () => {
    const result = compareGraphs(sampleOriginal, sampleDerivative)
    expect(result.verdict).toBe('Likely derivative')
    expect(result.usable_points).toBe(4)
    expect(result.aligned_points).toBe(4)
    expect(result.agreement_percent).toBe(100)
    expect(result.mean_residual).toBe(2.3)
    expect(result.residuals.map((item) => item.distance)).toEqual([4.12, 1.41, 2.24, 1.41])
    expect(result.source_coverage_percent).toBeNull()
  })

  it('matches the moved-camera sample', () => {
    const result = compareGraphs(sampleOriginal, sampleMoved)
    expect(result.verdict).toBe('No link found')
    expect(result.aligned_points).toBe(1)
    expect(result.agreement_percent).toBe(25)
    expect(result.mean_residual).toBe(55.58)
    expect(result.residuals[0]).toMatchObject({ name: 'bed', aligned: true })
    expect(result.residuals[1].aligned).toBe(false)
  })

  it('keeps a small shift and rejects a large one', () => {
    expect(compareGraphs(sampleOriginal, shiftGraph(sampleOriginal, 5, 0)).verdict).toBe('Likely derivative')
    expect(compareGraphs(sampleOriginal, shiftGraph(sampleOriginal, 80, 0)).verdict).toBe('No link found')
  })

  it('drops person-named objects', () => {
    const source = {
      room_objects: [
        { name: 'face', x: 0, y: 0, width: 20, height: 20 },
        { name: 'bed', x: 10, y: 10, width: 40, height: 40 },
      ],
    }
    const suspect = {
      room_objects: [
        { name: 'bed', x: 10, y: 10, width: 40, height: 40 },
        { name: 'body', x: 1, y: 1, width: 8, height: 30 },
      ],
    }
    const result = compareGraphs(source, suspect)
    expect(result.excluded_person_objects).toBe(2)
    expect(result.residuals.map((item) => item.name)).toEqual(['bed'])
    expect(result.verdict).not.toBe('Likely derivative')
  })
})

describe('comparison safety', () => {
  it('returns Cannot determine when nothing overlaps', () => {
    const source = {
      room_objects: [
        { name: 'bed', x: 100, y: 450, width: 380, height: 300 },
        { name: 'poster', x: 180, y: 150, width: 200, height: 150 },
      ],
    }
    const suspect = {
      room_objects: [
        { name: 'curtain', x: 40, y: 40, width: 220, height: 320 },
        { name: 'lamp', x: 640, y: 180, width: 90, height: 180 },
      ],
    }
    const result = compareGraphs(source, suspect)
    expect(result.usable_points).toBe(0)
    expect(result.aligned_points).toBe(0)
    expect(result.agreement_percent).toBe(0)
    expect(result.mean_residual).toBeNull()
    expect(result.residuals).toEqual([])
    expect(result.verdict).toBe('Cannot determine')
  })

  it('requires enough correspondences for any decisive verdict', () => {
    const aligned = {
      room_objects: [
        { name: 'bed', x: 100, y: 450, width: 380, height: 300 },
        { name: 'poster', x: 180, y: 150, width: 200, height: 150 },
        { name: 'door', x: 750, y: 200, width: 180, height: 450 },
      ],
    }
    const threeAligned = compareGraphs(aligned, aligned)
    expect(threeAligned.usable_points).toBe(3)
    expect(threeAligned.agreement_percent).toBe(100)
    expect(threeAligned.verdict).toBe('Cannot determine')

    const moved = {
      room_objects: [
        { name: 'bed', x: 500, y: 100, width: 380, height: 300 },
        { name: 'poster', x: 600, y: 600, width: 200, height: 150 },
        { name: 'door', x: 100, y: 100, width: 180, height: 450 },
      ],
    }
    const threeMissed = compareGraphs(aligned, moved)
    expect(threeMissed.aligned_points).toBe(0)
    expect(threeMissed.verdict).toBe('Cannot determine')
  })

  it('links identical graphs only with enough evidence', () => {
    const identical = compareGraphs(sampleOriginal, sampleOriginal)
    expect(identical.usable_points).toBe(4)
    expect(identical.aligned_points).toBe(4)
    expect(identical.agreement_percent).toBe(100)
    expect(identical.mean_residual).toBe(0)
    expect(identical.verdict).toBe('Likely derivative')

    const small = { room_objects: [{ name: 'bed', x: 100, y: 450, width: 380, height: 300 }] }
    expect(compareGraphs(small, small).verdict).toBe('Cannot determine')
  })

  it('rejects fully mismatched graphs with enough evidence', () => {
    const moved = {
      room_objects: [
        { name: 'bed', x: 500, y: 100, width: 380, height: 300 },
        { name: 'poster', x: 600, y: 600, width: 200, height: 150 },
        { name: 'door', x: 100, y: 100, width: 180, height: 450 },
        { name: 'rug', x: 600, y: 100, width: 400, height: 150 },
      ],
    }
    const result = compareGraphs(sampleOriginal, moved)
    expect(result.usable_points).toBe(4)
    expect(result.aligned_points).toBe(0)
    expect(result.agreement_percent).toBe(0)
    expect(result.verdict).toBe('No link found')
  })

  it('passes coverage through without inventing it', () => {
    expect(compareGraphs(sampleOriginal, sampleDerivative).suspect_coverage_percent).toBeNull()
    const withCoverage = { ...sampleOriginal, coverage_percent: 42 }
    const result = compareGraphs(withCoverage, sampleDerivative)
    expect(result.source_coverage_percent).toBe(42)
    expect(result.suspect_coverage_percent).toBeNull()
  })

  it('excludes person names case-insensitively but keeps near-misses', () => {
    const source = {
      room_objects: [
        { name: '  Face ', x: 0, y: 0, width: 40, height: 40 },
        { name: 'PERSON', x: 10, y: 10, width: 40, height: 40 },
        { name: 'bed', x: 100, y: 450, width: 380, height: 300 },
      ],
    }
    const suspect = {
      room_objects: [
        { name: 'bed', x: 100, y: 450, width: 380, height: 300 },
        { name: 'Body', x: 10, y: 10, width: 20, height: 80 },
      ],
    }
    const result = compareGraphs(source, suspect)
    expect(result.excluded_person_objects).toBe(3)
    expect(result.residuals.map((item) => item.name)).toEqual(['bed'])

    const wardrobe = {
      room_objects: [
        { name: 'wardrobe', x: 100, y: 100, width: 100, height: 200 },
        { name: 'headboard', x: 300, y: 100, width: 100, height: 200 },
      ],
    }
    const nearMiss = compareGraphs(wardrobe, wardrobe)
    expect(nearMiss.excluded_person_objects).toBe(0)
    expect(nearMiss.usable_points).toBe(2)

    const people = { room_objects: [{ name: 'face', x: 0, y: 0, width: 40, height: 40 }] }
    const peopleOnly = compareGraphs(people, people)
    expect(peopleOnly.usable_points).toBe(0)
    expect(peopleOnly.verdict).toBe('Cannot determine')
  })

  it('normalizes names and keeps the first duplicate', () => {
    const source = {
      room_objects: [
        { name: 'Bed', x: 100, y: 450, width: 380, height: 300 },
        { name: '  POSTER  ', x: 180, y: 150, width: 200, height: 150 },
      ],
    }
    const suspect = {
      room_objects: [
        { name: 'bed', x: 102, y: 451, width: 380, height: 300 },
        { name: 'poster', x: 181, y: 149, width: 200, height: 150 },
      ],
    }
    const normalized = compareGraphs(source, suspect)
    expect(normalized.usable_points).toBe(2)
    expect(normalized.residuals.map((item) => item.name)).toEqual(['bed', 'poster'])

    const duplicated = {
      room_objects: [
        { name: 'bed', x: 100, y: 450, width: 380, height: 300 },
        { name: 'Bed', x: 900, y: 900, width: 50, height: 50 },
      ],
    }
    const single = { room_objects: [{ name: 'bed', x: 102, y: 451, width: 380, height: 300 }] }
    const duplicateResult = compareGraphs(duplicated, single)
    expect(duplicateResult.usable_points).toBe(1)
    expect(duplicateResult.duplicate_objects).toBe(1)
    expect(duplicateResult.aligned_points).toBe(1)
  })

  it('skips invalid coordinates instead of crashing', () => {
    const source = {
      room_objects: [
        { name: 'bed', x: 100, y: 450, width: 380, height: 300 },
        { name: 'poster', x: -5, y: 150, width: 200, height: 150 },
        { name: 'door', x: 750, y: 200, width: 180, height: 4500 },
        { name: 'rug', x: 150, y: 700, width: 400 },
        { name: 'desk', x: 'far', y: 100, width: 100, height: 100 },
        { name: '', x: 10, y: 10, width: 10, height: 10 },
        'not-an-object',
        { name: 'shelf', x: Number.NaN, y: 10, width: 10, height: 10 },
        { name: 'chair', x: Number.POSITIVE_INFINITY, y: 10, width: 10, height: 10 },
      ],
    } as unknown as Parameters<typeof compareGraphs>[0]
    const suspect = {
      room_objects: [{ name: 'bed', x: 100, y: 450, width: 380, height: 300 }],
    }
    const result = compareGraphs(source, suspect)
    expect(result.usable_points).toBe(1)
    expect(result.invalid_objects).toBe(8)
    expect(result.verdict).toBe('Cannot determine')
  })

  it('accepts edge coordinates and rejects out-of-range ones', () => {
    const edge = {
      room_objects: [
        { name: 'a', x: 0, y: 0, width: 0, height: 0 },
        { name: 'b', x: 1000, y: 1000, width: 0, height: 0 },
      ],
    }
    const edgeResult = compareGraphs(edge, edge)
    expect(edgeResult.usable_points).toBe(2)
    expect(edgeResult.invalid_objects).toBe(0)

    const outside = {
      room_objects: [
        { name: 'a', x: -1, y: 0, width: 10, height: 10 },
        { name: 'b', x: 0, y: 1001, width: 10, height: 10 },
      ],
    }
    const outsideResult = compareGraphs(outside, outside)
    expect(outsideResult.usable_points).toBe(0)
    expect(outsideResult.invalid_objects).toBe(4)
    expect(outsideResult.verdict).toBe('Cannot determine')
  })

  it('handles malformed graphs without crashing', () => {
    const empty = {} as unknown as Parameters<typeof compareGraphs>[0]
    expect(compareGraphs(empty, empty).verdict).toBe('Cannot determine')
    const nullList = { room_objects: null } as unknown as Parameters<typeof compareGraphs>[0]
    expect(compareGraphs(nullList, sampleOriginal).usable_points).toBe(0)
  })

  it('reports zero rejects for the clean samples', () => {
    const result = compareGraphs(sampleOriginal, sampleDerivative)
    expect(result.invalid_objects).toBe(0)
    expect(result.duplicate_objects).toBe(0)
  })
})

describe('wording', () => {
  it('uses the product sentences for each real branch', () => {
    expect(present(compareGraphs(sampleOriginal, sampleDerivative)).summary).toBe(
      'The visible backgrounds strongly align from the same viewpoint.',
    )
    expect(present(compareGraphs(sampleOriginal, sampleMoved)).summary).toBe(
      'No reliable visual connection was established.',
    )
    const thin = compareGraphs(
      { room_objects: [{ name: 'bed', x: 0, y: 0, width: 10, height: 10 }] },
      { room_objects: [{ name: 'bed', x: 0, y: 0, width: 10, height: 10 }] },
    )
    expect(thin.verdict).toBe('Cannot determine')
    expect(present(thin).summary).toBe('Not enough background is visible.')
    const partial = {
      room_objects: sampleOriginal.room_objects.map((obj, index) =>
        index < 2 ? obj : { ...obj, x: obj.x + 80 },
      ),
    }
    const shifted = compareGraphs(sampleOriginal, partial)
    expect(shifted.aligned_points).toBe(2)
    expect(shifted.verdict).toBe('Cannot determine')
    expect(present(shifted).summary).toBe(
      'The viewpoints do not align closely enough to establish a reliable connection.',
    )
  })
})

describe('report privacy', () => {
  it('states limits and contains no image payload or invented scores', () => {
    const text = reportText(buildSample('derivative'))
    expect(text).toContain('What this proof does not establish')
    expect(text).toContain('Who created the image')
    expect(text).toContain('A background match alone cannot trigger automatic punishment or removal.')
    expect(text).not.toMatch(/data:image|PDQ|confidence/i)
    expect(text).toContain('Likely derivative')
    expect(text).toContain('100.0%')
  })

  it('does not invent a hash comparison', () => {
    expect(hashComparison(null, 'abc')).toBe('Not available')
    expect(hashComparison('abc', 'abc')).toBe('File bytes are identical.')
    expect(hashComparison('abc', 'def')).toMatch(/not a visual similarity/)
  })
})

describe('graphs and storage', () => {
  it('rejects a person object while reading a graph', () => {
    const read = readGraph({
      room_objects: [
        { name: 'face', x: 1, y: 1, width: 1, height: 1 },
        { name: 'door', x: 2, y: 2, width: 3, height: 4 },
      ],
      coverage_percent: 18,
    })
    expect(read.ok).toBe(true)
    if (!read.ok) return
    expect(read.excludedPeople).toBe(1)
    expect(read.graph.room_objects).toHaveLength(1)
    expect(read.graph.coverage_percent).toBe(18)
  })

  it('refuses to store image data and strips it on read', () => {
    expect(() => assertNoImagePayload({ src: 'data:image/png;base64,aaaa' })).toThrow(/image data/)
    const store = createSceneStore(createMemoryStore())
    const scene: StoredScene = {
      id: 'a',
      label: 'Window wall',
      createdAt: '2026-10-30T00:00:00.000Z',
      fileHash: null,
      mask: { x: 0.2, y: 0.1, w: 0.3, h: 0.5 },
      maskConfirmed: true,
      personExcludedConfirmed: true,
      graph: sampleOriginal,
    }
    store.save(scene)
    expect(store.get('a')?.label).toBe('Window wall')
    store.clear()
    expect(store.list()).toHaveLength(0)
  })

  it('changes the sample graph under zoom', () => {
    const result = compareGraphs(sampleOriginal, zoomAndCrop(sampleOriginal))
    expect(result.agreement_percent).toBeLessThan(80)
  })
})

describe('protection tests', () => {
  it('runs geometry tests and leaves unimplemented image attacks empty', () => {
    const tests = runProtectionTests(sampleOriginal)
    const byId = Object.fromEntries(tests.map((item) => [item.id, item]))
    expect(byId.zoom.ran).toBe(true)
    expect(byId.zoom.result).not.toBeNull()
    expect(byId.screenshot.ran).toBe(false)
    expect(byId.screenshot.result).toBeNull()
    expect(byId.color.result).toBeNull()
    expect(byId.repaint.result).toBeNull()
    expect(byId.background.result?.verdict).toBe('Cannot determine')
  })
})

describe('room pose', () => {
  it('opens the second room only later in the story', () => {
    expect(scenePose({ story: 0, slider: 0, alignU: -1, hold: false }).ghost).toBe(0)
    expect(scenePose({ story: 0.7, slider: 1, alignU: -1, hold: false }).ghost).toBeGreaterThan(0.8)
    expect(scenePose({ story: 0.7, slider: 0, alignU: -1, hold: false }).converge).toBeGreaterThan(0.9)
    const held = scenePose({ story: 0, slider: 1, alignU: -1, hold: true })
    expect(held.green).toBe(1)
    expect(held.converge).toBe(1)
  })
})
