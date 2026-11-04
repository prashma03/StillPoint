import { describe, expect, it, vi } from 'vitest'
import { createRouteScroll } from './RouteScroll'

function setup() {
  let onScroll = () => {}
  const host = {
    scrollX: 0, scrollY: 0,
    history: { scrollRestoration: 'auto' },
    addEventListener: vi.fn((_name, callback) => { onScroll = callback }),
    removeEventListener: vi.fn(),
    scrollTo: vi.fn((position: ScrollToOptions) => { host.scrollX = position.left ?? 0; host.scrollY = position.top ?? 0 }),
  }
  const manager = createRouteScroll(host as unknown as Window)
  const scroll = (top: number) => { host.scrollY = top; onScroll() }
  return { host, manager, scroll }
}

describe('route scroll management', () => {
  it('starts every new page at the top, overriding CSS smooth scroll', () => {
    const { host, manager, scroll } = setup()
    for (const page of ['/proof', '/check', '/protect', '/trust', '/', '/discover', '/settings']) {
      scroll(900)
      manager.navigate(page, false)
      expect(host.scrollY).toBe(0)
      expect(host.scrollTo).toHaveBeenLastCalledWith({ left: 0, top: 0, behavior: 'instant' })
    }
  })

  it('restores independent Back/Forward entries, including repeated visits to one page', () => {
    const { host, manager, scroll } = setup()
    manager.navigate('proof-1', false); scroll(720)
    manager.navigate('check-1', false); scroll(230)
    manager.navigate('proof-2', false); scroll(400)
    manager.navigate('check-1', true)
    expect(host.scrollY).toBe(230)
    manager.navigate('proof-1', true)
    expect(host.scrollY).toBe(720)
    manager.navigate('proof-2', true)
    expect(host.scrollY).toBe(400)
  })

  it('preserves the outgoing position even if the new DOM clamps window scrolling', () => {
    const { host, manager, scroll } = setup()
    manager.navigate('proof', false); scroll(1200)
    host.scrollY = 0 // A shorter incoming page has been committed.
    manager.navigate('check', false)
    manager.navigate('proof', true)
    expect(host.scrollY).toBe(1200)
  })

  it('uses manual restoration only while mounted and handles unknown history entries', () => {
    const { host, manager } = setup()
    expect(host.history.scrollRestoration).toBe('manual')
    manager.navigate('unknown', true)
    expect(host.scrollY).toBe(0)
    manager.dispose()
    expect(host.history.scrollRestoration).toBe('auto')
    expect(host.removeEventListener).toHaveBeenCalledWith('scroll', host.addEventListener.mock.calls[0][1])
  })
})
