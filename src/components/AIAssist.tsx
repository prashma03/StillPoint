import { useEffect, useState } from 'react'
import { analyzePhoto, getAIStatus } from '../lib/ai'
import { allowedImageType, redactImage } from '../lib/redact'
import type { Mask } from '../lib/types'
import { Button } from './ui'

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
}

/** Experimental AI-assisted mapping. Manual mapping below always works. */
export function AIAssist({ file, mask, ready, blockedReason, ctaLabel, onGraph, consentScope, maxPoints }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'unreachable'>('loading')
  const [consent, setConsent] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    void getAIStatus().then((result) => {
      if (!live) return
      if (!result.ok) setStatus('unreachable')
      else setStatus(result.configured ? 'ready' : 'unavailable')
    })
    return () => {
      live = false
    }
  }, [])

  // Consent is per transfer: a new photo, request, or mask needs fresh consent.
  useEffect(() => {
    setConsent(false)
  }, [consentScope])

  async function run() {
    if (!file) return
    setWorking(true)
    setError('')
    try {
      if (!allowedImageType(file.type, file.name)) {
        setError('Only JPEG, PNG, or WebP photographs can be analyzed.')
        return
      }
      const redacted = await redactImage(file, mask)
      const outcome = await analyzePhoto(redacted.dataUrl, mask, maxPoints)
      if (!outcome.ok) {
        setError(outcome.error)
        return
      }
      onGraph(outcome.graph, outcome.model)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Nothing was saved.')
    } finally {
      setWorking(false)
    }
  }

  const disabled = working || !ready || !file || status !== 'ready' || !consent

  return (
    <section className="stack" aria-label="AI-assisted mapping, experimental">
      <h2>AI-assisted mapping · experimental</h2>
      {status === 'loading' && <p className="muted">Checking the local backend…</p>}
      {status === 'unreachable' && (
        <p className="note">The local backend is not running, so AI mapping is off. Start it with `python -m backend.server`, or map the background by hand below.</p>
      )}
      {status === 'unavailable' && (
        <p className="note">AI mapping is not configured on this computer — no model API key. Manual mapping below is the working path.</p>
      )}
      {status === 'ready' && (
        <>
          <p className="muted">The masked photo is redacted on this device, then sent to the local backend for model analysis. The person area stays covered. Suggestions arrive unconfirmed — review each one below.</p>
          <label className="checkline">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I consent to sending this redacted photo for model analysis. I understand backgrounds and other details may still be identifying. This consent covers this photo and current mask only.</span>
          </label>
          {blockedReason && <p className="note">{blockedReason}</p>}
          <div className="actions">
            <Button onClick={() => void run()} disabled={disabled}>
              {working ? 'Analyzing…' : ctaLabel}
            </Button>
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
