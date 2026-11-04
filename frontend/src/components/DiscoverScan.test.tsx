// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DiscoverScan } from './DiscoverScan'

vi.mock('../lib/redact', () => ({ decodeToPixels: vi.fn(async () => {
  const width = 64, height = 64, data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const value = ((Math.floor(x / 8) + Math.floor(y / 8)) % 2) * 255, i = (y * width + x) * 4
    data[i] = value; data[i + 1] = value; data[i + 2] = value; data[i + 3] = 255
  }
  return { data, width, height }
}) }))

beforeEach(() => { Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:fixture') }); Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() }) })
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete (URL as unknown as { createObjectURL?: unknown }).createObjectURL; delete (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL })

describe('local Discover scan', () => {
  it('scans uploaded pixels, presents measured features, and carries a summary to Proof', async () => {
    const onContinue = vi.fn()
    render(<DiscoverScan onContinue={onContinue} />)
    const photo = new File(['fixture'], 'room.png', { type: 'image/png' })
    fireEvent.change(screen.getByLabelText(/Choose a photograph/), { target: { files: [photo] } })
    fireEvent.click(screen.getByRole('button', { name: 'Scan Image' }))
    expect(await screen.findByText('Discovery Scan Complete', {}, { timeout: 5000 })).toBeTruthy()
    expect(screen.getByText(/measured corners/)).toBeTruthy()
    expect(screen.getByText(/illustrative depth and links/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Continue to Proof' }))
    await waitFor(() => expect(onContinue).toHaveBeenCalledWith(expect.objectContaining({ fileName: 'room.png' })))
  })
})
