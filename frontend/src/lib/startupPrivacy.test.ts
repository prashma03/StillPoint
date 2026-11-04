// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { startFreshImageSession } from './startupPrivacy'
import { emptyCheck, getCheckSession, getProofMedia, saveCheckSession, setProofMedia } from './checkSession'
import { setDiscoveryHandoff, takeDiscoveryHandoff } from './discover'

afterEach(() => { startFreshImageSession(); sessionStorage.clear(); localStorage.clear() })
describe('fresh image session on full app startup', () => {
  it('removes browser-restored maps, drafts, notes, results, and temporary pictures before rendering', () => {
    const keys = ['stillpoint.scenes.v1', 'stillpoint.reviews.v1', 'stillpoint.case.v1', 'stillpoint.protect.draft.v1']
    for (const key of keys) {
      sessionStorage.setItem(key, 'previous-session')
      localStorage.setItem(key, 'legacy-session')
    }
    const draft = emptyCheck()
    draft.original.file = new File(['harmless fixture'], 'original.png', { type: 'image/png' })
    draft.original.label = 'original.png'
    draft.step = 5
    saveCheckSession(draft)
    setProofMedia({ caseId: 'old-case', original: new Blob(['fixture']), suspicious: null, blind: true })
    setDiscoveryHandoff({ sceneId: 'old-scene', candidate: { id: 'old', domain: 'example.com', image: null, links: [], provider_score: null, verification: 'unverified' } })
    startFreshImageSession()
    for (const key of keys) {
      expect(sessionStorage.getItem(key)).toBeNull()
      expect(localStorage.getItem(key)).toBeNull()
    }
    expect(getCheckSession().original.file).toBeNull()
    expect(getCheckSession().step).toBe(1)
    expect(getProofMedia('old-case')).toBeNull()
    expect(takeDiscoveryHandoff()).toBeNull()
  })
  it('keeps active page-to-page work until the next full startup, while preserving access and preferences', () => {
    startFreshImageSession()
    sessionStorage.setItem('stillpoint.auth.v1', 'account-session-fixture')
    sessionStorage.setItem('stillpoint.guest.v1', 'true')
    localStorage.setItem('stillpoint.settings.v1', 'preferences')
    const draft = { ...emptyCheck(), step: 3 }
    saveCheckSession(draft)
    expect(getCheckSession()).toBe(draft) // Ordinary route remounts read this same session.
    startFreshImageSession() // Reopen/refresh, even with an authenticated session.
    expect(getCheckSession().step).toBe(1)
    expect(sessionStorage.getItem('stillpoint.auth.v1')).toBe('account-session-fixture')
    expect(sessionStorage.getItem('stillpoint.guest.v1')).toBe('true')
    expect(localStorage.getItem('stillpoint.settings.v1')).toBe('preferences')
  })
})
