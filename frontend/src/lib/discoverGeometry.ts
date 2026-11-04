import { harrisResponse, rgbaToGrayscale, sobelScores } from './detect'

export type DiscoverMode = 'approximate-layout' | 'feature-map'
export type FeaturePoint = { id: number; x: number; y: number; strength: number }
export type StructureSegment = {
  id: number
  x1: number
  y1: number
  x2: number
  y2: number
  orientation: 'horizontal' | 'vertical'
  role: 'floor' | 'wall' | 'edge'
  strength: number
}
export type Outline = { id: number; x: number; y: number; w: number; h: number; kind: 'upper-rectangle' | 'lower-rectangle' }
export type SceneLine = { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number; illustrative: boolean }
export type DiscoverLayout = {
  width: number
  height: number
  corners: FeaturePoint[]
  regions: number
  segments: StructureSegment[]
  outlines: Outline[]
  links: [number, number][]
  lines: SceneLine[]
  mode: DiscoverMode
  floorY: number | null
  note: string
}

const PLANE_W = 3.2

export function planeSize(layout: Pick<DiscoverLayout, 'width' | 'height'>) {
  const aspect = layout.width / Math.max(1, layout.height)
  const width = PLANE_W
  const height = PLANE_W / Math.min(Math.max(aspect, 0.45), 2.2)
  return { width, height }
}

export function imageToWorld(x: number, y: number, layout: Pick<DiscoverLayout, 'width' | 'height'>, z = 0.07) {
  const size = planeSize(layout)
  return { x: (x - 0.5) * size.width, y: (0.5 - y) * size.height, z }
}

function pickPeaks(scores: Float32Array, width: number, height: number, limit: number, minGap: number, local: boolean): FeaturePoint[] {
  let peak = 0
  for (let i = 0; i < scores.length; i += 1) if (scores[i] > peak) peak = scores[i]
  if (peak <= 0) return []
  const candidates: FeaturePoint[] = []
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 480))
  for (let y = 6; y < height - 6; y += stride) for (let x = 6; x < width - 6; x += stride) {
    const score = scores[y * width + x]
    if (score < peak * (local ? 0.04 : 0.5)) continue
    if (local && (score < scores[y * width + x - 1] || score < scores[y * width + x + 1] || score < scores[(y - 1) * width + x] || score < scores[(y + 1) * width + x])) continue
    candidates.push({ id: 0, x: x / width, y: y / height, strength: score / peak })
  }
  candidates.sort((a, b) => b.strength - a.strength)
  const selected: FeaturePoint[] = []
  for (const feature of candidates) {
    if (selected.some(other => Math.hypot((other.x - feature.x) * width, (other.y - feature.y) * height) < minGap)) continue
    selected.push({ ...feature, id: selected.length })
    if (selected.length >= limit) break
  }
  return selected
}

function countRegions(edges: Float32Array, width: number, height: number) {
  const cols = 24
  const rows = 18
  const on = new Uint8Array(cols * rows)
  for (let row = 0; row < rows; row += 1) for (let col = 0; col < cols; col += 1) {
    const x0 = Math.floor(col * width / cols)
    const x1 = Math.max(x0 + 1, Math.floor((col + 1) * width / cols))
    const y0 = Math.floor(row * height / rows)
    const y1 = Math.max(y0 + 1, Math.floor((row + 1) * height / rows))
    let sum = 0
    let count = 0
    for (let y = y0; y < y1; y += 2) for (let x = x0; x < x1; x += 2) { sum += edges[y * width + x]; count += 1 }
    if (count && sum / count >= 0.42) on[row * cols + col] = 1
  }
  const seen = new Uint8Array(on.length)
  let regions = 0
  for (let start = 0; start < on.length; start += 1) {
    if (!on[start] || seen[start]) continue
    regions += 1
    const stack = [start]
    seen[start] = 1
    while (stack.length) {
      const index = stack.pop() as number
      const row = Math.floor(index / cols)
      const col = index % cols
      for (const next of [index - 1, index + 1, index - cols, index + cols]) {
        if (next < 0 || next >= on.length || seen[next] || !on[next]) continue
        const nextRow = Math.floor(next / cols)
        const nextCol = next % cols
        if (Math.abs(nextRow - row) + Math.abs(nextCol - col) !== 1) continue
        seen[next] = 1
        stack.push(next)
      }
    }
  }
  return regions
}

type Raw = { x1: number; y1: number; x2: number; y2: number; strength: number; orientation: 'horizontal' | 'vertical' }

function collectRuns(edges: Float32Array, width: number, height: number, orientation: 'horizontal' | 'vertical'): Raw[] {
  const runs: Raw[] = []
  const across = orientation === 'horizontal' ? width : height
  const along = orientation === 'horizontal' ? height : width
  const minLen = Math.max(8, Math.round(across * 0.12))
  for (let fixed = 2; fixed < along - 2; fixed += 2) {
    let start = -1
    let peak = 0
    const commit = (end: number) => {
      if (start >= 0 && end - start >= minLen) {
        const a = start / across
        const b = end / across
        const c = fixed / along
        runs.push(orientation === 'horizontal'
          ? { x1: a, y1: c, x2: b, y2: c, strength: peak, orientation }
          : { x1: c, y1: a, x2: c, y2: b, strength: peak, orientation })
      }
      start = -1
      peak = 0
    }
    for (let moving = 2; moving < across - 2; moving += 1) {
      const value = orientation === 'horizontal' ? edges[fixed * width + moving] : edges[moving * width + fixed]
      if (value >= 0.48) {
        if (start < 0) start = moving
        if (value > peak) peak = value
      } else if (start >= 0) commit(moving)
    }
    if (start >= 0) commit(across - 2)
  }
  return mergeRuns(runs, orientation, width, height)
}

function mergeRuns(runs: Raw[], orientation: 'horizontal' | 'vertical', width: number, height: number) {
  const sorted = [...runs].sort((a, b) => (orientation === 'horizontal' ? a.y1 - b.y1 || a.x1 - b.x1 : a.x1 - b.x1 || a.y1 - b.y1))
  const merged: Raw[] = []
  for (const run of sorted) {
    const previous = merged[merged.length - 1]
    const sameBand = previous && (orientation === 'horizontal'
      ? Math.abs(previous.y1 - run.y1) * height <= 5 && run.x1 <= previous.x2 + 8 / width
      : Math.abs(previous.x1 - run.x1) * width <= 5 && run.y1 <= previous.y2 + 8 / height)
    if (!previous || !sameBand) { merged.push({ ...run }); continue }
    if (orientation === 'horizontal') {
      previous.x1 = Math.min(previous.x1, run.x1)
      previous.x2 = Math.max(previous.x2, run.x2)
    } else {
      previous.y1 = Math.min(previous.y1, run.y1)
      previous.y2 = Math.max(previous.y2, run.y2)
    }
    previous.strength = Math.max(previous.strength, run.strength)
  }
  return merged
}

function lengthOf(segment: Raw) {
  return segment.orientation === 'horizontal' ? segment.x2 - segment.x1 : segment.y2 - segment.y1
}

function outlinesFrom(segments: StructureSegment[]): Outline[] {
  const horizontal = segments.filter(segment => segment.orientation === 'horizontal')
  const vertical = segments.filter(segment => segment.orientation === 'vertical')
  const found: Outline[] = []
  for (let i = 0; i < vertical.length; i += 1) for (let j = i + 1; j < vertical.length; j += 1) {
    const left = vertical[i].x1 < vertical[j].x1 ? vertical[i] : vertical[j]
    const right = left === vertical[i] ? vertical[j] : vertical[i]
    const gap = right.x1 - left.x1
    if (gap < 0.08 || gap > 0.72) continue
    const top = Math.max(left.y1, right.y1)
    const bottom = Math.min(left.y2, right.y2)
    if (bottom - top < 0.08) continue
    const cap = (y: number) => horizontal.find(segment => Math.abs(segment.y1 - y) < 0.045 && segment.x1 <= left.x1 + 0.04 && segment.x2 >= right.x1 - 0.04)
    if (!cap(top) || !cap(bottom)) continue
    found.push({ id: found.length, x: left.x1, y: top, w: gap, h: bottom - top, kind: (top + bottom) / 2 < 0.62 ? 'upper-rectangle' : 'lower-rectangle' })
    if (found.length >= 4) return found
  }
  return found
}

function linksAlong(segments: StructureSegment[], corners: FeaturePoint[]) {
  const links: [number, number][] = []
  for (const segment of segments) {
    const near = corners.filter(point => {
      if (segment.orientation === 'horizontal') return Math.abs(point.y - segment.y1) < 0.035 && point.x >= segment.x1 - 0.02 && point.x <= segment.x2 + 0.02
      return Math.abs(point.x - segment.x1) < 0.035 && point.y >= segment.y1 - 0.02 && point.y <= segment.y2 + 0.02
    }).sort((a, b) => segment.orientation === 'horizontal' ? a.x - b.x : a.y - b.y)
    for (let index = 1; index < near.length; index += 1) {
      const gap = segment.orientation === 'horizontal' ? near[index].x - near[index - 1].x : near[index].y - near[index - 1].y
      if (gap < 0.22) links.push([near[index - 1].id, near[index].id])
    }
  }
  return links.slice(0, 160)
}

export function analyzeDiscoverImage(image: { data: Uint8ClampedArray; width: number; height: number }): DiscoverLayout {
  const { data, width, height } = image
  if (width < 16 || height < 16) throw new Error('The photograph is too small to scan.')
  const gray = rgbaToGrayscale(data, width, height)
  const edges = sobelScores(gray, width, height)
  const corners = pickPeaks(harrisResponse(gray, width, height), width, height, 96, 16, true)
  const raw = [...collectRuns(edges, width, height, 'horizontal'), ...collectRuns(edges, width, height, 'vertical')]
  const floor = raw.filter(segment => segment.orientation === 'horizontal' && segment.y1 > 0.55 && lengthOf(segment) > 0.22)
    .sort((a, b) => b.strength * lengthOf(b) - a.strength * lengthOf(a))
  const walls = raw.filter(segment => segment.orientation === 'vertical' && lengthOf(segment) > 0.2)
  const separatedWalls = walls.filter((segment, index) => walls.findIndex(other => Math.abs(other.x1 - segment.x1) < 0.08) === index)
  const room = floor.length > 0 && separatedWalls.length >= 2 && Math.abs(separatedWalls[0].x1 - separatedWalls[separatedWalls.length - 1].x1) > 0.15
  const floorY = room ? floor[0].y1 : null
  const segments: StructureSegment[] = raw
    .sort((a, b) => b.strength * lengthOf(b) - a.strength * lengthOf(a))
    .slice(0, 24)
    .map((segment, id) => ({
      ...segment,
      id,
      role: segment.orientation === 'horizontal' && floorY != null && Math.abs(segment.y1 - floorY) < 0.03 ? 'floor' : segment.orientation === 'vertical' && lengthOf(segment) > 0.2 ? 'wall' : 'edge',
    }))
  const outlines = outlinesFrom(segments)
  const lines: SceneLine[] = segments.map(segment => {
    const a = imageToWorld(segment.x1, segment.y1, { width, height }, 0.08)
    const b = imageToWorld(segment.x2, segment.y2, { width, height }, 0.08)
    return { x1: a.x, y1: a.y, z1: a.z, x2: b.x, y2: b.y, z2: b.z, illustrative: false }
  })
  if (room && floorY != null) {
    const usable = separatedWalls.filter(segment => segment.y2 > floorY - 0.05).sort((a, b) => a.x1 - b.x1)
    const left = usable[0]
    const right = usable[usable.length - 1]
    if (left && right) {
      const hingeL = imageToWorld(left.x1, floorY, { width, height }, 0.08)
      const hingeR = imageToWorld(right.x1, floorY, { width, height }, 0.08)
      lines.push(
        { x1: hingeL.x, y1: hingeL.y, z1: 0.08, x2: hingeL.x, y2: hingeL.y - 0.04, z2: 1.25, illustrative: true },
        { x1: hingeR.x, y1: hingeR.y, z1: 0.08, x2: hingeR.x, y2: hingeR.y - 0.04, z2: 1.25, illustrative: true },
        { x1: hingeL.x, y1: hingeL.y - 0.04, z1: 1.25, x2: hingeR.x, y2: hingeR.y - 0.04, z2: 1.25, illustrative: true },
      )
    }
  }
  return {
    width,
    height,
    corners,
    regions: countRegions(edges, width, height),
    segments,
    outlines,
    links: linksAlong(segments, corners),
    lines,
    mode: room ? 'approximate-layout' : 'feature-map',
    floorY,
    note: room
      ? 'Approximate indoor layout. A measured lower horizontal boundary is used as a floor line, and separated vertical boundaries are used as wall lines. The forward depth is illustrative, not a verified 3D reconstruction.'
      : '2.5D feature map. This image did not contain a measurable floor line and separated wall lines, so no room was invented.',
  }
}

export function discoveryReport(fileName: string, layout: DiscoverLayout) {
  const listed = layout.segments.slice(0, 12).map(segment => `${segment.role} ${segment.orientation} (${segment.x1.toFixed(3)}, ${segment.y1.toFixed(3)})–(${segment.x2.toFixed(3)}, ${segment.y2.toFixed(3)})`)
  return [
    'Stillpoint discovery summary',
    `File: ${fileName}`,
    `Image size: ${layout.width}×${layout.height}`,
    'Image processing: complete on this device.',
    'External sharing: not shared. This scan did not send the photograph.',
    '',
    'Measured',
    `Corners: ${layout.corners.length}`,
    `High-contrast regions: ${layout.regions}`,
    `Straight structural segments: ${layout.segments.length}`,
    `Rectangular outlines: ${layout.outlines.length}`,
    `Layout reading: ${layout.mode === 'approximate-layout' ? 'approximate indoor layout' : '2.5D feature map'}`,
    layout.floorY == null ? 'Floor line: none measured' : `Floor line: y ${layout.floorY.toFixed(3)} of image height`,
    ...listed,
    layout.segments.length > listed.length ? `${layout.segments.length - listed.length} additional measured segments are counted above and omitted from this list.` : '',
    '',
    'Illustrative, not measured',
    layout.note,
    'Glowing nodes use measured image positions. Connecting lines follow those positions or a detected segment.',
    'Rectangular outlines are closed line geometry. They are not identified as windows, furniture, faces, or bodies.',
    layout.lines.some(line => line.illustrative) ? 'Lines marked by forward depth in the spatial view extend past the photograph. That depth is illustrative.' : 'No illustrative room depth was added.',
    '',
    'Stillpoint has mapped visual features from this photograph. These features can support further structural comparison with another image.',
    'This scan does not establish that the photograph is authentic, unedited, safe, or protected from manipulation.',
  ].filter(Boolean).join('\n')
}
