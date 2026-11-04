import * as THREE from 'three'

export type FeaturePoint = {
  index: number
  key: string
  label: string
  category: string
  priority: 'key' | 'supporting'
}

export interface RoomData {
  positions: Float32Array
  colors: Float32Array
  categories: string[]
  count: number
  features: FeaturePoint[]
  wireframe: Float32Array
}

export interface SimPair {
  key: string
  leftIndex: number
  rightIndex: number
  label: string
  category: string
  strong: boolean
}

const palette: Record<string, string> = {
  structure: '#69849c', floor: '#526d86', window: '#66bbd0', door: '#7c9fbd',
  bed: '#93abc0', desk: '#78a9cb', chair: '#7d9bb5', shelf: '#a1b6c8',
  poster: '#78c4d3', rug: '#6384a1', lamp: '#b4c8d5',
}

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6D2B79F5) | 0
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

export function makeRoom(variant: boolean, minimumPoints = 1800): RoomData {
  const random = rng(variant ? 991 : 123)
  const positions: number[] = []
  const colors: number[] = []
  const categories: string[] = []
  const features: FeaturePoint[] = []
  const wireframe: number[] = []

  const add = (x: number, y: number, z: number, category: string, color = palette[category] ?? palette.structure, feature?: Omit<FeaturePoint, 'index'>) => {
    const index = positions.length / 3
    positions.push(x, y, z)
    const pointColor = new THREE.Color(color)
    if (variant) pointColor.offsetHSL(0.015, -0.03, 0.025)
    colors.push(pointColor.r, pointColor.g, pointColor.b)
    categories.push(category)
    if (feature) features.push({ ...feature, index })
  }

  const surface = (
    origin: [number, number, number], axisU: [number, number, number], axisV: [number, number, number],
    width: number, height: number, columns: number, rows: number, category: string,
    colorOrOmit?: string | ((u: number, v: number) => boolean),
  ) => {
    const surfaceColor = typeof colorOrOmit === 'string' ? colorOrOmit : palette[category] ?? palette.structure
    const omit = typeof colorOrOmit === 'function' ? colorOrOmit : undefined
    for (let row = 0; row <= rows; row += 1) for (let column = 0; column <= columns; column += 1) {
      const u = column / columns
      const v = row / rows
      if (omit?.(u, v)) continue
      const wobble = 0.006
      const du = (random() - 0.5) * wobble
      const dv = (random() - 0.5) * wobble
      add(
        origin[0] + axisU[0] * ((u + du - 0.5) * width) + axisV[0] * ((v + dv - 0.5) * height),
        origin[1] + axisU[1] * ((u + du - 0.5) * width) + axisV[1] * ((v + dv - 0.5) * height),
        origin[2] + axisU[2] * ((u + du - 0.5) * width) + axisV[2] * ((v + dv - 0.5) * height),
        category,
        surfaceColor,
      )
    }
  }

  const edge = (key: string, label: string, category: string, start: [number, number, number], end: [number, number, number], steps = 22, priority: FeaturePoint['priority'] = 'supporting') => {
    wireframe.push(...start, ...end)
    for (let step = 0; step <= steps; step += 1) {
      const t = step / steps
      add(
        THREE.MathUtils.lerp(start[0], end[0], t),
        THREE.MathUtils.lerp(start[1], end[1], t),
        THREE.MathUtils.lerp(start[2], end[2], t),
        category,
        palette[category] ?? '#8ed6e2',
        { key: `${key}:${step}`, label, category, priority },
      )
    }
  }

  const path = (key: string, label: string, category: string, points: [number, number, number][], steps = 22, priority: FeaturePoint['priority'] = 'supporting') => {
    for (let i = 0; i < points.length; i += 1) edge(`${key}:${i}`, label, category, points[i], points[(i + 1) % points.length], steps, priority)
  }

  const box = (key: string, label: string, category: string, center: [number, number, number], size: [number, number, number], detail = 7, edgeSteps = 16, priority: FeaturePoint['priority'] = 'supporting') => {
    const [cx, cy, cz] = center
    const [w, h, d] = size
    const x0 = cx - w / 2, x1 = cx + w / 2
    const y0 = cy - h / 2, y1 = cy + h / 2
    const z0 = cz - d / 2, z1 = cz + d / 2
    surface([cx, y1, cz], [1, 0, 0], [0, 0, 1], w, d, detail * 2, detail, category)
    surface([cx, y0, cz], [1, 0, 0], [0, 0, 1], w, d, detail * 2, detail, category)
    surface([x0, cy, cz], [0, 1, 0], [0, 0, 1], h, d, detail, detail, category)
    surface([x1, cy, cz], [0, 1, 0], [0, 0, 1], h, d, detail, detail, category)
    surface([cx, cy, z0], [1, 0, 0], [0, 1, 0], w, h, detail * 2, detail * 2, category)
    surface([cx, cy, z1], [1, 0, 0], [0, 1, 0], w, h, detail * 2, detail * 2, category)
    const corners: [number, number, number][] = [[x0,y0,z0],[x1,y0,z0],[x1,y1,z0],[x0,y1,z0],[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]]
    const links: [number, number][] = [[0,1],[1,2],[2,3],[3,0],[4,5],[5,6],[6,7],[7,4],[0,4],[1,5],[2,6],[3,7]]
    links.forEach(([a, b], i) => edge(`${key}:edge${i}`, label, category, corners[a], corners[b], edgeSteps, priority))
  }

  // Open-front room shell: floor, back wall and two side walls, sampled on
  // their surfaces so the room reads as architecture rather than a fog of dots.
  surface([0, 0, 0], [1, 0, 0], [0, 0, 1], 4.8, 4.5, 48, 38, 'floor')
  surface([0, 1.55, -2.2], [1, 0, 0], [0, 1, 0], 4.8, 3.1, 50, 32, 'structure', (u, v) => {
    const x = (u - 0.5) * 4.8
    const y = v * 3.1
    const inWindow = x > -1.9 && x < -0.45 && y > 1.05 && y < 2.42
    const inDoor = x > 1.1 && x < 2.12 && y < 2.35
    return inWindow || inDoor
  })
  surface([-2.4, 1.5, 0], [0, 0, 1], [0, 1, 0], 4.4, 3, 40, 28, 'structure')
  surface([2.4, 1.5, 0], [0, 0, 1], [0, 1, 0], 4.4, 3, 40, 28, 'structure')

  // Window and door frames use stable semantic sample keys in both rooms.
  const window = [[-1.9,1.05,-2.16],[-0.45,1.05,-2.16],[-0.45,2.42,-2.16],[-1.9,2.42,-2.16]] as [number,number,number][]
  path('window:frame', 'Window frame', 'window', window, 30, 'key')
  edge('window:mullion', 'Window mullion', 'window', [-1.175,1.05,-2.15], [-1.175,2.42,-2.15], 28, 'key')
  edge('window:crossbar', 'Window crossbar', 'window', [-1.9,1.74,-2.15], [-0.45,1.74,-2.15], 28, 'key')
  const door = [[1.1,0,-2.15],[2.12,0,-2.15],[2.12,2.35,-2.15],[1.1,2.35,-2.15]] as [number,number,number][]
  path('door:frame', 'Door frame', 'door', door, 28, 'key')
  edge('door:lintel', 'Door lintel', 'door', [1.1,2.05,-2.14], [2.12,2.05,-2.14], 22, 'key')

  // Furniture silhouettes: surfaces describe volume; stable edge samples
  // identify matching structures without pairing arbitrary array positions.
  box('bed:base', 'Bed frame', 'bed', [-1.05,0.32,0.82], [1.75,0.42,1.25], 7, 20, 'key')
  box('bed:mattress', 'Mattress edge', 'bed', [-1.05,0.59,0.82], [1.66,0.18,1.16], 7, 20, 'key')
  box('bed:pillow', 'Pillow corner', 'bed', [-1.5,0.72,0.82], [0.5,0.12,0.38], 4, 12)
  box('desk:top', 'Desk edge', 'desk', [1.25,1.0,-0.55], [1.45,0.12,0.82], 7, 18, 'key')
  for (const [i, x] of [-0.62, 0.62].entries()) for (const [j, z] of [-0.3, 0.3].entries()) {
    edge(`desk:leg:${i}:${j}`, 'Desk leg', 'desk', [1.25+x,0.94,-0.55+z], [1.25+x,0.12,-0.55+z], 13, 'supporting')
  }
  box('chair:seat', 'Chair seat', 'chair', [0.2,0.62,0.35], [0.7,0.12,0.65], 4, 14, 'supporting')
  box('chair:back', 'Chair back', 'chair', [0.2,1.0,0.62], [0.7,0.65,0.12], 4, 14, 'supporting')
  for (const [i, x] of [-0.26,0.26].entries()) for (const [j, z] of [-0.23,0.23].entries()) {
    edge(`chair:leg:${i}:${j}`, 'Chair leg', 'chair', [0.2+x,0.56,0.35+z], [0.2+x,0.08,0.35+z], 10, 'supporting')
  }
  box('shelf:upright', 'Shelf upright', 'shelf', [1.88,1.65,0.9], [0.65,1.65,0.28], 5, 16, 'key')
  for (const [index, y] of [1.05,1.65,2.22].entries()) {
    edge(`shelf:board:${index}`, 'Shelf board', 'shelf', [1.5,y,0.72], [2.23,y,0.72], 18, 'key')
  }
  path('poster:frame', 'Poster boundary', 'poster', [[-2.08,1.55,-2.12],[-1.55,1.55,-2.12],[-1.55,2.25,-2.12],[-2.08,2.25,-2.12]], 18, 'key')
  surface([-1.815,1.9,-2.115], [1,0,0], [0,1,0], 0.42,0.58,8,10,'poster')
  surface([-0.25,0.015,0.5], [1,0,0], [0,0,1], 1.35,1.05,18,14,'rug')
  edge('lamp:stem','Lamp stem', 'lamp',[-1.92,0.05,1.72],[-1.92,1.4,1.72],18,'supporting')
  path('lamp:shade','Lamp shade','lamp',[[-2.2,1.4,1.72],[-1.64,1.4,1.72],[-1.78,1.68,1.72],[-2.06,1.68,1.72]],12,'supporting')

  // Add low-density wall and floor detail to make depth readable without fog.
  const current = positions.length / 3
  for (let i = current; i < minimumPoints; i += 1) {
    const x = (random() - 0.5) * 4.5
    const y = random() * 2.8 + 0.08
    add(x, y, -2.19, 'structure', '#5c7893')
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), categories, count: positions.length / 3, features, wireframe: new Float32Array(wireframe) }
}

/** Match synthetic points by stable semantic feature key, never by array index. */
export function buildSimPairs(left: RoomData, right: RoomData): SimPair[] {
  const rightByKey = new Map(right.features.map((feature) => [feature.key, feature]))
  return left.features.flatMap((feature) => {
    const match = rightByKey.get(feature.key)
    if (!match) return []
    return [{
      key: feature.key,
      leftIndex: feature.index,
      rightIndex: match.index,
      label: feature.label,
      category: feature.category,
      strong: feature.priority === 'key',
    }]
  }).sort((a, b) => Number(b.strong) - Number(a.strong))
}
