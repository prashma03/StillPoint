// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscoverScan } from './DiscoverScan'

vi.mock('./DiscoverScene', () => ({
  DiscoverScene: ({ layout }: { layout: { mode: string; corners: unknown[]; note: string } }) => <div id="discover-map">{layout.note} {layout.mode} {layout.corners.length}</div>,
}))
vi.mock('../lib/redact', () => ({ decodeToPixels: vi.fn(async () => {
  const width = 160, height = 120, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = y < 82 && x > 18 && x < 142 ? 190 : 28
    const index = (y * width + x) * 4
    data[index] = data[index + 1] = data[index + 2] = value
    data[index + 3] = 255
  }
  return { data, width, height }
}) }))

const created: Blob[] = []
beforeEach(() => {
  created.length = 0
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn((value: Blob) => { created.push(value); return 'blob:fixture' }) })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  HTMLElement.prototype.scrollIntoView = vi.fn()
})
afterEach(() => { cleanup(); vi.restoreAllMocks() })

describe('local Discover scan', () => {
  it('scans the uploaded photograph, keeps the results, and downloads the measured summary', async () => {
    const onContinue = vi.fn()
    const onCompare = vi.fn()
    render(<DiscoverScan onContinue={onContinue} onCompare={onCompare} />)
    fireEvent.change(screen.getByLabelText(/Choose a photograph/), { target: { files: [new File(['fixture'], 'room.png', { type: 'image/png' })] } })
    expect(await screen.findByText('Discovery Scan Complete', {}, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Your Discovery Results' })).toBeTruthy()
    expect(screen.getByText(/visual structure has been mapped successfully/)).toBeTruthy()
    expect(screen.getAllByText(/not a verified 3D reconstruction|no room was invented/).length).toBeGreaterThan(0)
    expect(screen.getByText('Not shared. This scan did not send the photograph.')).toBeTruthy()
    expect(HTMLElement.prototype.scrollIntoView).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Explore 3D Map' }))
    expect(screen.getByText('Discovery Scan Complete')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Compare Another Image' }))
    expect(onCompare).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'room.png' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download Discovery Summary' }))
    const report = created.find(blob => blob.type === 'text/plain')
    expect(report).toBeTruthy()
    expect(await report?.text()).toMatch(/Corners: \d+/)
    expect(await report?.text()).toMatch(/High-contrast regions: \d+/)
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Proof' }))
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'room.png', cornerCount: expect.any(Number) })))
  })
})
