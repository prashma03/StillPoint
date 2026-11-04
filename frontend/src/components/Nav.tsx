import { Link, NavLink, useLocation } from 'react-router-dom'
import { Mark } from './ui'

const links = [
  { to: '/check', label: 'Check' },
  { to: '/protect', label: 'Protect' },
  { to: '/proof', label: 'Proof' },
  { to: '/trust', label: 'Trust' },
  { to: '/settings', label: 'Settings' },
]

export function TopBar() {
  return (
    <header className="topbar">
      <Link className="brand" to="/" aria-label="Stillpoint, home">
        <Mark size={22} />
        <span className="brand-name">Stillpoint</span>
      </Link>
      <nav className="nav-links" aria-label="Primary">
        {links.map((link) => (
          <NavLink key={link.to} to={link.to} className="nav-link">
            {link.label}
          </NavLink>
        ))}
      </nav>
      <div className="header-actions">
        <NavLink className="btn btn-primary header-check" to="/check">
          Check
        </NavLink>
        <NavLink className="header-signin" to="/login">Sign in</NavLink>
        <NavLink className="icon-btn" to="/settings" aria-label="Settings">
          <SettingsIcon />
        </NavLink>
      </div>
    </header>
  )
}

export function TabBar() {
  const { pathname } = useLocation()
  const protectOn = pathname === '/protect' || pathname.startsWith('/protected')
  return (
    <nav className="tabbar" aria-label="Primary">
      <NavLink to="/" end className="tab">
        <Mark size={16} />
        Home
      </NavLink>
      <NavLink to="/check" className="tab">
        <CheckIcon />
        Check
      </NavLink>
      <NavLink to="/protect" className={protectOn ? 'tab tab-on' : 'tab'} aria-current={protectOn ? 'page' : undefined}>
        <ProtectIcon />
        Protect
      </NavLink>
      <NavLink to="/proof" className="tab">
        <ProofIcon />
        Proof
      </NavLink>
      <NavLink to="/trust" className="tab">
        <TrustIcon />
        Trust
      </NavLink>
    </nav>
  )
}

function SettingsIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4 18 18M18 6l-1.6 1.6M7.6 16.4 6 18" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <circle cx="15" cy="9" r="1.2" fill="currentColor" />
      <circle cx="8" cy="15" r="1.2" fill="currentColor" />
    </svg>
  )
}

function ProtectIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 3.5 19 6.2v6.2c0 4.2-2.8 6.8-7 8.1-4.2-1.3-7-3.9-7-8.1V6.2Z" />
    </svg>
  )
}

function ProofIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M7 5h6.5L18 9.5V19H7Z" />
      <path d="M13.5 5v4.5H18" />
    </svg>
  )
}

function TrustIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
      <path d="M12 4v16M5 8h14M7 8l-2 8h6L7 8Zm10 0-2 8h6l-4-8Z" />
    </svg>
  )
}
