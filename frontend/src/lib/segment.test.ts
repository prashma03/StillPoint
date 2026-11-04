import { describe, expect, it, vi } from 'vitest'
import { segmentPhoto } from './ai'
import { settingsStore } from './storage'
import { beforeEach } from 'vitest'
beforeEach(() => settingsStore().save({ blindMode: true, pythonEngine: false, externalImagesEnabled: true }))
import { combineSegmentMasks } from './segment'

describe('person segmentation masks', () => {
  it('combines multiple person rasters into opaque image-aligned pixels', () => {
    const mask = combineSegmentMasks(20, 10, [
      { width: 2, height: 2, left: 2, top: 2, boxWidth: 4, boxHeight: 4, data: [1, 0, 0, 1] },
      { width: 1, height: 2, left: 14, top: 2, boxWidth: 2, boxHeight: 4, data: [1, 1] },
    ])
    expect(mask.width).toBe(20)
    expect(mask.height).toBe(10)
    expect(mask.data.reduce((sum, value) => sum + value, 0)).toBeGreaterThan(4)
    expect(mask.data[3 * mask.width + 3]).toBe(1)
    expect(mask.data[3 * mask.width + 15]).toBe(1)
  })

  it('treats an empty model result as no detected person', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ masks: [], rects: [], count: 0, model: 'sam-3.1' }), { status: 200 })))
    const result = await segmentPhoto('data:image/jpeg;base64,AA==', true)
    expect(result).toEqual({ ok: true, masks: [], rects: [], count: 0, model: 'sam-3.1' })
    vi.unstubAllGlobals()
  })

  it('returns a recoverable error for failed segmentation requests', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: 'invalid_model_output' }), { status: 502 })))
    const result = await segmentPhoto('data:image/jpeg;base64,AA==', true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/person-detection output/i)
    vi.unstubAllGlobals()
  })
})
