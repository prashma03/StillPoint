export type RoomObject = {
  name: string
  x: number
  y: number
  width: number
  height: number
  occludes?: string[]
  is_above?: string[]
  is_below?: string[]
}

export type SceneGraph = {
  room_objects: RoomObject[]
  total_stable_points?: number
  coverage_percent?: number
}

export type Residual = {
  name: string
  distance: number
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

export type StoredScene = {
  id: string
  label: string
  createdAt: string
  fileHash: string | null
  mask: Mask | null
  maskConfirmed: boolean
  personExcludedConfirmed: boolean
  graph: SceneGraph
}

export type CaseRecord = {
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
  hashComparison: string
  maskApplied: boolean
  excludedInCheck: number
  sourceGraph: SceneGraph
  suspectGraph: SceneGraph
  pythonNote: string | null
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
}
