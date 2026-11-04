import { describe, expect, it } from 'vitest'
import { compareGraphs } from './align'
import { reportText, verdictExplanation } from './report'
import { buildSample } from './sampleCase'
import { sampleDerivative, sampleMoved, sampleOriginal } from './samples'

describe('verdict explanation', () => {
  it('explains a likely derivative from the counts', () => {
    const lines = verdictExplanation(compareGraphs(sampleOriginal, sampleDerivative))
    expect(lines[0]).toMatch(/4 of 4/)
    expect(lines[0]).toMatch(/100\.0%/)
  })

  it('explains no link without claiming proof of unrelatedness', () => {
    const lines = verdictExplanation(compareGraphs(sampleOriginal, sampleMoved))
    expect(lines[0]).toMatch(/does not prove the images are unrelated/)
  })

  it('explains insufficient evidence from the threshold', () => {
    const thin = { room_objects: [{ name: 'bed', x: 0, y: 0, width: 10, height: 10 }] }
    const lines = verdictExplanation(compareGraphs(thin, thin))
    expect(lines[0]).toMatch(/at least 4/)
  })

  it('flags uniform shifts as crop-consistent without upgrading the verdict', () => {
    const names = ['bed', 'poster', 'door', 'rug']
    const source = {
      room_objects: names.map((name, index) => ({ name, x: 100 + index * 100, y: 200, width: 60, height: 60 })),
    }
    const suspect = {
      room_objects: names.map((name, index) => ({ name, x: 180 + index * 100, y: 200, width: 60, height: 60 })),
    }
    const result = compareGraphs(source, suspect)
    expect(result.verdict).toBe('No link found')
    const lines = verdictExplanation(result)
    expect(lines.some((line) => line.includes('crop or resize'))).toBe(true)
    expect(lines.some((line) => line.includes('never upgrades a verdict'))).toBe(true)
  })
})

describe('report completeness', () => {
  it('carries case identity, method, graph summaries, and correspondence shifts', () => {
    const text = reportText(buildSample('derivative'))
    expect(text).toContain('Case: sample-derivative')
    expect(text).toContain('Analyzed: ')
    expect(text).toContain('Method: Named-background center comparison')
    expect(text).toContain('Source objects (4): bed, poster, door, rug')
    expect(text).toContain('shift (+4.00, +1.00)')
    expect(text).not.toMatch(/data:image|PDQ|confidence/i)
  })
})
