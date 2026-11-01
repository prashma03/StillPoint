import type { AlignResult, SceneGraph } from './types'

export async function verifyWithPython(
  source: SceneGraph,
  suspect: SceneGraph,
): Promise<{ ok: true; result: AlignResult } | { ok: false; error: string }> {
  try {
    const response = await fetch('http://127.0.0.1:8787/api/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source, suspect }),
    })
    const payload = (await response.json()) as { result?: AlignResult; error?: string }
    if (!response.ok || !payload.result) {
      return { ok: false, error: payload.error || 'The local Python engine declined the comparison.' }
    }
    return { ok: true, result: payload.result }
  } catch {
    return { ok: false, error: 'The local Python engine is not running. The on-device result stands.' }
  }
}
