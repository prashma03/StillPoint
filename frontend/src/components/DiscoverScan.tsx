import { useEffect, useRef, useState } from 'react'
import { useObjectUrl } from './ImageReview'
import { DiscoverScene } from './DiscoverScene'
import { Button } from './ui'
import { decodeToPixels } from '../lib/redact'
import { analyzeDiscoverImage, discoveryReport, type DiscoverLayout } from '../lib/discoverGeometry'

const stages = ['Analyzing image', 'Mapping visual structures', 'Connecting feature points', 'Building spatial view', 'Discovery complete']
export type DiscoverySummary = { fileName: string; cornerCount: number; edgeCount: number; lineCount: number; regionCount: number; mode: DiscoverLayout['mode'] }

function reducedMotion() {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
function pause(ms: number) {
  return new Promise(resolve => window.setTimeout(resolve, reducedMotion() ? 0 : ms))
}

export function DiscoverScan({ onContinue, onCompare }: { onContinue: (summary: DiscoverySummary) => void; onCompare: (summary: DiscoverySummary) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [layout, setLayout] = useState<DiscoverLayout | null>(null)
  const [stage, setStage] = useState(-1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [activeId, setActiveId] = useState<number | null>(null)
  const resultsRef = useRef<HTMLElement>(null)
  const runId = useRef(0)
  const url = useObjectUrl(file)
  const done = !!layout && stage === 4

  useEffect(() => {
    if (!file) { setLayout(null); setStage(-1); setActiveId(null); return }
    void run(file)
  }, [file])
  useEffect(() => {
    if (done) resultsRef.current?.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' })
  }, [done])

  async function run(target: File) {
    const id = ++runId.current
    setBusy(true); setLayout(null); setError(''); setStage(0); setActiveId(null)
    try {
      const pixels = await decodeToPixels(target, 720)
      if (runId.current !== id) return
      const detected = analyzeDiscoverImage(pixels)
      setStage(1); await pause(360)
      if (runId.current !== id) return
      setLayout(detected); setStage(2); await pause(360)
      if (runId.current !== id) return
      setStage(3); await pause(420)
      if (runId.current !== id) return
      setStage(4)
    } catch (err) {
      if (runId.current === id) { setError(err instanceof Error ? err.message : 'The image could not be analyzed in this browser.'); setStage(-1) }
    } finally { if (runId.current === id) setBusy(false) }
  }

  function summary(): DiscoverySummary {
    return { fileName: file?.name ?? 'Photograph', cornerCount: layout?.corners.length ?? 0, edgeCount: layout?.regions ?? 0, lineCount: layout?.segments.length ?? 0, regionCount: layout?.regions ?? 0, mode: layout?.mode ?? 'feature-map' }
  }
  function download() {
    if (!layout || !file) return
    const blob = new Blob([discoveryReport(file.name, layout)], { type: 'text/plain' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = 'stillpoint-discovery-summary.txt'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(href), 30000)
  }

  return <section className={`panel discover-scan${done ? ' is-complete' : ''}`} aria-labelledby="discover-scan-title">
    <div className="discover-scan-heading"><div><p className="eyebrow">Private local scan</p><h2 id="discover-scan-title">Explore the visual structure</h2><p className="muted">Upload a photograph. Stillpoint measures corners, edges, and straight boundaries in this browser, then builds a spatial view from those measurements. The photograph is not sent anywhere by this scan.</p></div>{done && <span className="discover-shield" aria-label="Discovery scan complete">✓</span>}</div>
    <label className="field"><span>Choose a photograph (JPEG, PNG, or WebP · up to 20 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const next = event.currentTarget.files?.[0] ?? null; setError(''); if (next && (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 20 * 1024 * 1024)) { setError('Choose a JPEG, PNG, or WebP image up to 20 MB.'); setFile(null) } else setFile(next); event.currentTarget.value = '' }} /></label>
    <div className="actions"><Button disabled={!file || busy} onClick={() => file && void run(file)}>{busy ? 'Scanning image…' : 'Scan Image'}</Button></div>
    {error && <p role="alert" className="error">{error}</p>}
    {stage >= 0 && <ol className="discover-scan-stages" aria-live="polite">{stages.slice(0, stage + 1).map((label, index) => <li key={label} className={index === stage ? 'is-active' : 'is-done'}>{label}</li>)}</ol>}
    {url && <div className="discover-scan-grid">
      <div className={`discover-photo-frame${busy ? ' is-scanning' : ''}`}>
        <img src={url} alt="Uploaded photograph being scanned locally" />
        {busy && stage < 2 && <span className="discover-scan-line" aria-hidden="true" />}
        {layout && <>
          <svg className="discover-feature-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-hidden="true">
            {layout.outlines.map(outline => <rect key={outline.id} x={outline.x} y={outline.y} width={outline.w} height={outline.h} />)}
            {layout.segments.map(segment => <line key={segment.id} x1={segment.x1} y1={segment.y1} x2={segment.x2} y2={segment.y2} />)}
          </svg>
          <div className="discover-node-layer">{layout.corners.map(point => <button type="button" key={point.id} className={activeId === point.id ? 'is-active' : ''} style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} aria-label={`Measured corner ${point.id + 1}`} aria-pressed={activeId === point.id} onMouseEnter={() => setActiveId(point.id)} onFocus={() => setActiveId(point.id)} onClick={() => setActiveId(point.id)} />)}</div>
        </>}
      </div>
      <div className="discover-scan-output">
        {layout && stage >= 2 ? <>
          <div className="discover-counts"><span><b>{layout.corners.length}</b> measured corners</span><span><b>{layout.regions}</b> high-contrast regions</span><span><b>{layout.segments.length}</b> structural lines</span></div>
          <DiscoverScene url={url} layout={layout} activeId={activeId} onSelect={setActiveId} reduced={reducedMotion()} />
        </> : <div className="discover-scan-placeholder">{busy ? 'Reading structure from the photograph…' : 'Your photograph and measured feature map will appear here.'}</div>}
      </div>
    </div>}
    {done && layout && <section className="discover-results" id="discover-results" ref={resultsRef} aria-labelledby="discover-results-title">
      <h2 id="discover-results-heading">Your Discovery Results</h2>
      <div className="discover-complete" role="status"><span>✓</span><div><h3 id="discover-results-title">Discovery Scan Complete</h3><p>Your photograph&apos;s visual structure has been mapped successfully.</p></div></div>
      <div className="discover-metrics">
        <article><b>{layout.corners.length}</b><span>Measured corners</span></article>
        <article><b>{layout.regions}</b><span>High-contrast regions</span></article>
        <article><b>{layout.segments.length}</b><span>Structural lines</span></article>
        <article><b>{layout.outlines.length}</b><span>Rectangular outlines</span></article>
      </div>
      <p>Stillpoint has mapped visual features from your photograph. These features can support further structural comparison with another image.</p>
      <p className="muted">{layout.note} Highlighted points on the photograph and in the spatial view are the same measured corners.</p>
      <dl className="discover-status">
        <div><dt>Image processing</dt><dd>Complete on this device</dd></div>
        <div><dt>External sharing</dt><dd>Not shared. This scan did not send the photograph.</dd></div>
        <div><dt>Spatial view</dt><dd>{layout.mode === 'approximate-layout' ? 'Approximate layout from measured lines' : '2.5D feature map'}</dd></div>
      </dl>
      <div className="actions">
        <Button onClick={() => document.getElementById('discover-map')?.scrollIntoView?.({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'center' })}>Explore 3D Map</Button>
        <Button onClick={() => onCompare(summary())}>Compare Another Image</Button>
        <Button onClick={download}>Download Discovery Summary</Button>
        <Button variant="secondary" onClick={() => onContinue(summary())}>Continue to Proof</Button>
      </div>
    </section>}
  </section>
}
