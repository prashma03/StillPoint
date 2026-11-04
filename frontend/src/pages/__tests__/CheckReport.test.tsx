// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaseProvider } from '../../components/case'
import { clearCheckSession, emptyCheck, getCheckSession, getProofMedia, saveCheckSession, setProofMedia } from '../../lib/checkSession'
import { saveCaseRaw, sessionMemory } from '../../lib/storage'
import { buildSample } from '../../lib/sampleCase'
import { Check } from '../Check'

afterEach(() => { cleanup(); clearCheckSession(); sessionStorage.clear(); vi.restoreAllMocks(); Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal'); Reflect.deleteProperty(HTMLDialogElement.prototype, 'close') })

describe('Check evidence report and closure', () => {
  it('requires explicit confirmation, removes the case record and temporary proof media, and reports retention limits', async () => {
    const record = buildSample('derivative')
    saveCaseRaw(sessionMemory()!, record)
    saveCheckSession({ ...emptyCheck(), step: 6, caseId: record.id })
    setProofMedia({ caseId: record.id, original: new Blob(['redacted preview']), suspicious: new Blob(['redacted preview']), blind: true })
    Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.open = true } })
    Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.open = false; this.dispatchEvent(new Event('close')) } })
    render(createElement(MemoryRouter, { initialEntries: ['/check'] }, createElement(CaseProvider, null, createElement(Check))))

    expect(screen.getByRole('heading', { name: '6. Generate Evidence Report' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Close Case Securely' }))
    expect(screen.getByText(/It does not delete saved scene graphs, account or backup copies/)).toBeTruthy()
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close Case Securely' }))

    await waitFor(() => expect(screen.getByRole('heading', { name: '1. Upload Images' })).toBeTruthy())
    expect(sessionMemory()!.getItem('stillpoint.case.v1')).toBeNull()
    expect(getCheckSession().caseId).toBeNull()
    expect(getProofMedia(record.id)).toBeNull()
    expect(screen.getByText(/reports already downloaded remain under their own retention/)).toBeTruthy()
  })
})
