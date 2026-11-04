import { describe, expect, it } from 'vitest'
import { classifyComposition, type PhotoComposition } from './composition'
import { measureFeatureAvailability } from './photoCompare'

const environment: PhotoComposition = { faces: 0, largestFaceArea: 0, corners: 45, occupiedCells: 12 }
const headshot: PhotoComposition = { faces: 1, largestFaceArea: .42, corners: 5, occupiedCells: 2 }
describe('composition routing from measured signals', () => {
  it('recommends background for distributed environmental detail', () => expect(classifyComposition(environment, environment).recommended).toBe('background'))
  it('recommends opt-in facial geometry only for two close-up single-face images', () => {
    expect(classifyComposition(headshot, headshot)).toMatchObject({ kind: 'headshots', recommended: 'facial' })
    expect(classifyComposition(headshot, { ...headshot, faces: 2 }).recommended).toBe('inconclusive')
  })
  it('keeps mixed photos background-first', () => expect(classifyComposition({ ...environment, faces: 1, largestFaceArea: .1 }, environment)).toMatchObject({ kind: 'mixed', recommended: 'background' }))
  it('does not upgrade one usable image or a blank pair into evidence', () => {
    const blank = { ...environment, corners: 0, occupiedCells: 0 }
    expect(classifyComposition(blank, environment).recommended).toBe('inconclusive')
    expect(classifyComposition(blank, blank).kind).toBe('insufficient')
    const pixels = { data: new Uint8ClampedArray(128 * 128 * 4), width: 128, height: 128 }
    expect(measureFeatureAvailability(pixels, [])).toEqual({ corners: 0, occupiedCells: 0 })
  })
})
