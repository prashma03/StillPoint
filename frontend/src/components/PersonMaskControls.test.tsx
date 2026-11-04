// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PersonMaskControls } from './PersonMaskControls'
import { segmentLocally } from '../lib/localSegmentation'
import { segmentPhoto } from '../lib/ai'
import { emptyPhoto } from '../lib/checkSession'
import { settingsStore } from '../lib/storage'

vi.mock('../lib/localSegmentation', () => ({ LOCAL_MASK_MODEL: 'MediaPipe fixture', segmentLocally: vi.fn() }))
vi.mock('../lib/ai', () => ({ getAIStatus: vi.fn().mockResolvedValue({ ok: true, configured: true, provider_origin: 'https://api.meta.ai' }), segmentPhoto: vi.fn() }))
vi.mock('../lib/redact', () => ({ redactImage: vi.fn().mockResolvedValue({ dataUrl: 'data:image/png;base64,fixture', width: 2, height: 2 }) }))
const mask = { width: 2, height: 2, data: new Uint8Array([0, 1, 1, 0]) }
const onMask = vi.fn()
function show() {
  render(<PersonMaskControls photo={{ ...emptyPhoto(), file: new File(['fixture'], 'harmless.png', { type: 'image/png' }) }} mode="automatic" onMode={() => {}} onMask={onMask} onManual={() => {}} onAutomatic={() => {}} canManual />)
}
beforeEach(() => { settingsStore().save({ blindMode: true, pythonEngine: false, externalImagesEnabled: false }); vi.mocked(segmentLocally).mockResolvedValue(mask) })
afterEach(() => { cleanup(); vi.clearAllMocks() })
describe('privacy-first automatic masking', () => {
  it('uses local inference without external consent and never falls back to SAM', async () => {
    show(); fireEvent.click(screen.getByRole('button', { name: 'Run Automatic Mask' }))
    await waitFor(() => expect(onMask).toHaveBeenCalledWith(mask, 'MediaPipe fixture'))
    expect(segmentPhoto).not.toHaveBeenCalled()
    expect(segmentLocally).toHaveBeenCalledOnce()
  })
  it('leaves manual masking available when local inference fails', async () => {
    vi.mocked(segmentLocally).mockRejectedValue(new Error('Local model unavailable. Use manual masking.'))
    show(); fireEvent.click(screen.getByRole('button', { name: 'Run Automatic Mask' }))
    await screen.findByText(/Local model unavailable/)
    expect((screen.getByRole('button', { name: /Manual Mask/ }) as HTMLButtonElement).disabled).toBe(false)
    expect(segmentPhoto).not.toHaveBeenCalled()
  })
  it('requires separate availability, source selection, and per-action consent for external masks', async () => {
    settingsStore().save({ blindMode: true, pythonEngine: false, externalImagesEnabled: true })
    vi.mocked(segmentPhoto).mockResolvedValue({ ok: true, masks: [{ width: 2, height: 2, left: 0, top: 0, boxWidth: 2, boxHeight: 2, data: [0, 1, 1, 0] }], rects: [], count: 1, model: 'SAM fixture' })
    show(); fireEvent.change(screen.getByRole('combobox'), { target: { value: 'external' } })
    const button = screen.getByRole('button', { name: 'Run Automatic Mask' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(screen.getByRole('checkbox'))
    await waitFor(() => expect(button.disabled).toBe(false))
    fireEvent.click(button)
    await waitFor(() => expect(segmentPhoto).toHaveBeenCalledOnce())
    expect(vi.mocked(segmentPhoto).mock.calls[0][1]).toBe(true)
    await waitFor(() => expect((screen.getByRole('checkbox') as HTMLInputElement).checked).toBe(false))
    expect(segmentLocally).not.toHaveBeenCalled()
  })
  it('discards a late local result after cancellation', async () => {
    let finish!: (value: typeof mask) => void
    vi.mocked(segmentLocally).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    show(); fireEvent.click(screen.getByRole('button', { name: 'Run Automatic Mask' }))
    fireEvent.click(screen.getByRole('button', { name: 'Cancel masking' }))
    finish(mask)
    await screen.findByText('Masking cancelled. No image was sent externally.')
    expect(onMask).not.toHaveBeenCalled()
  })
})
