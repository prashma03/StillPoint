import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { App } from '../../App'

vi.mock('../../components/proof/evidence/EvidenceConnections', () => ({
  default: () => createElement('div', { 'data-testid': 'evidence-connections-mounted' }, 'Simulated 3D evidence visualization'),
}))

describe('Proof route', () => {
  it('renders Evidence Connections for a guest with no saved comparison', () => {
    const html = renderToStaticMarkup(createElement(
      MemoryRouter,
      { initialEntries: ['/proof'] },
      createElement(App),
    ))

    expect(html).toContain('id="evidence-connects-title"')
    expect(html).toContain('data-testid="evidence-connections-mounted"')
    expect(html).toContain('Simulated 3D evidence visualization')
    expect(html).toContain('No proof is open')
  })
})
