import { guideErrorMessage } from './guide'
import type { Mask } from './types'

/** Local-backend AI bridge. The browser never holds an API key. */

export const AI_BASE = 'http://127.0.0.1:8787'
const AI_TIMEOUT_MS = 75000

export type AIStatus =
  | { ok: true; configured: boolean; scene_model: string; seg_model: string }
  | { ok: false; error: string }

export type GuideMessage = { role: 'user' | 'assistant'; content: string }
export type GuideReply =
  | { ok: true; reply: string; model: string }
  | { ok: false; error: string; code: string }

export async function sendGuideMessage(messages: GuideMessage[], page: string): Promise<GuideReply> {
  try {
    const response = await fetch(`${AI_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages, page }),
      signal: AbortSignal.timeout(65000),
    })
    const body = await readBody(response)
    if (!response.ok || typeof body.reply !== 'string') {
      const code = typeof body.error === 'string' && body.error ? body.error : 'bad_response'
      return { ok: false, code, error: guideErrorMessage(code) }
    }
    return { ok: true, reply: body.reply, model: typeof body.model === 'string' ? body.model : 'configured model' }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, code: 'backend_timeout', error: guideErrorMessage('backend_timeout') }
    }
    return { ok: false, code: 'backend_down', error: guideErrorMessage('backend_down') }
  }
}

export type AIAnalysis =
  | { ok: true; graph: unknown; model: string; report: Record<string, unknown> }
  | { ok: false; error: string }

export type SegmentRect = { x: number; y: number; width: number; height: number }
export type SegmentMask = { width: number; height: number; left: number; top: number; boxWidth: number; boxHeight: number; data: number[] }

export type SegmentOutcome =
  | { ok: true; masks: SegmentMask[]; rects: SegmentRect[]; count: number; model: string }
  | { ok: false; error: string }

export function userSafeError(code: string | undefined, fallback: string, kind: 'scene' | 'segment' = 'scene'): string {
  switch (code) {
    case 'model_not_configured':
      return kind === 'segment'
        ? 'Person detection is not configured on this computer. The local backend needs a model API key — draw the mask yourself.'
        : 'AI mapping is not configured on this computer. The local backend needs a model API key — manual mapping below still works.'
    case 'segment_decoder_missing':
      return 'The local backend needs the SAM mask decoder. Install the packages in backend/requirements.txt and restart it, or use manual masking.'
    case 'consent_required':
      return 'Consent is required before any image leaves this page.'
    case 'invalid_image':
      return 'That image could not be used. JPEG, PNG, or WebP under 8 MB.'
    case 'auth':
      return 'The model service rejected the API key.'
    case 'rate_limited':
      return 'The model service is rate limiting requests. Try again later.'
    case 'content_blocked':
      return 'The model service refused the request.'
    case 'timeout':
      return 'The model request timed out. Nothing was saved.'
    case 'transport':
      return 'The model service could not be reached.'
    case 'invalid_model_output':
      return kind === 'segment'
        ? 'The person-detection output was not usable. Draw the mask yourself.'
        : 'The model output was not a usable scene graph. Nothing was saved.'
    case 'unavailable':
    case 'server_error':
    case 'bad_response':
    case 'bad_request':
    case 'prompt_missing':
      return 'Analysis failed on the backend. Nothing was saved.'
    default:
      return fallback
  }
}

async function readBody(response: Response): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await response.json()
    if (parsed && typeof parsed === 'object') return parsed as Record<string, unknown>
  } catch {
    // fall through to empty body
  }
  return {}
}

export async function getAIStatus(): Promise<AIStatus> {
  try {
    const response = await fetch(`${AI_BASE}/api/status`, { signal: AbortSignal.timeout(8000) })
    const body = await readBody(response)
    if (!response.ok || typeof body.configured !== 'boolean') {
      return { ok: false, error: 'The local backend did not answer.' }
    }
    return {
      ok: true,
      configured: body.configured,
      scene_model: typeof body.scene_model === 'string' ? body.scene_model : 'unknown',
      seg_model: typeof body.seg_model === 'string' ? body.seg_model : 'unknown',
    }
  } catch {
    return { ok: false, error: 'The local backend is not running.' }
  }
}

export type AnalyzeRequest = {
  image: string
  consent: true
  mask: Mask | null
  max_points?: number
}

export function buildAnalyzeBody(image: string, mask: Mask | null, maxPoints?: number): AnalyzeRequest {
  const body: AnalyzeRequest = { image, consent: true, mask }
  if (typeof maxPoints === 'number' && Number.isFinite(maxPoints)) body.max_points = Math.round(maxPoints)
  return body
}

function readMasks(value: unknown): SegmentMask[] | null {
  if (!Array.isArray(value)) return null
  const masks: SegmentMask[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const mask = item as Record<string, unknown>
    const coords = [mask.width, mask.height, mask.left, mask.top, mask.boxWidth, mask.boxHeight]
    if (!coords.every((entry) => typeof entry === 'number' && Number.isInteger(entry) && entry >= 0) || !Array.isArray(mask.data)) return null
    const width = mask.width as number, height = mask.height as number
    if (!width || !height || width * height > 4_000_000 || width * height !== mask.data.length || !mask.data.every((bit) => bit === 0 || bit === 1)) return null
    masks.push({ width, height, left: mask.left as number, top: mask.top as number, boxWidth: mask.boxWidth as number, boxHeight: mask.boxHeight as number, data: mask.data as number[] })
  }
  return masks
}

function readRects(value: unknown): SegmentRect[] | null {
  if (!Array.isArray(value)) return null
  const rects: SegmentRect[] = []
  for (const item of value) {
    if (!item || typeof item !== 'object') return null
    const rect = item as Record<string, unknown>
    if (![rect.x, rect.y, rect.width, rect.height].every(value => typeof value === 'number' && Number.isFinite(value))) return null
    rects.push({ x: rect.x as number, y: rect.y as number, width: rect.width as number, height: rect.height as number })
  }
  return rects
}

export async function segmentPhoto(dataUrl: string): Promise<SegmentOutcome> {
  let response: Response
  try {
    response = await fetch(`${AI_BASE}/api/segment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl, consent: true }),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, error: userSafeError('timeout', '', 'segment') }
    }
    return { ok: false, error: 'The local backend is not running. Start it with: python -m backend.server' }
  }
  const body = await readBody(response)
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : undefined
    return { ok: false, error: userSafeError(code, 'Person detection failed. Draw the mask yourself.', 'segment') }
  }
  const masks = readMasks(body.masks)
  const rects = readRects(body.rects)
  if (!masks || !rects || typeof body.count !== 'number' || body.count !== masks.length) {
    return { ok: false, error: userSafeError('invalid_model_output', '', 'segment') }
  }
  return {
    ok: true,
    masks,
    rects,
    count: body.count,
    model: typeof body.model === 'string' ? body.model : 'unknown',
  }
}

export async function analyzePhoto(dataUrl: string, mask: Mask | null, maxPoints?: number): Promise<AIAnalysis> {
  let response: Response
  try {
    response = await fetch(`${AI_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildAnalyzeBody(dataUrl, mask, maxPoints)),
      signal: AbortSignal.timeout(AI_TIMEOUT_MS),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      return { ok: false, error: userSafeError('timeout', '') }
    }
    return { ok: false, error: 'The local backend is not running. Start it with: python -m backend.server' }
  }
  const body = await readBody(response)
  if (!response.ok) {
    const code = typeof body.error === 'string' ? body.error : undefined
    return { ok: false, error: userSafeError(code, 'Analysis failed. Nothing was saved.') }
  }
  if (!body.graph || typeof body.graph !== 'object') {
    return { ok: false, error: userSafeError('invalid_model_output', '') }
  }
  return {
    ok: true,
    graph: body.graph,
    model: typeof body.model === 'string' ? body.model : 'unknown',
    report: (body.report && typeof body.report === 'object' ? body.report : {}) as Record<string, unknown>,
  }
}
