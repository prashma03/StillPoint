import { clearCheckSession } from './checkSession'
import { setDiscoveryHandoff } from './discover'
import { resetPrivateStores } from './storage'
import { tabStorage } from './auth'

const OWNER_KEY = 'stillpoint.private-owner.v1'
export function isolateAccount(owner: string) {
  const previous = tabStorage.getItem(OWNER_KEY)
  const changed = previous !== owner
  if (changed && (previous !== null || owner !== 'guest')) {
    resetPrivateStores()
    clearCheckSession()
    setDiscoveryHandoff(null)
    tabStorage.removeItem('stillpoint.protect.draft.v1')
  }
  tabStorage.setItem(OWNER_KEY, owner)
  return changed
}
