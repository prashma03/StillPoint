// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider, useAuthSession } from '../../components/AuthSession'
import { AuthPage } from '../Auth'
import { authConfiguration, getAuthClient } from '../../lib/auth'
import { getCheckSession, saveCheckSession, emptyCheck } from '../../lib/checkSession'

vi.mock('../../lib/auth', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/auth')>(), getAuthClient: vi.fn(), authConfiguration: vi.fn() }))
const user = { id: 'fixture-account', email: 'fixture@example.com' }
let listener: (event: string) => void
let api: { getUser: ReturnType<typeof vi.fn>; onAuthStateChange: ReturnType<typeof vi.fn>; signInWithPassword: ReturnType<typeof vi.fn>; signUp: ReturnType<typeof vi.fn>; signOut: ReturnType<typeof vi.fn>; resetPasswordForEmail: ReturnType<typeof vi.fn>; updateUser: ReturnType<typeof vi.fn> }
function AccountDestination() {
  const auth = useAuthSession()
  return <div><h1>{auth.guest ? 'Guest application' : auth.user ? 'Authenticated application' : 'No access'}</h1><button onClick={() => void auth.logout()}>Logout fixture</button></div>
}
function show(path = '/login?next=/check') {
  return render(<MemoryRouter initialEntries={[path]}><AuthProvider><Routes><Route path="/login" element={<AuthPage mode="login" />} /><Route path="/signup" element={<AuthPage mode="signup" />} /><Route path="/auth/reset" element={<AuthPage mode="reset" />} /><Route path="/check" element={<AccountDestination />} /><Route path="/" element={<AccountDestination />} /></Routes></AuthProvider></MemoryRouter>)
}
function fill(signup = false) {
  fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } })
  fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'fixture-password-only' } })
  if (signup) fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'fixture-password-only' } })
}
beforeEach(() => {
  sessionStorage.clear(); localStorage.clear()
  api = {
    getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
    onAuthStateChange: vi.fn(callback => { listener = callback; return { data: { subscription: { unsubscribe: vi.fn() } } } }),
    signInWithPassword: vi.fn(), signUp: vi.fn(), signOut: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }), updateUser: vi.fn().mockResolvedValue({ error: null }),
  }
  vi.mocked(authConfiguration).mockReturnValue({ configured: true, message: 'Fixture provider' })
  vi.mocked(getAuthClient).mockReturnValue({ auth: api } as unknown as NonNullable<ReturnType<typeof getAuthClient>>)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })
describe('real auth adapter UI with explicit provider fixtures', () => {
  it('logs in only after provider success, clears guest data, and preserves the intended route', async () => {
    sessionStorage.setItem('stillpoint.private-owner.v1', 'guest')
    sessionStorage.setItem('stillpoint.scenes.v1', '[{"fixture":true}]')
    saveCheckSession({ ...emptyCheck(), step: 3 })
    api.signInWithPassword.mockResolvedValue({ data: { user, session: { access_token: 'fixture-token' } }, error: null })
    show(); await screen.findByLabelText('Email'); fill()
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }))
    await screen.findByRole('heading', { name: 'Authenticated application' })
    expect(api.signInWithPassword).toHaveBeenCalledWith({ email: user.email, password: 'fixture-password-only' })
    expect(sessionStorage.getItem('stillpoint.scenes.v1')).toBeNull()
    expect(getCheckSession().step).toBe(1)
  })
  it('shows failed credentials without opening the application', async () => {
    api.signInWithPassword.mockResolvedValue({ data: {}, error: { code: 'invalid_credentials', status: 400 } })
    show(); await screen.findByLabelText('Email'); fill()
    fireEvent.click(screen.getByRole('button', { name: 'Log In' }))
    await screen.findByRole('alert')
    expect(screen.queryByRole('heading', { name: 'Authenticated application' })).toBeNull()
    expect((screen.getByLabelText('Password') as HTMLInputElement).value).toBe('')
  })
  it('supports password visibility and rejects mismatched confirmation before submission', async () => {
    show('/signup'); await screen.findByLabelText('Email'); fill(true)
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }))
    expect((screen.getByLabelText('Password') as HTMLInputElement).type).toBe('text')
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'different-fixture-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    await screen.findByText('The passwords do not match.')
    expect(api.signUp).not.toHaveBeenCalled()
  })
  it('submits account creation and honestly waits for email confirmation when no session is returned', async () => {
    api.signUp.mockResolvedValue({ data: { user, session: null }, error: null })
    show('/signup'); await screen.findByLabelText('Email'); fill(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    await screen.findByText(/Check your email for confirmation/)
    expect(api.signUp).toHaveBeenCalledOnce()
    expect(screen.queryByRole('heading', { name: 'Authenticated application' })).toBeNull()
  })
  it('supports signup with a provider-issued session', async () => {
    api.signUp.mockResolvedValue({ data: { user, session: { access_token: 'fixture-token' } }, error: null })
    show('/signup?next=/check'); await screen.findByLabelText('Email'); fill(true)
    fireEvent.click(screen.getByRole('button', { name: 'Create Account' }))
    await screen.findByRole('heading', { name: 'Authenticated application' })
  })
  it('requests a real reset email through the configured provider adapter', async () => {
    show(); await screen.findByLabelText('Email')
    fireEvent.click(screen.getByRole('button', { name: 'Forgot Password' }))
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: user.email } })
    fireEvent.click(screen.getByRole('button', { name: 'Send Reset Link' }))
    await screen.findByText(/If that address is eligible/)
    expect(api.resetPasswordForEmail).toHaveBeenCalledWith(user.email, { redirectTo: `${window.location.origin}/auth/reset` })
  })
  it('requires recovery authorization before password update', async () => {
    show('/auth/reset'); await screen.findByText(/A verified recovery link is required/)
    expect((screen.getByRole('button', { name: 'Save New Password' }) as HTMLButtonElement).disabled).toBe(true)
    expect(api.updateUser).not.toHaveBeenCalled()
  })
  it('updates the password after recovery and revokes the recovered session', async () => {
    show('/auth/reset'); await screen.findByText(/A verified recovery link is required/)
    api.getUser.mockResolvedValue({ data: { user }, error: null })
    await act(async () => { listener('PASSWORD_RECOVERY') })
    await waitFor(() => expect((screen.getByRole('button', { name: 'Save New Password' }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'updated-fixture-password' } })
    fireEvent.change(screen.getByLabelText('Confirm Password'), { target: { value: 'updated-fixture-password' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save New Password' }))
    await screen.findByRole('heading', { name: 'Welcome to Stillpoint.' })
    expect(api.updateUser).toHaveBeenCalledWith({ password: 'updated-fixture-password' })
    expect(api.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
  it('accepts arbitrary temporary login entries as local guest access when accounts are offline', async () => {
    vi.mocked(getAuthClient).mockReturnValue(null)
    vi.mocked(authConfiguration).mockReturnValue({ configured: false, message: 'Accounts not configured' })
    show(); await screen.findByText(/Accounts are offline right now/)
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'anything at all' } })
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'anything' } })
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await screen.findByRole('heading', { name: 'Guest application' })
    expect(api.signInWithPassword).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('stillpoint.guest.v1')).toBe('true')
    expect(sessionStorage.getItem('anything at all')).toBeNull()
  })
  it('validates returning users with the provider and clears account state on logout', async () => {
    api.getUser.mockResolvedValue({ data: { user }, error: null })
    show(); await screen.findByRole('heading', { name: 'Authenticated application' })
    expect(api.getUser).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Logout fixture' }))
    await screen.findByRole('heading', { name: 'No access' })
    expect(api.signOut).toHaveBeenCalledWith({ scope: 'local' })
    expect(sessionStorage.getItem('stillpoint.private-owner.v1')).toBe('signed-out')
  })
})
