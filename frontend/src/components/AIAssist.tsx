import { useEffect, useRef, useState } from 'react'
import { analyzePhoto, getAIStatus } from '../lib/ai'
import { allowedImageType, redactImage } from '../lib/redact'
import type { Mask } from '../lib/types'
import { Button } from './ui'
import { settingsStore } from '../lib/storage'

type Props = {
  file: File | null
  mask: Mask | null
  ready: boolean
  blockedReason: string | null
  ctaLabel: string
  onGraph: (graph: unknown, model: string) => void
  /**
   * Scope token for this transfer (image hash + request kind + mask). Consent
   * resets whenever the scope changes, so one checkbox can never authorize a
   * different photo, a different request, or a moved mask.
   */
  consentScope: string
  /** Desired maximum landmarks; forwarded to the backend prompt. */
  maxPoints?: number
  /**
   * Optional re-run trigger. When the parent bumps this token (after its own
   * credit confirmation), one analysis starts — but only with consent already
   * checked, so no run ever happens without explicit permission.
   */
  runToken?: number
}

/** Experimental AI-assisted mapping. Manual mapping below always works. */
export function AIAssist({ file, mask, ready, blockedReason, ctaLabel, onGraph, consentScope, maxPoints, runToken }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'unreachable'>('loading')
  const [consent, setConsent] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  const externalAllowed = settingsStore().load().externalImagesEnabled
  const [destination, setDestination] = useState('configured Meta image model endpoint')

  useEffect(() => {
    let live = true
    void getAIStatus().then((result) => {
      if (!live) return
      if (!result.ok) setStatus('unreachable')
      else { setStatus(result.configured ? 'ready' : 'unavailable'); if (result.provider_origin) setDestination(result.provider_origin) }
    })
    return () => {
      live = false
    }
  }, [])

  // Consent is per transfer: a new photo, request, or mask needs fresh consent.
  useEffect(() => {
    setConsent(false)
    request.current?.abort()
    setWorking(false)
    return () => request.current?.abort()
  }, [consentScope])

  // Parent-confirmed re-run. Skips silently on first mount (token 0).
  useEffect(() => {
    if (!runToken) return
    if (!file || status !== 'ready') {
      setError('The local backend is not ready for another analysis.')
      return
    }
    if (!ready) {
      setError(blockedReason ?? 'Confirm the cover before AI mapping.')
      return
    }
    if (!consent) {
      setError('Check the consent box first — each analysis needs your explicit consent.')
      return
    }
    void run()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runToken])

  async function run() {
    if (!file || !consent || !externalAllowed) return
    const controller = new AbortController()
    request.current = controller
    setWorking(true)
    setError('')
    try {
      if (!allowedImageType(file.type, file.name)) {
        setError('Only JPEG, PNG, or WebP photographs can be analyzed.')
        return
      }
      const redacted = await redactImage(file, mask)
      controller.signal.throwIfAborted()
      const outcome = await analyzePhoto(redacted.dataUrl, mask, maxPoints, consent, controller.signal)
      if (controller.signal.aborted) return
      if (!outcome.ok) {
        setError(outcome.error)
        return
      }
      onGraph(outcome.graph, outcome.model)
    } catch (err) {
      if (!controller.signal.aborted) setError(err instanceof Error ? err.message : 'Analysis failed. Nothing was saved.')
    } finally {
      if (!controller.signal.aborted) { setWorking(false); setConsent(false) }
    }
  }

  const disabled = working || !ready || !file || status !== 'ready' || !consent || !externalAllowed

  return (
    <section className="stack" aria-label="AI-assisted mapping, experimental">
      <h2>AI-assisted mapping · experimental</h2>
      {!externalAllowed && <p className="note">External image AI is disabled in Settings. Local feature proposals and manual mapping remain available. Enabling the tool never grants consent for a photograph.</p>}
      {status === 'loading' && <p className="muted">Checking the local backend…</p>}
      {status === 'unreachable' && (
        <p className="note">The local backend is not running, so AI mapping is off. Start it with `python -m backend.server`, or map the background by hand below.</p>
      )}
      {status === 'unavailable' && (
        <p className="note">AI mapping is not configured on this computer — no model API key. Manual mapping below is the working path.</p>
      )}
      {status === 'ready' && (
        <>
          <p className="muted">The photo is downscaled, stripped of metadata, and masked in this browser. With your consent, that redacted copy passes through the local backend to the configured Meta/Muse model provider. The backend holds it in memory for the request; provider retention is not verified by Stillpoint. The mask cannot guarantee anonymity. Suggestions arrive unconfirmed — review each one below.</p>
          <p className="muted">Destination reported by the backend: {destination}</p>
          <label className="checkline">
            <input type="checkbox" disabled={!externalAllowed || working} checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I consent to sending this redacted photo to the configured model provider for analysis. Backgrounds and other details may still identify someone. This consent covers this photo and current mask only.</span>
          </label>
          {blockedReason && <p className="note">{blockedReason}</p>}
          <div className="actions">
            <Button onClick={() => void run()} disabled={disabled}>
              {working ? 'Analyzing…' : ctaLabel}
            </Button>
            {working && <Button variant="secondary" onClick={() => { request.current?.abort(); setWorking(false); setConsent(false); setError('Analysis cancelled. An image already sent to the provider cannot be recalled.') }}>Cancel AI processing</Button>}
          </div>
        </>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
