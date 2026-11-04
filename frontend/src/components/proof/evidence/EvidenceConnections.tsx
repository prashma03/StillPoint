import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
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
  const material = useMemo(() => new THREE.LineBasicMaterial({ color: '#68c8d7', transparent: true, opacity: 0.1 + progress * 0.12 }), [progress])
  const pair = pairs[selected]
  const center: [number, number, number] = pair
    ? [(source.positions[pair.leftIndex * 3] + target.positions[pair.rightIndex * 3]) / 2, (source.positions[pair.leftIndex * 3 + 1] + target.positions[pair.rightIndex * 3 + 1]) / 2, (source.positions[pair.leftIndex * 3 + 2] + target.positions[pair.rightIndex * 3 + 2]) / 2]
    : [0, 0, 0]
  return <>
    <lineSegments geometry={geometry} material={material} />
    <mesh position={center}><sphereGeometry args={[0.045, 12, 12]} /><meshBasicMaterial color="#85e2e8" /></mesh>
  </>
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
  const [cameraControls, setCameraControls] = useState<OrbitControls | null>(null)
  const stageRef = useRef<HTMLElement>(null)
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const source = useMemo(() => makeRoom(false, POINT_LIMIT), [])
  const target = useMemo(() => makeRoom(true, POINT_LIMIT), [])
  const pairs = useMemo(() => buildSimPairs(source, target), [source, target])
  const selectedPair = pairs[selected % pairs.length]

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
      <Canvas camera={{ position: [0, 1.7, 9], fov: 46 }} dpr={[1, 1.5]} onCreated={({ gl }) => gl.setClearColor('#080e16', 1)}>
        <ambientLight intensity={0.8} />
        <Cloud room={source} offset={-2} selected={selectedPair?.leftIndex ?? null} />
        <Cloud room={target} offset={2} selected={selectedPair?.rightIndex ?? null} />
        <Connections source={source} target={target} pairs={pairs} selected={selected} progress={progress} />
        <CameraControls onReady={setCameraControls} />
      </Canvas>
      <div className={styles.roomLabels}><span>REFERENCE SCENE</span><span>ILLUSTRATIVE VARIANT</span></div>
      <div className={styles.phaseOverlay}><span>CONCEPTUAL MODEL</span><strong>Correspondence requires evidence</strong></div>
    </div>
    <div className={styles.phasebar} aria-label="Demonstration phases">
      {['Detect detail', 'Compare structure', 'Check geometry', 'Review evidence', 'Interpret limits'].map((label, index) => <div className={index === Math.min(4, Math.floor(progress * 5)) ? styles.phaseActive : styles.phase} key={label}><b>0{index + 1}</b>{label}</div>)}
    </div>
    <div className={styles.controls}>
      <button type="button" className={styles.primary} disabled={reduced} onClick={() => setPlaying((value) => !value)}>{reduced ? 'Motion reduced' : playing ? 'Pause' : 'Play'}</button>
      <button type="button" disabled={reduced} onClick={() => { setProgress(0); setReplayKey((value) => value + 1); setPlaying(true) }}>Replay</button>
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
