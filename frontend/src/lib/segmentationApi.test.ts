import { afterEach, describe, expect, it, vi } from 'vitest'
import { segmentPhoto } from './ai'
import { settingsStore } from './storage'
import { beforeEach } from 'vitest'
beforeEach(() => settingsStore().save({ blindMode: true, pythonEngine: false, externalImagesEnabled: true }))
afterEach(() => vi.unstubAllGlobals())
describe('segmentation API compatibility', () => {
  it('identifies an old rectangle-only backend rather than blaming the image', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rects: [], count: 0 }) }))
    const result = await segmentPhoto('data:image/png;base64,fixture', true)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('Restart the backend')
  })
  it('accepts actual binary mask output', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rects: [], count: 1, masks: [{ width: 2, height: 2, left: 0, top: 0, boxWidth: 2, boxHeight: 2, data: [0, 1, 1, 0] }] }) }))
    const result = await segmentPhoto('data:image/png;base64,fixture', true)
    expect(result.ok && result.masks[0].data).toEqual([0, 1, 1, 0])
  })
})
