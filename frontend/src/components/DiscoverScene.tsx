import { Component, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import * as THREE from 'three'
import { imageToWorld, planeSize, type DiscoverLayout } from '../lib/discoverGeometry'

function PhotoPlane({ url, layout }: { url: string; layout: DiscoverLayout }) {
  const texture = useMemo(() => new THREE.TextureLoader().load(url), [url])
  useEffect(() => () => { texture.dispose() }, [texture])
  const size = planeSize(layout)
  return <mesh position={[0, 0, 0]}>
    <planeGeometry args={[size.width, size.height]} />
    <meshBasicMaterial map={texture} toneMapped={false} />
  </mesh>
}

function MeasuredLines({ layout }: { layout: DiscoverLayout }) {
  const geometry = useMemo(() => {
    const positions = new Float32Array(Math.max(1, layout.lines.length) * 6)
    layout.lines.forEach((line, index) => positions.set([line.x1, line.y1, line.z1, line.x2, line.y2, line.z2], index * 6))
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    next.setDrawRange(0, layout.lines.length * 2)
    return next
  }, [layout])
  const links = useMemo(() => {
    const positions = new Float32Array(Math.max(1, layout.links.length) * 6)
    layout.links.forEach(([from, to], index) => {
      const a = layout.corners.find(point => point.id === from)
      const b = layout.corners.find(point => point.id === to)
      if (!a || !b) return
      const start = imageToWorld(a.x, a.y, layout, 0.09)
      const end = imageToWorld(b.x, b.y, layout, 0.09)
      positions.set([start.x, start.y, start.z, end.x, end.y, end.z], index * 6)
    })
    const next = new THREE.BufferGeometry()
    next.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    next.setDrawRange(0, layout.links.length * 2)
    return next
  }, [layout])
  useEffect(() => () => { geometry.dispose(); links.dispose() }, [geometry, links])
  return <>
    {layout.lines.length > 0 && <lineSegments geometry={geometry}><lineBasicMaterial color="#50dde8" transparent opacity={0.9} toneMapped={false} /></lineSegments>}
    {layout.links.length > 0 && <lineSegments geometry={links}><lineBasicMaterial color="#8ef6ff" transparent opacity={0.45} toneMapped={false} /></lineSegments>}
  </>
}

function Nodes({ layout, activeId, onSelect }: { layout: DiscoverLayout; activeId: number | null; onSelect: (id: number) => void }) {
  return <>{layout.corners.map(point => {
    const placed = imageToWorld(point.x, point.y, layout, 0.11)
    const active = point.id === activeId
    return <mesh key={point.id} position={[placed.x, placed.y, placed.z]} onClick={event => { event.stopPropagation(); onSelect(point.id) }} onPointerOver={event => { event.stopPropagation(); onSelect(point.id) }}>
      <sphereGeometry args={[active ? 0.055 : 0.03, 16, 16]} />
      <meshBasicMaterial color={active ? '#ffffff' : '#7ef6ff'} toneMapped={false} />
    </mesh>
  })}</>
}

function SceneCamera({ reduced }: { reduced: boolean }) {
  const { camera, gl } = useThree()
  const controls = useMemo(() => new OrbitControls(camera, gl.domElement), [camera, gl])
  const reducedRef = useRef(reduced)
  reducedRef.current = reduced
  useEffect(() => {
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.autoRotate = !reduced
    controls.autoRotateSpeed = 0.55
    controls.minDistance = 1.8
    controls.maxDistance = 8
    const pause = () => { controls.autoRotate = false }
    const orbit = (event: Event) => {
      pause()
      const offset = camera.position.clone().sub(controls.target).applyAxisAngle(new THREE.Vector3(0, 1, 0), (event as CustomEvent<number>).detail)
      camera.position.copy(controls.target).add(offset)
      controls.update()
    }
    const zoom = (event: Event) => {
      pause()
      camera.position.copy(controls.target).add(camera.position.clone().sub(controls.target).multiplyScalar((event as CustomEvent<number>).detail))
      controls.update()
    }
    controls.addEventListener('start', pause)
    window.addEventListener('discover-orbit', orbit)
    window.addEventListener('discover-zoom', zoom)
    return () => {
      controls.removeEventListener('start', pause)
      window.removeEventListener('discover-orbit', orbit)
      window.removeEventListener('discover-zoom', zoom)
      controls.dispose()
    }
  }, [camera, controls])
  useFrame(() => {
    if (reducedRef.current) controls.autoRotate = false
    controls.update()
  })
  return null
}

function Scene({ url, layout, activeId, onSelect, reduced }: { url: string; layout: DiscoverLayout; activeId: number | null; onSelect: (id: number) => void; reduced: boolean }) {
  return <>
    <color attach="background" args={['#080e16']} />
    <ambientLight intensity={0.85} />
    <PhotoPlane url={url} layout={layout} />
    <MeasuredLines layout={layout} />
    <Nodes layout={layout} activeId={activeId} onSelect={onSelect} />
    <SceneCamera reduced={reduced} />
  </>
}

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function FlatMap({ layout, activeId, onSelect }: { layout: DiscoverLayout; activeId: number | null; onSelect: (id: number) => void }) {
  return <svg className="discover-flat-map" viewBox="-1.7 -1.2 3.4 2.4" role="img" aria-label="Feature map using measured image positions">
    {layout.lines.filter(line => !line.illustrative).map((line, index) => <line key={index} x1={line.x1} y1={-line.y1} x2={line.x2} y2={-line.y2} />)}
    {layout.corners.map(point => {
      const placed = imageToWorld(point.x, point.y, layout)
      return <circle key={point.id} cx={placed.x} cy={-placed.y} r={point.id === activeId ? 0.045 : 0.028} onClick={() => onSelect(point.id)} />
    })}
  </svg>
}

export function DiscoverScene({ url, layout, activeId, onSelect, reduced }: { url: string; layout: DiscoverLayout; activeId: number | null; onSelect: (id: number) => void; reduced: boolean }) {
  const size = planeSize(layout)
  const fallback = <FlatMap layout={layout} activeId={activeId} onSelect={onSelect} />
  return <div className="discover-scene" id="discover-map">
    <SceneBoundary fallback={fallback}>
      <Canvas camera={{ position: [0, 0.15, Math.max(size.width, size.height) * 1.15], fov: 38, near: 0.1, far: 30 }} dpr={[1, 1.5]} gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }} fallback={fallback} onCreated={({ gl }) => gl.setClearColor('#080e16', 1)}>
        <Scene url={url} layout={layout} activeId={activeId} onSelect={onSelect} reduced={reduced} />
      </Canvas>
    </SceneBoundary>
    <p className="discover-depth-note">{layout.note}</p>
    <div className="discover-scene-controls">
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('discover-orbit', { detail: 0.35 }))}>Orbit left</button>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('discover-orbit', { detail: -0.35 }))}>Orbit right</button>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('discover-zoom', { detail: 0.86 }))}>Zoom in</button>
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent('discover-zoom', { detail: 1.16 }))}>Zoom out</button>
    </div>
  </div>
}
