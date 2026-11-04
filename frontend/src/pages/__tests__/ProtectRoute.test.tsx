import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Protect } from '../Protect'

describe('Protect route', () => {
  it('offers the shield and does not show feature mapping', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Protect)))
    expect(html).toContain('Choose a photograph')
    expect(html).toContain('Apply Protection Shield')
    expect(html).toContain('cannot guarantee')
    expect(html).toContain('not a watermark')
    expect(html).not.toContain('Identify background features')
    expect(html).not.toContain('Suggest background features')
    expect(html).not.toContain('Mark features')
  })
})
