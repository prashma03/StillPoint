import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { CaseProvider } from '../../components/case'
import { Check } from '../Check'
import { clearCheckSession, emptyCheck, saveCheckSession } from '../../lib/checkSession'

function render() { return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(CaseProvider, null, createElement(Check)))) }
afterEach(clearCheckSession)
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
    expect(html).toContain('Add privacy cover')
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
})
