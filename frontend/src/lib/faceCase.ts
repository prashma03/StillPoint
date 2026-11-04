import { compareGraphs } from './align'
import { hashComparison } from './report'
import type { CheckSession } from './checkSession'
import type { FaceGeometryEvidence } from './facialGeometry'
import type { CaseRecord } from './types'
import { FACE_LIMIT } from './facialGeometry'

export { FACE_LIMIT } from './facialGeometry'

/** Coordinate-free record. Selected facial points belong only in CaseProvider memory. */
export function makeFaceCase(session: CheckSession, face: FaceGeometryEvidence): CaseRecord {
  const empty = { room_objects: [] }
  const metadata = (photo: CheckSession['original']) => photo.file ? { name: photo.file.name, mimeType: photo.file.type, sizeBytes: photo.file.size } : null
  return {
    id: crypto.randomUUID(), createdAt: new Date().toISOString(), analysisMethod: 'facial',
    sourceLabel: session.original.label, suspectLabel: session.suspicious.label,
    sample: false, blind: session.blind || !session.viewing, engine: 'on-device',
    // Legacy record shape: no background comparison ran. All face metrics are below.
    result: compareGraphs(empty, empty),
    presentation: { state: 'insufficient_background', tone: 'slate', label: 'Facial geometry measured', summary: 'Descriptive facial-shape measurements only.', note: FACE_LIMIT },
    sourceHash: session.original.hash, suspectHash: session.suspicious.hash,
    sourceFile: metadata(session.original), suspectFile: metadata(session.suspicious),
    sourceMaskApplied: !!(session.original.masks.length || session.original.pixelMask?.data.some(Boolean)),
    suspectMaskApplied: !!(session.suspicious.masks.length || session.suspicious.pixelMask?.data.some(Boolean)),
    maskApplied: !!(session.original.masks.length || session.suspicious.masks.length || session.original.pixelMask?.data.some(Boolean) || session.suspicious.pixelMask?.data.some(Boolean)),
    sourceGraph: empty, suspectGraph: empty, excludedInCheck: 0, pythonNote: null,
    hashComparison: hashComparison(session.original.hash, session.suspicious.hash),
    photoMethod: 'Explicitly consented on-device facial landmark geometry. Selected reference landmarks were normalized using estimated 3D eye/chin axes and inter-eye spacing. Existing privacy covers were applied first. No background comparison or identity matching ran. Raw coordinates are held only in active memory and excluded from storage and reports.',
    faceGeometrySummary: { sourceLandmarks: face.sourceLandmarkCount, suspectLandmarks: face.suspectLandmarkCount, alignedLandmarks: face.alignedLandmarks, alignmentThreshold: face.alignmentThreshold, meanResidual: face.meanResidual },
  }
}
