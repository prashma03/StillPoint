import { useEffect, useRef, useState } from 'react'
import { getAIStatus, segmentPhoto } from '../lib/ai'
import { redactImage } from '../lib/redact'
import { combineSegmentMasks } from '../lib/segment'
import { LOCAL_MASK_MODEL, segmentLocally } from '../lib/localSegmentation'
import { settingsStore } from '../lib/storage'
import type { PhotoInput, PixelMask } from '../lib/checkSession'
import { Button } from './ui'

type Props = { photo: PhotoInput; mode: 'automatic' | 'manual'; onMode: (mode: 'automatic' | 'manual') => void; onMask: (mask: PixelMask, model?: string) => void; onManual: () => void; onAutomatic: () => void; canManual: boolean }
export function PersonMaskControls({ photo, mode, onMode, onMask, onManual, onAutomatic, canManual }: Props) {
  const [source, setSource] = useState<'local' | 'external'>('local')
  const [status, setStatus] = useState('loading'), [consent, setConsent] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  const [destination, setDestination] = useState('configured Meta SAM endpoint')
  const request = useRef<AbortController | null>(null)
  const allowed = settingsStore().load().externalImagesEnabled
  useEffect(() => { let live = true; void getAIStatus().then(result => { if (live) { setStatus(result.ok && result.configured ? 'ready' : 'unavailable'); if (result.ok && result.provider_origin) setDestination(result.provider_origin) } }); return () => { live = false } }, [])
  useEffect(() => { setConsent(false); setMessage(''); setBusy(false); setSource('local'); return () => request.current?.abort() }, [photo.file, photo.hash])
  async function automatic() {
    if (!photo.file || (source === 'external' && (!consent || !allowed))) return
    const controller = new AbortController(); request.current = controller
    setBusy(true); setMessage('')
    try {
      let next: PixelMask
      if (source === 'local') next = await segmentLocally(photo.file, controller.signal)
      else {
        const prepared = await redactImage(photo.file, null)
        controller.signal.throwIfAborted()
        const result = await segmentPhoto(prepared.dataUrl, consent, controller.signal)
        if (!result.ok) throw new Error(result.error)
        next = combineSegmentMasks(prepared.width, prepared.height, result.masks)
      }
      if (controller.signal.aborted) return
      if (!next.data.some(value => value)) { setMessage('No person pixels were detected. Review the image safely and add manual rectangles if needed.'); return }
      onMask(next, source === 'local' ? LOCAL_MASK_MODEL : 'Configured external SAM'); onAutomatic()
      setMessage(`Automatic mask generated ${source === 'local' ? 'on this device; no photograph was uploaded' : 'by the external service'}. Review it and cover any missed areas with manual rectangles.`)
    } catch (error) { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : 'Automatic masking failed. Manual rectangles remain available.') }
    finally { if (!controller.signal.aborted) { setBusy(false); setConsent(false) } }
  }
  return <div className="person-mask-tools">
    <div className="person-mask-options" role="group" aria-label="Masking method">
      <button disabled={busy} type="button" className={`person-mask-option${mode === 'automatic' ? ' is-active' : ''}`} aria-pressed={mode === 'automatic'} onClick={() => onMode('automatic')}><strong>Automatic Mask</strong><span>Prefer on-device person segmentation.</span></button>
      <button type="button" className={`person-mask-option${mode === 'manual' ? ' is-active' : ''}`} aria-pressed={mode === 'manual'} disabled={busy || !canManual} onClick={onManual}><strong>Manual Mask</strong><span>Place an opaque rectangle over a private area.</span></button>
    </div>
    {mode === 'automatic' && <div className="mask-method-panel stack">
      <label className="field"><span>Automatic masking location</span><select value={source} disabled={busy} onChange={e => { setSource(e.target.value as 'local' | 'external'); setConsent(false) }}><option value="local">On this device · recommended</option><option value="external">External Meta SAM · explicit consent required</option></select></label>
      {source === 'local' ? <p className="muted">MediaPipe SelfieSegmenter runs in your browser using bundled model files. It may miss small, distant, or partly hidden people. Multiple people are not guaranteed; review every person. If it cannot run, use manual masking. There is no automatic external fallback.</p> : <>
        <p className="note">The complete unmasked photograph is resized and stripped of metadata, then sent through your local backend to its configured Meta SAM endpoint to identify person regions. The provider can see people and backgrounds. Retention is not verified. Do not submit intimate imagery.</p>
        <p className="muted">Destination reported by the backend: {destination}</p>
        {!allowed && <p className="note">External image AI is disabled. Enable its availability in Settings first; that does not grant consent for any photo.</p>}
        {status !== 'ready' && <p className="note">The external masking service is unavailable or not configured.</p>}
        <label className="checkline"><input type="checkbox" disabled={busy || !allowed} checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I authorize this unmasked image to be sent to the configured external Meta SAM service for this detection only.</span></label>
      </>}
      <div className="actions"><Button disabled={busy || !photo.file || (source === 'external' && (!allowed || !consent || status !== 'ready'))} onClick={() => void automatic()}>{busy ? 'Detecting people…' : photo.pixelMask ? 'Run Automatic Mask Again' : 'Run Automatic Mask'}</Button>
        {busy && <Button variant="secondary" onClick={() => { request.current?.abort(); setBusy(false); setConsent(false); setMessage(source === 'local' ? 'Masking cancelled. No image was sent externally.' : 'Masking cancelled. Data already received by the external provider cannot be recalled.') }}>Cancel masking</Button>}</div>
    </div>}
    {message && <p role="status" className="note">{message}</p>}
  </div>
}
