// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { redactImage } from './redact'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('opaque image redaction', () => {
  it('paints each normalized rectangle into the exported image pixel canvas', async () => {
    const close = vi.fn()
    vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue({ width: 100, height: 80, close }))
    const fillRect = vi.fn(), drawImage = vi.fn()
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage, fillRect } as unknown as CanvasRenderingContext2D)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/jpeg;base64,masked')
    const result = await redactImage(new Blob(['private pixels'], { type: 'image/png' }), [
      { x: .25, y: .25, w: .5, h: .5 }, { x: 0, y: .75, w: .2, h: .25 },
    ])
    expect(drawImage).toHaveBeenCalledOnce()
    expect(fillRect.mock.calls).toEqual([[25, 20, 50, 40], [0, 60, 20, 20]])
    expect(result.dataUrl).toBe('data:image/jpeg;base64,masked')
    expect(result.width).toBe(100); expect(result.height).toBe(80)
    expect(close).toHaveBeenCalledOnce()
  })
})
