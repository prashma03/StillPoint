/**
 * Photograph-to-proposals pipeline. Local only: pixels never leave the tab.
 *
 * There is no remote extraction step because no verified remote model is
 * configured. analyzeBuffer() runs the experimental on-device assistant over
 * a decoded frame and returns labeled-by-user proposals or a named error.
 * It never invents a scene graph: empty, low-detail, and masked-out photos
 * fail loudly so the user falls back to manual points or a graph file.
 */
import { MIN_USABLE_FOR_VERDICT } from './align'
import { PROPOSAL_GRID, PROPOSAL_MAX, proposeRegions, rgbaToGrayscale, sobelScores, type Proposal } from './detect'
import { checkMask } from './segment'
import type { Mask } from './types'

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_ANALYSIS_DIMENSION = 1600
export const ACCEPTED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/bmp']

export type AnalysisErrorCode =
  | 'mask_unconfirmed'
  | 'mask_invalid'
  | 'mask_too_large'
  | 'unsupported_format'
  | 'too_large'
  | 'decode_failed'
  | 'no_detail'

export type AnalysisError = { code: AnalysisErrorCode; message: string }

export type AnalysisOk = {
  ok: true
  proposals: Proposal[]
  coverage_percent: number
  /** Fewer regions than a decisive comparison needs. Manual points can fill the gap. */
  insufficient: boolean
  detail_note: string
}

export type AnalysisResult = AnalysisOk | { ok: false; error: AnalysisError }

export function checkImageFile(file: { size: number; type: string; name: string }): AnalysisError | null {
  if (file.size > MAX_IMAGE_BYTES) {
    return { code: 'too_large', message: 'That file is larger than 20 MB.' }
  }
  const typeOk = ACCEPTED_IMAGE_TYPES.includes(file.type.toLowerCase())
  const extOk = /\.(jpe?g|png|webp|gif|bmp)$/i.test(file.name)
  if (!typeOk && !extOk) {
    return { code: 'unsupported_format', message: 'Choose a JPEG, PNG, WebP, GIF, or BMP photograph.' }
  }
  return null
}

export function analyzeBuffer(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
  mask: Mask | null,
  maskConfirmed: boolean,
  opts: { grid?: number; maxProposals?: number } = {},
): AnalysisResult {
  if (!maskConfirmed || !mask) {
    return {
      ok: false,
      error: {
        code: 'mask_unconfirmed',
        message: 'Confirm the person mask before analysis. Nothing is analyzed until the mask is confirmed.',
      },
    }
  }
  const maskCheck = checkMask(mask)
  if (!maskCheck.ok) {
    return { ok: false, error: { code: 'mask_invalid', message: maskCheck.problems[0] } }
  }
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 16 || height < 16) {
    return { ok: false, error: { code: 'decode_failed', message: 'That photograph could not be decoded.' } }
  }
  if (width > MAX_ANALYSIS_DIMENSION || height > MAX_ANALYSIS_DIMENSION) {
    return {
      ok: false,
      error: {
        code: 'too_large',
        message: `That photograph is larger than ${MAX_ANALYSIS_DIMENSION}px on one side. It was not analyzed.`,
      },
    }
  }
  if (rgba.length < width * height * 4) {
    return { ok: false, error: { code: 'decode_failed', message: 'That photograph could not be decoded.' } }
  }

  const gray = rgbaToGrayscale(rgba, width, height)
  const scores = sobelScores(gray, width, height)
  const report = proposeRegions(scores, width, height, mask, {
    grid: opts.grid ?? PROPOSAL_GRID,
    maxProposals: opts.maxProposals ?? PROPOSAL_MAX,
  })

  const totalCells = report.cells_total
  if (report.cells_masked / totalCells > 0.9) {
    return {
      ok: false,
      error: {
        code: 'mask_too_large',
        message: 'The mask covers almost the whole photograph, leaving no background to analyze.',
      },
    }
  }
  if (report.proposals.length === 0) {
    return {
      ok: false,
      error: {
        code: 'no_detail',
        message:
          'No stable background detail was found outside the mask. Add manual background points instead, or choose a photo with more visible room.',
      },
    }
  }
  const insufficient = report.proposals.length < MIN_USABLE_FOR_VERDICT
  return {
    ok: true,
    proposals: report.proposals,
    coverage_percent: report.coverage_percent,
    insufficient,
    detail_note: insufficient
      ? `Only ${report.proposals.length} region(s) proposed. A decisive comparison needs at least ${MIN_USABLE_FOR_VERDICT} shared points, so add manual points or choose a more detailed photo.`
      : `${report.proposals.length} regions proposed. Label each with the background object it shows, or discard it.`,
  }
}
