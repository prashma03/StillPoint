import { useEffect, useState } from 'react'
import { Button, PageHeader, usePageTitle } from '../components/ui'
import { decodeToPixels } from '../lib/redact'
import { applyProtectionShield, type ShieldOutput } from '../lib/shield'
import { photoFileError } from '../lib/photoCompare'

const PROCESS_LIMIT = 4096

async function encodePng(pixels: { data: Uint8ClampedArray; width: number; height: number }): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = pixels.width
  canvas.height = pixels.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot export the protected image.')
  context.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0)
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  canvas.width = 0
  canvas.height = 0
  if (!blob) throw new Error('The protected image could not be encoded.')
  return blob
}

export function Protect() {
  usePageTitle('Protect')
  const [file, setFile] = useState<File | null>(null)
  const [originalUrl, setOriginalUrl] = useState<string | null>(null)
  const [compareUrl, setCompareUrl] = useState<string | null>(null)
  const [protectedUrl, setProtectedUrl] = useState<string | null>(null)
  const [protectedBlob, setProtectedBlob] = useState<Blob | null>(null)
  const [shield, setShield] = useState<ShieldOutput | null>(null)
  const [scaled, setScaled] = useState('')
  const [slider, setSlider] = useState(50)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => () => {
    if (originalUrl) URL.revokeObjectURL(originalUrl)
    if (compareUrl) URL.revokeObjectURL(compareUrl)
    if (protectedUrl) URL.revokeObjectURL(protectedUrl)
  }, [originalUrl, compareUrl, protectedUrl])

  function choose(next: File) {
    const problem = photoFileError(next)
    if (problem) { setError(problem); return }
    if (originalUrl) URL.revokeObjectURL(originalUrl)
    if (compareUrl) URL.revokeObjectURL(compareUrl)
    if (protectedUrl) URL.revokeObjectURL(protectedUrl)
    setFile(next)
    setOriginalUrl(URL.createObjectURL(next))
    setCompareUrl(null)
    setProtectedUrl(null)
    setProtectedBlob(null)
    setShield(null)
    setScaled('')
    setSlider(50)
    setError('')
  }

  async function apply() {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const bitmap = await createImageBitmap(file)
      const nativeWidth = bitmap.width
      const nativeHeight = bitmap.height
      bitmap.close()
      const pixels = await decodeToPixels(file, PROCESS_LIMIT)
      const result = applyProtectionShield(pixels)
      const sourceBlob = await encodePng(pixels)
      const blob = await encodePng(result)
      if (compareUrl) URL.revokeObjectURL(compareUrl)
      if (protectedUrl) URL.revokeObjectURL(protectedUrl)
      setShield(result)
      setProtectedBlob(blob)
      setCompareUrl(URL.createObjectURL(sourceBlob))
      setProtectedUrl(URL.createObjectURL(blob))
      setScaled(pixels.width === nativeWidth && pixels.height === nativeHeight ? '' : `Processed at ${pixels.width}×${pixels.height}. The original is ${nativeWidth}×${nativeHeight}, above the ${PROCESS_LIMIT}px limit.`)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The photograph could not be protected.')
    } finally {
      setBusy(false)
    }
  }

  function download() {
    if (!protectedBlob) return
    const url = URL.createObjectURL(protectedBlob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'stillpoint-protected.png'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Protect"
        title="Protect an original photo"
        lede="Apply a local protection shield that changes the photograph itself. Scene comparison and feature mapping stay in Check and Proof."
      />
      <p className="note">This shield is experimental. It cannot guarantee that an editing model will fail to manipulate the image. It is not a watermark, a cover, or a verified defense.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <label className="drop">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={(event) => {
            const next = event.target.files?.[0]
            if (next) choose(next)
            event.currentTarget.value = ''
          }}
        />
        <b>{file ? 'Replace the photograph' : 'Choose a photograph'}</b>
        <span className="muted">JPEG, PNG, or WebP · up to 20 MB · processed in this browser</span>
      </label>
      {originalUrl && (
        <section className="stack">
          <h2>Original</h2>
          <img className="shield-preview" src={originalUrl} alt="Original photograph before protection" />
        </section>
      )}
      <div className="actions">
        <Button onClick={() => void apply()} disabled={!originalUrl || busy}>{busy ? 'Applying shield' : 'Apply Protection Shield'}</Button>
      </div>
      {protectedUrl && compareUrl && shield && (
        <section className="stack">
          <h2>Original and protected</h2>
          <div className="shield-pair">
            <figure><img src={compareUrl} alt="Original photograph" /><figcaption>Original</figcaption></figure>
            <figure><img src={protectedUrl} alt="Protected photograph with pixel values changed" /><figcaption>Protected</figcaption></figure>
          </div>
          <div className="shield-slider">
            <img src={protectedUrl} alt="" />
            <img src={compareUrl} alt="" style={{ clipPath: `inset(0 ${100 - slider}% 0 0)` }} />
            <input type="range" min={0} max={100} value={slider} aria-label="Compare the original and protected photographs" onChange={(event) => setSlider(Number(event.target.value))} />
          </div>
          <p className="muted">Drag right to reveal the original over the protected image.</p>
          {scaled && <p className="note">{scaled}</p>}
          <p className="num">Mean change {shield.meanAbs.toFixed(2)} levels · maximum {shield.maxAbs} of {shield.bound} · {shield.psnr.toFixed(1)} dB PSNR · {(shield.changedFraction * 100).toFixed(1)}% of color samples changed</p>
          <p className="muted">{shield.method}</p>
          <div className="actions">
            <Button onClick={download} disabled={!protectedBlob}>Download Protected Image</Button>
          </div>
          <section className="panel stack">
            <h2>Experimental effectiveness test</h2>
            <p>No image-editing model is connected. Stillpoint will not send this photograph anywhere to imitate a result.</p>
            <label className="checkline">
              <input type="checkbox" disabled />
              <span>I would consent to sending this image to an external editing model. That option is unavailable.</span>
            </label>
            <Button variant="secondary" disabled>Run effectiveness test</Button>
          </section>
        </section>
      )}
    </div>
  )
}
