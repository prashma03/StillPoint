import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_BASE, sendGuideMessage } from './ai'

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('guide chat client', () => {
  it('posts text-only messages with the page label to the local backend', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ reply: 'Hi there', model: 'muse-wonder-1.0' }))
    vi.stubGlobal('fetch', fetchMock)
    const result = await sendGuideMessage([{ role: 'user', content: 'hello' }], 'protect')
    expect(result).toEqual({ ok: true, reply: 'Hi there', model: 'muse-wonder-1.0' })
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${AI_BASE}/api/chat`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['messages', 'page'])
    expect(body).toEqual({ messages: [{ role: 'user', content: 'hello' }], page: 'protect' })
    expect(JSON.stringify(body)).not.toMatch(/data:image|dataUrl|pixels/i)
  })

  it('labels the model generically when the backend omits it', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ reply: 'Hi' })))
    expect(await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home')).toEqual({
      ok: true,
      reply: 'Hi',
      model: 'configured model',
    })
  })

  it('maps backend failures to safe, specific messages', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'model_not_configured' }, 503)))
    expect((await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home'))).toEqual({
      ok: false,
      error: 'AI is unavailable: no model API key is configured on this computer.',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'transport', message: 'Could not reach the model service.' }, 502)),
    )
    expect((await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home'))).toEqual({
      ok: false,
      error: 'Could not reach the model service.',
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'invalid_message' }, 400)))
    expect((await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home'))).toEqual({
      ok: false,
      error: 'AI is unavailable right now. Please try again shortly.',
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ unexpected: true }, 200)))
    expect((await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home'))).toEqual({
      ok: false,
      error: 'AI is unavailable right now. Please try again shortly.',
    })
  })

  it('reports a stopped backend with the exact recovery steps', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed')
      }),
    )
    expect(await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home')).toEqual({
      ok: false,
      error:
        'The Guide backend is not running at 127.0.0.1:8787. From the StillPoint ' +
        'project folder, start it with `python -m backend.server`, then retry. ' +
        'A model API key is also needed for AI replies.',
    })
  })

  it('reports a timed-out backend distinctly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new DOMException('timed out', 'TimeoutError')
      }),
    )
    expect(await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home')).toEqual({
      ok: false,
      error: 'The local Guide backend timed out. Check that it is running, then retry.',
    })
  })
})
