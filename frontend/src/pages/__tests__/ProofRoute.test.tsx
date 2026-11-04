import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { CaseProvider } from '../../components/case'
import { Proof } from '../Proof'

vi.mock('../../components/proof/evidence/EvidenceConnections', () => ({
  default: () => createElement('div', { 'data-testid': 'evidence-connections-mounted' }, 'Simulated 3D evidence visualization'),
}))

describe('Proof route', () => {
  it('invites a guest to start a check and keeps the simulated mode available', () => {
    const html = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ['/proof'] },
      createElement(CaseProvider, null,
        createElement(Routes, null,
          createElement(Route, { path: '/proof', element: createElement(Proof) }),
        ),
      ),
    ))

    expect(html).toContain('id="evidence-connects-title"')
    expect(html).toContain('My Image Comparison')
    expect(html).toContain('Concept Demo')
    expect(html).toContain('Conceptual visualization — simulated data, not reconstructed from uploaded photographs.')
    expect(html).toContain('Simulated 3D evidence visualization')
    expect(html).toContain('No proof is open')
  })
})
