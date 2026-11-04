import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { Mark } from '../components/ui'

/** Account screens remain available as honest placeholders until a provider is configured. */
export function AuthPage({ mode }: { mode: 'login' | 'signup' }) {
  const isLogin = mode === 'login'
  useEffect(() => { document.title = `${isLogin ? 'Sign in' : 'Create account'} · Stillpoint` }, [isLogin])

  return (
    <main className="auth-screen">
      <div className="auth-glow auth-glow-one" aria-hidden="true" />
      <div className="auth-glow auth-glow-two" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="auth-brand" to="/" aria-label="Stillpoint home"><Mark size={25} /><span>Stillpoint</span></Link>
        <p className="auth-demo">Accounts unavailable</p>
        <h1 id="auth-title">{isLogin ? 'Sign in is not set up yet.' : 'Account creation is not available yet.'}</h1>
        <p className="auth-copy">Stillpoint has no authentication provider configured, so it cannot offer protected account features right now.</p>
        <p className="note auth-availability">You can use private verification as a guest. No account is required to compare images, view results, download a local report, or use Stillpoint Guide.</p>
        <div className="actions auth-actions">
          <Link className="btn btn-primary" to="/check">Start private verification</Link>
          <Link className="btn btn-secondary" to="/">Return home</Link>
        </div>
      </section>
      <span className="auth-footer">A quieter way to see what holds.</span>
    </main>
  )
}
