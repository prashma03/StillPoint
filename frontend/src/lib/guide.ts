/** Stillpoint Guide presentation. No network and no credentials. */

export type GuideLink = 'connecting' | 'configured' | 'available' | 'unavailable' | 'not_configured'

const SERVICE_DOWN = new Set([
  'auth',
  'rate_limited',
  'timeout',
  'transport',
  'server_error',
  'unavailable',
  'backend_down',
  'bad_response',
])

export function guideLinkFromStatus(configured: boolean | undefined, failed: boolean): GuideLink {
  if (failed) return 'unavailable'
  if (configured === true) return 'configured'
  return 'not_configured'
}

export function guideLinkAfterFailure(current: GuideLink, code: string): GuideLink {
  if (SERVICE_DOWN.has(code)) return 'unavailable'
  return current === 'connecting' ? 'configured' : current
}

export function guideLinkLabel(link: GuideLink): string {
  switch (link) {
    case 'connecting':
      return 'Connecting'
    case 'configured':
      return 'Configured'
    case 'available':
      return 'Available'
    case 'not_configured':
      return 'Not configured'
    case 'unavailable':
      return 'Temporarily unavailable'
  }
}

export function guideErrorMessage(code: string): string {
  switch (code) {
    case 'model_not_configured':
      return 'AI is unavailable: no model API key is configured on this computer.'
    case 'auth':
      return 'The assistant cannot sign in to the model service right now.'
    case 'rate_limited':
      return 'The assistant is receiving too many requests. Wait a moment and try again.'
    case 'timeout':
      return 'The assistant took too long to answer. Try again.'
    case 'transport':
      return 'The assistant cannot reach the model service right now.'
    case 'bad_request':
      return 'The assistant could not answer that message. Try rephrasing it.'
    case 'content_blocked':
      return 'The assistant declined that message.'
    case 'sensitive_content':
      return 'Remove passwords and credentials before chatting.'
    case 'server_error':
    case 'unavailable':
      return 'The model service is temporarily unavailable. Try again shortly.'
    case 'backend_down':
      return 'The Guide backend is not running at 127.0.0.1:8787. From the StillPoint project folder, start it with `python -m backend.server`, then retry. A model API key is also needed for AI replies.'
    case 'backend_timeout':
      return 'The local Guide backend timed out. Check that it is running, then retry.'
    default:
      return 'The assistant is unavailable right now. Try again shortly.'
  }
}

/** Local help shown only after a model failure. It is never described as a model reply. */
export function guideFallback(page: string): string {
  const lead = 'Local navigation help, not a model reply.'
  if (page === 'protect') {
    return `${lead} On Protect, step 1 is “Start with the original photo.” Use the dashed control labeled “Choose a photograph.” It accepts a JPEG, PNG, or WebP up to 20 MB, or a scene-graph JSON file. Then name the scene and press Continue. The photograph stays in this browser tab. This chat does not upload it.`
  }
  if (page === 'check') {
    return `${lead} On Check, add the other file with “Add the suspicious file.” Blind Mode hides that image. Choose the original under “Your protected scene,” or import a scene graph, then press Compare viewpoints.`
  }
  if (page === 'results') {
    return `${lead} Results explains the alignment that was actually computed. It does not identify a person or decide consent.`
  }
  if (page === 'proof') {
    return `${lead} Proof is the redacted diagram. It does not contain the photograph.`
  }
  if (page === 'trust') {
    return `${lead} Trust explains the evidence categories. A background match alone cannot trigger automatic punishment or removal.`
  }
  if (page === 'settings') {
    return `${lead} Settings is where saved scene records and notes on this device can be deleted.`
  }
  return `${lead} Use Protect to add an original photograph, or Check to compare one you already protected.`
}

export type GuideSegment = { kind: 'text' | 'strong'; text: string }

/** Render the only markup the model is likely to emit if it ignores the plain-text instruction. */
export function guideSegments(text: string): GuideSegment[] {
  const parts: GuideSegment[] = []
  const pattern = /\*\*([^*\n]+)\*\*/g
  let last = 0
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0
    if (index > last) parts.push({ kind: 'text', text: text.slice(last, index) })
    parts.push({ kind: 'strong', text: match[1] })
    last = index + match[0].length
  }
  if (last < text.length) parts.push({ kind: 'text', text: text.slice(last) })
  if (parts.length === 0) parts.push({ kind: 'text', text })
  return parts
}
