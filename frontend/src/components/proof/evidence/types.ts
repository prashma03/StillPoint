export type Provenance = 'simulated' | 'verification'

export interface CorrespondencePair {
  id: string
  /** Normalized image or room coordinates for verification data; room-local coordinates when simulated. */
  source: [number, number, number]
  target: [number, number, number]
  label: string
  confidence?: number
  strong?: boolean
}

export interface CorrespondenceDataset {
  provenance: Provenance
  pairs: CorrespondencePair[]
  /** Supplied by the backend when available; never inferred by this visualization. */
  transform?: { type: 'homography' | 'fundamental' | 'essential'; matrix: number[] }
  sourceLabel: string
  targetLabel: string
}

const isVec3 = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === 'number' && Number.isFinite(item))

/** Fail closed for malformed adapter payloads; never constructs correspondence pairs. */
export function validateDataset(raw: unknown): CorrespondenceDataset | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Partial<CorrespondenceDataset>
  if (data.provenance !== 'simulated' && data.provenance !== 'verification') return null
  if (!Array.isArray(data.pairs) || data.pairs.length === 0) return null
  if (typeof data.sourceLabel !== 'string' || typeof data.targetLabel !== 'string') return null
  for (const pair of data.pairs) {
    if (!pair || typeof pair.id !== 'string' || typeof pair.label !== 'string' || !isVec3(pair.source) || !isVec3(pair.target)) return null
    if (pair.confidence !== undefined && (typeof pair.confidence !== 'number' || !Number.isFinite(pair.confidence) || pair.confidence < 0 || pair.confidence > 1)) return null
    if (pair.strong !== undefined && typeof pair.strong !== 'boolean') return null
  }
  if (data.transform && (!Array.isArray(data.transform.matrix) || data.transform.matrix.length !== 9 || !data.transform.matrix.every((value) => typeof value === 'number' && Number.isFinite(value)))) return null
  return data as CorrespondenceDataset
}
