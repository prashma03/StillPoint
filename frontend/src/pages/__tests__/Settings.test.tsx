// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CaseProvider } from '../../components/case'
import { AuthProvider } from '../../components/AuthSession'
import { Settings } from '../Settings'
import { settingsStore } from '../../lib/storage'

beforeEach(() => {
  localStorage.clear(); sessionStorage.clear()
  settingsStore().save({ blindMode: true, pythonEngine: false, externalImagesEnabled: false })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ configured: false }) }))
  vi.stubEnv('VITE_SUPABASE_URL', '')
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs() })
function open() { render(<MemoryRouter><AuthProvider><CaseProvider><Settings /></CaseProvider></AuthProvider></MemoryRouter>) }
describe('Settings dashboard', () => {
  it('renders the requested sections without submitting images', async () => {
    open()
    await screen.findByRole('heading', { name: 'Settings' })
    const navigation = screen.getByRole('navigation', { name: 'Settings sections' })
    expect(within(navigation).getAllByRole('link').map(link => link.textContent)).toEqual(['Privacy & Protection', 'AI Processing', 'My Data', 'Account & Security', 'Advanced Settings'])
    expect(vi.mocked(fetch).mock.calls.every(call => !call[1] || call[1].method !== 'POST')).toBe(true)
  })
  it('persists privacy preferences without treating availability as upload consent', () => {
    open()
    fireEvent.click(screen.getByRole('switch', { name: 'Start checks with Blind Mode' }))
    expect(settingsStore().load().blindMode).toBe(false)
    fireEvent.click(screen.getByRole('switch', { name: 'Allow external image AI tools' }))
    expect(settingsStore().load().externalImagesEnabled).toBe(true)
    expect(vi.mocked(fetch).mock.calls.every(call => !call[1] || call[1].method !== 'POST')).toBe(true)
  })
  it('requires confirmation and allows cancelling before clearing session data', async () => {
    open()
    sessionStorage.setItem('stillpoint.case.v1', 'private-result')
    fireEvent.click(screen.getByRole('button', { name: 'Clear session data' }))
    const dialog = screen.getByRole('dialog')
    expect(sessionStorage.getItem('stillpoint.case.v1')).toBe('private-result')
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(sessionStorage.getItem('stillpoint.case.v1')).toBe('private-result')
    fireEvent.click(screen.getByRole('button', { name: 'Clear session data' }))
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Clear session data' }))
    expect(sessionStorage.getItem('stillpoint.case.v1')).toBeNull()
  })
})
