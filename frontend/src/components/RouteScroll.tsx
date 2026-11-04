import { useLayoutEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

type ScrollHost = Pick<Window, 'scrollX' | 'scrollY' | 'scrollTo' | 'addEventListener' | 'removeEventListener' | 'history'>

export function createRouteScroll(host: ScrollHost) {
  const positions = new Map<string, { left: number; top: number }>()
  const previousRestoration = host.history.scrollRestoration
  let activeKey: string | null = null
  host.history.scrollRestoration = 'manual'
  const remember = () => {
    if (activeKey !== null) positions.set(activeKey, { left: host.scrollX, top: host.scrollY })
  }
  host.addEventListener('scroll', remember, { passive: true })
  return {
    navigate(key: string, restore: boolean) {
      activeKey = key
      const target = restore ? positions.get(key) : undefined
      // Explicit instant behavior overrides the app's CSS smooth scrolling.
      // Save on scroll, rather than after route DOM changes can clamp the old position.
      host.scrollTo({ left: target?.left ?? 0, top: target?.top ?? 0, behavior: 'instant' })
      remember()
    },
    dispose() {
      host.removeEventListener('scroll', remember)
      host.history.scrollRestoration = previousRestoration
    },
  }
}

/** Window is the page scroller on both desktop and mobile. */
export function RouteScroll() {
  const { key } = useLocation()
  const navigationType = useNavigationType()
  const manager = useRef<ReturnType<typeof createRouteScroll> | null>(null)
  useLayoutEffect(() => {
    manager.current = createRouteScroll(window)
    return () => { manager.current?.dispose(); manager.current = null }
  }, [])
  useLayoutEffect(() => {
    manager.current?.navigate(key, navigationType === 'POP')
  }, [key, navigationType])
  return null
}
