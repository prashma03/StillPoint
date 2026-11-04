import { useEffect, useRef, useState } from 'react'
import type * as React from 'react'
import type { PixelMask } from '../lib/checkSession'
import { getAIStatus, segmentPhoto } from '../lib/ai'
import { redactImage } from '../lib/redact'
import { combineSegmentMasks, emptyPixelMask } from '../lib/segment'
import type { PhotoInput } from '../lib/checkSession'
import { Button } from './ui'

type Props = { photo: PhotoInput; visible: boolean; onMask: (mask: PixelMask) => void; onContinue: () => void }
function drawMask(canvas: HTMLCanvasElement, mask: PixelMask | null | undefined) {
  const context = canvas.getContext('2d')
  if (!context || !mask) return
  canvas.width = mask.width; canvas.height = mask.height
  const pixels = context.createImageData(mask.width, mask.height)
  for (let index = 0; index < mask.data.length; index++) if (mask.data[index]) {
    const offset = index * 4
    pixels.data[offset] = 0; pixels.data[offset + 1] = 0; pixels.data[offset + 2] = 0; pixels.data[offset + 3] = 255
  }
  context.putImageData(pixels, 0, 0)
}

export function PersonMaskControls({ photo, visible, onMask, onContinue }: Props) {
  const [mode, setMode] = useState<'choose' | 'manual'>('choose')
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable' | 'offline'>('loading')
  const [consent, setConsent] = useState(false)
  const [revealed, setRevealed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [brush, setBrush] = useState(28)
  const [erase, setErase] = useState(false)
  const [undo, setUndo] = useState<Uint8Array[]>([])
  const [redo, setRedo] = useState<Uint8Array[]>([])
  const [revealedUrl, setRevealedUrl] = useState<string | null>(null)
  const maskCanvas = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const previousPoint = useRef<{ x: number; y: number } | null>(null)
  const mask = photo.pixelMask ?? null
  const canSee = visible || revealed

  useEffect(() => {
    let live = true
    void getAIStatus().then(result => { if (live) setStatus(!result.ok ? 'offline' : result.configured ? 'ready' : 'unavailable') })
    return () => { live = false }
  }, [])
  useEffect(() => { setConsent(false) }, [photo.file, photo.hash])
  useEffect(() => { if (maskCanvas.current) drawMask(maskCanvas.current, mask) }, [mask, mode])
  useEffect(() => {
    if (!canSee || !photo.file) { setRevealedUrl(null); return }
    const next = URL.createObjectURL(photo.file); setRevealedUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [canSee, photo.file])

  function snapshot() { if (mask) setUndo(previous => [...previous.slice(-29), mask.data.slice()]); setRedo([]) }
  function applyStroke(context: CanvasRenderingContext2D, x: number, y: number) {
    context.globalCompositeOperation = erase ? 'destination-out' : 'source-over'
    context.fillStyle = '#000'
    context.strokeStyle = '#000'; context.lineCap = 'round'; context.lineJoin = 'round'; context.lineWidth = brush
    context.beginPath()
    if (previousPoint.current) { context.moveTo(previousPoint.current.x, previousPoint.current.y); context.lineTo(x, y); context.stroke() }
    else { context.arc(x, y, brush / 2, 0, Math.PI * 2); context.fill() }
    previousPoint.current = { x, y }
    context.globalCompositeOperation = 'source-over'
  }
  function pointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (busy) return
    const canvas = event.currentTarget
    if (!mask) {
      const img = canvas.parentElement?.querySelector('img')
      if (!img?.naturalWidth || !img.naturalHeight) return
      const initial = emptyPixelMask(img.naturalWidth, img.naturalHeight)
      setUndo([initial.data.slice()]); setRedo([])
      onMask(initial)
      drawMask(canvas, initial); startDraw(event, canvas, initial)
      return
    }
    startDraw(event, canvas, mask)
  }
  function startDraw(event: React.PointerEvent<HTMLCanvasElement>, canvas: HTMLCanvasElement, value: PixelMask) {
    drawing.current = true
    canvas.setPointerCapture(event.pointerId)
    snapshot(); previousPoint.current = null
    const rect = canvas.getBoundingClientRect(), context = canvas.getContext('2d')
    if (!context) return
    const x = (event.clientX - rect.left) / rect.width * value.width, y = (event.clientY - rect.top) / rect.height * value.height
    applyStroke(context, x, y)
    const pixels = context.getImageData(0, 0, value.width, value.height).data
    const data = new Uint8Array(value.width * value.height)
    for (let index = 0; index < data.length; index++) data[index] = pixels[index * 4 + 3] > 0 ? 1 : 0
    onMask({ ...value, data })
  }
  function pointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || !mask) return
    const canvas = event.currentTarget, rect = canvas.getBoundingClientRect(), context = canvas.getContext('2d')
    if (!context) return
    applyStroke(context, (event.clientX - rect.left) / rect.width * mask.width, (event.clientY - rect.top) / rect.height * mask.height)
    const pixels = context.getImageData(0, 0, mask.width, mask.height).data, data = new Uint8Array(mask.width * mask.height)
    for (let index = 0; index < data.length; index++) data[index] = pixels[index * 4 + 3] > 0 ? 1 : 0
    onMask({ ...mask, data })
  }

  async function automatic() {
    if (!photo.file || !consent) return
    setBusy(true); setMessage('')
    try {
      const prepared = await redactImage(photo.file, null)
      const result = await segmentPhoto(prepared.dataUrl)
      if (!result.ok) { setMessage(result.error); return }
      if (!result.masks.length) { setMessage('No person was detected. Try the manual brush if someone is visible.'); return }
      const next = combineSegmentMasks(prepared.width, prepared.height, result.masks)
      if (!next.data.some(value => value)) { setMessage('The segmentation returned an empty mask. Retry or use manual masking.'); return }
      setUndo([]); setRedo([]); onMask(next)
      setMessage('Automatic mask generated. Please review the covered areas before continuing.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Automatic detection failed. Use manual masking.') }
    finally { setBusy(false) }
  }

  function restore(kind: 'undo' | 'redo') {
    const source = kind === 'undo' ? undo : redo, previous = source[source.length - 1]
    if (!mask || !previous) return
    if (kind === 'undo') { setRedo(values => [...values, mask.data.slice()]); setUndo(values => values.slice(0, -1)) }
    else { setUndo(values => [...values, mask.data.slice()]); setRedo(values => values.slice(0, -1)) }
    onMask({ ...mask, data: previous })
  }
  function reset() { if (!mask) return; snapshot(); onMask({ ...mask, data: new Uint8Array(mask.data.length) }); setMessage('Mask reset.') }

  return <div className="person-mask-tools">
    {photo.file && !canSee && <div className="note"><strong>Privacy warning:</strong> reviewing the image reveals its unmasked contents. Blind Mode is keeping this photo concealed. <label className="checkline"><input type="checkbox" checked={revealed} onChange={event => setRevealed(event.target.checked)} /><span>I understand and choose to reveal this image for mask review.</span></label></div>}
    {mode === 'choose' ? <div className="person-mask-options">
      <section className="panel"><h3>Automatic Mask</h3><p>Let Stillpoint detect and conceal people.</p><p className="muted">Uses Meta SAM 3.1 through the configured model provider. The image is sent outside this device only after the consent below. The returned pixel mask is processed in this browser.</p>
        {status === 'offline' && <p className="error">Local Stillpoint backend is unavailable. Use manual masking.</p>}{status === 'unavailable' && <p className="muted">SAM is not configured. Use manual masking.</p>}
        {status === 'ready' && <label className="checkline"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>I consent to sending this image to the configured external Meta SAM 3.1 service for person segmentation. This consent is for this image only.</span></label>}
        <Button disabled={busy || !photo.file || status !== 'ready' || !consent} onClick={() => void automatic()}>{busy ? 'Detecting and masking…' : mask ? 'Retry Automatic Detection' : 'Automatically Mask Person'}</Button>
      </section>
      <section className="panel"><h3>Manual Mask</h3><p>Choose exactly which areas to conceal with an on-device brush. Add, erase, undo, redo, or reset.</p><Button variant="secondary" disabled={!photo.file || !canSee} onClick={() => setMode('manual')}>Manually Mask Person</Button></section>
    </div> : <section className="panel stack"><h3>Refine Mask</h3><p>Brush strokes apply to the image pixels and remain aligned as the preview resizes.</p>
      <div className="mask-editor-wrap">{canSee && photo.file ? <div className="mask-editor-image"><img src={revealedUrl ?? ''} alt="Image revealed for privacy mask editing" onLoad={event => { if (!mask) { const image = event.currentTarget, initial = emptyPixelMask(image.naturalWidth, image.naturalHeight); onMask(initial) } }} /><canvas ref={maskCanvas} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drawing.current = false; previousPoint.current = null }} onPointerCancel={() => { drawing.current = false; previousPoint.current = null }} aria-label="Draw privacy mask over the photograph" /></div> : <div className="check-concealed">Photo concealed until you choose to reveal it.</div>}</div>
      <label className="field"><span>Brush size: {brush} px</span><input type="range" min={8} max={120} value={brush} onChange={event => setBrush(Number(event.target.value))} /></label>
      <div className="actions"><Button variant={erase ? 'secondary' : 'primary'} onClick={() => setErase(false)}>Add mask</Button><Button variant={erase ? 'primary' : 'secondary'} onClick={() => setErase(true)}>Erase mask</Button><Button variant="secondary" disabled={!undo.length} onClick={() => restore('undo')}>Undo</Button><Button variant="secondary" disabled={!redo.length} onClick={() => restore('redo')}>Redo</Button><Button variant="secondary" disabled={!mask} onClick={reset}>Reset</Button><Button variant="ghost" onClick={() => setMode('choose')}>Done refining</Button></div>
    </section>}
    {message && <p role="status" className={message.startsWith('Automatic mask generated') ? 'note' : 'error'}>{message}</p>}
    {mask && <div className="actions"><Button variant="secondary" onClick={() => setMode('manual')}>Refine Mask</Button><Button variant="secondary" disabled={busy || !consent || status !== 'ready'} onClick={() => void automatic()}>Retry Automatic Detection</Button><Button variant="secondary" onClick={() => setMode('manual')}>Switch to Manual</Button><Button disabled={!photo.confirmed} onClick={onContinue}>Continue to Feature Review</Button></div>}
  </div>
}
