import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { User } from '@supabase/supabase-js'
import { authConfiguration, authError, getAuthClient, GUEST_KEY, INTRO_KEY, tabStorage } from '../lib/auth'
import { isolateAccount } from '../lib/accountIsolation'

type AuthState = {
  user: User | null; loading: boolean; guest: boolean; recovery: boolean; revision: number; error: string
  configured: boolean; configurationMessage: string
  acceptUser: (user: User) => void; enterGuest: () => void; logout: () => Promise<boolean>
  finishRecovery: () => void
}
const Context = createContext<AuthState | null>(null)
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null), [loading, setLoading] = useState(true)
  const [guest, setGuest] = useState(false), [recovery, setRecovery] = useState(false)
  const [revision, setRevision] = useState(0), [error, setError] = useState('')
  const generation = useRef(0)
  const configuration = authConfiguration()
  function acceptUser(next: User) {
    if (isolateAccount(`user:${next.id}`)) setRevision(value => value + 1)
    tabStorage.removeItem(GUEST_KEY); tabStorage.setItem(INTRO_KEY, 'complete')
    setGuest(false); setUser(next); setError(''); setLoading(false)
  }
  function signedOut() {
    generation.current++
    if (isolateAccount('signed-out')) setRevision(value => value + 1)
    tabStorage.removeItem(GUEST_KEY); setGuest(false); setUser(null); setRecovery(false); setLoading(false)
  }
  useEffect(() => {
    let active = true
    const client = getAuthClient()
    const check = async () => {
      const token = ++generation.current
      try {
        // getUser validates with the authentication server; local session data is not authorization.
        const result = client ? await client.auth.getUser() : null
        if (!active || generation.current !== token) return
        if (result?.data.user) acceptUser(result.data.user)
        else {
          const isGuest = tabStorage.getItem(GUEST_KEY) === 'true'
          if (isolateAccount('guest')) setRevision(value => value + 1)
          setUser(null); setGuest(isGuest); setLoading(false)
        }
      } catch {
        if (active && generation.current === token) { setLoading(false); setError('Account session could not be verified. You can retry login or continue as a guest.') }
      }
    }
    const subscription = client?.auth.onAuthStateChange((event) => {
      if (!active) return
      if (event === 'PASSWORD_RECOVERY') setRecovery(true)
      if (event === 'SIGNED_OUT') signedOut()
      // Avoid Supabase auth-lock reentrancy by validating outside the callback.
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'PASSWORD_RECOVERY') setTimeout(() => { if (active) void check() }, 0)
    }).data.subscription
    void check()
    return () => { active = false; generation.current++; subscription?.unsubscribe() }
  }, [])
  function enterGuest() {
    generation.current++
    if (isolateAccount('guest')) setRevision(value => value + 1)
    tabStorage.setItem(GUEST_KEY, 'true'); tabStorage.setItem(INTRO_KEY, 'complete')
    setUser(null); setRecovery(false); setGuest(true); setLoading(false); setError('')
  }
  async function logout() {
    const client = getAuthClient()
    try {
      if (client && user) {
        const { error: failure } = await client.auth.signOut({ scope: 'local' })
        if (failure) { setError(authError(failure)); return false }
      }
    } catch { setError('Logout could not be confirmed. Check your connection and try again.'); return false }
    signedOut(); tabStorage.setItem(INTRO_KEY, 'complete'); return true
  }
  return <Context.Provider value={{ user, loading, guest, recovery, revision, error, configured: configuration.configured, configurationMessage: configuration.message, acceptUser, enterGuest, logout, finishRecovery: () => setRecovery(false) }}>{children}</Context.Provider>
}
export function useAuthSession() {
  const state = useContext(Context)
  if (!state) throw new Error('AuthProvider is required.')
  return state
}
