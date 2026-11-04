import * as THREE from 'three'

export interface RoomData { positions: Float32Array; colors: Float32Array; categories: string[]; count: number }
export interface SimPair { leftIndex: number; rightIndex: number; label: string; confidence: number; strong: boolean }

function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let value = Math.imul(seed ^ (seed >>> 15), 1 | seed); value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value; return ((value ^ (value >>> 14)) >>> 0) / 4294967296 }
}

export function makeRoom(variant: boolean, target: number): RoomData {
  const random = rng(variant ? 991 : 123)
  const positions: number[] = [], colors: number[] = [], categories: string[] = []
  const push = (x: number, y: number, z: number, hex: string, category: string) => {
    positions.push(x, y, z)
    const color = new THREE.Color(hex)
    if (variant) color.offsetHSL(0.03, -0.08, 0.02)
    colors.push(color.r, color.g, color.b); categories.push(category)
  }
  const plane = (cx: number, cy: number, cz: number, w: number, h: number, n: number, col: string, cat: string, axis: 'xy' | 'xz' | 'zy') => {
    for (let i = 0; i < n; i++) { const u = (random() - 0.5) * w, v = (random() - 0.5) * h; if (axis === 'xy') push(cx + u, cy + v, cz, col, cat); else if (axis === 'xz') push(cx + u, cy, cz + v, col, cat); else push(cx, cy + v, cz + u, col, cat) }
  }
  const edge = (a: number[], b: number[], n: number, col: string, cat: string) => { for (let i = 0; i < n; i++) { const t = i / n; push(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, col, cat) } }
  const box = (cx: number, cy: number, cz: number, w: number, h: number, d: number, n: number, col: string, cat: string) => {
    for (let i = 0; i < n; i++) { const face = Math.floor(random() * 6), u = random() - 0.5, v = random() - 0.5; const pts = [[cx + u * w, cy + h / 2, cz + v * d], [cx + u * w, cy - h / 2, cz + v * d], [cx - w / 2, cy + u * h, cz + v * d], [cx + w / 2, cy + u * h, cz + v * d], [cx + u * w, cy + v * h, cz - d / 2], [cx + u * w, cy + v * h, cz + d / 2]]; push(...(pts[face] as [number, number, number]), col, cat) }
  }

  plane(0, 0, 0, 4, 3.2, 650, '#355a86', 'floor', 'xz'); plane(0, 2.6, 0, 4, 3.2, 380, '#243a5c', 'ceiling', 'xz')
  plane(0, 1.3, -1.6, 4, 2.6, 950, '#5b7fae', 'wall', 'xy'); plane(-2, 1.3, 0, 3.2, 2.6, 620, '#486b96', 'wall', 'zy'); plane(2, 1.3, 0, 3.2, 2.6, 380, '#3d5a82', 'wall', 'zy')
  edge([-1.25, 1, -1.59], [-0.25, 1, -1.59], 90, '#67e8f9', 'window'); edge([-1.25, 2.1, -1.59], [-0.25, 2.1, -1.59], 90, '#67e8f9', 'window'); edge([-1.25, 1, -1.59], [-1.25, 2.1, -1.59], 90, '#67e8f9', 'window'); edge([-0.25, 1, -1.59], [-0.25, 2.1, -1.59], 90, '#67e8f9', 'window')
  edge([-0.75, 1, -1.59], [-0.75, 2.1, -1.59], 50, '#67e8f9', 'window'); plane(-0.75, 1.55, -1.59, 1, 1.1, 140, '#164e63', 'window', 'xy')
  edge([1.05, 0, -1.59], [1.75, 0, -1.59], 60, '#c4b5fd', 'door'); edge([1.05, 2, -1.59], [1.75, 2, -1.59], 60, '#c4b5fd', 'door'); edge([1.05, 0, -1.59], [1.05, 2, -1.59], 80, '#c4b5fd', 'door'); edge([1.75, 0, -1.59], [1.75, 2, -1.59], 80, '#c4b5fd', 'door')
  box(-1.05, 0.28, 0.65, 1.65, 0.5, 1, 720, variant ? '#8b6f5a' : '#64748b', 'bed'); plane(-1.05, 0.55, 0.65, 1.5, 0.85, 220, '#93c5fd', 'bed', 'xz')
  box(1.15, 0.55, -0.85, 1.35, 0.08, 0.75, 260, '#a78bfa', 'desk'); box(1.15, 0.28, -0.85, 1.2, 0.5, 0.65, 260, '#475569', 'desk'); box(0.45, 0.45, -0.7, 0.45, 0.85, 0.45, 260, '#94a3b8', 'chair')
  box(1.55, 1.45, 0.9, 0.75, 1.3, 0.28, 420, '#5eead4', 'shelf'); box(-1.65, 1.65, -1.2, 0.55, 0.75, 0.08, 220, '#f59e0b', 'poster'); plane(-0.4, 0.02, 0.3, 1.4, 1, 220, '#1e40af', 'rug', 'xz')
  edge([-1.75, 0, 1.25], [-1.75, 1.35, 1.25], 70, '#fde68a', 'lamp')
  for (let i = 0; i < 70; i++) { const angle = random() * 6.28, radius = random() * 0.18; push(-1.75 + Math.cos(angle) * radius, 1.42 + random() * 0.12, 1.25 + Math.sin(angle) * radius, '#fde68a', 'lamp') }
  if (variant) box(1.65, 0.35, 1.25, 0.5, 0.7, 0.5, 220, '#22c55e', 'plant')
  while (positions.length / 3 < target) { plane(0, 1.3, -1.6, 4, 2.6, 120, '#4a6f9f', 'wall', 'xy'); plane(0, 0, 0, 4, 3.2, 80, '#2f4f78', 'floor', 'xz') }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), categories, count: positions.length / 3 }
}

const FEATURE_CATS = new Set(['window', 'door', 'bed', 'desk', 'shelf', 'lamp', 'poster'])
export function featureIndices(data: RoomData, stride = 6): number[] { const out: number[] = []; data.categories.forEach((category, index) => { if (FEATURE_CATS.has(category) && index % stride === 0) out.push(index) }); return out }

const LANDMARKS: [number, number, number, string][] = [
  [-1.25, 1, -1.59, 'Window corner'], [-0.25, 1, -1.59, 'Window corner'], [-1.25, 2.1, -1.59, 'Window corner'], [-0.25, 2.1, -1.59, 'Window top'],
  [1.05, 0, -1.59, 'Door frame'], [1.75, 2, -1.59, 'Door frame'], [1.05, 2, -1.59, 'Door frame'], [-2, 2.6, -1.6, 'Wall intersection'], [2, 2.6, -1.6, 'Wall intersection'],
  [-1.75, 1.42, 1.25, 'Lamp detail'], [1.55, 2.1, 0.9, 'Shelf edge'], [-1.65, 1.65, -1.2, 'Poster corner'],
]
function nearest(data: RoomData, [x, y, z]: number[]): number { let best = 0, bestDistance = Infinity; for (let i = 0; i < data.count; i++) { const dx = data.positions[i * 3] - x, dy = data.positions[i * 3 + 1] - y, dz = data.positions[i * 3 + 2] - z, distance = dx * dx + dy * dy + dz * dz; if (distance < bestDistance) { bestDistance = distance; best = i } } return best }
export function buildSimPairs(left: RoomData, right: RoomData): SimPair[] {
  const pairs = LANDMARKS.map(([x, y, z, label], index) => ({ leftIndex: nearest(left, [x, y, z]), rightIndex: nearest(right, [x, y, z]), label, confidence: 0.93 + ((index * 37) % 6) / 100, strong: true }))
  const leftFeatures = featureIndices(left, 9), rightFeatures = featureIndices(right, 9), used = new Set<number>()
  for (const leftIndex of leftFeatures) {
    const x = left.positions[leftIndex * 3], y = left.positions[leftIndex * 3 + 1], z = left.positions[leftIndex * 3 + 2]
    let best = -1, bestDistance = 0.02
    for (const rightIndex of rightFeatures) { if (used.has(rightIndex)) continue; const dx = right.positions[rightIndex * 3] - x, dy = right.positions[rightIndex * 3 + 1] - y, dz = right.positions[rightIndex * 3 + 2] - z, distance = dx * dx + dy * dy + dz * dz; if (distance < bestDistance) { bestDistance = distance; best = rightIndex } }
    if (best >= 0) { used.add(best); pairs.push({ leftIndex, rightIndex: best, label: `${left.categories[leftIndex]} structure`, confidence: 0.74 + ((leftIndex * 13) % 20) / 100, strong: false }) }
    if (pairs.length >= 240) break
  }
  return pairs
}
