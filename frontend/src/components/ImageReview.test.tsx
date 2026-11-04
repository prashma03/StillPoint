// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyPhoto, type PhotoInput } from '../lib/checkSession'
import { ImageReview } from './ImageReview'

vi.mock('../lib/ai', () => ({
  getAIStatus: vi.fn().mockResolvedValue({ ok: true, configured: true, scene_model: 'test', seg_model: 'test' }),
  segmentPhoto: vi.fn().mockResolvedValue({ ok: true, masks: [{ width: 4, height: 4, left: 0, top: 0, boxWidth: 4, boxHeight: 4, data: [0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0] }], rects: [], count: 1, model: 'test' }),
}))
vi.mock('../lib/localSegmentation', () => ({
  LOCAL_MASK_MODEL: 'test-local-segmenter',
  segmentLocally: vi.fn().mockResolvedValue({ width: 4, height: 4, data: Uint8Array.from([0,0,0,0,0,1,1,0,0,1,1,0,0,0,0,0]) }),
}))
vi.mock('../lib/redact', () => ({ redactImage: vi.fn().mockResolvedValue({ dataUrl: 'data:image/jpeg;base64,test', width: 4, height: 4 }) }))

function Harness({ visible = true }: { visible?: boolean }) {
  const [photo, setPhoto] = useState<PhotoInput>(() => ({ ...emptyPhoto(), file: new File(['photo'], 'photo.png', { type: 'image/png' }), label: 'photo.png' }))
  return <ImageReview title="Suspicious Photograph" photo={photo} visible={visible} mode="privacy" onChange={setPhoto} />
}

beforeEach(() => {
  vi.stubGlobal('PointerEvent', class extends MouseEvent { pointerId: number; constructor(type: string, init: PointerEventInit = {}) { super(type, init); this.pointerId = init.pointerId ?? 1 } })
  vi.stubGlobal('createImageBitmap', vi.fn())
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:fixture') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { configurable: true, value: vi.fn() })
  Object.defineProperty(HTMLElement.prototype, 'hasPointerCapture', { configurable: true, value: vi.fn(() => true) })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL; delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL; delete (HTMLElement.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture; delete (HTMLElement.prototype as unknown as { releasePointerCapture?: unknown }).releasePointerCapture; delete (HTMLElement.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture })

function setFrameSize() {
  const frame = document.querySelector('.check-photo') as HTMLElement
  Object.defineProperty(frame, 'getBoundingClientRect', { configurable: true, value: () => ({ left: 0, top: 0, width: 200, height: 100, right: 200, bottom: 100, x: 0, y: 0, toJSON() {} }) })
}
function manual() { fireEvent.click(screen.getByRole('button', { name: /Manual Mask/ })); setFrameSize() }

describe('manual rectangular privacy masks', () => {
  it('creates an opaque mask immediately and supports dragging within image bounds', () => {
    const { container } = render(<Harness />); manual()
    const mask = screen.getByRole('group', { name: /Mask 1/ })
    expect([mask.style.left, mask.style.top, mask.style.width].join(' ')).toBe('30% 18% 40%')
    expect(parseFloat(mask.style.height)).toBeCloseTo(55)
    expect(mask.className).toContain('is-selected')
    fireEvent.pointerDown(mask, { pointerId: 1, clientX: 100, clientY: 45 })
    fireEvent.pointerMove(mask, { pointerId: 1, clientX: 160, clientY: 80 })
    fireEvent.pointerUp(mask, { pointerId: 1, clientX: 160, clientY: 80 })
    expect([mask.style.left, mask.style.top]).toEqual(['60%', '45%'])
    fireEvent.pointerDown(mask, { pointerId: 2, clientX: 125, clientY: 70 })
    fireEvent.pointerMove(mask, { pointerId: 2, clientX: 500, clientY: 500 })
    fireEvent.pointerUp(mask, { pointerId: 2, clientX: 500, clientY: 500 })
    expect([mask.style.left, mask.style.top]).toEqual(['60%', '45%'])
    expect((container.querySelector('.check-cover') as HTMLElement).className).toContain('check-cover')
  })

  it('resizes from edge handles and preserves normalized positioning on responsive image sizes', () => {
    render(<Harness />); manual()
    const mask = screen.getByRole('group', { name: /Mask 1/ })
    fireEvent.pointerDown(within(mask).getByRole('button', { name: 'Resize mask 1 se' }), { pointerId: 3, clientX: 140, clientY: 73 })
    fireEvent.pointerMove(mask, { pointerId: 3, clientX: 160, clientY: 83 })
    fireEvent.pointerUp(mask, { pointerId: 3, clientX: 160, clientY: 83 })
    expect([mask.style.left, mask.style.top, mask.style.width].join(' ')).toBe('30% 18% 50%')
    expect(parseFloat(mask.style.height)).toBeCloseTo(65)
  })

  it('adds, removes, and resets rectangles while invalidating prior confirmation', () => {
    render(<Harness />); manual()
    fireEvent.click(screen.getByRole('button', { name: 'Add Another Rectangle' }))
    expect(screen.getAllByRole('group', { name: /Mask \d/ })).toHaveLength(2)
    fireEvent.click(screen.getByRole('button', { name: 'Remove selected' }))
    expect(screen.getAllByRole('group', { name: /Mask \d/ })).toHaveLength(1)
    const confirmation = screen.getByLabelText(/I reviewed this mask/) as HTMLInputElement
    expect(confirmation.checked).toBe(false)
    fireEvent.click(confirmation)
    expect(confirmation.checked).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Reset rectangles' }))
    expect(document.querySelectorAll('.check-cover')).toHaveLength(0)
    expect((screen.getByLabelText(/I reviewed this mask/) as HTMLInputElement).checked).toBe(false)
  })

  it('removes the focused mask with Backspace without deleting from an editable field', () => {
    render(<Harness />); manual()
    const mask = screen.getByRole('group', { name: /Mask 1/ })
    fireEvent.keyDown(mask, { key: 'Backspace' })
    expect(document.querySelectorAll('.check-cover')).toHaveLength(0)
  })

  it('keeps Blind Mode concealed until the user explicitly chooses to reveal the image', () => {
    render(<Harness visible={false} />)
    fireEvent.click(screen.getByRole('button', { name: /Manual Mask/ }))
    expect(screen.getByText(/Suspicious image concealed/)).not.toBeNull()
    expect(document.querySelector('.check-photo')).toBeNull()
    fireEvent.click(screen.getByLabelText(/choose to reveal this suspicious photograph/i))
    expect(document.querySelector('.check-photo')).not.toBeNull()
    expect(screen.getByRole('group', { name: /Mask 1/ })).not.toBeNull()
  })

  it('automatically detects people locally and enables rectangle refinement', async () => {
    render(<Harness />)
    fireEvent.click(within(screen.getByRole('group', { name: 'Masking method' })).getByRole('button', { name: /Automatic Mask/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Run Automatic Mask' }))
    expect(await screen.findByText(/Automatic mask generated on this device/)).not.toBeNull()
    expect(document.querySelector('.check-pixel-mask')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Add Another Rectangle' })).not.toBeNull()
    expect((screen.getByLabelText(/I reviewed this mask/) as HTMLInputElement).checked).toBe(false)
  })

  it('shows only the two clear mask choices and no nested feature-review continuation', () => {
    render(<Harness />)
    const choices = screen.getByRole('group', { name: 'Masking method' })
    expect(within(choices).getByRole('button', { name: /Automatic Mask/ })).not.toBeNull()
    expect(within(choices).getByRole('button', { name: /Manual Mask/ })).not.toBeNull()
    expect(screen.queryByRole('button', { name: /Continue to Feature Review/ })).toBeNull()
  })
})

function DetailHarness() {
  const [photo, setPhoto] = useState<PhotoInput>(() => ({ ...emptyPhoto(), file: new File(['photo'], 'photo.png', { type: 'image/png' }), graph: { room_objects: [{ name: 'Window', x: 400, y: 400, width: 0, height: 0 }] } }))
  return <ImageReview title="Original" photo={photo} visible mode="features" onChange={setPhoto} />
}

describe('selected details', () => {
  it('shows a floating Remove action and supports undo after removal', () => {
    render(<DetailHarness />)
    expect(screen.queryByRole('button', { name: 'Remove Window' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Select Window' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove Window' }))
    expect(screen.queryByRole('button', { name: 'Select Window' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Undo edit' }))
    expect(screen.getByRole('button', { name: 'Select Window' })).not.toBeNull()
  })
  it.each(['Backspace', 'Delete'])('removes the clicked detail with %s, preserving typing in fields', key => {
    render(<DetailHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Select Window' }))
    fireEvent.keyDown(screen.getByLabelText('Horizontal'), { key })
    expect(screen.getByRole('button', { name: 'Select Window' })).not.toBeNull()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Select Window' }), { key })
    expect(screen.queryByRole('button', { name: 'Select Window' })).toBeNull()
  })
})
