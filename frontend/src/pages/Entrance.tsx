import { useEffect, useRef, useState } from 'react'
import { Mark, useReducedMotion } from '../components/ui'

export const INTRO_DURATION = 6500
export function Entrance({ onComplete }: { onComplete: () => void }) {
  const [phase, setPhase] = useState<'poster' | 'playing' | 'failed'>('poster')
  const reduced = useReducedMotion()
  const video = useRef<HTMLVideoElement>(null)
  const complete = useRef(onComplete)
  complete.current = onComplete
  const source = import.meta.env.VITE_INTRO_VIDEO_URL?.trim()
  // Only app-hosted assets. No third-party video requests or trackers.
  const videoUrl = source?.startsWith('/') && !source.startsWith('//') && !/[\\\x00-\x20]/.test(source) ? source : null
  useEffect(() => {
    if (phase !== 'playing' || videoUrl) return
    const timer = window.setTimeout(() => complete.current(), reduced ? 700 : INTRO_DURATION)
    return () => window.clearTimeout(timer)
  }, [phase, videoUrl, reduced])
  useEffect(() => {
    if (phase !== 'playing' || !videoUrl) return
    // Bound an unavailable/stalled player; the Continue control always remains available.
    const timer = window.setTimeout(() => setPhase('failed'), 15000)
    return () => window.clearTimeout(timer)
  }, [phase, videoUrl])
  function enter() {
    setPhase('playing')
    if (videoUrl && video.current && !reduced) {
      video.current.currentTime = 0; video.current.muted = true
      void video.current.play().catch(() => setPhase('failed'))
    } else if (videoUrl && reduced) complete.current()
  }
  return <main className={`entrance-screen entrance-${phase}${reduced ? ' entrance-reduced' : ''}`}>
    <div className="entrance-atmosphere" aria-hidden="true" />
    <svg className="entrance-constellation" viewBox="0 0 1000 600" aria-hidden="true"><path d="M170 390 360 210 650 245 820 150M360 210 550 450 650 245" />{[[170,390],[360,210],[650,245],[820,150],[550,450]].map(([x,y],i) => <circle key={i} cx={x} cy={y} r={i === 1 ? 4 : 2.5} />)}</svg>
    {videoUrl && <video ref={video} className="entrance-video" src={videoUrl} preload="none" muted playsInline onEnded={() => { if (phase === 'playing') complete.current() }} onError={() => { if (phase === 'playing') setPhase('failed') }} aria-label="Stillpoint introduction" />}
    <section className="entrance-content" aria-labelledby="entrance-title">
      <div className="entrance-mark"><Mark size={66} /></div><p className="entrance-wordmark" id="entrance-title">Stillpoint</p>
      <h1>Proof without seeing.</h1>
      {phase === 'poster' && <><p className="entrance-caption">A quieter way to examine what remains.</p><button type="button" className="btn btn-primary entrance-enter" onClick={enter}>Continue <span aria-hidden="true">↗</span></button></>}
      {phase === 'playing' && <p className="entrance-caption" role="status">Background details. Measured connections. A clearer perspective.</p>}
      {phase === 'failed' && <><p role="status">The introduction could not play. You can continue.</p><button className="btn btn-primary" onClick={() => complete.current()}>Continue</button></>}
    </section>
    {phase === 'playing' && <button className="btn btn-ghost entrance-skip" onClick={() => { video.current?.pause(); complete.current() }}>Skip Intro</button>}
    <p className="entrance-footer">Privacy by choice. Evidence with limits.</p>
  </main>
}
