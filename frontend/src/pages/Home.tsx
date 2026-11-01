import { useEffect, useMemo, useRef, useState } from 'react'
import { compareGraphs } from '../lib/align'
import { homeView } from '../lib/homeView'
import { sampleDerivative, sampleMoved, sampleOriginal } from '../lib/samples'
import { RoomLayer } from '../components/RoomScene'
import { Button, usePageTitle, useReducedMotion } from '../components/ui'
import { EvidenceDiagram } from '../components/EvidenceDiagram'

const scenes = [
  { id: 'intro', label: 'Introduction' },
  { id: 'geometry', label: 'Geometry' },
  { id: 'alignment', label: 'Alignment' },
  { id: 'evidence', label: 'Evidence' },
]

export function Home() {
  usePageTitle('Home')
  const reduced = useReducedMotion()
  const layerRef = useRef<HTMLDivElement>(null)
  const [scene, setScene] = useState(0)
  const [slider, setSlider] = useState(0)
  const [look, setLook] = useState(0)
  const [aligning, setAligning] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const edited = useMemo(() => compareGraphs(sampleOriginal, sampleDerivative), [])
  const moved = useMemo(() => compareGraphs(sampleOriginal, sampleMoved), [])
  const showingMoved = slider >= 0.5

  useEffect(() => {
    homeView.reduced = reduced
  }, [reduced])

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== 'mouse') return
      homeView.lookX = (event.clientX / window.innerWidth) * 2 - 1
      homeView.lookY = (event.clientY / window.innerHeight) * 2 - 1
    }
    const onScroll = () => {
      const max = document.documentElement.scrollHeight - window.innerHeight
      homeView.story = max <= 0 ? 0 : window.scrollY / max
      let next = 0
      for (const [index, item] of scenes.entries()) {
        const node = document.getElementById(item.id)
        if (node && node.getBoundingClientRect().top < window.innerHeight * 0.46) next = index
      }
      setScene((current) => (current === next ? current : next))
    }
    const onKey = (event: KeyboardEvent) => {
      const target = event.target
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return
      if (event.key >= '1' && event.key <= '4') {
        document.getElementById(scenes[Number(event.key) - 1].id)?.scrollIntoView({
          behavior: reduced ? 'auto' : 'smooth',
          block: 'start',
        })
      }
    }
    onScroll()
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('keydown', onKey)
      homeView.alignAt = 0
      homeView.holdAlign = false
      homeView.story = 0
    }
  }, [reduced])

  function jump(index: number) {
    document.getElementById(scenes[index].id)?.scrollIntoView({
      behavior: reduced ? 'auto' : 'smooth',
      block: 'start',
    })
  }

  function align() {
    homeView.holdStory = homeView.story
    setConfirm(false)
    if (reduced) {
      homeView.holdAlign = true
      homeView.alignAt = 0
      setConfirm(true)
      return
    }
    homeView.holdAlign = false
    homeView.alignAt = performance.now()
    setAligning(true)
  }

  return (
    <div className="home" data-scene={scene}>
      <p className="sr-only">
        Illustrative room with a bed, window, door, poster, and desk. No people. Not a photograph and not an analysis.
      </p>
      <div className="room-layer" ref={layerRef}>
        <RoomLayer
          layerRef={layerRef}
          active
          aligned={confirm}
          onDone={() => {
            setAligning(false)
            setConfirm(true)
          }}
        />
      </div>
      <nav className="scene-nav" aria-label="Scenes">
        {scenes.map((item, index) => (
          <button key={item.id} className="scene-btn" type="button" aria-current={scene === index ? 'true' : undefined} aria-label={item.label} onClick={() => jump(index)}>
            {String(index + 1).padStart(2, '0')}
          </button>
        ))}
      </nav>
      {scene < 3 && (
        <button className="btn btn-secondary align-btn" type="button" aria-pressed={aligning} onClick={align}>
          {aligning ? 'Aligning' : 'Align viewpoint'}
        </button>
      )}
      {confirm && scene < 3 && (
        <p className="confirm" role="status">
          Reference points meet. Illustrative demonstration — not a photograph analysis.
        </p>
      )}

      <section className="home-scene" id="intro" data-scene-index="0">
        <div className="scene-copy">
          <p className="demo-tag">Illustrative demonstration</p>
          <h1 className="display">Proof without seeing.</h1>
          <p className="lede">Check whether an altered image may have come from your original photo—without exposing the person in it.</p>
          <div className="actions" style={{ marginTop: 22 }}>
            <Button to="/check">Check a suspicious photo</Button>
            <Button to="/protect" variant="secondary">Protect a photo</Button>
          </div>
          <label className="look-control">
            Viewpoint
            <input
              type="range"
              min={-1}
              max={1}
              step={0.01}
              value={look}
              aria-label="Viewpoint"
              onChange={(event) => {
                const value = Number(event.target.value)
                setLook(value)
                homeView.lookTouch = value
              }}
            />
          </label>
        </div>
      </section>

      <section className="home-scene" id="geometry" data-scene-index="1">
        <div className="scene-copy">
          <p className="eyebrow">Geometry</p>
          <h2 className="display display-wide">Every room has a pattern.</h2>
          <p className="lede">Stillpoint compares stable background details rather than relying on your face.</p>
        </div>
      </section>

      <section className="home-scene" id="alignment" data-scene-index="2">
        <div className="scene-copy">
          <p className="eyebrow">Alignment</p>
          <h2 className="display display-wide">Different image. Shared perspective.</h2>
          <p className="lede">
            An edited derivative keeps the camera where it was, so background points stay put. A new photograph of the same room moves those points. The rooms below are a demonstration. The numbers are the sample scene graphs.
          </p>
          <div className="slider-block">
            <div className="slider-ends">
              <span>Edited derivative</span>
              <span>New photograph</span>
            </div>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={slider}
              aria-valuetext={showingMoved ? 'New photograph from another viewpoint' : 'Edited derivative'}
              aria-label="Compare an edited derivative with a new photograph"
              onChange={(event) => {
                const value = Number(event.target.value)
                homeView.slider = value
                homeView.holdAlign = false
                setSlider(value)
              }}
            />
            <p className="lede">
              {showingMoved
                ? 'Sample graph 3 uses the same object names with a moved layout.'
                : 'Sample graph 2 keeps each object almost where graph 1 left it.'}
            </p>
            <p className="num">
              {(showingMoved ? moved : edited).verdict} · {(showingMoved ? moved : edited).agreement_percent.toFixed(1)}% geometric agreement
            </p>
          </div>
        </div>
      </section>

      <section className="home-scene evidence" id="evidence" data-scene-index="3">
        <div className="scene-copy">
          <p className="eyebrow">Evidence</p>
          <h2 className="display display-wide">Evidence without exposure.</h2>
          <p className="lede">Understand what the comparison supports without exposing sensitive imagery.</p>
          <div className="evidence-card">
            <p className="muted">Sample scene graphs shipped with Stillpoint. Not your photographs.</p>
            <EvidenceDiagram
              source={sampleOriginal}
              suspect={sampleDerivative}
              residuals={edited.residuals}
              showLines
              replayKey={1}
              reduced={reduced}
              sourceCaption="Sample original"
              suspectCaption="Sample derivative"
            />
            <p>{edited.verdict}. {edited.aligned_points} of {edited.usable_points} reference points align.</p>
            <p className="display display-wide" style={{ fontSize: 'clamp(2rem, 5vw, 3.2rem)', marginTop: 18 }}>
              Your image. Your decision.
            </p>
            <div className="actions" style={{ marginTop: 16 }}>
              <Button to="/check">Start a private check</Button>
              <Button to="/results?sample=derivative" variant="secondary">View sample measurements</Button>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}
