import type { ModalGeometryEvidence } from './types'

const LOCAL_API = 'http://127.0.0.1:8787'

export async function modalVerificationConfigured(signal?: AbortSignal): Promise<boolean> {
  try {
    const response = await fetch(`${LOCAL_API}/api/status`, { signal, cache: 'no-store' })
    if (!response.ok) return false
    const status = await response.json() as { modal_verification?: { configured?: boolean } }
    return status.modal_verification?.configured === true
  } catch { return false }
}

export async function verifyModalGeometry(source: string, suspect: string, signal?: AbortSignal): Promise<ModalGeometryEvidence> {
  const response = await fetch(`${LOCAL_API}/api/modal/verify`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, signal,
    body: JSON.stringify({ consent: true, privacy_masked: { source: true, suspect: true }, images: { source, suspect } }),
  })
  const payload = await response.json().catch(() => null) as { evidence?: unknown; error?: string; message?: string } | null
  if (!response.ok) throw new Error(payload?.message || payload?.error || 'Modal verification is unavailable.')
  const value = payload?.evidence as ModalGeometryEvidence | undefined
  if (!value || value.provider !== 'modal' || value.schema_version !== 1 || !Array.isArray(value.matches) ||
      !Number.isFinite(value.candidate_matches) || !Number.isFinite(value.verified_inliers) ||
      !['inconclusive', 'caution', 'measurable'].includes(value.uncertainty?.status) ||
      value.matches.some(match => ![match.source?.x, match.source?.y, match.suspect?.x, match.suspect?.y].every(n => Number.isFinite(n) && n >= 0 && n <= 1))) {
    throw new Error('Modal returned an invalid geometric evidence record.')
  }
  return value
}
