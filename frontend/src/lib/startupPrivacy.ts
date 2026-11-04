import { clearCheckSession } from './checkSession'
import { setDiscoveryHandoff } from './discover'
import { resetPrivateStores } from './storage'

/** Run once per document load, before React can restore old image-related state.
 * Browser sessionStorage can survive a fully closed/restored browser session.
 * Account-backed saving is not enabled: reopening always starts fresh for now.
 */
export function startFreshImageSession() {
  resetPrivateStores()
  clearCheckSession()
  setDiscoveryHandoff(null)
}
