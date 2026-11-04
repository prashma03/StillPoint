import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { getProofMedia } from '../../../lib/checkSession'
import type { CaseRecord, ImageCorrespondence } from '../../../lib/types'
import { useReducedMotion } from '../../ui'
import styles from './EvidenceConnections.module.css'

const DURATION_MS = 24_000
const PLANE_W = 2.35
const OFFSET = 1.72

const phases = [
  { title: 'Scene introduction', caption: 'The two photographs enter the view.', detail: 'The planes are a presentation of the images. Their depth is not measured room geometry.' },
  { title: 'Feature detection', caption: 'Detected corners illuminate.', detail: 'Every point is a Harris corner kept from the analysis, or a reviewed pair.' },
  { title: 'Candidate correspondences', caption: 'Patch matches connect in amber.', detail: 'These pairs agreed by descriptor distance. They are not verified yet.' },
  { title: 'Geometric verification', caption: 'A homography keeps the consistent pairs.', detail: 'Cyan pairs fit the same 2D image-plane map. Coral pairs do not.' },
  { title: 'Final evidence', caption: 'Verified correspondences remain.', detail: 'A homography can support shared scene structure. It does not prove manipulation, identity, or consent.' },
]

function phaseIndex(progress: number) { return Math.min(4, Math.floor(progress * 5)) }

function useBlobTexture(blob: Blob | null) {
  const [texture, setTexture] = useState<THREE.Texture | null>(null)
  const [aspect, setAspect] = useState(0.72)
  useEffect(() => {
    if (!blob) { setTexture(null); return }
    const url = URL.createObjectURL(blob)
    const image = new Image()
    let cancelled = false
    let map: THREE.Texture | null = null
    image.onload = () => {
      if (cancelled) return
      map = new THREE.Texture(image)
      map.colorSpace = THREE.SRGBColorSpace
      map.needsUpdate = true
      setAspect(image.naturalWidth ? image.naturalHeight / image.naturalWidth : 0.72)
      setTexture(map)
    }
    image.src = url
    return () => {
      cancelled = true
      URL.revokeObjectURL(url)
      map?.dispose()
    }
  }, [blob])
  return { texture, aspect }
}

function planePoint(u: number, v: number, height: number): [number, number, number] {
  return [(u - 0.5) * PLANE_W, (0.5 - v) * height, 0.03]
}

function PhotoPlane({ side, texture, aspect, progress }: { side: 'left' | 'right'; texture: THREE.Texture | null; aspect: number; progress: number }) {
  const material = useRef<THREE.MeshBasicMaterial>(null)
  const height = PLANE_W * aspect
  useFrame(() => {
    const intro = THREE.MathUtils.smoothstep(progress, 0, 0.18)
    if (material.current) material.current.opacity = 0.25 + intro * 0.75
  })
  return <mesh position={[side === 'left' ? -OFFSET : OFFSET, 0, 0]} scale={[1, 1, 1]}>
    <planeGeometry args={[PLANE_W, height]} />
    <meshBasicMaterial ref={material} map={texture ?? undefined} color={texture ? '#ffffff' : '#152232'} transparent opacity={1} toneMapped={false} />
  </mesh>
}

function EvidenceCloud({ fit, progress, aspects, selected }: { fit: ImageCorrespondence; progress: number; aspects: [number, number]; selected: string | null }) {
  const points = useRef<THREE.Points>(null)
  const lines = useRef<THREE.LineSegments>(null)
  const shown = useMemo(() => {
    const ordered = [...fit.matches.filter((match) => match.status === 'verified'), ...fit.matches.filter((match) => match.status !== 'verified')]
    return ordered.slice(0, fit.renderedLimit)
  }, [fit])
  const geometry = useMemo(() => {
    const leftH = PLANE_W * aspects[0]
    const rightH = PLANE_W * aspects[1]
    const extras = [...fit.unmatchedSource.map((point) => ({ side: 'source' as const, ...point })), ...fit.unmatchedSuspect.map((point) => ({ side: 'suspect' as const, ...point }))]
    const count = shown.length * 2 + extras.length
    const positions = new Float32Array(Math.max(1, count) * 3)
    const colors = new Float32Array(Math.max(1, count) * 3)
    const linePositions = new Float32Array(Math.max(1, shown.length) * 6)
    const lineColors = new Float32Array(Math.max(1, shown.length) * 6)
    shown.forEach((match, index) => {
      const left = planePoint(match.sourceX, match.sourceY, leftH)
      const right = planePoint(match.suspectX, match.suspectY, rightH)
      left[0] -= OFFSET
      right[0] += OFFSET
      positions.set(left, index * 6)
      positions.set(right, index * 6 + 3)
      linePositions.set([...left, ...right], index * 6)
    })
    extras.forEach((point, index) => {
      const placed = planePoint(point.x, point.y, point.side === 'source' ? leftH : rightH)
      placed[0] += point.side === 'source' ? -OFFSET : OFFSET
      positions.set(placed, (shown.length * 2 + index) * 3)
    })
    const pointsGeometry = new THREE.BufferGeometry()
    pointsGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    pointsGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    const lineGeometry = new THREE.BufferGeometry()
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3))
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3))
    return { pointsGeometry, lineGeometry, extraCount: extras.length }
  }, [aspects, fit.unmatchedSource, fit.unmatchedSuspect, shown])

  useEffect(() => () => {
    geometry.pointsGeometry.dispose()
    geometry.lineGeometry.dispose()
  }, [geometry])

  useFrame(() => {
    const stage = phaseIndex(progress)
    const local = progress * 5 - stage
    const pointAttribute = geometry.pointsGeometry.getAttribute('color') as THREE.BufferAttribute
    const pointColors = pointAttribute.array as Float32Array
    const featureWave = stage === 0 ? 0 : stage === 1 ? local : 1
    const visiblePoints = Math.ceil(shown.length * featureWave)
    const cyan = new THREE.Color('#50DDE8')
    const amber = new THREE.Color('#F3B75E')
    const coral = new THREE.Color('#E47C83')
    const slate = new THREE.Color('#8ea4b8')
    const paint = (offset: number, color: THREE.Color, alpha: number) => {
      pointColors[offset] = color.r * alpha
      pointColors[offset + 1] = color.g * alpha
      pointColors[offset + 2] = color.b * alpha
    }
    shown.forEach((match, index) => {
      const selectedPoint = selected === match.name
      const color = stage < 3 ? amber : match.status === 'verified' ? cyan : match.status === 'rejected' ? coral : amber
      const alpha = index < visiblePoints ? (selectedPoint ? 1 : match.status === 'rejected' && stage >= 4 ? 0.28 : 0.95) : 0
      paint(index * 6, color, alpha)
      paint(index * 6 + 3, color, alpha)
    })
    const extraWave = stage < 1 ? 0 : stage === 1 ? local : 1
    for (let index = 0; index < geometry.extraCount; index += 1) {
      paint((shown.length * 2 + index) * 3, slate, index < geometry.extraCount * extraWave ? 0.75 : 0)
    }
    pointAttribute.needsUpdate = true
    const lineAttribute = geometry.lineGeometry.getAttribute('color') as THREE.BufferAttribute
    const lineColors = lineAttribute.array as Float32Array
    shown.forEach((match, index) => {
      const color = stage < 3 ? amber : match.status === 'verified' ? cyan : coral
      const dim = match.status === 'rejected' && stage >= 4 ? 0.35 : 1
      for (let end = 0; end < 2; end += 1) {
        lineColors[index * 6 + end * 3] = color.r * dim
        lineColors[index * 6 + end * 3 + 1] = color.g * dim
        lineColors[index * 6 + end * 3 + 2] = color.b * dim
      }
    })
    lineAttribute.needsUpdate = true
    const lineCount = stage < 2 ? 0 : stage === 2 ? Math.ceil(shown.length * local) : shown.length
    lines.current?.geometry.setDrawRange(0, lineCount * 2)
  })

  return <>
    <points ref={points} geometry={geometry.pointsGeometry}>
      <pointsMaterial size={0.045} sizeAttenuation vertexColors transparent depthWrite={false} toneMapped={false} />
    </points>
    <lineSegments ref={lines} geometry={geometry.lineGeometry}>
      <lineBasicMaterial vertexColors transparent depthWrite={false} toneMapped={false} />
    </lineSegments>
  </>
}

function CameraRig({ progress, manual }: { progress: number; manual: boolean }) {
  const { camera, gl } = useThree()
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  useEffect(() => {
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 2.4
    controls.maxDistance = 9
    controls.maxPolarAngle = Math.PI * 0.48
    const orbit = (event: Event) => {
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), (event as CustomEvent<number>).detail)
      camera.position.copy(controls.target).add(offset)
      controls.update()
    }
    const zoom = (event: Event) => {
      camera.position.copy(controls.target).add(camera.position.clone().sub(controls.target).multiplyScalar((event as CustomEvent<number>).detail))
      controls.update()
    }
    window.addEventListener('stillpoint-orbit', orbit)
    window.addEventListener('stillpoint-zoom', zoom)
    return () => {
      window.removeEventListener('stillpoint-orbit', orbit)
      window.removeEventListener('stillpoint-zoom', zoom)
      controls.dispose()
    }
  }, [camera, controls])
  useFrame((_, delta) => {
    if (!manual) {
      const pose = new THREE.Vector3(Math.sin(progress * 0.7) * 0.8, 0.35 + progress * 0.15, 5.6 - progress * 0.45)
      camera.position.lerp(pose, 1 - Math.exp(-delta * 1.4))
      controls.target.lerp(new THREE.Vector3(0, 0, 0), 1 - Math.exp(-delta * 1.4))
    }
    controls.update()
  })
  return null
}

class Boundary extends Component<{ children: ReactNode; fit: ImageCorrespondence }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, _info: ErrorInfo) { console.error('Image evidence could not render:', error) }
  render() {
    if (this.state.failed) return <StaticFit fit={this.props.fit} />
    return this.props.children
  }
}

function StaticFit({ fit }: { fit: ImageCorrespondence }) {
  const verified = fit.matches.filter((match) => match.status === 'verified').slice(0, 24)
  return <svg viewBox="0 0 760 240" role="img" aria-label="Two image planes with measured correspondences">
    <rect x="40" y="30" width="280" height="180" fill="#152232" stroke="#7091aa" />
    <rect x="440" y="30" width="280" height="180" fill="#152232" stroke="#7091aa" />
    {verified.map((match) => <line key={match.name} x1={40 + match.sourceX * 280} y1={30 + match.sourceY * 180} x2={440 + match.suspectX * 280} y2={30 + match.suspectY * 180} stroke="#50DDE8" />)}
  </svg>
}

export function ImageEvidence({ record }: { record: CaseRecord }) {
  const fit = record.correspondence
  const reduced = useReducedMotion()
  const media = getProofMedia(record.id)
  const [view, setView] = useState(false)
  const [playing, setPlaying] = useState(() => typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [progress, setProgress] = useState(() => (typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0))
  const [manual, setManual] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [presenting, setPresenting] = useState(false)
  const stageRef = useRef<HTMLElement>(null)
  const revealSuspicious = Boolean(media && (!media.blind || view))
  const original = useBlobTexture(media?.original ?? null)
  const suspicious = useBlobTexture(revealSuspicious ? media?.suspicious ?? null : null)
  const phase = phaseIndex(progress)
  const selectable = (fit?.matches ?? []).filter((match) => match.status === 'verified').slice(0, 8)
  const selectedMatch = fit?.matches.find((match) => match.name === selected) ?? selectable[0] ?? null
  const rendered = Math.min(fit?.matches.length ?? 0, fit?.renderedLimit ?? 0)

  useEffect(() => {
    if (!playing || reduced) return
    let frame = 0
    let published = performance.now()
    const tick = (now: number) => {
      if (now - published >= 33) {
        const elapsed = now - published
        published = now
        setProgress((value) => Math.min(1, value + elapsed / DURATION_MS))
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, reduced])
  useEffect(() => { if (progress >= 1) setPlaying(false) }, [progress])
  useEffect(() => {
    const update = () => setPresenting(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  if (!fit) return null
  const insufficient = fit.candidates < 4 || !fit.matrix

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.()
      else await stageRef.current?.requestFullscreen?.()
    } catch (error) {
      console.error('Fullscreen presentation could not start:', error)
    }
  }

  return <section className={styles.stage} ref={stageRef} aria-label="Image correspondence visualization">
    <div className={styles.viewport}>
      <div className={styles.hud}>
        <span>Measured image correspondences · 2.5D presentation</span>
        <span>Drag to orbit · scroll or use controls to zoom</span>
      </div>
      <div className={`${styles.sceneLabel} ${styles.sceneOriginal}`}>ORIGINAL PHOTOGRAPH</div>
      <div className={`${styles.sceneLabel} ${styles.sceneCompared}`}>{revealSuspicious ? 'SUSPECTED PHOTOGRAPH' : 'SUSPECTED PHOTOGRAPH CONCEALED'}</div>
      <Boundary fit={fit}>
        <Canvas className={styles.canvas} camera={{ position: [0, 0.4, 5.8], fov: 35, near: 0.1, far: 40 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.setClearColor('#080e16', 1) }}>
          <ambientLight intensity={0.8} />
          <PhotoPlane side="left" texture={original.texture} aspect={original.aspect} progress={progress} />
          <PhotoPlane side="right" texture={suspicious.texture} aspect={suspicious.aspect} progress={progress} />
          <EvidenceCloud fit={fit} progress={progress} aspects={[original.aspect, suspicious.aspect]} selected={selectedMatch?.name ?? null} />
          <CameraRig progress={progress} manual={manual} />
        </Canvas>
      </Boundary>
    </div>
    {media?.blind && <label className="checkline"><input type="checkbox" checked={view} onChange={(event) => setView(event.target.checked)} /><span>I choose to view the redacted suspicious photograph. Areas outside the privacy cover may still be sensitive.</span></label>}
    <div className={styles.explanation} aria-live="polite">
      <div className={styles.phaseCopy}>
        <span className={styles.phaseKicker}>PHASE 0{phase + 1} / 05 · {phases[phase].title.toUpperCase()}</span>
        <h3>{insufficient && phase >= 3 ? 'Not enough consistent matches for a homography.' : phases[phase].caption}</h3>
        <p>{insufficient && phase >= 3 ? 'The pairs stay unverified. Stillpoint does not substitute simulated matches.' : phases[phase].detail}</p>
      </div>
      <div className={styles.progressMeta}><strong>{Math.round(progress * 100)}%</strong><span>{rendered} of {fit.matches.length} correspondences drawn</span></div>
    </div>
    <div className={styles.phasebar} aria-label="Five phases of the image comparison">
      {phases.map((item, index) => <div className={index === phase ? styles.phaseActive : styles.phase} aria-current={index === phase ? 'step' : undefined} key={item.title}><b>0{index + 1}</b>{item.title}</div>)}
    </div>
    <div className={styles.controls}>
      <button type="button" className={styles.primary} disabled={reduced} onClick={() => setPlaying((value) => !value)}>{reduced ? 'Reduced motion' : playing ? 'Pause' : 'Play'}</button>
      <button type="button" onClick={() => { setProgress(reduced ? 1 : 0); setPlaying(!reduced); setManual(false) }}>Replay</button>
      <button type="button" onClick={() => setManual((value) => !value)} aria-pressed={manual}>{manual ? 'Camera manual' : 'Camera auto'}</button>
      <button type="button" aria-label="Rotate scene left" onClick={() => { setManual(true); window.dispatchEvent(new CustomEvent('stillpoint-orbit', { detail: Math.PI / 12 })) }}>Orbit left</button>
      <button type="button" aria-label="Rotate scene right" onClick={() => { setManual(true); window.dispatchEvent(new CustomEvent('stillpoint-orbit', { detail: -Math.PI / 12 })) }}>Orbit right</button>
      <button type="button" aria-label="Zoom in" onClick={() => window.dispatchEvent(new CustomEvent('stillpoint-zoom', { detail: 0.86 }))}>Zoom in</button>
      <button type="button" aria-label="Zoom out" onClick={() => window.dispatchEvent(new CustomEvent('stillpoint-zoom', { detail: 1.16 }))}>Zoom out</button>
      <button type="button" onClick={() => void toggleFullscreen()}>{presenting ? 'Exit fullscreen' : 'Fullscreen'}</button>
      <label className={styles.timeline}>Scrub the sequence <input aria-label="Scrub the image correspondence sequence" type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)) }} /></label>
    </div>
    <div className={styles.bottom}>
      <div className={styles.panel}><h3>Inspect a verified pair</h3>
        <div className={styles.featureButtons}>{selectable.map((match) => <button type="button" aria-pressed={selectedMatch?.name === match.name} key={match.name} onClick={() => setSelected(match.name)}>{match.name}</button>)}</div>
        <p>{selectedMatch ? `${selectedMatch.name}: original (${selectedMatch.sourceX.toFixed(3)}, ${selectedMatch.sourceY.toFixed(3)}), suspected (${selectedMatch.suspectX.toFixed(3)}, ${selectedMatch.suspectY.toFixed(3)}). ${selectedMatch.status}. ${selectedMatch.errorPx == null ? 'No reprojection error.' : `Reprojection ${selectedMatch.errorPx.toFixed(2)} px.`}` : 'No reviewed pair is available to inspect.'}</p>
      </div>
      <div className={styles.panel}><h3>Measured counts</h3>
        <p>Original corners retained: {fit.sourceFeatures}. Suspected corners retained: {fit.suspectFeatures}. Patch candidates: {fit.candidates}. Verified: {fit.verified}. Rejected: {fit.rejected}.</p>
        <p>Mean verified error: {fit.meanVerifiedErrorPx == null ? 'not available' : `${fit.meanVerifiedErrorPx.toFixed(2)} px`} at a {fit.thresholdPx} px threshold. Model: {fit.model}.</p>
        <p className={styles.hint}>{rendered < fit.matches.length ? `Drawing ${rendered} of ${fit.matches.length} correspondences. The counts above are the full analysis.` : 'Every reviewed correspondence is drawn.'} {fit.limitation}</p>
      </div>
    </div>
  </section>
}
