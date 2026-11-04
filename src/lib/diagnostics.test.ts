import { describe, expect, it } from 'vitest'
import { compareGraphs } from './align'
import { sampleDerivative, sampleMoved, sampleOriginal } from './samples'

describe('shift diagnostics', () => {
  it('reports small uniform shifts for the edited derivative', () => {
    const result = compareGraphs(sampleOriginal, sampleDerivative)
    expect(result.median_shift).toEqual([1, 0])
    expect(result.shift_spread).toBe(3.16)
    expect(result.uniform_shift).toBe(true)
    expect(result.residuals.map((item) => [item.dx, item.dy])).toEqual([
      [4, 1],
      [1, -1],
      [-1, 2],
      [1, -1],
    ])
  })

  it('reports scattered shifts for the moved camera', () => {
    const result = compareGraphs(sampleOriginal, sampleMoved)
    expect(result.median_shift).toEqual([7.5, -17.5])
    expect(result.shift_spread).toBe(92.53)
    expect(result.uniform_shift).toBe(false)
  })

  it('reports no shift when nothing overlaps', () => {
    const source = { room_objects: [{ name: 'bed', x: 0, y: 0, width: 10, height: 10 }] }
    const suspect = { room_objects: [{ name: 'lamp', x: 0, y: 0, width: 10, height: 10 }] }
    const result = compareGraphs(source, suspect)
    expect(result.median_shift).toBeNull()
    expect(result.shift_spread).toBeNull()
    expect(result.uniform_shift).toBe(false)
  })

  it('reports zero spread for a single correspondence', () => {
    const graph = { room_objects: [{ name: 'bed', x: 100, y: 100, width: 50, height: 50 }] }
    const moved = { room_objects: [{ name: 'bed', x: 130, y: 140, width: 50, height: 50 }] }
    const result = compareGraphs(graph, moved)
    expect(result.median_shift).toEqual([30, 40])
    expect(result.shift_spread).toBe(0)
    expect(result.uniform_shift).toBe(false)
  })

  it('never lets a uniform shift override the verdict', () => {
    const names = ['bed', 'poster', 'door', 'rug']
    const source = {
      room_objects: names.map((name, index) => ({ name, x: 100 + index * 100, y: 200, width: 60, height: 60 })),
    }
    const suspect = {
      room_objects: names.map((name, index) => ({ name, x: 180 + index * 100, y: 200, width: 60, height: 60 })),
    }
    const result = compareGraphs(source, suspect)
    expect(result.verdict).toBe('No link found')
    expect(result.median_shift).toEqual([80, 0])
    expect(result.shift_spread).toBe(0)
    expect(result.uniform_shift).toBe(true)
  })
})
