// @vitest-environment jsdom
import { createElement } from 'react'
import { cleanup, fireEvent, render as renderApp, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CaseProvider } from '../../components/case'
import { Check } from '../Check'
import { clearCheckSession, emptyCheck, emptyPhoto, saveCheckSession } from '../../lib/checkSession'

vi.mock('../../lib/ai', () => ({ getAIStatus: () => Promise.resolve({ ok: false, error: 'offline' }), segmentPhoto: vi.fn() }))

function render() { return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CaseProvider, null, createElement(Check)))) }
afterEach(() => { cleanup(); clearCheckSession(); vi.restoreAllMocks() })
describe('guided Check route', () => {
  it('starts with two photo inputs and disabled continuation, without requiring technical imports', () => {
    const html = render()
    expect(html).toContain('Check an Image')
    expect(html).toContain('Upload original photograph')
    expect(html).toContain('Upload suspicious photograph')
    expect(html).toContain('Continue to Privacy Review')
    expect(html).toContain('disabled=""')
    expect(html).toContain('Advanced Tools')
    expect(html).not.toContain('Import your original scene graph')
    expect(html).not.toContain('src="blob:')
  })
  it('retains the stage and Blind Mode across page unmounts without exposing a suspicious preview', () => {
    saveCheckSession({ ...emptyCheck(), step: 2 })
    const html = render()
    expect(html).toContain('Protect Privacy')
    expect(html).toContain('Keep Blind Mode on')
    expect(html).toContain('Suspicious image concealed')
    expect(html).toContain('Manual Mask')
    expect(html).toContain('People are masked automatically on this device when you continue')
    expect(html.match(/I reviewed this mask and confirm the areas to exclude/g)).toHaveLength(1)
    expect(html.match(/Continue to Feature Review/g)).toHaveLength(1)
    expect(html).not.toContain('Suspicious Photograph for review')
  })
  it('provides manual feature editing and honest empty-result review without a model service', () => {
    saveCheckSession({ ...emptyCheck(), step: 3 })
    const html = render()
    expect(html).toContain('Add detail')
    expect(html).toContain('Undo edit')
    expect(html).toContain('Reset suggestions from images')
    expect(html).toContain('experimental')
  })

  it('requires only the original privacy confirmation and exposes one continue action', async () => {
    saveCheckSession({ ...emptyCheck(), step: 2, original: emptyPhoto(), suspicious: emptyPhoto() })
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    renderApp(createElement(MemoryRouter, { initialEntries: ['/check'] }, createElement(CaseProvider, null, createElement(Check))))
    const confirmations = screen.getAllByLabelText(/I reviewed this mask and confirm the areas to exclude/)
    expect(confirmations).toHaveLength(1)
    expect((confirmations[0] as HTMLInputElement).checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Continue to Feature Review' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(confirmations[0])
    expect((screen.getByRole('button', { name: 'Continue to Feature Review' }) as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getAllByRole('button', { name: 'Continue to Feature Review' })).toHaveLength(1)
    expect(screen.queryByLabelText(/confirm the areas to exclude.*concealed image/i)).toBeNull()
  })
})
