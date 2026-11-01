import type { AlignResult, CaseRecord } from './types'

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
  const lines = [
    'Stillpoint redacted summary',
    record.sample ? 'Sample scene graphs. Not a photograph and not your images.' : 'Redacted scene comparison. No photograph is included.',
    '',
    `Source: ${record.sourceLabel}`,
    `Suspect: ${record.suspectLabel}`,
    `Engine verdict: ${record.result.verdict}`,
    record.presentation.summary,
    record.presentation.note ?? '',
    '',
    `Matched reference points: ${record.result.aligned_points} of ${record.result.usable_points}`,
    `Geometric agreement: ${record.result.agreement_percent.toFixed(1)}%`,
    `Alignment residual: ${formatResidual(record.result.mean_residual)} (threshold ${record.result.alignment_threshold} on a 0–1000 scale)`,
    `Background coverage in source graph: ${formatCoverage(record.result.source_coverage_percent)}`,
    `Background coverage in suspect graph: ${formatCoverage(record.result.suspect_coverage_percent)}`,
    `File hash comparison: ${record.hashComparison}`,
    `Person-named objects excluded: ${record.result.excluded_person_objects + record.excludedInCheck}`,
    `Person mask confirmed: ${record.maskApplied ? 'Yes' : 'No'}`,
    '',
    'Reference points',
    ...record.result.residuals.map(
      (item) => `- ${item.name}: residual ${item.distance.toFixed(2)} · ${item.aligned ? 'aligned' : 'not aligned'}`,
    ),
    '',
    'What this proof does not establish',
    ...PROOF_LIMITS.map((item) => `- ${item}`),
    '',
    SCIENCE_LIMIT,
    PUNISHMENT_RULE,
    '',
    'Scene matching cannot establish the source when the background has been replaced. That condition is not detected automatically in this build.',
    'Sealed identity verification is not available in this build.',
    record.pythonNote ?? '',
    '',
    'Computed on this device. This file contains no photograph.',
  ]
  return lines.filter((line) => line !== '').join('\n') + '\n'
}

export function metricRows(result: AlignResult, hash: string): { label: string; value: string }[] {
  return [
    { label: 'Matched reference points', value: `${result.aligned_points} of ${result.usable_points}` },
    { label: 'Geometric agreement', value: `${result.agreement_percent.toFixed(1)}%` },
    { label: 'Alignment residual', value: formatResidual(result.mean_residual) },
    { label: 'Background coverage', value: coveragePair(result) },
    { label: 'File hash comparison', value: hash },
  ]
}

function coveragePair(result: AlignResult): string {
  const source = formatCoverage(result.source_coverage_percent)
  const suspect = formatCoverage(result.suspect_coverage_percent)
  if (source === 'Not provided' && suspect === 'Not provided') return 'Not provided'
  return `Source ${source} · Suspect ${suspect}`
}
