import { createClient, type SupabaseClient } from '@supabase/supabase-js'

export const AUTH_STORAGE_KEY = 'stillpoint.auth.v1'
export const GUEST_KEY = 'stillpoint.guest.v1'
export const INTRO_KEY = 'stillpoint.intro.v1'
const values = new Map<string, string>()
export const tabStorage = {
  getItem(key: string) { try { return sessionStorage.getItem(key) } catch { return values.get(key) ?? null } },
  setItem(key: string, value: string) { try { sessionStorage.setItem(key, value) } catch { values.set(key, value) } },
  removeItem(key: string) { try { sessionStorage.removeItem(key) } catch { values.delete(key) } },
}

export function safeDestination(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\x00-\x20]/.test(value)) return '/'
  const path = value.split(/[?#]/)[0]
  return ['/login', '/signup', '/auth/reset', '/auth/callback'].includes(path) ? '/' : value
}

export function emailError(email: string): string | null {
  return !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ? 'Enter a valid email address.' : null
}
export function credentialsError(email: string, password: string, confirmation?: string): string | null {
  if (emailError(email)) return 'Enter a valid email address.'
  if (!password || password.length > 128) return 'Enter a password of at most 128 characters.'
  if (confirmation !== undefined && password.length < 12) return 'Choose a password with at least 12 characters.'
  if (confirmation !== undefined && password !== confirmation) return 'The passwords do not match.'
  return null
}

export function authError(error: { code?: string; status?: number } | null): string {
  if (error?.status === 429 || error?.code === 'over_request_rate_limit' || error?.code === 'over_email_send_rate_limit') return 'Too many attempts. Please wait before trying again.'
  if (error?.code === 'email_not_confirmed') return 'Confirm your email using the link from Supabase, then log in.'
  if (error?.code === 'weak_password') return 'That password does not meet the account security requirements. Choose a stronger password.'
  return 'The request could not be completed. Check your credentials, confirmation link, or connection and try again.'
}

export function authConfiguration() {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  if (!url || !key) return { configured: false, message: 'Accounts are not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the frontend. Guest access is available.' }
  // Only a public publishable/anon key belongs in a browser bundle.
  let privateKey = key.startsWith('sb_secret_')
  try { privateKey ||= JSON.parse(atob(key.split('.')[1])).role === 'service_role' } catch { /* publishable keys are not JWTs */ }
  if (!url.startsWith('https://') || privateKey) return { configured: false, message: 'Authentication configuration is invalid. Use an HTTPS Supabase project URL and a public publishable/anon key, never a service-role or secret key.' }
  return { configured: true, message: 'Email and password authentication through Supabase.' }
}

let client: SupabaseClient | null = null
export function getAuthClient(): SupabaseClient | null {
  if (!authConfiguration().configured) return null
  if (!client) client = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY, {
    auth: { storage: tabStorage, storageKey: AUTH_STORAGE_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) }) },
  })
  return client
}
