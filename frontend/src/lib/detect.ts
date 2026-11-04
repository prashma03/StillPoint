/**
 * Experimental on-device background-proposal assistant.
 *
 * This is classical image processing over the actual photo pixels (edge
 * density per grid cell), computed locally in this browser tab. It is NOT
 * object recognition: it cannot name a door, a bed, or a person. It only
 * finds regions outside the person mask that contain enough visual detail to
 * serve as background reference areas. The user must label each proposed
 * region with a stable background name, or discard it.
 *
 * Scores are relative to the photo being analyzed (normalized per photo), so
 * they compare regions within one photo, never across photos.
 *
 * Everything here is pure and deterministic: same pixels, same proposals.
 */
import type { Mask } from './types'

export type Proposal = {
  /** Box on the 0–1000 scene-graph scale. */
  x: number
  y: number
  width: number
  height: number
  /** Relative detail score within this photo, 0–1. Not a detection certainty. */
  score: number
}

export type ProposalReport = {
  proposals: Proposal[]
  /** Share of unmasked cells with enough detail, 0–100. */
  coverage_percent: number
  cells_total: number
  cells_masked: number
  cells_with_detail: number
}

export const PROPOSAL_GRID = 8
export const PROPOSAL_MAX = 6
/** Normalized edge density a cell needs to count as background detail. */
export const DETAIL_THRESHOLD = 0.08

export function rgbaToGrayscale(data: Uint8ClampedArray | Uint8Array, width: number, height: number): Float32Array {
  const gray = new Float32Array(width * height)
  for (let i = 0; i < width * height; i += 1) {
    const r = data[i * 4]
    const g = data[i * 4 + 1]
    const b = data[i * 4 + 2]
    gray[i] = 0.299 * r + 0.587 * g + 0.114 * b
  }
  return gray
}

/** Sobel edge magnitude per pixel, normalized to 0–1 within this image. */
export function sobelScores(gray: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height)
  if (width < 3 || height < 3) return out
  let peak = 0
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      const gx =
        -gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1] +
        gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1]
      const gy =
        -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] +
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]
      const magnitude = Math.sqrt(gx * gx + gy * gy)
      out[i] = magnitude
      if (magnitude > peak) peak = magnitude
    }
  }
  if (peak > 0) {
    for (let i = 0; i < out.length; i += 1) out[i] /= peak
  }
  return out
}

/**
 * Harris corner response per pixel (0 where flat). Dependency-free and
 * deterministic: same pixels, same response. Used only to nudge an existing
 * landmark onto the nearest measured corner within a small radius — it never
 * invents points.
 *
 * Tradeoff note (see report): full ORB/FAST pipelines add rotation-invariant
 * keypoints plus descriptors for cross-image matching, but they need a native
 * or WASM dependency and produce anonymous keypoints that do not fit
 * name-matched scene-graph comparison. Harris runs on the pixels already in
 * the tab and keeps every landmark human-labeled and reviewable.
 */
export function harrisResponse(gray: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(width * height)
  if (width < 3 || height < 3) return out
  const gx = new Float32Array(width * height)
  const gy = new Float32Array(width * height)
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x
      gx[i] =
        -gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1] +
        gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1]
      gy[i] =
        -gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1] +
        gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]
    }
  }
  const K = 0.04
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      let sxx = 0
      let syy = 0
      let sxy = 0
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const j = (y + dy) * width + (x + dx)
          sxx += gx[j] * gx[j]
          syy += gy[j] * gy[j]
          sxy += gx[j] * gy[j]
        }
      }
      const det = sxx * syy - sxy * sxy
      const trace = sxx + syy
      const response = det - K * trace * trace
      out[y * width + x] = response > 0 ? response : 0
    }
  }
  return out
}

export type SnapResult = { x: number; y: number; moved: number } | null

/**
 * Move a 0–1000 landmark onto the strongest measured corner within
 * radiusUnits. Returns null when the neighborhood is flat or the point is
 * already on the local maximum — the caller then keeps the original.
 */
export function snapToCorner(
  gray: Float32Array,
  width: number,
  height: number,
  x1000: number,
  y1000: number,
  radiusUnits = 14,
): SnapResult {
  if (gray.length < width * height || width < 3 || height < 3) return null
  const response = harrisResponse(gray, width, height)
  const cx = Math.round((x1000 / 1000) * (width - 1))
  const cy = Math.round((y1000 / 1000) * (height - 1))
  const rx = Math.max(1, Math.round((radiusUnits / 1000) * width))
  const ry = Math.max(1, Math.round((radiusUnits / 1000) * height))
  let bestX = cx
  let bestY = cy
  let best = response[cy * width + cx] ?? 0
  for (let y = Math.max(1, cy - ry); y <= Math.min(height - 2, cy + ry); y += 1) {
    for (let x = Math.max(1, cx - rx); x <= Math.min(width - 2, cx + rx); x += 1) {
      const value = response[y * width + x]
      if (value > best) {
        best = value
        bestX = x
        bestY = y
      }
    }
  }
  if (best <= 0 || (bestX === cx && bestY === cy)) return null
  const x = Math.min(1000, Math.max(0, Math.round((bestX / (width - 1)) * 1000)))
  const y = Math.min(1000, Math.max(0, Math.round((bestY / (height - 1)) * 1000)))
  return { x, y, moved: Math.hypot(x - x1000, y - y1000) }
}

function cellCenterInMask(col: number, row: number, grid: number, mask: Mask | null): boolean {
  if (!mask) return false
  const cx = (col + 0.5) / grid
  const cy = (row + 0.5) / grid
  return cx >= mask.x && cx <= mask.x + mask.w && cy >= mask.y && cy <= mask.y + mask.h
}

export function proposeRegions(
  scores: Float32Array,
  width: number,
  height: number,
  mask: Mask | null,
  opts: { grid?: number; maxProposals?: number; minScore?: number } = {},
): ProposalReport {
  const grid = opts.grid ?? PROPOSAL_GRID
  const maxProposals = opts.maxProposals ?? PROPOSAL_MAX
  const minScore = opts.minScore ?? DETAIL_THRESHOLD
  const cellW = width / grid
  const cellH = height / grid

  type Cell = { col: number; row: number; score: number }
  const cells: Cell[] = []
  let masked = 0
  for (let row = 0; row < grid; row += 1) {
    for (let col = 0; col < grid; col += 1) {
      if (cellCenterInMask(col, row, grid, mask)) {
        masked += 1
        continue
      }
      const x0 = Math.floor(col * cellW)
      const x1 = Math.min(width, Math.ceil((col + 1) * cellW))
      const y0 = Math.floor(row * cellH)
      const y1 = Math.min(height, Math.ceil((row + 1) * cellH))
      let sum = 0
      let count = 0
      for (let y = y0; y < y1; y += 1) {
        for (let x = x0; x < x1; x += 1) {
          sum += scores[y * width + x]
          count += 1
        }
      }
      cells.push({ col, row, score: count > 0 ? sum / count : 0 })
    }
  }

  const unmasked = cells.length
  const detailed = cells.filter((cell) => cell.score >= DETAIL_THRESHOLD)
  // Deterministic order: strongest detail first, then top-to-bottom, left-to-right.
  const ranked = [...cells]
    .filter((cell) => cell.score >= minScore)
    .sort((a, b) => b.score - a.score || a.row - b.row || a.col - b.col)
    .slice(0, Math.max(0, maxProposals))

  const proposals: Proposal[] = ranked.map((cell) => {
    // Inset each cell slightly so the box sits on the detail, not the grid line.
    const inset = 0.08 / grid
    const x = Math.round(((cell.col + 0.08) / grid) * 1000)
    const y = Math.round(((cell.row + 0.08) / grid) * 1000)
    const edge = Math.round(((1 - inset * grid) / grid) * 1000)
    return { x, y, width: edge, height: edge, score: Math.round(cell.score * 1000) / 1000 }
  })

  return {
    proposals,
    coverage_percent: unmasked === 0 ? 0 : (Math.round((detailed.length / unmasked) * 1000) / 10),
    cells_total: grid * grid,
    cells_masked: masked,
    cells_with_detail: detailed.length,
  }
}
