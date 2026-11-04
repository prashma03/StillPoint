import { Canvas, useFrame } from '@react-three/fiber'
import { Component, useEffect, useLayoutEffect, useMemo, useRef, type ReactNode, type RefObject } from 'react'
import * as THREE from 'three'
import { homeView } from '../lib/homeView'
import { scenePose } from '../lib/pose'

const REFERENCE: { name: string; position: [number, number, number] }[] = [
  { name: 'Bed', position: [-1.65, 0.36, -1.42] },
  { name: 'Bed foot', position: [-0.05, 0.36, 0.55] },
  { name: 'Poster', position: [-0.9, 1.95, -1.84] },
  { name: 'Window', position: [-2.24, 0.92, -0.5] },
  { name: 'Door', position: [0.86, 1.85, -1.84] },
  { name: 'Desk', position: [1.78, 0.8, 0.68] },
]

type Materials = {
  solid: THREE.Material
  edge: THREE.Material
  points: THREE.Material
  glass: THREE.Material
}

function SolidBox({
  w,
  h,
  d,
  position,
  rotation,
  solid,
  edge,
}: {
  w: number
  h: number
  d: number
  position: [number, number, number]
  rotation?: [number, number, number]
  solid: THREE.Material
  edge: THREE.Material
}) {
  const geom = useMemo(() => new THREE.BoxGeometry(w, h, d), [w, h, d])
  const edges = useMemo(() => new THREE.EdgesGeometry(geom), [geom])
  useEffect(
    () => () => {
      geom.dispose()
      edges.dispose()
    },
    [geom, edges],
  )
  return (
    <group position={position} rotation={rotation}>
      <mesh geometry={geom} material={solid} />
      <lineSegments geometry={edges} material={edge} />
    </group>
  )
}

function RoomModel({ solid, edge, points, glass }: Materials) {
  return (
    <group>
      <SolidBox w={4.7} h={0.05} d={3.9} position={[0, 0.02, 0]} solid={solid} edge={edge} />
      <SolidBox w={4.7} h={2.55} d={0.05} position={[0, 1.28, -1.92]} solid={solid} edge={edge} />
      <SolidBox w={0.05} h={2.55} d={3.9} position={[-2.35, 1.28, 0]} solid={solid} edge={edge} />
      <SolidBox w={0.05} h={2.55} d={3.9} position={[2.35, 1.28, 0]} solid={solid} edge={edge} />
      <SolidBox w={1.7} h={0.28} d={2.05} position={[-0.85, 0.2, -0.42]} solid={solid} edge={edge} />
      <SolidBox w={1.7} h={0.58} d={0.06} position={[-0.85, 0.52, -1.42]} solid={solid} edge={edge} />
      <SolidBox w={1.15} h={0.06} d={0.55} position={[1.25, 0.76, 0.48]} solid={solid} edge={edge} />
      <SolidBox w={0.05} h={0.7} d={0.05} position={[0.78, 0.4, 0.66]} solid={solid} edge={edge} />
      <SolidBox w={0.05} h={0.7} d={0.05} position={[1.72, 0.4, 0.66]} solid={solid} edge={edge} />
      <SolidBox w={0.7} h={0.92} d={0.03} position={[-0.55, 1.55, -1.86]} solid={solid} edge={edge} />
      <SolidBox w={0.68} h={1.85} d={0.05} position={[1.22, 0.98, -1.82]} rotation={[0, -0.2, 0]} solid={solid} edge={edge} />
      <SolidBox w={0.04} h={1.05} d={0.06} position={[-2.28, 1.42, -0.52]} solid={solid} edge={edge} />
      <SolidBox w={0.04} h={1.05} d={0.06} position={[-2.28, 1.42, 0.28]} solid={solid} edge={edge} />
      <SolidBox w={0.04} h={0.06} d={0.86} position={[-2.28, 1.94, -0.12]} solid={solid} edge={edge} />
      <SolidBox w={0.04} h={0.06} d={0.86} position={[-2.28, 0.9, -0.12]} solid={solid} edge={edge} />
      <mesh position={[-2.26, 1.42, -0.12]} rotation={[0, Math.PI / 2, 0]} material={glass}>
        <planeGeometry args={[0.74, 0.92]} />
      </mesh>
      {REFERENCE.map((point) => (
        <mesh key={point.name} position={point.position} material={points}>
          <sphereGeometry args={[0.042, 12, 10]} />
        </mesh>
      ))}
    </group>
  )
}

function Correspondence({
  groupA,
  groupB,
  geometry,
  positions,
}: {
  groupA: RefObject<THREE.Group | null>
  groupB: RefObject<THREE.Group | null>
  geometry: THREE.BufferGeometry
  positions: Float32Array
}) {
  const start = useMemo(() => new THREE.Vector3(), [])
  const end = useMemo(() => new THREE.Vector3(), [])
  const tip = useMemo(() => new THREE.Vector3(), [])
  useFrame(() => {
    const a = groupA.current
    const b = groupB.current
    if (!a || !b) return
    a.updateWorldMatrix(true, true)
    b.updateWorldMatrix(true, true)
    const poseLines = geometry.userData.lines as number
    REFERENCE.forEach((point, index) => {
      start.fromArray(point.position).applyMatrix4(a.matrixWorld)
      end.fromArray(point.position).applyMatrix4(b.matrixWorld)
      tip.copy(start).lerp(end, poseLines ?? 0)
      positions.set([start.x, start.y, start.z, tip.x, tip.y, tip.z], index * 6)
    })
    const attribute = geometry.getAttribute('position') as THREE.BufferAttribute
    attribute.needsUpdate = true
  })
  return null
}

function Director({
  layerRef,
  onDone,
  groupA,
  groupB,
  solid,
  edge,
  ghostSolid,
  ghostEdge,
  pointA,
  pointB,
  lineMat,
  lineGeom,
  glass,
}: {
  layerRef: RefObject<HTMLDivElement | null>
  onDone: () => void
  groupA: RefObject<THREE.Group | null>
  groupB: RefObject<THREE.Group | null>
  solid: THREE.MeshStandardMaterial
  edge: THREE.LineBasicMaterial
  ghostSolid: THREE.MeshStandardMaterial
  ghostEdge: THREE.LineBasicMaterial
  pointA: THREE.MeshBasicMaterial
  pointB: THREE.MeshBasicMaterial
  lineMat: THREE.LineBasicMaterial
  lineGeom: THREE.BufferGeometry
  glass: THREE.MeshStandardMaterial
}) {
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone
  const finished = useRef(false)
  const started = useRef(0)
  const green = useMemo(() => new THREE.Color('#8FB9A4'), [])
  const blue = useMemo(() => new THREE.Color('#4A9EFF'), [])

  useFrame(({ camera }, delta) => {
    if (homeView.alignAt !== started.current) {
      started.current = homeView.alignAt
      finished.current = false
    }
    if (homeView.alignAt && Math.abs(homeView.story - homeView.holdStory) > 0.05) {
      homeView.alignAt = 0
      homeView.holdAlign = false
    }
    let alignU = -1
    if (homeView.alignAt) {
      alignU = Math.min(1, (performance.now() - homeView.alignAt) / 4200)
      if (alignU >= 1 && !finished.current) {
        finished.current = true
        homeView.holdAlign = true
        onDoneRef.current()
      }
    }
    const pose = scenePose({
      story: homeView.story,
      slider: homeView.slider,
      alignU,
      hold: homeView.holdAlign,
    })
    const damp = homeView.reduced ? 1 : 1 - Math.exp(-3.2 * delta)
    const lookX = homeView.lookX * 0.32 + homeView.lookTouch * 0.62
    camera.position.x += (lookX - camera.position.x) * damp
    camera.position.y += (pose.cameraY - homeView.lookY * 0.16 - camera.position.y) * damp
    camera.position.z += (pose.cameraZ - camera.position.z) * damp
    camera.lookAt(0.15, 0.78, -0.25)

    solid.opacity = 1 - pose.wire * 0.78
    edge.opacity = 0.28 + pose.wire * 0.72
    ghostSolid.opacity = pose.ghost * (0.22 + (1 - pose.wire) * 0.45)
    ghostEdge.opacity = pose.ghost * (0.35 + pose.wire * 0.65)
    glass.opacity = 0.14 * (1 - pose.wire * 0.65)
    const apart = 1 - pose.converge
    if (groupA.current) groupA.current.position.x = 0.95
    if (groupB.current) {
      groupB.current.visible = pose.ghost > 0.03
      groupB.current.position.set(0.95 + apart * 0.78, 0, apart * 0.32)
      groupB.current.rotation.y = apart * 0.26
    }
    lineMat.opacity = pose.lines
    lineGeom.userData.lines = pose.lines
    pointA.color.copy(blue).lerp(green, pose.green)
    pointB.color.copy(blue).lerp(green, pose.green)
    pointB.opacity = pose.ghost
    if (layerRef.current) layerRef.current.style.opacity = String(pose.roomOpacity)
  })

  return <Correspondence groupA={groupA} groupB={groupB} geometry={lineGeom} positions={lineGeom.getAttribute('position').array as Float32Array} />
}

function Scene({ layerRef, onDone }: { layerRef: RefObject<HTMLDivElement | null>; onDone: () => void }) {
  const groupA = useRef<THREE.Group>(null)
  const groupB = useRef<THREE.Group>(null)
  const solid = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#243447', roughness: 0.92, metalness: 0.04, transparent: true }),
    [],
  )
  const edge = useMemo(() => new THREE.LineBasicMaterial({ color: '#93A8BB', transparent: true }), [])
  const ghostSolid = useMemo(() => {
    const material = solid.clone()
    material.opacity = 0
    return material
  }, [solid])
  const ghostEdge = useMemo(() => {
    const material = edge.clone()
    material.opacity = 0
    return material
  }, [edge])
  const pointA = useMemo(() => new THREE.MeshBasicMaterial({ color: '#4A9EFF' }), [])
  const pointB = useMemo(() => new THREE.MeshBasicMaterial({ color: '#4A9EFF', transparent: true, opacity: 0 }), [])
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: '#8FB9A4', transparent: true }), [])
  const glass = useMemo(
    () => new THREE.MeshStandardMaterial({ color: '#4A9EFF', transparent: true, opacity: 0.14, roughness: 0.15 }),
    [],
  )
  const positions = useMemo(() => new Float32Array(REFERENCE.length * 6), [])
  const lineGeom = useMemo(() => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geometry.userData.lines = 0
    return geometry
  }, [positions])

  useLayoutEffect(() => {
    if (groupB.current) groupB.current.visible = false
  }, [])

  useEffect(
    () => () => {
      solid.dispose()
      edge.dispose()
      ghostSolid.dispose()
      ghostEdge.dispose()
      pointA.dispose()
      pointB.dispose()
      lineMat.dispose()
      glass.dispose()
      lineGeom.dispose()
    },
    [solid, edge, ghostSolid, ghostEdge, pointA, pointB, lineMat, glass, lineGeom],
  )

  return (
    <>
      <hemisphereLight args={['#d7e3ee', '#101923', 0.62]} />
      <directionalLight position={[2.8, 4.4, 2.6]} intensity={1.35} color="#f4f7fb" />
      <directionalLight position={[-2.4, 2.2, -1.4]} intensity={0.18} color="#9ec4ef" />
      <fog attach="fog" args={['#101923', 8.5, 16]} />
      <group ref={groupA}>
        <RoomModel solid={solid} edge={edge} points={pointA} glass={glass} />
      </group>
      <group ref={groupB}>
        <RoomModel solid={ghostSolid} edge={ghostEdge} points={pointB} glass={glass} />
      </group>
      <lineSegments geometry={lineGeom} material={lineMat} />
      <Director
        layerRef={layerRef}
        onDone={onDone}
        groupA={groupA}
        groupB={groupB}
        solid={solid}
        edge={edge}
        ghostSolid={ghostSolid}
        ghostEdge={ghostEdge}
        pointA={pointA}
        pointB={pointB}
        lineMat={lineMat}
        lineGeom={lineGeom}
        glass={glass}
      />
    </>
  )
}

class WebGLBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function RoomFallback({ aligned }: { aligned: boolean }) {
  return (
    <div className={aligned ? 'room-fallback is-aligned' : 'room-fallback'} aria-hidden="true">
      <RoomSvg />
      <RoomSvg ghost />
    </div>
  )
}

function RoomSvg({ ghost = false }: { ghost?: boolean }) {
  return (
    <svg className={ghost ? 'ghost-room' : undefined} viewBox="0 0 640 420">
      <path d="M70 330 250 250 570 330 390 410Z" fill="none" stroke="#7E93A8" />
      <path d="M70 330V120L250 50V250" fill="none" stroke="#7E93A8" />
      <path d="M250 50 570 120V330" fill="none" stroke="#7E93A8" />
      <path d="M120 300 230 250 230 150 120 190Z" fill="none" stroke="#A6B4C2" />
      <path d="M300 90h70v90h-70Z" fill="none" stroke="#A6B4C2" />
      <path d="M470 150h55v130h-55Z" fill="none" stroke="#A6B4C2" />
      <path d="M150 130h40v50h-40Z" fill="none" stroke="#4A9EFF" />
      <circle cx="120" cy="190" r="3.5" fill="#4A9EFF" />
      <circle cx="300" cy="90" r="3.5" fill="#4A9EFF" />
      <circle cx="470" cy="150" r="3.5" fill="#4A9EFF" />
      <circle cx="400" cy="300" r="3.5" fill="#4A9EFF" />
    </svg>
  )
}

export function RoomLayer({
  layerRef,
  active,
  onDone,
  aligned,
}: {
  layerRef: RefObject<HTMLDivElement | null>
  active: boolean
  onDone: () => void
  aligned: boolean
}) {
  return (
    <WebGLBoundary fallback={<RoomFallback aligned={aligned} />}>
      <Canvas
        className="room-canvas"
        dpr={typeof window !== 'undefined' && window.innerWidth < 760 ? [1, 1.15] : [1, 1.5]}
        camera={{ position: [0, 1.95, 6.55], fov: 34, near: 0.1, far: 40 }}
        frameloop={active ? 'always' : 'never'}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.setClearColor('#101923', 0)
          gl.toneMapping = THREE.ACESFilmicToneMapping
          gl.toneMappingExposure = 1.02
        }}
      >
        <Scene layerRef={layerRef} onDone={onDone} />
      </Canvas>
    </WebGLBoundary>
  )
}
