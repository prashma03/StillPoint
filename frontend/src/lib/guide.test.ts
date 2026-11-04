import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_BASE, sendGuideMessage } from './ai'
import {
  guideErrorMessage,
  guideFallback,
  guideLinkAfterFailure,
  guideLinkFromStatus,
  guideLinkLabel,
  guideSegments,
} from './guide'

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
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe(`${AI_BASE}/api/chat`)
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['messages', 'page'])
    expect(body).toEqual({ messages: [{ role: 'user', content: 'hello' }], page: 'protect' })
    expect(JSON.stringify(body)).not.toMatch(/data:image|dataUrl|pixels/i)
  })

  it('sends a greeting and then a follow-up with the earlier assistant turn', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ reply: 'Use Choose a photograph.', model: 'muse-wonder-1.0' }))
    vi.stubGlobal('fetch', fetchMock)
    const first = await sendGuideMessage([{ role: 'user', content: 'hi' }], 'protect')
    expect(first.ok).toBe(true)
    const second = await sendGuideMessage(
      [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'Hello.' },
        { role: 'user', content: 'where do I upload my picture?' },
      ],
      'protect',
    )
    expect(second).toEqual({ ok: true, reply: 'Use Choose a photograph.', model: 'muse-wonder-1.0' })
    const secondBody = JSON.parse((fetchMock.mock.calls[1] as unknown as [string, RequestInit])[1].body as string)
    expect(secondBody.page).toBe('protect')
    expect(secondBody.messages.map((item: { role: string }) => item.role)).toEqual(['user', 'assistant', 'user'])
    expect(JSON.stringify(secondBody)).not.toMatch(/data:image|MODEL_API_KEY|Bearer/i)
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
      code: 'model_not_configured',
      error: 'AI is unavailable: no model API key is configured on this computer.',
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ error: 'transport', message: 'Could not reach the model service.' }, 502)),
    )
    expect((await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home'))).toEqual({
      ok: false,
      code: 'transport',
      error: 'The assistant cannot reach the model service right now.',
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'bad_request', message: 'The model service rejected the request.' }, 502)))
    expect((await sendGuideMessage([{ role: 'user', content: 'where do I upload my picture?' }], 'protect'))).toEqual({
      ok: false,
      code: 'bad_request',
      error: 'The assistant could not answer that message. Try rephrasing it.',
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'auth' }, 502)))
    expect((await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home')).ok).toBe(false)
    expect(guideErrorMessage('auth')).toMatch(/cannot sign in/)

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'rate_limited' }, 502)))
    expect(await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home')).toMatchObject({
      ok: false,
      code: 'rate_limited',
      error: guideErrorMessage('rate_limited'),
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'timeout' }, 502)))
    expect(await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home')).toMatchObject({
      ok: false,
      code: 'timeout',
      error: guideErrorMessage('timeout'),
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'invalid_message' }, 400)))
    expect((await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home'))).toEqual({
      ok: false,
      code: 'invalid_message',
      error: 'The assistant is unavailable right now. Try again shortly.',
    })

    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ unexpected: true }, 200)))
    expect((await sendGuideMessage([{ role: 'user', content: 'hi' }], 'home'))).toEqual({
      ok: false,
      code: 'bad_response',
      error: 'The assistant is unavailable right now. Try again shortly.',
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
      code: 'backend_down',
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
      code: 'backend_timeout',
      error: 'The local Guide backend timed out. Check that it is running, then retry.',
    })
  })
})

describe('guide status and navigation', () => {
  it('does not treat a configured key as a live connection', () => {
    expect(guideLinkFromStatus(true, false)).toBe('configured')
    expect(guideLinkFromStatus(false, false)).toBe('not_configured')
    expect(guideLinkFromStatus(undefined, true)).toBe('unavailable')
    expect(guideLinkLabel('connecting')).toBe('Connecting')
    expect(guideLinkLabel('configured')).toBe('Configured')
    expect(guideLinkLabel('available')).toBe('Available')
    expect(guideLinkLabel('unavailable')).toBe('Temporarily unavailable')
    expect(guideLinkLabel('configured')).not.toMatch(/connected/i)
    expect(guideLinkAfterFailure('configured', 'rate_limited')).toBe('unavailable')
    expect(guideLinkAfterFailure('configured', 'timeout')).toBe('unavailable')
    expect(guideLinkAfterFailure('configured', 'auth')).toBe('unavailable')
    expect(guideLinkAfterFailure('available', 'bad_request')).toBe('available')
  })

  it('explains the Protect upload control without claiming to be the model', () => {
    const help = guideFallback('protect')
    expect(help).toMatch(/not a model reply/)
    expect(help).toMatch(/Choose a photograph/)
    expect(help).toMatch(/Apply Protection Shield/)
    expect(help).not.toMatch(/Meta generated|AI generated/)
    expect(guideFallback('check')).toMatch(/Add the suspicious file/)
  })

  it('renders bold markers without leaving the asterisks visible', () => {
    expect(guideSegments('You are on **Protect** now.')).toEqual([
      { kind: 'text', text: 'You are on ' },
      { kind: 'strong', text: 'Protect' },
      { kind: 'text', text: ' now.' },
    ])
  })
})
