// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { App } from '../../App'

vi.mock('../../components/RoomScene', () => ({ RoomLayer: () => null }))
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  vi.stubGlobal('scrollTo', vi.fn())
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ configured: false }) }))
  vi.stubEnv('VITE_SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
describe('entrance to existing application', () => {
  it('gates a new visitor, skips intro, and opens guest access at the intended page', async () => {
    render(<MemoryRouter initialEntries={['/check']}><App /></MemoryRouter>)
    await screen.findByRole('button', { name: /Continue/ })
    expect(screen.queryByRole('heading', { name: 'Check an Image' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip Intro' }))
    await screen.findByRole('heading', { name: 'Welcome to Stillpoint.' })
    fireEvent.click(screen.getByRole('button', { name: 'Continue as Guest' }))
    await screen.findByRole('heading', { name: 'Check an Image' })
    for (const page of ['Protect', 'Trust', 'Proof', 'Settings', 'Discover', 'Home', 'Check']) {
      const links = screen.getAllByRole('link', { name: page })
      fireEvent.click(links[0])
      expect(screen.getAllByRole('heading', { level: 1 }).length).toBeGreaterThan(0)
    }
  })
  it('lets a returning guest access the intended route without replaying the intro', async () => {
    sessionStorage.setItem('stillpoint.guest.v1', 'true')
    render(<MemoryRouter initialEntries={['/check']}><App /></MemoryRouter>)
    await screen.findByRole('heading', { name: 'Check an Image' })
    expect(screen.queryByRole('button', { name: /^Continue$/ })).toBeNull()
  })
})
