import { describe, expect, it } from 'vitest'
import { personMaskFromConfidence } from './personMaskPixels'
import { maskBounds } from './localSegmentation'
describe('local person foreground pixels', () => {
  it('thresholds the real model confidence contract without treating scores as verification', () => {
    const mask = personMaskFromConfidence(2, 2, new Float32Array([0, .8, .5, .1]))
    expect([...mask.data]).toEqual([0, 1, 1, 0])
    expect(maskBounds(mask)).toEqual([{ x: 0, y: 0, width: 1000, height: 1000 }])
  })
  it('rejects invalid model output rather than silently producing private holes', () => {
    expect(() => personMaskFromConfidence(1, 1, new Float32Array([NaN]))).toThrow()
    expect(() => personMaskFromConfidence(2, 2, new Float32Array([0]))).toThrow()
  })
})
