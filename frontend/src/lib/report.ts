import { ALIGN_DISTANCE, DERIVATIVE_AGREEMENT, MIN_USABLE_FOR_VERDICT, NO_LINK_AGREEMENT } from './align'
import type { AlignResult, CaseRecord, MappingOrigin } from './types'
import { FACE_LIMIT } from './facialGeometry'

export function mappingLabel(origin: MappingOrigin | undefined, model: string | null | undefined): string {
  if (origin === 'local') return 'Experimental local feature proposals with user edits.'
  if (origin === 'ai-assist') return model ? `AI-assisted (${model}).` : 'AI-assisted.'
  if (origin === 'manual') return 'Manual point placement.'
  return 'Not recorded.'
}

export const PROOF_LIMITS = [
  'Who created the image',
  'Whether distribution was consensual',
  'The identity of the depicted person',
  'Whether unrelated content was composited into the background',
] as const

export const SCIENCE_LIMIT =
  'Background alignment alone cannot establish the identity of the depicted person, consent, or wrongdoing.'

export const PUNISHMENT_RULE =
  'A background match alone cannot trigger automatic punishment or removal.'

export const METHOD_SUMMARY =
  `Named-background center comparison on a 0–1000 scale. A shared object aligns when its center moves ` +
  `less than ${ALIGN_DISTANCE} units. With at least ${MIN_USABLE_FOR_VERDICT} shared objects, ` +
  `${DERIVATIVE_AGREEMENT}% or more aligned is Likely derivative, ${NO_LINK_AGREEMENT}% or less is No link found, ` +
  `and anything else is Cannot determine. Person-named objects are excluded before scoring. ` +
  `Shift diagnostics are informational and never change the verdict.`

export const STILLPOINT_VERSION = '0.1.0'

export function hashComparison(source: string | null, suspect: string | null): string {
  if (!source || !suspect) return 'Not available'
  if (source === suspect) return 'File bytes are identical.'
  return 'File bytes differ. This is not a visual similarity score.'
}

export function formatCoverage(value: number | null): string {
  if (value == null) return 'Not provided'
  return `${value}%`
}

export function formatResidual(value: number | null): string {
  if (value == null) return 'Not available'
  return value.toFixed(2)
}

export function reportText(record: CaseRecord): string {
  if (record.analysisMethod === 'facial') {
    const face = record.faceGeometrySummary
    return ['Stillpoint redacted facial geometry summary', `Case: ${record.id}`, `Analyzed: ${record.createdAt}`, 'Method: Explicitly consented on-device Facial Landmark Geometry. No background or identity comparison ran.', `Source: ${record.sourceLabel}`, `Compared: ${record.suspectLabel}`, `Reference landmarks: ${face?.sourceLandmarks ?? 'unavailable'} / ${face?.suspectLandmarks ?? 'unavailable'}`, `Within threshold: ${face?.alignedLandmarks ?? 'unavailable'} at ${face?.alignmentThreshold ?? 'unavailable'} inter-eye spacings`, `Mean residual: ${face?.meanResidual ?? 'unavailable'} inter-eye spacings`, record.photoMethod, FACE_LIMIT, 'No raw facial coordinates, face templates, or photograph pixels are included. This is not a forensic opinion or legally certified evidence.'].filter(Boolean).join('\n') + '\n'
  }
  const lines = [
    'Stillpoint redacted summary',
    record.sample ? 'Sample scene graphs. Not a photograph and not your images.' : 'Redacted scene comparison. No photograph is included.',
    `Case: ${record.id}`,
    `Analyzed: ${record.createdAt}`,
    `Stillpoint version: ${STILLPOINT_VERSION}`,
    `Method: ${METHOD_SUMMARY}`,
    ...(record.photoMethod ? [`Photo preparation: ${record.photoMethod}`] : []),
    ...(record.faceGeometrySummary ? [
      'Consent-based facial geometry (aggregate only; not identity verification):',
      `Reference landmarks: ${record.faceGeometrySummary.sourceLandmarks} original / ${record.faceGeometrySummary.suspectLandmarks} suspected.`,
      `Landmarks within ${record.faceGeometrySummary.alignmentThreshold.toFixed(2)} inter-eye spacings: ${record.faceGeometrySummary.alignedLandmarks}.`,
      `Mean normalized landmark residual: ${record.faceGeometrySummary.meanResidual == null ? 'not available' : record.faceGeometrySummary.meanResidual.toFixed(3)} inter-eye spacings.`,
      'Raw facial landmark coordinates are not included in this report. Facial-shape geometry does not establish identity or shared image origin.',
    ] : []),
    'Provenance: scene-graph proposals may be manual, local edge-region suggestions, or optional AI-assisted mapping. AI-assisted mapping sends the consented redacted image to the configured external model provider; see the mapping fields below.',
    '',
    `Source: ${record.sourceLabel}`,
    `Suspect: ${record.suspectLabel}`,
    ...(record.discovery ? [
      `Discovery provider: ${record.discovery.provider}; domain: ${record.discovery.domain}`,
      `Provider relevance: ${record.discovery.providerRelevance ?? 'not supplied'} (not geometric verification)`,
      ...record.discovery.sourceLinks.map(link => `Candidate source: ${link}`),
      'The local candidate file and its source association were supplied by the user; Stillpoint did not authenticate that association.',
    ] : []),
    `Engine verdict: ${record.result.verdict}`,
    record.presentation.summary,
    record.presentation.note ?? '',
    '',
    `Matched reference points: ${record.result.aligned_points} of ${record.result.usable_points}`,
    `Geometric agreement: ${record.result.agreement_percent.toFixed(1)}%`,
    `Alignment residual: ${formatResidual(record.result.mean_residual)} (threshold ${record.result.alignment_threshold} on a 0–1000 scale)`,
    ...(record.correspondence ? [
      `Homography model: ${record.correspondence.model}. ${record.correspondence.method}.`,
      `Features retained: ${record.correspondence.sourceFeatures} original, ${record.correspondence.suspectFeatures} suspected (strongest Harris corners, at most 100 each).`,
      `Patch candidates: ${record.correspondence.candidates}. Verified inliers: ${record.correspondence.verified}. Rejected: ${record.correspondence.rejected}.`,
      `Mean verified reprojection: ${record.correspondence.meanVerifiedErrorPx == null ? 'not available' : `${record.correspondence.meanVerifiedErrorPx.toFixed(2)} px`} (threshold ${record.correspondence.thresholdPx} px).`,
      record.correspondence.limitation,
    ] : []),
    ...(record.modalGeometry?.status === 'completed' ? [
      `Supplemental Modal geometric verification: ${record.modalGeometry.evidence.verified_inliers} RANSAC inliers from ${record.modalGeometry.evidence.candidate_matches} actual feature candidates; uncertainty ${record.modalGeometry.evidence.uncertainty.status}. This did not change the on-device verdict.`,
      `Modal alignment: ${record.modalGeometry.evidence.alignment.model}; mean inlier reprojection ${record.modalGeometry.evidence.alignment.mean_inlier_reprojection_error_px == null ? 'not available' : `${record.modalGeometry.evidence.alignment.mean_inlier_reprojection_error_px.toFixed(2)} px`}; source hull coverage ${(record.modalGeometry.evidence.alignment.source_inlier_hull_coverage * 100).toFixed(2)}%.`,
      ...record.modalGeometry.evidence.matches.map((match, index) => `Modal measured pair ${index + 1}: source (${match.source.x.toFixed(5)}, ${match.source.y.toFixed(5)}), compared (${match.suspect.x.toFixed(5)}, ${match.suspect.y.toFixed(5)}), ${match.inlier ? 'RANSAC inlier' : 'rejected'}, reprojection ${match.reprojection_error_px == null ? 'unavailable' : `${match.reprojection_error_px.toFixed(3)} px`}.`),
    ] : []),
    `Background coverage in source graph: ${formatCoverage(record.result.source_coverage_percent)}`,
    `Background coverage in suspect graph: ${formatCoverage(record.result.suspect_coverage_percent)}`,
    `Shift pattern: ${shiftLabel(record.result)} (describes movement only; never changes the verdict)`,
    `File hash comparison: ${record.hashComparison}`,
    `Person-named objects excluded: ${record.result.excluded_person_objects + record.excludedInCheck}`,
    `Person mask confirmed: ${record.maskApplied ? 'Yes' : 'No'}`,
    `Source mapping: ${mappingLabel(record.sourceOrigin, record.sourceModel)}`,
    `Suspect mapping: ${mappingLabel(record.suspectOrigin, record.suspectModel)}`,
    `Source objects (${record.sourceGraph.room_objects.length}): ${graphNames(record.sourceGraph)}`,
    `Suspect objects (${record.suspectGraph.room_objects.length}): ${graphNames(record.suspectGraph)}`,
    '',
    'Reference points',
    ...record.result.residuals.map(
      (item) =>
        `- ${item.name}: residual ${item.distance.toFixed(2)} · shift (${signed(item.dx)}, ${signed(item.dy)}) · ${item.aligned ? 'aligned' : 'not aligned'}`,
    ),
    '',
    'What this proof does not establish',
    ...PROOF_LIMITS.map((item) => `- ${item}`),
    '',
    'Practical next steps',
    '- Keep the original files unchanged and preserve the original device/export context where available; use copies for review.',
    '- If you choose to report suspected misuse, use the relevant platform’s official reporting and support channels. This summary is not submitted automatically.',
    '',
    SCIENCE_LIMIT,
    PUNISHMENT_RULE,
    '',
    'Scene matching cannot establish the source when the background has been replaced. That condition is not detected automatically in this build.',
    'Sealed identity verification is not available in this build.',
    record.pythonNote ?? '',
    '',
    'The named-point geometry comparison was computed in the browser. This file contains no photograph. If AI-assisted mapping was used, the scene-graph suggestions were generated by the configured external model provider as noted above.',
  ]
  return lines.filter((line) => line !== '').join('\n') + '\n'
}

export function shiftLabel(result: AlignResult): string {
  if (result.median_shift == null || result.shift_spread == null) return 'Not available'
  const [dx, dy] = result.median_shift
  const kind = result.uniform_shift ? 'Uniform' : 'Scattered'
  return `${kind} (median ${dx.toFixed(1)}, ${dy.toFixed(1)} · spread ${result.shift_spread.toFixed(1)})`
}

/** Plain-language reasons behind the verdict. Never restates the verdict as a certainty. */
export function verdictExplanation(result: AlignResult): string[] {
  const lines: string[] = []
  if (result.usable_points < MIN_USABLE_FOR_VERDICT) {
    lines.push(
      `Only ${result.usable_points} shared background object(s) were available. A decisive verdict needs at least ${MIN_USABLE_FOR_VERDICT}, so the engine cannot determine a link.`,
    )
  } else if (result.verdict === 'Likely derivative') {
    lines.push(
      `${result.aligned_points} of ${result.usable_points} shared objects aligned — ${result.agreement_percent.toFixed(1)}% agreement (needs ${DERIVATIVE_AGREEMENT}% or more).`,
    )
  } else if (result.verdict === 'No link found') {
    lines.push(
      `${result.aligned_points} of ${result.usable_points} shared objects aligned — ${result.agreement_percent.toFixed(1)}% agreement (${NO_LINK_AGREEMENT}% or less). This does not prove the images are unrelated.`,
    )
  } else {
    lines.push(
      `${result.aligned_points} of ${result.usable_points} shared objects aligned — ${result.agreement_percent.toFixed(1)}% agreement falls between the ${NO_LINK_AGREEMENT}% and ${DERIVATIVE_AGREEMENT}% thresholds, so the engine cannot determine a link.`,
    )
  }
  if (result.uniform_shift && result.verdict !== 'Likely derivative' && result.shift_spread != null) {
    lines.push(
      `All shared points moved together (spread ${result.shift_spread.toFixed(1)}), which is consistent with a crop or resize rather than a moved camera. The engine stays conservative: this note never upgrades a verdict.`,
    )
  }
  if (result.source_coverage_percent == null && result.suspect_coverage_percent == null) {
    lines.push('No coverage percentage was provided for either graph, so completeness is unknown.')
  }
  const excluded = result.excluded_person_objects
  if (excluded > 0) {
    lines.push(`${excluded} person-named object(s) were excluded before scoring. People are never reference points.`)
  }
  return lines
}

export function metricRows(result: AlignResult, hash: string): { label: string; value: string }[] {
  return [
    { label: 'Matched reference points', value: `${result.aligned_points} of ${result.usable_points}` },
    { label: 'Geometric agreement', value: `${result.agreement_percent.toFixed(1)}%` },
    { label: 'Alignment residual', value: formatResidual(result.mean_residual) },
    { label: 'Shift pattern', value: shiftLabel(result) },
    { label: 'Background coverage', value: coveragePair(result) },
    { label: 'File hash comparison', value: hash },
  ]
}

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}`
}

function graphNames(graph: CaseRecord['sourceGraph']): string {
  const names = graph.room_objects.map((obj) => obj.name)
  return names.length > 0 ? names.join(', ') : 'none'
}

function coveragePair(result: AlignResult): string {
  const source = formatCoverage(result.source_coverage_percent)
  const suspect = formatCoverage(result.suspect_coverage_percent)
  if (source === 'Not provided' && suspect === 'Not provided') return 'Not provided'
  return `Source ${source} · Suspect ${suspect}`
}
