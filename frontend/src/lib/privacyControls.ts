import { clearCheckSession } from './checkSession'
import { setDiscoveryHandoff } from './discover'
import { reviewStore, sceneStore, resetPrivateStores } from './storage'

function remove(keys: string[]) {
  let failed = false
  for (const kind of ['localStorage', 'sessionStorage'] as const) {
    try { for (const key of keys) window[kind].removeItem(key) } catch { failed = true }
  }
  if (failed) throw new Error('Browser storage could not be fully cleared.')
}
export function clearCurrentComparison() {
  clearCheckSession(); setDiscoveryHandoff(null)
  remove(['stillpoint.case.v1'])
}
export function deleteRegistrations() {
  sceneStore().clear()
  remove(['stillpoint.scenes.v1', 'stillpoint.protect.draft.v1'])
}
export function deleteLocalRecords() {
  clearCurrentComparison(); reviewStore().clear()
  remove(['stillpoint.reviews.v1', 'stillpoint.trust.v1', 'stillpoint.trust.owner.v1'])
}
export function clearPrivateSession() {
  clearCurrentComparison(); resetPrivateStores()
}
