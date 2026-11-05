import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EvidenceDiagram } from './EvidenceDiagram'

const residual = [{ name: 'detail 1', distance: 0, dx: 0, dy: 0, aligned: true }]
const source = { room_objects: [{ name: 'Detail 1', x: 260, y: 340, width: 0, height: 0 }] }
const suspect = { room_objects: [{ name: 'DETAIL 1', x: 270, y: 350, width: 0, height: 0 }] }

describe('EvidenceDiagram', () => {
  it('draws valid pairs even when scene point names differ by case', () => {
    const html = renderToStaticMarkup(<EvidenceDiagram source={source} suspect={suspect} residuals={residual} showLines replayKey="case" reduced sourceCaption="Original details" suspectCaption="Compared details" />)
    expect(html).toContain('<svg')
    expect(html).toContain('<line')
    expect(html.match(/<circle/g)?.length).toBeGreaterThanOrEqual(4)
    expect(html).toContain('detail 1: residual 0.00')
  })

  it('replaces an empty plotting area with a clear explanation', () => {
    const html = renderToStaticMarkup(<EvidenceDiagram source={{ room_objects: [] }} suspect={{ room_objects: [] }} residuals={[]} showLines replayKey="empty" reduced sourceCaption="Original details" suspectCaption="Compared details" />)
    expect(html).toContain('No paired details to visualize')
    expect(html).not.toContain('<svg')
  })
})
