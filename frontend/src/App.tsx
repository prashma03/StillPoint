import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { CaseProvider } from './components/case'
import { TabBar, TopBar } from './components/Nav'
import { Check } from './pages/Check'
import { Discover } from './pages/Discover'
import { Home } from './pages/Home'
import { Proof } from './pages/Proof'
import { Protect } from './pages/Protect'
import { ProtectedDetail } from './pages/ProtectedDetail'
import { Results } from './pages/Results'
import { Settings } from './pages/Settings'
import { TestProtection } from './pages/TestProtection'
import { Trust } from './pages/Trust'
import { Button } from './components/ui'
import { StillpointGuide } from './components/StillpointGuide'
import { AuthPage } from './pages/Auth'
import { RouteScroll } from './components/RouteScroll'
import { AuthProvider, useAuthSession } from './components/AuthSession'
import { Entrance } from './pages/Entrance'
import { INTRO_KEY, safeDestination, tabStorage } from './lib/auth'

export function App() {
  return <AuthProvider><SessionApplication /></AuthProvider>
}

function SessionApplication() {
  const auth = useAuthSession()
  return (
    <CaseProvider key={`${auth.revision}:${auth.user?.id ?? 'guest'}`}>
      <RouteScroll />
      <a className="skip" href="#content">Skip to content</a>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/auth/reset" element={<AuthPage mode="reset" />} />
        <Route path="/auth/callback" element={<AuthPage mode="login" />} />
        <Route path="*" element={<AccessGate />} />
      </Routes>
    </CaseProvider>
  )
}

function AccessGate() {
  const auth = useAuthSession(), location = useLocation(), navigate = useNavigate()
  if (auth.loading) return <main className="auth-screen"><p role="status">Checking your account session…</p></main>
  if (auth.recovery) return <Navigate to="/auth/reset" replace />
  if (auth.user || auth.guest) return <ApplicationShell />
  const next = safeDestination(location.pathname + location.search)
  if (tabStorage.getItem(INTRO_KEY) === 'complete') return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />
  return <Entrance onComplete={() => { tabStorage.setItem(INTRO_KEY, 'complete'); navigate(`/login?next=${encodeURIComponent(next)}`, { replace: true }) }} />
}

function ApplicationShell() {
  return <>
    <TopBar />
    <Stage />
    <TabBar />
    <StillpointGuide />
  </>
}

function Stage() {
  const location = useLocation()
  useEffect(() => {
    const heading = document.querySelector('main h1')
    if (heading instanceof HTMLElement) {
      heading.tabIndex = -1
      if (location.pathname !== '/') heading.focus({ preventScroll: true })
    }
  }, [location.pathname])
  return (
    <main id="content" key={location.pathname} className="route-stage">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/check" element={<Check />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/protect" element={<Protect />} />
        <Route path="/protected/:id" element={<ProtectedDetail />} />
        <Route path="/results" element={<Results />} />
        <Route path="/proof" element={<Proof />} />
        <Route path="/test" element={<TestProtection />} />
        <Route path="/trust" element={<Trust />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="*" element={<Missing />} />
      </Routes>
    </main>
  )
}

function Missing() {
  return (
    <div className="page">
      <h1>This page is not part of Stillpoint.</h1>
      <Button to="/">Return home</Button>
    </div>
  )
}
