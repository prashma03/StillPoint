import { afterEach, describe, expect, it, vi } from 'vitest'
import { authConfiguration, authError, credentialsError, safeDestination } from './auth'
afterEach(() => vi.unstubAllEnvs())
describe('authentication boundaries', () => {
  it('allows only local non-authentication destinations', () => {
    for (const value of ['https://example.com', '//evil.example', '/\\evil.example', '/login', '/auth/reset', '/check\n']) expect(safeDestination(value)).toBe('/')
    expect(safeDestination('/proof?case=123')).toBe('/proof?case=123')
  })
  it('validates email, password bounds, and account confirmation', () => {
    expect(credentialsError('bad', 'secret')).not.toBeNull()
    expect(credentialsError('test@example.com', 'short', 'short')).toContain('12')
    expect(credentialsError('test@example.com', 'long-password-here', 'different')).toContain('match')
    expect(credentialsError('test@example.com', 'long-password-here', 'long-password-here')).toBeNull()
  })
  it('shows a real missing-configuration state and refuses browser secret keys', () => {
    vi.stubEnv('VITE_SUPABASE_URL', ''); vi.stubEnv('VITE_SUPABASE_ANON_KEY', '')
    expect(authConfiguration().configured).toBe(false)
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co'); vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'sb_secret_fixture')
    expect(authConfiguration().configured).toBe(false)
  })
  it('does not expose raw provider errors and handles rate limits explicitly', () => {
    expect(authError({ status: 429 })).toContain('Too many')
    expect(authError({ code: 'email_not_confirmed' })).toContain('Confirm your email')
    expect(authError({ code: 'invalid_credentials' })).not.toContain('invalid_credentials')
  })
})
