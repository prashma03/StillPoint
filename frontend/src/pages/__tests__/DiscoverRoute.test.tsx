// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { Discover } from '../Discover'

vi.mock('../../components/DiscoverScan', () => ({
  DiscoverScan: () => <section>Local discovery scan</section>,
}))

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('Discover page', () => {
  it('keeps public image search closed and does not show setup instructions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ provider: 'TinEye', configured: false, sources: '', missing: ['key'] }) })))
    render(<MemoryRouter><Discover /></MemoryRouter>)
    expect(screen.getByText('Local discovery scan')).toBeTruthy()
    expect(screen.queryByText('Registered original')).toBeNull()
    expect(screen.queryByText(/TINEYE_API_KEY/)).toBeNull()
    expect(screen.queryByText('Provider configuration')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Search for Public Matches' }))
    expect(await screen.findByText(/Public image search is currently unavailable/)).toBeTruthy()
    expect(screen.queryByText(/TINEYE_API_KEY/)).toBeNull()
    expect(screen.queryByText('Registered original')).toBeNull()
    expect(screen.getByText('Local discovery scan')).toBeTruthy()
  })

  it('shows the existing TinEye form only after search is available', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ provider: 'TinEye', configured: true, sources: 'TinEye public web index', missing: [] }) })))
    render(<MemoryRouter initialEntries={['/discover?scene=saved']}><Discover /></MemoryRouter>)
    expect(await screen.findByText('Registered original')).toBeTruthy()
    expect(screen.getByText(/complete unmasked original image/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Search public images' })).toBeTruthy()
  })
})
