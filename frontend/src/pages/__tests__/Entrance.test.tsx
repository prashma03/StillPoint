// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Entrance, INTRO_DURATION } from '../Entrance'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
})
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })
describe('cinematic entrance', () => {
  it('does nothing until Continue, then completes the real CSS timeline', () => {
    const done = vi.fn(); const { container } = render(<Entrance onComplete={done} />)
    act(() => vi.advanceTimersByTime(20000))
    expect(done).not.toHaveBeenCalled()
    expect(container.querySelector('.entrance-playing')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(container.querySelector('.entrance-playing')).not.toBeNull()
    act(() => vi.advanceTimersByTime(INTRO_DURATION))
    expect(done).toHaveBeenCalledOnce()
  })
  it('lets users skip immediately and cancels the timer on unmount', () => {
    const done = vi.fn(), view = render(<Entrance onComplete={done} />)
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Skip Intro' }))
    expect(done).toHaveBeenCalledOnce(); view.unmount()
    act(() => vi.advanceTimersByTime(20000)); expect(done).toHaveBeenCalledOnce()
  })
  it('never autoplays a configured video and starts it from zero on Continue', () => {
    vi.stubEnv('VITE_INTRO_VIDEO_URL', '/media/test-intro.mp4')
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const { container } = render(<Entrance onComplete={vi.fn()} />)
    const video = container.querySelector('video')!
    expect(video.autoplay).toBe(false); expect(video.preload).toBe('none'); expect(video.muted).toBe(true)
    expect(play).not.toHaveBeenCalled(); video.currentTime = 3
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(play).toHaveBeenCalledOnce(); expect(video.currentTime).toBe(0)
  })
  it('provides Continue on player failure, and finishes on ended', () => {
    vi.stubEnv('VITE_INTRO_VIDEO_URL', '/media/test-intro.mp4')
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const done = vi.fn(), { container } = render(<Entrance onComplete={done} />)
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.error(container.querySelector('video')!)
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    expect(done).toHaveBeenCalledOnce()
  })
  it('respects reduced motion without starting video playback', () => {
    vi.stubEnv('VITE_INTRO_VIDEO_URL', '/media/test-intro.mp4')
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(), done = vi.fn()
    render(<Entrance onComplete={done} />)
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    expect(play).not.toHaveBeenCalled(); expect(done).toHaveBeenCalledOnce()
  })
  it('transitions only when a user-started video ends', () => {
    vi.stubEnv('VITE_INTRO_VIDEO_URL', '/media/test-intro.mp4')
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue()
    const done = vi.fn(), { container } = render(<Entrance onComplete={done} />)
    fireEvent.ended(container.querySelector('video')!); expect(done).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /Continue/ }))
    fireEvent.ended(container.querySelector('video')!); expect(done).toHaveBeenCalledOnce()
  })
})
