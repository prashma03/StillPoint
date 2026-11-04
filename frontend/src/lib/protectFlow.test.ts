import { describe, expect, it } from 'vitest'
import { acceptVisualSuggestion, canAdvanceProtectStep, imageClickToCoordinates, placeManualAnnotation, PROTECT_CATEGORIES, suggestionFromAiPoint, suggestionFromRegion, validatePhotoSelection } from './protectFlow'
import type { RoomObject } from './types'

describe('guided Protect annotations', () => {
  it('selects each supported category and places a labeled marker', () => {
    for (const category of PROTECT_CATEGORIES) {
      const point = placeManualAnnotation(category, 250, 730, [])
      expect(point).toMatchObject({ x: 250, y: 730, width: 0, height: 0, pointOrigin: 'manual', confirmed: true })
      expect(point?.name).toBe(category === 'other' ? 'other background feature' : category)
    }
  })

  it('allows multiple same-category features with unique visible labels', () => {
    const first = placeManualAnnotation('window', 200, 300, [])!
    const second = placeManualAnnotation('window', 700, 300, [first])!
    expect(first.name).toBe('window')
    expect(second.name).toBe('window 2')
  })

  it('maps pointer coordinates to normalized image coordinates across display sizes', () => {
    expect(imageClickToCoordinates(250, 175, { left: 50, top: 25, width: 400, height: 300 })).toEqual({ x: 500, y: 500 })
    expect(imageClickToCoordinates(350, 250, { left: 0, top: 0, width: 800, height: 600 })).toEqual({ x: 438, y: 417 })
    expect(imageClickToCoordinates(350, 250, { left: 0, top: 0, width: 400, height: 300 })).toEqual({ x: 875, y: 833 })
  })

  it('keeps local regions unidentified until the user labels and accepts them', () => {
    const suggestion = suggestionFromRegion({ x: 200, y: 400, width: 120, height: 80 }, 0)
    expect(suggestion.label).toBe('Unidentified object')
    const accepted = acceptVisualSuggestion(suggestion, [], 'window')
    expect(accepted).toMatchObject({ name: 'window', x: 200, y: 400, width: 120, height: 80, pointOrigin: 'local', confirmed: true })
    expect(acceptVisualSuggestion({ ...suggestion, accepted: true }, [], 'other')).toBeNull()
  })

  it('labels AI suggestions only when a recognized category came back from the model', () => {
    expect(suggestionFromAiPoint({ name: 'window', x: 20, y: 30, width: 50, height: 60 }, 0).label).toBe('Window')
    expect(suggestionFromAiPoint({ name: 'window 2', x: 20, y: 30, width: 50, height: 60 }, 1).label).toBe('Window')
    expect(suggestionFromAiPoint({ name: 'decorative rectangular thing', x: 20, y: 30, width: 50, height: 60 }, 2).label).toBe('Unidentified object')
  })

  it('supports user correction or dismiss by category selection and omission from accepted output', () => {
    const suggestion = suggestionFromRegion({ x: 400, y: 200, width: 90, height: 120 }, 1)
    const corrected = acceptVisualSuggestion(suggestion, [], 'chair')
    expect(corrected?.name).toBe('chair')
    const dismissed: RoomObject[] = []
    expect(dismissed).toEqual([])
  })

  it('blocks navigation until each step’s required action is complete', () => {
    expect(canAdvanceProtectStep(1, false, false, false)).toBe(false)
    expect(canAdvanceProtectStep(1, true, false, false)).toBe(true)
    expect(canAdvanceProtectStep(2, true, false, false)).toBe(false)
    expect(canAdvanceProtectStep(2, true, true, false)).toBe(true)
    expect(canAdvanceProtectStep(2, true, false, true)).toBe(true)
  })

  it('validates supported formats and oversized files with clear recovery text', () => {
    expect(validatePhotoSelection({ name: 'room.jpg', type: 'image/jpeg', size: 1024 })).toBeNull()
    expect(validatePhotoSelection({ name: 'room.png', type: 'image/png', size: 1024 })).toBeNull()
    expect(validatePhotoSelection({ name: 'room.webp', type: 'image/webp', size: 1024 })).toBeNull()
    expect(validatePhotoSelection({ name: 'room.gif', type: 'image/gif', size: 1024 })).toMatch(/Unsupported format/)
    expect(validatePhotoSelection({ name: 'room.jpg', type: 'image/jpeg', size: 21 * 1024 * 1024 })).toMatch(/20 MB/)
    expect(validatePhotoSelection({ name: 'map.json', type: 'application/json', size: 1024 })).toBeNull()
  })
})
