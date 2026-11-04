export type PointOrigin = 'ai' | 'manual' | 'local'

export type RoomObject = {
  name: string
  x: number
  y: number
  width: number
  height: number
  occludes?: string[]
  is_above?: string[]
  is_below?: string[]
  /**
   * Where this point came from. 'ai' = model suggestion awaiting review,
   * 'manual' = placed or corrected by the user, 'local' = on-device proposal.
   * Absent on legacy graphs; treated as 'manual'.
   */
  pointOrigin?: PointOrigin
  /**
   * True once the user has reviewed this point (placed by hand, confirmed,
   * or corrected after an AI suggestion). Absent on legacy graphs; treated
   * as confirmed so old scenes keep working.
   */
  confirmed?: boolean
}

export type SceneGraph = {
  room_objects: RoomObject[]
  total_stable_points?: number
  coverage_percent?: number
}

export type Residual = {
  name: string
  distance: number
  /** Signed displacement, suspect center minus source center. */
  dx: number
  dy: number
  aligned: boolean
}

export type Verdict = 'Likely derivative' | 'No link found' | 'Cannot determine'

export type AlignResult = {
  usable_points: number
  aligned_points: number
  agreement_percent: number
  verdict: Verdict
  residuals: Residual[]
  mean_residual: number | null
  /** Median displacement across correspondences. Null when nothing is shared. */
  median_shift: [number, number] | null
  /** Largest distance of any shift from the median shift. Informational only. */
  shift_spread: number | null
  /** True when at least two objects moved together within the threshold. */
  uniform_shift: boolean
  alignment_threshold: number
  excluded_person_objects: number
  invalid_objects: number
  duplicate_objects: number
  source_coverage_percent: number | null
  suspect_coverage_percent: number | null
}

export type EvidenceTone = 'success' | 'amber' | 'slate'

export type EvidenceState =
  | 'likely_derivative'
  | 'different_viewpoint'
  | 'insufficient_background'
  | 'no_link'

export type Presentation = {
  state: EvidenceState
  tone: EvidenceTone
  label: string
  summary: string
  note: string | null
}

export type Mask = {
  x: number
  y: number
  w: number
  h: number
}

export type MappingOrigin = 'manual' | 'ai-assist' | 'local'

export type StoredScene = {
  id: string
  label: string
  createdAt: string
  fileHash: string | null
  mask: Mask | null
  maskConfirmed: boolean
  personExcludedConfirmed: boolean
  graph: SceneGraph
  origin?: MappingOrigin
  model?: string | null
}

export type CorrespondenceStatus = 'candidate' | 'verified' | 'rejected'

export type DetectionSnapshot = {
  sourceWidth: number
  sourceHeight: number
  suspectWidth: number
  suspectHeight: number
  sourceFeatures: number
  suspectFeatures: number
  sourceCorners: Array<{ x: number; y: number }>
  suspectCorners: Array<{ x: number; y: number }>
}

export type ImageCorrespondence = {
  model: 'homography' | 'none'
  method: string
  /** Forward reprojection threshold in the suspected image's analysis pixels. */
  thresholdPx: number
  sourceFeatures: number
  suspectFeatures: number
  candidates: number
  verified: number
  rejected: number
  meanVerifiedErrorPx: number | null
  /** Row-major 3×3 map between normalized image coordinates. Not a camera matrix. */
  matrix: number[] | null
  matches: Array<{
    name: string
    sourceX: number
    sourceY: number
    suspectX: number
    suspectY: number
    status: CorrespondenceStatus
    errorPx: number | null
  }>
  /** Detected corners that were not kept as a reviewed pair. Coordinates are 0–1 in the analysis image. */
  unmatchedSource: Array<{ x: number; y: number }>
  unmatchedSuspect: Array<{ x: number; y: number }>
  renderedLimit: number
  limitation: string
}

/** Aggregate, non-coordinate summary of an explicitly consented facial geometry comparison. */
export type FaceGeometrySummary = {
  sourceLandmarks: number
  suspectLandmarks: number
  alignedLandmarks: number
  alignmentThreshold: number
  meanResidual: number | null
}

export type CaseRecord = {
  photoMethod?: string
  discovery?: { provider: 'TinEye'; domain: string; sourceLinks: string[]; providerRelevance: number | null }
  id: string
  createdAt: string
  sourceLabel: string
  suspectLabel: string
  sample: boolean
  blind: boolean
  engine: 'on-device'
  result: AlignResult
  presentation: Presentation
  sourceHash: string | null
  suspectHash: string | null
  detectedKeypoints?: { source: number; suspect: number } | null
  correspondence?: ImageCorrespondence | null
  faceGeometrySummary?: FaceGeometrySummary | null
  sourceFile?: { name: string; mimeType: string; sizeBytes: number } | null
  suspectFile?: { name: string; mimeType: string; sizeBytes: number } | null
  sourceMaskApplied?: boolean
  suspectMaskApplied?: boolean
  hashComparison: string
  maskApplied: boolean
  excludedInCheck: number
  sourceGraph: SceneGraph
  suspectGraph: SceneGraph
  pythonNote: string | null
  sourceOrigin?: MappingOrigin
  suspectOrigin?: MappingOrigin
  sourceModel?: string | null
  suspectModel?: string | null
}

export type StageUpdate = {
  id: 'prepare' | 'exclude' | 'map' | 'compare' | 'evidence'
  label: string
  state: 'active' | 'done'
  detail: string
}

export type ReviewNote = {
  id: string
  createdAt: string
  kind: 'review' | 'appeal' | 'counter-notice'
  note: string
  caseId: string | null
}

export type Settings = {
  blindMode: boolean
  pythonEngine: boolean
  maskingPreference?: 'local' | 'manual'
  externalImagesEnabled?: boolean
}
