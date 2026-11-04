/** 2D homography fit. This is a projective map between image planes, not a 3D reconstruction. */

export type PlanePoint = { x: number; y: number }

export type HomographyStatus = 'candidate' | 'verified' | 'rejected'

export type HomographyFit = {
  /** Row-major 3×3 map from source pixels to suspected-image pixels. Null when fewer than four consistent pairs exist. */
  matrix: number[] | null
  statuses: HomographyStatus[]
  /** Forward reprojection error in suspected-image pixels. Null when no model was fit. */
  errorPx: Array<number | null>
  verified: number
  rejected: number
  candidates: number
  meanVerifiedErrorPx: number | null
  thresholdPx: number
  model: 'homography'
  method: 'Hartley-normalized DLT with deterministic RANSAC, refit on inliers'
}

const THRESHOLD_PX = 4.5
const ITERATIONS = 160

function mulberry(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

function solve(matrix: number[][], values: number[]): number[] | null {
  const size = values.length
  const rows = matrix.map((row, index) => [...row, values[index]])
  for (let column = 0; column < size; column += 1) {
    let pivot = column
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(rows[row][column]) > Math.abs(rows[pivot][column])) pivot = row
    }
    if (Math.abs(rows[pivot][column]) < 1e-10) return null
    const chosen = rows[pivot]
    rows[pivot] = rows[column]
    rows[column] = chosen
    const scale = rows[column][column]
    for (let cell = column; cell <= size; cell += 1) rows[column][cell] /= scale
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue
      const factor = rows[row][column]
      for (let cell = column; cell <= size; cell += 1) rows[row][cell] -= factor * rows[column][cell]
    }
  }
  return rows.map((row) => row[size])
}

function multiply(left: number[], right: number[]) {
  const out = Array(9).fill(0)
  for (let row = 0; row < 3; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      for (let k = 0; k < 3; k += 1) out[row * 3 + column] += left[row * 3 + k] * right[k * 3 + column]
    }
  }
  return out
}

function invert(matrix: number[]) {
  const [a, b, c, d, e, f, g, h, i] = matrix
  const A = e * i - f * h
  const B = c * h - b * i
  const C = b * f - c * e
  const D = f * g - d * i
  const E = a * i - c * g
  const F = c * d - a * f
  const G = d * h - e * g
  const H = b * g - a * h
  const I = a * e - b * d
  const det = a * A + b * D + c * G
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) return null
  return [A, B, C, D, E, F, G, H, I].map((value) => value / det)
}

function normalize(points: PlanePoint[]) {
  const count = points.length || 1
  const cx = points.reduce((sum, point) => sum + point.x, 0) / count
  const cy = points.reduce((sum, point) => sum + point.y, 0) / count
  const mean = points.reduce((sum, point) => sum + Math.hypot(point.x - cx, point.y - cy), 0) / count
  const scale = mean > 1e-8 ? Math.SQRT2 / mean : 1
  return {
    points: points.map((point) => ({ x: (point.x - cx) * scale, y: (point.y - cy) * scale })),
    transform: [scale, 0, -scale * cx, 0, scale, -scale * cy, 0, 0, 1],
  }
}

function equations(source: PlanePoint, target: PlanePoint) {
  const { x, y } = source
  const { x: u, y: v } = target
  return {
    rows: [
      [x, y, 1, 0, 0, 0, -u * x, -u * y],
      [0, 0, 0, x, y, 1, -v * x, -v * y],
    ],
    values: [u, v],
  }
}

function modelFromPairs(source: PlanePoint[], target: PlanePoint[]) {
  const left = normalize(source)
  const right = normalize(target)
  const rows: number[][] = []
  const values: number[] = []
  left.points.forEach((point, index) => {
    const equation = equations(point, right.points[index])
    rows.push(...equation.rows)
    values.push(...equation.values)
  })
  const solved = rows.length === 8 ? solve(rows, values) : leastSquares(rows, values)
  if (!solved) return null
  const normalized = [solved[0], solved[1], solved[2], solved[3], solved[4], solved[5], solved[6], solved[7], 1]
  const rightInverse = invert(right.transform)
  if (!rightInverse) return null
  return multiply(multiply(rightInverse, normalized), left.transform)
}

function leastSquares(rows: number[][], values: number[]) {
  const size = 8
  const normal = Array.from({ length: size }, () => Array(size).fill(0))
  const target = Array(size).fill(0)
  rows.forEach((row, index) => {
    for (let r = 0; r < size; r += 1) {
      target[r] += row[r] * values[index]
      for (let c = 0; c < size; c += 1) normal[r][c] += row[r] * row[c]
    }
  })
  return solve(normal, target)
}

export function applyHomography(matrix: number[], point: PlanePoint): PlanePoint | null {
  const weight = matrix[6] * point.x + matrix[7] * point.y + matrix[8]
  if (!Number.isFinite(weight) || Math.abs(weight) < 1e-8) return null
  return {
    x: (matrix[0] * point.x + matrix[1] * point.y + matrix[2]) / weight,
    y: (matrix[3] * point.x + matrix[4] * point.y + matrix[5]) / weight,
  }
}

function reprojection(matrix: number[], source: PlanePoint, target: PlanePoint, width: number, height: number) {
  const projected = applyHomography(matrix, source)
  if (!projected) return Number.POSITIVE_INFINITY
  return Math.hypot((projected.x - target.x) * width, (projected.y - target.y) * height)
}

function spread(points: PlanePoint[]) {
  let area = 0
  for (let index = 1; index < points.length - 1; index += 1) {
    area += Math.abs(
      (points[index].x - points[0].x) * (points[index + 1].y - points[0].y)
      - (points[index + 1].x - points[0].x) * (points[index].y - points[0].y),
    )
  }
  return area
}

export function verifyHomography(source: PlanePoint[], target: PlanePoint[], width: number, height: number): HomographyFit {
  const count = Math.min(source.length, target.length)
  const empty: HomographyFit = {
    matrix: null,
    statuses: Array.from({ length: count }, () => 'candidate' as const),
    errorPx: Array.from({ length: count }, () => null),
    verified: 0,
    rejected: 0,
    candidates: count,
    meanVerifiedErrorPx: null,
    thresholdPx: THRESHOLD_PX,
    model: 'homography',
    method: 'Hartley-normalized DLT with deterministic RANSAC, refit on inliers',
  }
  if (count < 4 || width <= 0 || height <= 0) return empty
  const sources = source.slice(0, count)
  const targets = target.slice(0, count)
  const random = mulberry(count * 97 + Math.round(sources[0].x * 1000 + targets[0].y * 1000))
  let best: number[] = []
  let bestModel: number[] | null = null
  for (let attempt = 0; attempt < ITERATIONS; attempt += 1) {
    const picked: number[] = []
    while (picked.length < 4) {
      const index = Math.floor(random() * count)
      if (!picked.includes(index)) picked.push(index)
    }
    if (spread(picked.map((index) => sources[index])) < 1e-4) continue
    const model = modelFromPairs(picked.map((index) => sources[index]), picked.map((index) => targets[index]))
    if (!model) continue
    const inliers: number[] = []
    for (let index = 0; index < count; index += 1) {
      if (reprojection(model, sources[index], targets[index], width, height) <= THRESHOLD_PX) inliers.push(index)
    }
    if (inliers.length > best.length) {
      best = inliers
      bestModel = model
      if (inliers.length === count) break
    }
  }
  if (!bestModel || best.length < 4) return empty
  const refit = modelFromPairs(best.map((index) => sources[index]), best.map((index) => targets[index])) ?? bestModel
  const inliers: number[] = []
  const errors = sources.map((point, index) => reprojection(refit, point, targets[index], width, height))
  errors.forEach((error, index) => { if (error <= THRESHOLD_PX) inliers.push(index) })
  if (inliers.length < 4) return empty
  const statuses = errors.map((error) => (error <= THRESHOLD_PX ? 'verified' : 'rejected')) as HomographyStatus[]
  const verifiedErrors = errors.filter((error) => error <= THRESHOLD_PX)
  return {
    ...empty,
    matrix: refit,
    statuses,
    errorPx: errors.map((error) => (Number.isFinite(error) ? error : null)),
    verified: inliers.length,
    rejected: count - inliers.length,
    candidates: count,
    meanVerifiedErrorPx: verifiedErrors.reduce((sum, error) => sum + error, 0) / verifiedErrors.length,
  }
}
