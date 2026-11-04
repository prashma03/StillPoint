import type { ModalGeometryEvidence } from '../lib/types'

/** Coordinate-only view of the actual features and RANSAC classifications returned by Modal. */
export function ModalGeometryEvidenceView({ evidence }: { evidence: ModalGeometryEvidence }) {
  const matches = evidence.matches.slice(0, 128)
  return <section className="modal-evidence" aria-label="Modal geometric correspondences">
    <div className="analysis-results-heading"><div><span className="eyebrow">SUPPLEMENTAL REMOTE MEASUREMENT · MODAL</span><h3>Measured image-feature correspondences</h3></div><span className="status status-neutral">Uncertainty: {evidence.uncertainty.status}</span></div>
    <dl className="analysis-result-metrics"><div><dt>Detected features</dt><dd>{evidence.source_features} / {evidence.suspect_features}</dd></div><div><dt>RANSAC inliers</dt><dd>{evidence.verified_inliers} / {evidence.candidate_matches}</dd></div><div><dt>Mean reprojection error</dt><dd>{evidence.alignment.mean_inlier_reprojection_error_px == null ? 'Unavailable' : `${evidence.alignment.mean_inlier_reprojection_error_px.toFixed(2)} px`}</dd></div></dl>
    <svg className="modal-match-map" viewBox="0 0 1000 390" role="img" aria-label={`${matches.length} actual Modal image correspondences; cyan lines are RANSAC inliers, coral lines are rejected`}>
      <rect x="24" y="24" width="390" height="340" rx="12" /><rect x="586" y="24" width="390" height="340" rx="12" />
      <text x="38" y="50">Original redacted image coordinates</text><text x="600" y="50">Compared redacted image coordinates</text>
      {matches.map((match, index) => {
        const x1 = 24 + match.source.x * 390, y1 = 24 + match.source.y * 340
        const x2 = 586 + match.suspect.x * 390, y2 = 24 + match.suspect.y * 340
        const color = match.inlier ? '#67e8f9' : '#fb7185'
        return <g key={`${index}-${match.source.x}-${match.suspect.x}`}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke={color} opacity=".48" /><circle cx={x1} cy={y1} r="4" fill={color} /><circle cx={x2} cy={y2} r="4" fill={color} /></g>
      })}
    </svg>
    <p className="muted">Cyan indicates measured RANSAC inliers; coral indicates measured rejected matches. Points are normalized coordinates in the respective redacted analysis images. This coordinate map shows actual feature detections, not image pixels or reconstructed rooms.</p>
    {evidence.uncertainty.reasons.length > 0 && <p className="note">Uncertainty indicators: {evidence.uncertainty.reasons.join(', ')}.</p>}
    <p className="note">Supplemental Modal measurement. It does not alter the on-device verdict. {evidence.limitations.join(' ')}</p>
  </section>
}
