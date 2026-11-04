import { useEffect, useMemo, useState } from 'react'
import { useObjectUrl } from './ImageReview'
import { Button } from './ui'
import { decodeToPixels } from '../lib/redact'
import { harrisResponse, rgbaToGrayscale, sobelScores } from '../lib/detect'

type Feature = { x: number; y: number; strength: number }
type Scan = { width: number; height: number; corners: Feature[]; edges: Feature[] }
const stages = ['Analyzing image', 'Mapping visual structures', 'Connecting feature points', 'Discovery complete']

function detectFeatures(image: { data: Uint8ClampedArray; width: number; height: number }): Scan {
  const { data, width, height } = image
  const gray = rgbaToGrayscale(data, width, height)
  const responses = harrisResponse(gray, width, height)
  const edges = sobelScores(gray, width, height)
  const pick = (scores: Float32Array, limit: number, minGap: number, local: boolean) => {
    const peak = scores.reduce((max, score) => Math.max(max, score), 0)
    const candidates: Feature[] = []
    const stride = Math.max(1, Math.floor(Math.max(width, height) / 500))
    for (let y = 6; y < height - 6; y += stride) for (let x = 6; x < width - 6; x += stride) {
      const score = scores[y * width + x]
      if (!score || score < peak * (local ? .035 : .42)) continue
      if (local && (score < scores[y * width + x - 1] || score < scores[y * width + x + 1] || score < scores[(y - 1) * width + x] || score < scores[(y + 1) * width + x])) continue
      candidates.push({ x: x / width, y: y / height, strength: score / peak })
    }
    candidates.sort((a, b) => b.strength - a.strength)
    const selected: Feature[] = []
    for (const feature of candidates) {
      if (selected.some(other => Math.hypot((other.x - feature.x) * width, (other.y - feature.y) * height) < minGap)) continue
      selected.push(feature)
      if (selected.length >= limit) break
    }
    return selected
  }
  return { width, height, corners: pick(responses, 88, 18, true), edges: pick(edges, 70, 26, false) }
}

function PointCloud({ scan }: { scan: Scan }) {
  const nodes = useMemo(() => scan.corners.map(point => ({ x: (point.x - .5) * 4, y: (.5 - point.y) * 2.8, z: (point.strength - .5) * .75 })), [scan])
  const lines = useMemo(() => nodes.flatMap((node, i) => nodes.slice(i + 1).map((other, offset) => ({ a: i, b: i + 1 + offset, distance: Math.hypot(node.x - other.x, node.y - other.y) })).filter(edge => edge.distance < .48).slice(0, 180)), [nodes])
  return <div className="discover-cloud-stage" aria-label={`Illustrative point map with ${nodes.length} detected corners`}>
    <div className="discover-cloud-orbit"><svg viewBox="-2.4 -1.7 4.8 3.4" role="img" aria-label="Detected image corners and illustrative connecting geometry">
      {lines.map((edge, i) => <line key={i} x1={nodes[edge.a].x} y1={nodes[edge.a].y} x2={nodes[edge.b].x} y2={nodes[edge.b].y} opacity={Math.max(.12, 1 - edge.distance / .55)} />)}
      {nodes.map((node, i) => <circle key={i} cx={node.x} cy={node.y} r={.018 + node.z * .006} opacity={.5 + node.z * .45} />)}
    </svg></div>
    <span className="discover-depth-note">2D measured positions · illustrative depth and links</span>
  </div>
}

export function DiscoverScan({ onContinue }: { onContinue: (summary: { fileName: string; cornerCount: number; edgeCount: number }) => void }) {
  const [file, setFile] = useState<File | null>(null), [scan, setScan] = useState<Scan | null>(null)
  const [stage, setStage] = useState(-1), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const url = useObjectUrl(file)
  useEffect(() => { setScan(null); setStage(-1) }, [file])
  async function run() {
    if (!file || busy) return
    setBusy(true); setScan(null); setError(''); setStage(0)
    try {
      const pixels = await decodeToPixels(file, 720)
      const detected = detectFeatures(pixels)
      setStage(1); await new Promise(resolve => window.setTimeout(resolve, 420))
      setScan(detected); setStage(2); await new Promise(resolve => window.setTimeout(resolve, 420))
      setStage(3)
    } catch (err) { setError(err instanceof Error ? err.message : 'The image could not be analyzed in this browser.'); setStage(-1) }
    finally { setBusy(false) }
  }
  const done = !!scan && stage === 3
  return <section className={`panel discover-scan${done ? ' is-complete' : ''}`} aria-labelledby="discover-scan-title">
    <div className="discover-scan-heading"><div><p className="eyebrow">Private local scan</p><h2 id="discover-scan-title">Explore the visual structure</h2><p className="muted">Measure corners and high contrast edges in this browser. The photograph is not sent to a service by this scan.</p></div>{done && <span className="discover-shield" aria-label="Discovery scan complete">✓</span>}</div>
    <label className="field"><span>Choose a photograph (JPEG, PNG, or WebP · up to 20 MB)</span><input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={event => { const next = event.currentTarget.files?.[0] ?? null; setError(''); if (next && (!['image/jpeg', 'image/png', 'image/webp'].includes(next.type) || next.size > 20 * 1024 * 1024)) { setError('Choose a JPEG, PNG, or WebP image up to 20 MB.'); setFile(null) } else setFile(next) }} /></label>
    <div className="actions"><Button disabled={!file || busy} onClick={() => void run()}>{busy ? 'Scanning image…' : 'Scan Image'}</Button>{done && <Button onClick={() => onContinue({ fileName: file?.name ?? 'Photograph', cornerCount: scan.corners.length, edgeCount: scan.edges.length })}>Continue to Proof</Button>}</div>
    {error && <p role="alert" className="error">{error}</p>}
    {stage >= 0 && <ol className="discover-scan-stages" aria-live="polite">{stages.slice(0, stage + 1).map((label, index) => <li key={label} className={index === stage ? 'is-active' : 'is-done'}>{label}</li>)}</ol>}
    {url && <div className="discover-scan-grid"><div className={`discover-photo-frame${busy ? ' is-scanning' : ''}`}><img src={url} alt="Uploaded photograph being scanned locally" />{busy && <span className="discover-scan-line" aria-hidden="true" />}{scan && <svg className="discover-feature-overlay" viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Detected visual points">{scan.edges.map((p, i) => <circle key={`e${i}`} className="edge-point" cx={p.x} cy={p.y} r=".003" />)}{scan.corners.map((p, i) => <circle key={`c${i}`} cx={p.x} cy={p.y} r=".006" />)}</svg>}</div>
      <div className="discover-scan-output">{scan ? <><div className="discover-counts"><span><b>{scan.corners.length}</b> measured corners</span><span><b>{scan.edges.length}</b> high contrast regions</span></div><PointCloud scan={scan} /><p className="muted">The nodes mark measured image positions. Added depth and connecting lines are illustrative geometry, not room reconstruction or forensic certainty.</p></> : <div className="discover-scan-placeholder">Your photograph and measured feature map will appear here.</div>}</div></div>}
    {done && <div className="discover-complete" role="status"><span>✓</span><div><h3>Discovery Scan Complete</h3><p>Your image has been analyzed successfully. No external sharing was required for this local scan.</p></div></div>}
  </section>
}
