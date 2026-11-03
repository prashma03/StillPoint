import { describe, expect, it } from 'vitest'
import fixtures from '../../../eval/parity_fixtures.json'
import { compareGraphs } from './align'

describe('cross-language parity', () => {
  for (const parityCase of fixtures.cases) {
    it(`matches the pinned contract for ${parityCase.id}`, () => {
      const result = compareGraphs(
        parityCase.source as Parameters<typeof compareGraphs>[0],
        parityCase.suspect as Parameters<typeof compareGraphs>[1],
      )
      const expected = parityCase.expected
      expect(result.usable_points).toBe(expected.usable_points)
      expect(result.aligned_points).toBe(expected.aligned_points)
      expect(result.agreement_percent).toBe(expected.agreement_percent)
      expect(result.verdict).toBe(expected.verdict)
      expect(result.mean_residual).toBe(expected.mean_residual)
      expect(result.median_shift).toEqual(expected.median_shift)
      expect(result.shift_spread).toBe(expected.shift_spread)
      expect(result.uniform_shift).toBe(expected.uniform_shift)
      expect(
        result.residuals.map((item) => [item.name, item.distance, item.dx, item.dy, item.aligned]),
      ).toEqual(expected.residuals.map((item) => [item.name, item.distance, item.dx, item.dy, item.aligned]))
    })
  }
})
