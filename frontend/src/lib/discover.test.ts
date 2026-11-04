import { afterEach, describe, expect, it, vi } from 'vitest'
import { discoverRequest, safeLink, setDiscoveryHandoff, takeDiscoveryHandoff } from './discover'
import { runCheck } from './check'
import { reportText } from './report'

afterEach(() => vi.unstubAllGlobals())
describe('Discover bridge', () => {
  it('reports unavailable credentials and provider failures without results', async () => {
    for (const message of ['Set TINEYE_API_KEY', 'TinEye timed out']) {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({ message }) }))
      await expect(discoverRequest('search', new AbortController().signal, { consent: true })).rejects.toThrow(message)
    }
  })
  it('passes cancellation to fetch and never substitutes results', async () => {
    const controller = new AbortController()
    vi.stubGlobal('fetch', vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')))
    })))
    const pending = discoverRequest('search', controller.signal, { consent: true })
    controller.abort()
    await expect(pending).rejects.toThrow('Cancelled')
  })
  it('preserves a genuine empty response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ candidates: [] }) }))
    expect(await discoverRequest('search', new AbortController().signal, {})).toEqual({ candidates: [] })
  })
  it('rejects unsafe outbound link schemes', () => {
    for (const link of ['javascript:alert(1)', 'file:///c:/a', 'https://user:pass@example.com/']) expect(safeLink(link)).toBeUndefined()
  })
  it('hands a candidate and original reference to the real comparison and Proof report pipeline', async () => {
    const candidate = { id: 'fixture', image: null, links: [], domain: 'example.com', provider_score: 90, verification: 'unverified' as const }
    setDiscoveryHandoff({ sceneId: 'original-fixture', candidate })
    expect(takeDiscoveryHandoff()?.sceneId).toBe('original-fixture')
    // Hand-reviewed background feature fixture. This tests geometry, not live photo recognition.
    const graph = { room_objects: ['window', 'door', 'lamp', 'desk'].map((name, i) => ({ name, x: i * 100, y: 100, width: 20, height: 20 })) }
    vi.stubGlobal('crypto', { randomUUID: () => 'test-discovery-case' })
    const result = await runCheck({ source: graph, suspect: graph, sourceLabel: 'Original', suspectLabel: candidate.domain, sourceHash: null, suspectHash: null, sourceMask: null, maskApplied: false, blind: true, sample: false }, () => {})
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.record.result.residuals).toHaveLength(4)
      expect(result.record.result.aligned_points).toBe(4)
      expect(reportText(result.record)).toContain('example.com')
    }
  })
})
