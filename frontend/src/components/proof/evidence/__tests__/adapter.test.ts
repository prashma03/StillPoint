import { describe, expect, it } from 'vitest'
import { validateDataset } from '../types'

describe('validateDataset', () => {
  it('accepts well-formed verification data', () => {
    expect(validateDataset({ provenance: 'verification', sourceLabel: 'a', targetLabel: 'b', pairs: [{ id: '1', source: [0, 0, 0], target: [1, 1, 1], label: 'corner', confidence: 0.9 }] })).not.toBeNull()
  })

  it('rejects aggregate-only payloads instead of fabricating matches', () => {
    expect(validateDataset({ provenance: 'verification', sourceLabel: 'a', targetLabel: 'b', pairs: [], score: 0.87 })).toBeNull()
    expect(validateDataset({ provenance: 'verification', sourceLabel: 'a', targetLabel: 'b', pairs: [{ id: '1', source: [0, 0], target: [1, 1, 1], label: 'x' }] })).toBeNull()
    expect(validateDataset(null)).toBeNull()
  })

  it('rejects non-finite coordinates and out-of-range confidence', () => {
    expect(validateDataset({ provenance: 'verification', sourceLabel: 'a', targetLabel: 'b', pairs: [{ id: '1', source: [0, Infinity, 0], target: [1, 1, 1], label: 'x' }] })).toBeNull()
    expect(validateDataset({ provenance: 'verification', sourceLabel: 'a', targetLabel: 'b', pairs: [{ id: '1', source: [0, 0, 0], target: [1, 1, 1], label: 'x', confidence: 1.2 }] })).toBeNull()
  })
})
