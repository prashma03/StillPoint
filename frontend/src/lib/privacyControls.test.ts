// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearCurrentComparison, clearPrivateSession, deleteLocalRecords, deleteRegistrations } from './privacyControls'
import { emptyCheck, getCheckSession, saveCheckSession, getProofMedia, setProofMedia } from './checkSession'
import { settingsStore } from './storage'
import { segmentPhoto, analyzePhoto } from './ai'
afterEach(() => { clearPrivateSession(); sessionStorage.clear(); localStorage.clear(); vi.unstubAllGlobals() })
describe('privacy controls', () => {
  it('honors the Blind Mode preference for new comparisons while never acknowledging visibility', () => {
    settingsStore().save({ blindMode: false, pythonEngine: false })
    expect(emptyCheck().blind).toBe(false)
    expect(emptyCheck().viewing).toBe(false)
  })
  it('clears comparison images and results without deleting original registrations', () => {
    sessionStorage.setItem('stillpoint.scenes.v1', 'registration')
    sessionStorage.setItem('stillpoint.case.v1', 'old-result')
    saveCheckSession({ ...emptyCheck(), step: 5 })
    setProofMedia({ caseId: 'case', original: new Blob(['fixture']), suspicious: null, blind: true })
    clearCurrentComparison()
    expect(getCheckSession().step).toBe(1)
    expect(getProofMedia('case')).toBeNull()
    expect(sessionStorage.getItem('stillpoint.case.v1')).toBeNull()
    expect(sessionStorage.getItem('stillpoint.scenes.v1')).toBe('registration')
  })
  it('deletes registrations and Protect drafts from both legacy and session storage', () => {
    for (const store of [localStorage, sessionStorage]) for (const key of ['stillpoint.scenes.v1', 'stillpoint.protect.draft.v1']) store.setItem(key, 'private')
    deleteRegistrations()
    for (const store of [localStorage, sessionStorage]) for (const key of ['stillpoint.scenes.v1', 'stillpoint.protect.draft.v1']) expect(store.getItem(key)).toBeNull()
  })
  it('deletes private notes and Trust records; clearing session preserves auth and preferences', () => {
    sessionStorage.setItem('stillpoint.trust.v1', 'private-claim')
    sessionStorage.setItem('stillpoint.reviews.v1', 'private-note')
    sessionStorage.setItem('stillpoint.auth.v1', 'auth-fixture')
    deleteLocalRecords()
    expect(sessionStorage.getItem('stillpoint.trust.v1')).toBeNull()
    expect(sessionStorage.getItem('stillpoint.reviews.v1')).toBeNull()
    clearPrivateSession()
    expect(sessionStorage.getItem('stillpoint.auth.v1')).toBe('auth-fixture')
  })
  it('blocks external photo requests without action-specific consent, even when tools are enabled', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    settingsStore().save({ blindMode: true, pythonEngine: false, externalImagesEnabled: true })
    expect((await segmentPhoto('data:image/png;base64,fixture')).ok).toBe(false)
    expect((await analyzePhoto('data:image/png;base64,fixture', null)).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('blocks external photo requests when the Settings permission is disabled', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch)
    settingsStore().save({ blindMode: true, pythonEngine: false, externalImagesEnabled: false })
    expect((await segmentPhoto('data:image/png;base64,fixture', true)).ok).toBe(false)
    expect((await analyzePhoto('data:image/png;base64,fixture', null, 12, true)).ok).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})
