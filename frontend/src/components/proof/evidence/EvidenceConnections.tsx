import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { useReducedMotion } from '../../ui'
import { buildSimPairs, makeRoom, type RoomData, type SimPair } from './roomGeometry'
import styles from './EvidenceConnections.module.css'

const DURATION_MS = 28_000
const ROOM_OFFSET = 3.05
const LINE_LIMIT = 560

const phases = [
  { title: 'Scene initialization', caption: 'Two separate rooms are ready to compare.', detail: 'The point shapes show surfaces, edges, and familiar objects in each scene.' },
  { title: 'Feature identification', caption: 'Identifying distinctive background features.', detail: 'Window corners, the door frame, and furniture edges light up as useful landmarks.' },
  { title: 'Correspondence discovery', caption: 'Comparing spatial relationships.', detail: 'Matching structural landmarks connect across the two scenes.' },
  { title: 'Geometric alignment', caption: 'Checking whether the room structures align.', detail: 'The compared scene moves into place while consistent features stay highlighted.' },
  { title: 'Evidence explanation', caption: 'Consistent scene geometry can support a relationship between images.', detail: 'Scene correspondence alone does not establish identity, ownership, consent, or manipulation.' },
]

function phaseIndex(progress: number) { return Math.min(4, Math.floor(progress * 5)) }
function phaseAmount(progress: number) { const local = progress * 5 - phaseIndex(progress); return THREE.MathUtils.clamp(local, 0, 1) }
function alignmentAmount(progress: number) { return THREE.MathUtils.smoothstep(progress, 0.6, 0.82) }
function comparedOffset(progress: number) { return THREE.MathUtils.lerp(ROOM_OFFSET, -ROOM_OFFSET, alignmentAmount(progress)) }

function Cloud({ room, variant, progress, selected, wireframe, reduced }: {
  room: RoomData
  variant: boolean
  progress: number
  selected: number
  wireframe: boolean
  reduced: boolean
}) {
  const group = useRef<THREE.Group>(null)
  const points = useRef<THREE.Points>(null)
  const markedCount = useRef(-1)
  const lastSelected = useRef(-1)
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(room.positions, 3))
    buffer.setAttribute('color', new THREE.BufferAttribute(new Float32Array(room.colors), 3))
    return buffer
  }, [room])
  const featureIndices = useMemo(() => room.features.map((feature) => feature.index), [room])
  const selectedPosition: [number, number, number] = [room.positions[selected * 3] ?? 0, room.positions[selected * 3 + 1] ?? 0, room.positions[selected * 3 + 2] ?? 0]

  useFrame(() => {
    if (variant && group.current) {
      group.current.position.x = comparedOffset(progress)
      group.current.rotation.y = THREE.MathUtils.lerp(0.045, 0, alignmentAmount(progress))
    }
    const identification = progress <= 0.2 ? 0 : progress >= 0.4 ? 1 : (progress - 0.2) / 0.2
    const count = Math.floor(featureIndices.length * identification)
    if ((count !== markedCount.current || selected !== lastSelected.current) && points.current) {
      const attribute = geometry.getAttribute('color') as THREE.BufferAttribute
      const array = attribute.array as Float32Array
      const base = room.colors
      for (let i = 0; i < featureIndices.length; i += 1) {
        const index = featureIndices[i]
        const lit = i < count
        const selectedPoint = index === selected && progress >= 0.2
        const multiplier = selectedPoint ? 1.8 : lit ? 1.38 : 0.78
        array[index * 3] = Math.min(1, base[index * 3] * multiplier)
        array[index * 3 + 1] = Math.min(1, base[index * 3 + 1] * multiplier)
        array[index * 3 + 2] = Math.min(1, base[index * 3 + 2] * multiplier)
      }
      attribute.needsUpdate = true
      markedCount.current = count
      lastSelected.current = selected
    }
  })

  return <group ref={group} position={[variant ? comparedOffset(progress) : -ROOM_OFFSET, 0, 0]}>
    <points ref={points} geometry={geometry}>
      <pointsMaterial size={0.027} sizeAttenuation vertexColors transparent opacity={0.96} depthWrite={false} toneMapped={false} />
    </points>
    {wireframe && <Wireframe room={room} />}
    {progress >= 0.2 && <FeatureMarker position={selectedPosition} reduced={reduced} />}
  </group>
}

function Wireframe({ room }: { room: RoomData }) {
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(room.wireframe, 3))
    return buffer
  }, [room])
  return <lineSegments geometry={geometry}><lineBasicMaterial color="#71b8d0" transparent opacity={0.42} depthWrite={false} toneMapped={false} /></lineSegments>
}

function FeatureMarker({ position, reduced }: { position: [number, number, number]; reduced: boolean }) {
  const marker = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (marker.current && !reduced) marker.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3.2) * 0.16)
  })
  return <mesh ref={marker} position={position}>
    <sphereGeometry args={[0.085, 14, 14]} />
    <meshBasicMaterial color="#b9fff5" toneMapped={false} />
  </mesh>
}

function Connections({ source, target, pairs, progress, reduced }: {
  source: RoomData
  target: RoomData
  pairs: SimPair[]
  progress: number
  reduced: boolean
}) {
  const subtle = useRef<THREE.LineSegments>(null)
  const primary = useRef<THREE.LineSegments>(null)
  const allPairs = useMemo(() => pairs.slice(0, LINE_LIMIT), [pairs])
  const keyPairs = useMemo(() => allPairs.filter((pair) => pair.strong).slice(0, 20), [allPairs])
  const makeGeometry = useCallback((subset: SimPair[]) => {
    const coordinates = new Float32Array(subset.length * 6)
    const colors = new Float32Array(subset.length * 6)
    const quiet = new THREE.Color('#69a9bd')
    const bright = new THREE.Color('#c2fff4')
    subset.forEach((pair, i) => {
      const left = pair.leftIndex * 3
      const right = pair.rightIndex * 3
      coordinates.set([source.positions[left] - ROOM_OFFSET, source.positions[left + 1], source.positions[left + 2], target.positions[right] + ROOM_OFFSET, target.positions[right + 1], target.positions[right + 2]], i * 6)
      const color = pair.strong ? bright : quiet
      colors.set([color.r,color.g,color.b,color.r,color.g,color.b], i * 6)
    })
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(coordinates, 3))
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return geometry
  }, [source, target])
  const allGeometry = useMemo(() => makeGeometry(allPairs), [allPairs, makeGeometry])
  const keyGeometry = useMemo(() => makeGeometry(keyPairs), [keyPairs, makeGeometry])

  useFrame(() => {
    const rightOffset = comparedOffset(progress)
    for (const [ref, subset] of [[subtle, allPairs], [primary, keyPairs]] as const) {
      const object = ref.current
      if (!object) continue
      const attribute = object.geometry.getAttribute('position') as THREE.BufferAttribute
      const values = attribute.array as Float32Array
      subset.forEach((pair, i) => { values[i * 6 + 3] = target.positions[pair.rightIndex * 3] + rightOffset })
      attribute.needsUpdate = true
    }
    const stage = phaseIndex(progress)
    const local = phaseAmount(progress)
    const shown = stage < 2 ? 0 : stage === 2 ? Math.max(1, Math.floor(allPairs.length * local)) : stage === 4 ? Math.min(24, allPairs.length) : allPairs.length
    if (subtle.current) {
      subtle.current.geometry.setDrawRange(0, shown * 2)
      const material = subtle.current.material as THREE.LineBasicMaterial
      material.opacity = stage === 4 ? 0.13 : 0.34
    }
    if (primary.current) {
      const count = stage < 2 ? 0 : stage === 2 ? Math.min(keyPairs.length, Math.max(1, Math.floor(keyPairs.length * local))) : keyPairs.length
      primary.current.geometry.setDrawRange(0, count * 2)
      const material = primary.current.material as THREE.LineBasicMaterial
      material.opacity = stage === 4 ? 0.82 : 0.92
    }
    if (reduced && progress === 0) {
      subtle.current?.geometry.setDrawRange(0, 0)
      primary.current?.geometry.setDrawRange(0, 0)
    }
  })

  return <>
    <lineSegments ref={subtle} geometry={allGeometry}><lineBasicMaterial vertexColors transparent opacity={0.34} depthWrite={false} toneMapped={false} /></lineSegments>
    <lineSegments ref={primary} geometry={keyGeometry}><lineBasicMaterial vertexColors transparent opacity={0.92} depthWrite={false} toneMapped={false} /></lineSegments>
  </>
}

function cameraPose(progress: number) {
  const stops: [number, [number,number,number], [number,number,number]][] = [
    [0, [0,3.4,11.8], [0,1.25,0]], [0.2, [0,3.0,10.8], [0,1.2,0]],
    [0.4, [0,4.7,14.3], [0,1.35,0]], [0.6, [0,4.0,12.2], [0,1.25,0]],
    [0.82, [0,3.7,11.6], [-3.0,1.3,0]], [1, [0,3.4,10.8], [-3.05,1.25,0]],
  ]
  let index = stops.findIndex(([time]) => time >= progress)
  if (index < 1) index = 1
  const [t1, p1, target1] = stops[index]
  const [t0, p0, target0] = stops[index - 1]
  const t = THREE.MathUtils.smoothstep(progress, t0, t1)
  return { position: new THREE.Vector3().fromArray(p0).lerp(new THREE.Vector3().fromArray(p1), t), target: new THREE.Vector3().fromArray(target0).lerp(new THREE.Vector3().fromArray(target1), t) }
}

function CameraControls({ progress, manual, resetKey, onManual }: { progress: number; manual: boolean; resetKey: number; onManual: () => void }) {
  const { camera, gl } = useThree()
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  const progressRef = useRef(progress)
  useEffect(() => { progressRef.current = progress }, [progress])
  useEffect(() => {
    controls.enableDamping = true
    controls.dampingFactor = 0.065
    controls.minDistance = 7
    controls.maxDistance = 19
    controls.maxPolarAngle = Math.PI * 0.49
    const takeControl = () => onManual()
    const orbit = (event: Event) => {
      takeControl()
      const angle = (event as CustomEvent<number>).detail
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0,1,0), angle)
      camera.position.copy(controls.target).add(offset)
      controls.update()
    }
    const zoom = (event: Event) => {
      takeControl()
      const scale = (event as CustomEvent<number>).detail
      camera.position.copy(controls.target).add(camera.position.clone().sub(controls.target).multiplyScalar(scale))
      controls.update()
    }
    controls.addEventListener('start', takeControl)
    window.addEventListener('stillpoint-orbit', orbit)
    window.addEventListener('stillpoint-zoom', zoom)
    return () => { controls.removeEventListener('start', takeControl); window.removeEventListener('stillpoint-orbit', orbit); window.removeEventListener('stillpoint-zoom', zoom); controls.dispose() }
  }, [camera, controls, onManual])
  useEffect(() => {
    if (resetKey === 0) return
    const pose = cameraPose(progressRef.current)
    camera.position.copy(pose.position)
    controls.target.copy(pose.target)
    controls.update()
  }, [camera, controls, resetKey])
  useFrame((_, delta) => {
    if (!manual) {
      const pose = cameraPose(progress)
      camera.position.lerp(pose.position, 1 - Math.exp(-delta * 1.5))
      controls.target.lerp(pose.target, 1 - Math.exp(-delta * 1.5))
    }
    controls.update()
  })
  return null
}

class VisualizationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, _info: ErrorInfo) { console.error('Evidence Connections could not render:', error) }
  render() {
    if (this.state.failed) return <div className={styles.fallback} role="status"><strong>3D view unavailable</strong><p>Your browser could not initialize the simulated visualization. The written evidence and result remain available below.</p><StaticRooms /></div>
    return this.props.children
  }
}

function StaticRooms() {
  return <svg viewBox="0 0 760 200" role="img" aria-label="Two simulated room outlines with corresponding background landmarks">
    <g fill="none" stroke="#7091aa" strokeWidth="2"><path d="M35 155 155 105 285 155 160 195Z M155 105V42L285 82V155 M285 82 405 42V155"/><path d="M355 155 475 105 605 155 480 195Z M475 105V42L605 82V155 M605 82 725 42V155"/></g>
    <g fill="none" stroke="#8be7e6" strokeWidth="2"><path d="M75 128v-36h45v36m-45-19h45 M210 92v-44h40v44 M405 128v-36h45v36m-45-19h45 M540 92v-44h40v44"/><path d="M120 124 450 124 M210 72 540 72 M250 92 580 92" strokeDasharray="5 5"/></g>
  </svg>
}

export default function EvidenceConnections() {
  const reduced = useReducedMotion()
  const [playing, setPlaying] = useState(() => typeof window !== 'undefined' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const [progress, setProgress] = useState(0)
  const [selected, setSelected] = useState(0)
  const [wireframe, setWireframe] = useState(true)
  const [presenting, setPresenting] = useState(false)
  const [manualCamera, setManualCamera] = useState(false)
  const [cameraReset, setCameraReset] = useState(0)
  const stageRef = useRef<HTMLElement>(null)
  const source = useMemo(() => makeRoom(false), [])
  const target = useMemo(() => makeRoom(true), [])
  const pairs = useMemo(() => buildSimPairs(source, target).slice(0, LINE_LIMIT), [source, target])
  const selectedPair = pairs[selected % pairs.length]
  const selectablePairs = useMemo(() => {
    const labels = new Set<string>()
    return pairs.filter((pair) => pair.strong && !labels.has(pair.label) && Boolean(labels.add(pair.label))).slice(0, 8)
  }, [pairs])
  const phase = phaseIndex(progress)
  const percent = Math.round(progress * 100)
  const onManualCamera = useCallback(() => setManualCamera(true), [])

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

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen?.()
      else await stageRef.current?.requestFullscreen?.()
    } catch (error) {
      console.error('Fullscreen presentation could not start:', error)
    }
  }

  function reset() {
    setProgress(0)
    setPlaying(!reduced)
    setManualCamera(false)
    setCameraReset((value) => value + 1)
  }

  function selectPoint(index: number) { setSelected(index % pairs.length) }

  return <section className={styles.stage} ref={stageRef} aria-label="Simulated conceptual 3D evidence visualization">
    <div className={styles.viewport}>
      <div className={styles.hud}>
        <span className={styles.warn}>SIMULATED CONCEPTUAL VISUALIZATION · NOT IMAGE-DERIVED</span>
        <span>Drag to orbit · scroll or use controls to zoom</span>
      </div>
      <div className={`${styles.sceneLabel} ${styles.sceneOriginal}`}>ORIGINAL SCENE</div>
      <div className={`${styles.sceneLabel} ${styles.sceneCompared}`}>COMPARED SCENE</div>
      <VisualizationBoundary>
        <Canvas className={styles.canvas} fallback={<div className={styles.fallback} role="status">WebGL is unavailable. A static conceptual illustration is shown instead.<StaticRooms /></div>} camera={{ position: [0,3.4,11.8], fov: 35, near: 0.1, far: 60 }} dpr={[1,1.5]} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.setClearColor('#080e16', 1); gl.toneMapping = THREE.ACESFilmicToneMapping; gl.toneMappingExposure = 1.15 }}>
          <ambientLight intensity={0.7} />
          <Cloud room={source} variant={false} progress={progress} selected={selectedPair?.leftIndex ?? -1} wireframe={wireframe} reduced={reduced} />
          <Cloud room={target} variant progress={progress} selected={selectedPair?.rightIndex ?? -1} wireframe={wireframe} reduced={reduced} />
          <Connections source={source} target={target} pairs={pairs} progress={progress} reduced={reduced} />
          <CameraControls progress={progress} manual={manualCamera} resetKey={cameraReset} onManual={onManualCamera} />
        </Canvas>
      </VisualizationBoundary>
    </div>
    <div className={styles.explanation} aria-live="polite">
      <div className={styles.phaseCopy}>
        <span className={styles.phaseKicker}>PHASE 0{phase + 1} / 05 · {phases[phase].title.toUpperCase()}</span>
        <h3>{phases[phase].caption}</h3>
        <p>{phases[phase].detail}</p>
      </div>
      <div className={styles.progressMeta}><strong>{percent}%</strong><span>{pairs.length} simulated landmark correspondences</span></div>
    </div>
    <div className={styles.phasebar} aria-label="Five phases of the simulated comparison">
      {phases.map((item,index) => <div className={index === phase ? styles.phaseActive : styles.phase} aria-current={index === phase ? 'step' : undefined} key={item.title}><b>0{index + 1}</b>{item.title}</div>)}
    </div>
    <div className={styles.controls}>
      <button type="button" className={styles.primary} disabled={reduced} onClick={() => setPlaying((value) => !value)}>{reduced ? 'Reduced motion' : playing ? 'Pause' : 'Play'}</button>
      <button type="button" onClick={reset}>Replay</button>
      <button type="button" onClick={() => setManualCamera((value) => !value)} aria-pressed={manualCamera}>{manualCamera ? 'Camera manual' : 'Camera auto'}</button>
      <button type="button" onClick={() => setWireframe((value) => !value)} aria-pressed={wireframe}>Wireframe {wireframe ? 'on' : 'off'}</button>
      <button type="button" aria-label="Rotate scene left" onClick={() => { setManualCamera(true); window.dispatchEvent(new CustomEvent('stillpoint-orbit', { detail: Math.PI / 12 })) }}>Orbit left</button>
      <button type="button" aria-label="Rotate scene right" onClick={() => { setManualCamera(true); window.dispatchEvent(new CustomEvent('stillpoint-orbit', { detail: -Math.PI / 12 })) }}>Orbit right</button>
      <button type="button" aria-label="Zoom in" onClick={() => window.dispatchEvent(new CustomEvent('stillpoint-zoom', { detail: 0.86 }))}>Zoom in</button>
      <button type="button" aria-label="Zoom out" onClick={() => window.dispatchEvent(new CustomEvent('stillpoint-zoom', { detail: 1.16 }))}>Zoom out</button>
      <button type="button" onClick={() => void toggleFullscreen()}>{presenting ? 'Exit fullscreen' : 'Fullscreen'}</button>
      <button type="button" onClick={() => { setManualCamera(false); setCameraReset((value) => value + 1) }}>Reset camera</button>
      <label className={styles.timeline}>Scrub the sequence <input aria-label="Scrub the 28-second visualization" type="range" min="0" max="1" step="0.001" value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)) }} /></label>
    </div>
    <div className={styles.bottom}>
      <div className={styles.panel}><h3>Inspect a matched feature</h3>
        <div className={styles.featureButtons}>{selectablePairs.map((pair) => {
          const index = pairs.indexOf(pair)
          return <button type="button" aria-pressed={index === selected} key={pair.key} onClick={() => selectPoint(index)}>{pair.label}</button>
        })}</div>
        <p>Selected landmark: {selectedPair?.label ?? 'none'}. Lines join the same named synthetic structure in both generated rooms.</p>
      </div>
      <div className={styles.panel}><h3>How to read this scene</h3><p>This is a simulated teaching model, separate from your result. Stillpoint currently compares user-reviewed scene-graph names and centers; it does not reconstruct rooms in 3D.</p><p className={styles.hint}>Simulated conceptual visualization. These rooms and correspondences are not reconstructed from uploaded photographs.</p></div>
    </div>
  </section>
}
