import type { CaseRecord } from '../lib/types'
import type { FaceGeometryEvidence } from '../lib/facialGeometry'
import { methodLabel } from '../lib/composition'
import { FACE_LIMIT } from '../lib/faceCase'
import { FacialGeometryProof } from './FacialGeometryProof'
import { EvidenceDiagram } from './EvidenceDiagram'
import { ModalGeometryEvidenceView } from './ModalGeometryEvidence'
import { Button, useReducedMotion } from './ui'

export function AnalysisResults({ record, face, proofLink = true }: { record: CaseRecord; face: FaceGeometryEvidence | null; proofLink?: boolean }) {
  const reduced = useReducedMotion(), facial = record.analysisMethod === 'facial', summary = record.faceGeometrySummary
  return <section className="analysis-results stack" aria-label="Comparison results">
    <div className="analysis-results-heading"><div><span className="eyebrow">MEASURED ON THIS DEVICE</span><h3>{methodLabel(record.analysisMethod ?? 'background')}</h3></div><span className="status status-neutral">{facial ? 'Descriptive geometry' : record.presentation.label}</span></div>
    <dl className="analysis-result-metrics"><div><dt>{facial ? 'Detected reference landmarks' : 'Detected image corners'}</dt><dd>{facial ? `${summary?.sourceLandmarks ?? '—'} / ${summary?.suspectLandmarks ?? '—'}` : record.detectedKeypoints ? `${record.detectedKeypoints.source} / ${record.detectedKeypoints.suspect}` : 'Not measured'}</dd></div><div><dt>{facial ? `Within ${summary?.alignmentThreshold.toFixed(2) ?? '—'} eye spacings` : 'Aligned reviewed pairs'}</dt><dd>{facial ? `${summary?.alignedLandmarks ?? '—'} / ${summary?.sourceLandmarks ?? '—'}` : `${record.result.aligned_points} / ${record.result.usable_points}`}</dd></div><div><dt>{facial ? 'Mean normalized residual' : 'Geometric verification'}</dt><dd>{facial ? summary?.meanResidual == null ? 'Unavailable' : `${summary.meanResidual.toFixed(3)} eye spacings` : record.correspondence ? `${record.correspondence.verified} homography inliers` : 'Scene-map comparison'}</dd></div></dl>
    {facial ? face ? <FacialGeometryProof evidence={face} caseId={record.id} blind={record.blind} /> : <p className="note">Temporary landmark coordinates are no longer available. Aggregate measurements remain; run a new consented analysis to visualize facial points.</p> : <div className="analysis-background-diagram"><EvidenceDiagram source={record.sourceGraph} suspect={record.suspectGraph} residuals={record.result.residuals} showLines replayKey={record.id} reduced={reduced} sourceCaption="Original details" suspectCaption="Compared details" responsive /></div>}
    {!facial && record.modalGeometry?.status === 'completed' && <ModalGeometryEvidenceView evidence={record.modalGeometry.evidence} />}
    {!facial && record.modalGeometry?.status === 'fallback' && <p className="note">Optional Modal verification unavailable: {record.modalGeometry.reason} The on-device result remains unchanged.</p>}
    <p className="analysis-result-limits">{facial ? FACE_LIMIT : 'A background correspondence cannot establish identity, consent, manipulation, ownership, or wrongdoing. Missing matches do not prove the images are unrelated.'}{!facial && record.correspondence && ` ${record.correspondence.model === 'homography' ? `Mean verified reprojection: ${record.correspondence.meanVerifiedErrorPx?.toFixed(2) ?? 'unavailable'} px; threshold ${record.correspondence.thresholdPx} px.` : 'No stable image-plane transformation was established.'}`}</p>
    {proofLink && <Button to={`/proof?case=${encodeURIComponent(record.id)}`}>Continue to Proof</Button>}
  </section>
}
