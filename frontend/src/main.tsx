import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import '@fontsource-variable/inter'
import { App } from './App'
import './styles.css'
import { startFreshImageSession } from './lib/startupPrivacy'

// Bootstrap only: changing routes must not erase an active comparison.
startFreshImageSession()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
