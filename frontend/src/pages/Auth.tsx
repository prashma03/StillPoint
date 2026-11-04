import { useEffect, useState, type FormEvent } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { Mark } from '../components/ui'
import { useAuthSession } from '../components/AuthSession'
import { authError, credentialsError, emailError, getAuthClient, safeDestination } from '../lib/auth'

export function AuthPage({ mode }: { mode: 'login' | 'signup' | 'reset' }) {
  const auth = useAuthSession(), navigate = useNavigate(), [params] = useSearchParams()
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false), [forgot, setForgot] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState(''), [message, setMessage] = useState('')
  const next = safeDestination(params.get('next'))
  const reset = mode === 'reset', signup = mode === 'signup'
  useEffect(() => { document.title = `${reset ? 'Reset password' : signup ? 'Create account' : 'Log in'} · Stillpoint`; setError(''); setMessage(''); setPassword(''); setConfirm(''); setForgot(false) }, [mode, reset, signup])
  // SDK consumes the single-use PKCE callback before loading becomes false.
  useEffect(() => {
    if (!auth.loading && (params.has('code') || params.has('error'))) window.history.replaceState(window.history.state, '', `${window.location.pathname}${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`)
  }, [auth.loading, params, next])
  if (auth.loading) return <main className="auth-screen"><p role="status">Checking your account session…</p></main>
  if (auth.user && !reset && !auth.recovery) return <Navigate to={next} replace />
  async function submit(event: FormEvent) {
    event.preventDefault(); setError(''); setMessage('')
    const client = getAuthClient()
    // Temporary local access when the Supabase account service is not set up.
    // Submitted values are deliberately neither checked nor persisted.
    if (!client && mode === 'login' && !forgot) {
      auth.enterGuest(); navigate(next, { replace: true }); return
    }
    if (!client) { setError(auth.configurationMessage); return }
    if (forgot) {
      if (emailError(email.trim())) { setError('Enter a valid email address.'); return }
    } else if (reset) {
      if (!auth.user || !auth.recovery) { setError('Open a valid password reset link in the tab where you requested it.'); return }
      const invalid = credentialsError(auth.user.email ?? 'account@example.com', password, confirm)
      if (invalid) { setError(invalid); return }
    } else {
      const invalid = credentialsError(email.trim(), password, signup ? confirm : undefined)
      if (invalid) { setError(invalid); return }
    }
    setBusy(true)
    try {
      if (forgot) {
        const result = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/reset` })
        if (result.error) throw result.error
        setMessage('If that address is eligible, Supabase will send a reset link. Open it in this same tab. Email delivery depends on the configured mail service.')
      } else if (reset) {
        const result = await client.auth.updateUser({ password })
        if (result.error) throw result.error
        // End this recovered session; require a fresh password login afterwards.
        if (!await auth.logout()) throw new Error('Sign-out failed')
        auth.finishRecovery(); navigate('/login', { replace: true })
      } else if (signup) {
        const result = await client.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` } })
        if (result.error) throw result.error
        if (result.data.session && result.data.user) { auth.acceptUser(result.data.user); navigate(next, { replace: true }) }
        else setMessage('Check your email for confirmation instructions. An active session has not been created. Email delivery depends on the configured mail service.')
      } else {
        const result = await client.auth.signInWithPassword({ email: email.trim(), password })
        if (result.error) throw result.error
        if (!result.data.user || !result.data.session) throw new Error('No verified session')
        auth.acceptUser(result.data.user); navigate(next, { replace: true })
      }
    } catch (failure) { setError(authError(failure as { code?: string; status?: number })) }
    finally { setBusy(false); setPassword(''); setConfirm('') }
  }
  return <main className="auth-screen">
    <div className="auth-glow auth-glow-one" aria-hidden="true" /><div className="auth-glow auth-glow-two" aria-hidden="true" />
    <section className="auth-card auth-live" aria-labelledby="auth-title">
      <Link className="auth-brand" to="/" aria-label="Stillpoint home"><Mark size={25} /><span>Stillpoint</span></Link>
      <p className="eyebrow">Proof without seeing.</p><h1 id="auth-title">{reset ? 'Choose a new password.' : forgot ? 'Find your way back.' : signup ? 'A private place to begin.' : 'Welcome to Stillpoint.'}</h1>
      {!reset && <nav className="auth-tabs" aria-label="Account access"><Link className={!signup ? 'is-active' : ''} to={`/login?next=${encodeURIComponent(next)}`} aria-current={!signup ? 'page' : undefined}>Log In</Link><Link className={signup ? 'is-active' : ''} to={`/signup?next=${encodeURIComponent(next)}`} aria-current={signup ? 'page' : undefined}>Create Account</Link></nav>}
      {!auth.configured && mode === 'login' && !forgot && <p className="note" role="status">Accounts are offline right now. Continue to open a private guest session on this tab. The entries below are not checked or saved.</p>}
      {!auth.configured && (mode !== 'login' || forgot) && <p className="note" role="status">{auth.configurationMessage}</p>}
      {auth.error && <p className="error" role="alert">{auth.error}</p>}
      {reset && !auth.recovery && <p className="note">A verified recovery link is required. Request a fresh link from Log In if yours has expired.</p>}
      <form className="stack auth-form" onSubmit={event => void submit(event)}>
        {!reset && <label className="field"><span>Email</span><input type={auth.configured ? 'email' : 'text'} autoComplete="email" required={auth.configured || forgot} maxLength={254} disabled={busy} value={email} onChange={e => setEmail(e.target.value)} /></label>}
        {!forgot && <><label className="field"><span>Password</span><div className="auth-password"><input type={show ? 'text' : 'password'} autoComplete={signup || reset ? 'new-password' : 'current-password'} required={auth.configured || signup || reset} minLength={signup || reset ? 12 : undefined} maxLength={128} disabled={busy} value={password} onChange={e => setPassword(e.target.value)} /><button type="button" disabled={busy} onClick={() => setShow(!show)} aria-pressed={show}>{show ? 'Hide' : 'Show'} password</button></div></label>{(signup || reset) && <label className="field"><span>Confirm Password</span><input type={show ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={confirm} onChange={e => setConfirm(e.target.value)} /></label>}{(signup || reset) && <p className="footer-note">Use at least 12 characters. The account provider may enforce additional password requirements.</p>}</>}
        {error && <p className="error" role="alert">{error}</p>}{message && <p className="note" role="status">{message}</p>}
        <button className="btn btn-primary" type="submit" disabled={busy || ((!auth.configured && (signup || forgot || reset)) || (reset && !auth.recovery))}>{busy ? 'Please wait…' : forgot ? 'Send Reset Link' : reset ? 'Save New Password' : signup ? 'Create Account' : auth.configured ? 'Log In' : 'Continue'}</button>
        {!signup && !reset && <button className="auth-text-button" type="button" disabled={busy} onClick={() => { setForgot(!forgot); setError(''); setMessage('') }}>{forgot ? 'Back to Log In' : 'Forgot Password'}</button>}
      </form>
      <div className="auth-guest"><span>One comparison. No account needed.</span><button className="btn btn-secondary" disabled={busy || !!auth.user} onClick={() => { auth.enterGuest(); navigate(next, { replace: true }) }}>Continue as Guest</button></div>
      <p className="footer-note">Account credentials go only to the configured Supabase authentication service. Private photographs are never sent there or automatically saved to an account. Switching between guest and account access clears this tab’s comparison data.</p>
      {reset && <Link to="/login">Back to Log In</Link>}
    </section>
  </main>
}
