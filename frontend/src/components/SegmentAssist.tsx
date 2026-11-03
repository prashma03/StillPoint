import { useEffect, useState } from 'react'
import { getAIStatus, segmentPhoto, type SegmentRect } from '../lib/ai'
import { allowedImageType, redactImage } from '../lib/redact'
import { Button } from './ui'

type Props = {
  file: File | null
  onRects: (rects: SegmentRect[], model: string) => void
}

/**
 * Experimental automatic person detection. Sends the photo (downscaled,
 * metadata stripped, person still visible) to the local backend for
 * segmentation, and returns coarse rectangles for the user to review.
 * Only rectangles come back; pixel masks are discarded server-side.
 * A suggestion is never a confirmed mask.
 */
export function SegmentAssist({ file, onRects }: Props) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'unreachable'>('loading')
  const [consent, setConsent] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

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

  async function run() {
    if (!file) return
    setWorking(true)
    setError('')
    setNote('')
    try {
      if (!allowedImageType(file.type, file.name)) {
        setError('Only JPEG, PNG, or WebP photographs can be checked.')
        return
      }
      // No mask painted: detection needs to see the person. The photo is
      // still downscaled and re-encoded, which drops metadata.
      const prepared = await redactImage(file, null)
      const outcome = await segmentPhoto(prepared.dataUrl)
      if (!outcome.ok) {
        setError(outcome.error)
        return
      }
      if (outcome.count === 0) {
        setNote('No person was found. If someone is visible, draw the mask yourself — nothing is analyzed until a mask is confirmed.')
        return
      }
      setNote(
        `Suggested ${outcome.count} person region${outcome.count === 1 ? '' : 's'}. Review the outline, correct any missed area by hand, then confirm the mask.`,
      )
      onRects(outcome.rects, outcome.model)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Person detection failed. Draw the mask yourself.')
    } finally {
      setWorking(false)
    }
  }

  const disabled = working || !file || status !== 'ready' || !consent

  return (
    <section className="stack" aria-label="Automatic person detection, experimental">
      <h2>Suggest the person mask · experimental</h2>
      {status === 'loading' && <p className="muted">Checking the local backend…</p>}
      {status === 'unreachable' && (
        <p className="note">The local backend is not running, so automatic detection is off. Draw the mask yourself below — that path always works.</p>
      )}
      {status === 'unavailable' && (
        <p className="note">Person detection is not configured on this computer — no model API key. Draw the mask yourself below.</p>
      )}
      {status === 'ready' && (
        <>
          <p className="muted">Detection sees the full photo, including the person. Only coarse rectangles come back; pixel masks are discarded and nothing is stored.</p>
          <label className="checkline">
            <input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} />
            <span>I consent to sending this photo for person detection. I understand the person is visible to the model service.</span>
          </label>
          <div className="actions">
            <Button onClick={() => void run()} disabled={disabled}>
              {working ? 'Detecting…' : 'Suggest person mask'}
            </Button>
          </div>
        </>
      )}
      {note && !error && <p role="status">{note}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  )
}
