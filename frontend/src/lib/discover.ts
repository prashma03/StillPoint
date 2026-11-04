import { AI_BASE } from './ai'

export type Candidate = {
  id: string
  image: string | null
  domain: string
  provider_score: number | null
  links: { page: string | null; image: string | null; crawl_date: string }[]
  verification: 'unverified'
}
export type DiscoverStatus = { provider: string; configured: boolean; sources: string; missing: string[] }
export type DiscoveryHandoff = { sceneId: string; candidate: Candidate }
// Memory-only metadata transfer. Never persist candidate images or original pixels.
let handoff: DiscoveryHandoff | null = null
export function setDiscoveryHandoff(value: DiscoveryHandoff | null) { handoff = value }
export function takeDiscoveryHandoff() { return handoff }

export function safeLink(value: string | null): string | undefined {
  if (!value) return undefined
  try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : undefined } catch { return undefined }
}

export async function discoverRequest<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch(`${AI_BASE}/api/discover/${path}`, {
    method: body ? 'POST' : 'GET', signal,
    ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
  })
  const data = await response.json()
  if (!response.ok) throw new Error(data.message || data.error || 'Discovery request failed.')
  return data as T
}

export function readSearchImage(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 8_000_000 || !file.size) {
    return Promise.reject(new Error('Choose a JPEG, PNG, or WebP photograph up to 8 MB.'))
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read the original photograph.'))
    reader.readAsDataURL(file)
  })
}
