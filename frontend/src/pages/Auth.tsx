import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Mark } from '../components/ui'

export function AuthPage({ mode, loggedOut = false }: { mode: 'login' | 'signup'; loggedOut?: boolean }) {
  const [showPassword, setShowPassword] = useState(false)
  const navigate = useNavigate()
  const passwordRef = useRef<HTMLInputElement>(null)
  const isLogin = mode === 'login'

  useEffect(() => { document.title = `${isLogin ? 'Log in' : 'Create account'} · Stillpoint` }, [isLogin])

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Credentials are deliberately neither read nor retained.
    if (passwordRef.current) passwordRef.current.value = ''
    navigate('/', { replace: true })
  }

  return (
    <main className="auth-screen">
      <div className="auth-glow auth-glow-one" aria-hidden="true" />
      <div className="auth-glow auth-glow-two" aria-hidden="true" />
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="auth-brand" to="/" aria-label="Stillpoint home"><Mark size={25} /><span>Stillpoint</span></Link>
        <p className="auth-demo">Demo Mode — Authentication Disabled</p>
        <h1 id="auth-title">{loggedOut ? 'You’re signed out.' : isLogin ? 'Welcome back.' : 'A little more room to breathe.'}</h1>
        <p className="auth-copy">{loggedOut ? 'Demo session ended. Continue whenever you’re ready.' : isLogin ? 'Pick up where you left off.' : 'Create a demo account to explore Stillpoint.'}</p>
        <form className="auth-form" onSubmit={submit} autoComplete="off">
          <label className="field"><span className="field-label">Email</span><input type="email" name="email" autoComplete="off" placeholder="you@example.com" /></label>
          <label className="field"><span className="field-label">Password</span>
            <span className="auth-password"><input ref={passwordRef} type={showPassword ? 'text' : 'password'} name="password" autoComplete="new-password" placeholder="Enter any password" /><button className="auth-show" type="button" aria-label={showPassword ? 'Hide password' : 'Show password'} onClick={() => setShowPassword((value) => !value)}>{showPassword ? 'Hide' : 'Show'}</button></span>
          </label>
          <p className="auth-note">Demo only. Credentials are not checked, saved, or sent anywhere.</p>
          <button className="btn btn-primary auth-submit" type="submit">{isLogin ? 'Log in' : 'Create account'} <span aria-hidden="true">→</span></button>
        </form>
        <p className="auth-switch">{isLogin ? 'New to Stillpoint?' : 'Already explored with us?'} <Link to={isLogin ? '/signup' : '/login'}>{isLogin ? 'Create an account' : 'Log in'}</Link></p>
      </section>
      <span className="auth-footer">A quieter way to see what holds.</span>
    </main>
  )
}
