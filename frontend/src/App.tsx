import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { CaseProvider } from './components/case'
import { TabBar, TopBar } from './components/Nav'
import { Check } from './pages/Check'
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

export function App() {
  const demoAuthEnabled = import.meta.env.DEV && import.meta.env.VITE_DEMO_AUTH === 'true'
  return (
    <CaseProvider>
      <a className="skip" href="#content">Skip to content</a>
      {demoAuthEnabled ? <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route path="/logout" element={<AuthPage mode="login" loggedOut />} />
        <Route path="*" element={<ApplicationShell demoAuthEnabled />} />
      </Routes> : <Routes><Route path="*" element={<ApplicationShell demoAuthEnabled={false} />} /></Routes>}
    </CaseProvider>
  )
}

function ApplicationShell({ demoAuthEnabled }: { demoAuthEnabled: boolean }) {
  return <>
    <TopBar demoAuthEnabled={demoAuthEnabled} />
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
