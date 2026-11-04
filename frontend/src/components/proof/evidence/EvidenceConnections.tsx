import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Component, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { buildSimPairs, makeRoom } from './roomGeometry'
import styles from './EvidenceConnections.module.css'

const POINT_LIMIT = 1800

function Cloud({ room, offset, selected }: { room: ReturnType<typeof makeRoom>; offset: number; selected: number | null }) {
  const geometry = useMemo(() => {
    const buffer = new THREE.BufferGeometry()
    buffer.setAttribute('position', new THREE.BufferAttribute(room.positions, 3))
    const colors = new Float32Array(room.positions.length)
    const ordinary = new THREE.Color(offset < 0 ? '#9fb7ce' : '#7396b5')
    const highlight = new THREE.Color('#6dd6e6')
    for (let i = 0; i < room.count; i += 1) {
      const color = i === selected ? highlight : ordinary
      colors.set([color.r, color.g, color.b], i * 3)
    }
    buffer.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return buffer
  }, [room, offset, selected])
  return <points geometry={geometry} position={[offset, 0, 0]}><pointsMaterial size={0.018} vertexColors sizeAttenuation transparent opacity={0.8} /></points>
}

function Connections({ source, target, pairs, selected, progress }: {
  source: ReturnType<typeof makeRoom>
  target: ReturnType<typeof makeRoom>
  pairs: ReturnType<typeof buildSimPairs>
  selected: number
  progress: number
}) {
  const geometry = useMemo(() => {
    const coords: number[] = []
    for (const pair of pairs.slice(0, 36)) {
      const a = pair.leftIndex * 3
      const b = pair.rightIndex * 3
      coords.push(source.positions[a] - 2, source.positions[a + 1], source.positions[a + 2])
      coords.push(target.positions[b] + 2, target.positions[b + 1], target.positions[b + 2])
    }
    const result = new THREE.BufferGeometry()
    result.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3))
    return result
  }, [source, target, pairs])
  const material = useMemo(() => new THREE.LineBasicMaterial({ color: '#68c8d7', transparent: true, opacity: 0.62 }), [])
  const lines = useRef<THREE.LineSegments>(null)
  useFrame(() => {
    if (!lines.current) return
    const shown = Math.ceil(Math.max(0.025, progress) * Math.min(pairs.length, 36))
    lines.current.geometry.setDrawRange(0, shown * 2)
  })
  const pair = pairs[selected]
  const center: [number, number, number] = pair
    ? [(source.positions[pair.leftIndex * 3] + target.positions[pair.rightIndex * 3]) / 2, (source.positions[pair.leftIndex * 3 + 1] + target.positions[pair.rightIndex * 3 + 1]) / 2, (source.positions[pair.leftIndex * 3 + 2] + target.positions[pair.rightIndex * 3 + 2]) / 2]
    : [0, 0, 0]
  return <>
    <lineSegments ref={lines} geometry={geometry} material={material} />
    <mesh position={center}><sphereGeometry args={[0.055, 12, 12]} /><meshBasicMaterial color="#85e2e8" /></mesh>
  </>
}

function Wireframe({ offset }: { offset: number }) {
  const geometry = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(4.1, 2.7, 3.3)), [])
  return <lineSegments geometry={geometry} position={[offset, 1.32, 0]}><lineBasicMaterial color="#7dd3d8" transparent opacity={0.62} /></lineSegments>
}

function FeatureMarker({ position }: { position: [number, number, number] }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3.2) * 0.18)
  })
  return <mesh ref={ref} position={position}><sphereGeometry args={[0.075, 16, 16]} /><meshBasicMaterial color="#8df5ef" /></mesh>
}

class VisualizationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, _info: ErrorInfo) { console.error('Evidence Connections could not render:', error) }
  render() {
    if (this.state.failed) return <div className={styles.fallback} role="status"><strong>3D view unavailable</strong><p>Your browser could not initialize the 3D demonstration. The verification summary below is still available.</p><FallbackRoom /></div>
    return this.props.children
  }
}

function FallbackRoom() {
  return <svg viewBox="0 0 640 220" role="img" aria-label="Static simulated room correspondence illustration">
    <path d="M55 170 175 112 290 160 168 211Z M175 112V45L290 88V160 M290 88 410 45 535 102V170" fill="none" stroke="#8098ad" strokeWidth="2" />
    <path d="M90 156V112h45v66 M200 70h34v44h-34z M430 115h45v55h-45z" fill="none" stroke="#4a9eff" strokeWidth="2" />
    <path d="M180 120 435 118 M165 153 450 146 M220 83 450 130" stroke="#7dd3d8" strokeDasharray="6 5" />
  </svg>
}

function CameraControls({ onReady }: { onReady: (controls: OrbitControls) => void }) {
  const { camera, gl } = useThree()
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  useEffect(() => {
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.minDistance = 5
    controls.maxDistance = 13
    controls.target.set(0, 0.9, 0)
    onReady(controls)
    return () => controls.dispose()
  }, [controls, onReady])
  useFrame(() => controls.update())
  return null
}

export default function EvidenceConnections() {
  const [playing, setPlaying] = useState(true)
  const [progress, setProgress] = useState(0)
  const [selected, setSelected] = useState(0)
  const [presenting, setPresenting] = useState(false)
  const [replayKey, setReplayKey] = useState(0)
  const [wireframe, setWireframe] = useState(true)
  const [cameraControls, setCameraControls] = useState<OrbitControls | null>(null)
  const stageRef = useRef<HTMLElement>(null)
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const source = useMemo(() => makeRoom(false, POINT_LIMIT), [])
  const target = useMemo(() => makeRoom(true, POINT_LIMIT), [])
  const pairs = useMemo(() => buildSimPairs(source, target), [source, target])
  const selectedPair = pairs[selected % pairs.length]
  const leftFeature: [number, number, number] = selectedPair ? [source.positions[selectedPair.leftIndex * 3] - 2, source.positions[selectedPair.leftIndex * 3 + 1], source.positions[selectedPair.leftIndex * 3 + 2]] : [-2, 1, 0]
  const rightFeature: [number, number, number] = selectedPair ? [target.positions[selectedPair.rightIndex * 3] + 2, target.positions[selectedPair.rightIndex * 3 + 1], target.positions[selectedPair.rightIndex * 3 + 2]] : [2, 1, 0]

  useEffect(() => {
    if (!playing || reduced) return
    const timer = window.setInterval(() => setProgress((value) => value >= 1 ? 0 : value + 0.006), 50)
    return () => window.clearInterval(timer)
  }, [playing, reduced, replayKey])

  useEffect(() => {
    const update = () => setPresenting(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])

  async function togglePresentation() {
    if (!stageRef.current) return
    if (document.fullscreenElement) await document.exitFullscreen?.()
    else await stageRef.current.requestFullscreen?.()
  }

  function rotateCamera(angle: number) {
    if (!cameraControls) return
    const offset = cameraControls.object.position.clone().sub(cameraControls.target)
    offset.applyAxisAngle(new THREE.Vector3(0, 1, 0), angle)
    cameraControls.object.position.copy(cameraControls.target).add(offset)
    cameraControls.update()
  }

  function zoomCamera(scale: number) {
    if (!cameraControls) return
    const offset = cameraControls.object.position.clone().sub(cameraControls.target).multiplyScalar(scale)
    cameraControls.object.position.copy(cameraControls.target).add(offset)
    cameraControls.update()
  }

  return <section className={styles.stage} ref={stageRef} aria-label="Simulated 3D evidence correspondence demonstration">
    <div className={styles.viewport}>
      <div className={styles.hud}><span className={styles.warn}>SIMULATED · NOT IMAGE-DERIVED</span><span>Drag to orbit · scroll to zoom</span></div>
      <VisualizationBoundary>
        <Canvas className={styles.canvas} fallback={<div className={styles.fallback} role="status">WebGL is unavailable in this browser. A static simulated diagram is provided below.</div>} camera={{ position: [0, 1.7, 9], fov: 46, near: 0.1, far: 50 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }} onCreated={({ gl }) => { gl.setClearColor('#080e16', 1); gl.toneMapping = THREE.ACESFilmicToneMapping }}>
          <ambientLight intensity={0.8} />
          <Cloud room={source} offset={-2} selected={selectedPair?.leftIndex ?? null} />
          <Cloud room={target} offset={2} selected={selectedPair?.rightIndex ?? null} />
          <Connections source={source} target={target} pairs={pairs} selected={selected} progress={progress} />
          <FeatureMarker position={leftFeature} /><FeatureMarker position={rightFeature} />
          {wireframe && <><Wireframe offset={-2} /><Wireframe offset={2} /></>}
          <CameraControls onReady={setCameraControls} />
        </Canvas>
      </VisualizationBoundary>
      <div className={styles.roomLabels}><span>REFERENCE SCENE</span><span>ILLUSTRATIVE VARIANT</span></div>
      <div className={styles.phaseOverlay}><span>CONCEPTUAL MODEL</span><strong>Correspondence requires evidence</strong></div>
    </div>
    <div className={styles.phasebar} aria-label="Demonstration phases">
      {['Detect detail', 'Compare structure', 'Check geometry', 'Review evidence', 'Interpret limits'].map((label, index) => <div className={index === Math.min(4, Math.floor(progress * 5)) ? styles.phaseActive : styles.phase} key={label}><b>0{index + 1}</b>{label}</div>)}
    </div>
    <div className={styles.controls}>
      <button type="button" className={styles.primary} disabled={reduced} onClick={() => setPlaying((value) => !value)}>{reduced ? 'Motion reduced' : playing ? 'Pause' : 'Play'}</button>
      <button type="button" disabled={reduced} onClick={() => { setProgress(0); setReplayKey((value) => value + 1); setPlaying(true) }}>Replay</button>
      <button type="button" aria-pressed={wireframe} onClick={() => setWireframe((value) => !value)}>Wireframe {wireframe ? 'on' : 'off'}</button>
      <button type="button" aria-label="Rotate scene left" onClick={() => rotateCamera(Math.PI / 12)}>Rotate left</button>
      <button type="button" aria-label="Rotate scene right" onClick={() => rotateCamera(-Math.PI / 12)}>Rotate right</button>
      <button type="button" aria-label="Zoom in" onClick={() => zoomCamera(0.85)}>Zoom in</button>
      <button type="button" aria-label="Zoom out" onClick={() => zoomCamera(1.15)}>Zoom out</button>
      <button type="button" onClick={() => void togglePresentation()}>{presenting ? 'Exit presentation' : 'Presentation mode'}</button>
      <label className={styles.timeline}>Progress <input aria-label="Demonstration progress" type="range" min="0" max="1" step="0.01" value={progress} onChange={(event) => { setPlaying(false); setProgress(Number(event.target.value)) }} /></label>
    </div>
    <div className={styles.bottom}>
      <div className={styles.panel}><h3>Explore a reference point</h3>
        <div className={styles.controls}>{pairs.slice(0, 8).map((pair, index) => <button type="button" aria-pressed={index === selected} key={`${pair.label}-${index}`} onClick={() => setSelected(index)}>{pair.label}</button>)}</div>
        <p>Selected: {selectedPair?.label ?? 'none'}. These points come from a synthetic room model, not the comparison above.</p>
      </div>
      <div className={styles.panel}><h3>What this demonstrates</h3><p>Spatial relationships can be drawn and inspected. Stillpoint's current verifier compares user-reviewed scene-graph names and centers; this point cloud does not show its output or establish identity, ownership, consent, or wrongdoing.</p><p className={styles.hint}>Camera controls: drag to orbit and scroll to zoom. Use the timeline to pause or replay the illustration.</p></div>
    </div>
  </section>
}
