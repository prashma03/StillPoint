import { useState } from 'react'
import { getProofMedia } from '../lib/checkSession'
import type { CaseRecord } from '../lib/types'
import { useObjectUrl } from './ImageReview'
import { Button } from './ui'

export function PhotoProof({ record, lines, replay }: { record: CaseRecord; lines: boolean; replay: number }) {
  const media = getProofMedia(record.id)
  const [view, setView] = useState(false)
  const [ratios, setRatios] = useState([1, 1])
  const original = useObjectUrl(media?.original ?? null)
  const suspicious = useObjectUrl(media && (!media.blind || view) ? media.suspicious : null)
  if (!media) return record.photoMethod ? <p className="note">Photographs were cleared on refresh or deletion. The actual coordinate measurements remain available below.</p> : null
  return <section className="stack"><h3>Photographs from this comparison</h3><p className="muted">Privacy covers are burned into these temporary previews. Lines connect measured or manually reviewed details, not a fitted image transformation.</p>
    {media.blind && <label className="checkline"><input type="checkbox" checked={view} onChange={e => setView(e.target.checked)} /><span>I choose to view the redacted suspicious photograph in Proof. Areas outside my covers may still be sensitive.</span></label>}
    <div className="photo-proof-pair">
      <div>{original ? <img src={original} alt="Original photograph with chosen privacy covers" onLoad={e => { const image = e.currentTarget; setRatios(prev => [image.naturalHeight / image.naturalWidth, prev[1]]) }} /> : <p>Original pixels unavailable; saved reference used.</p>}</div>
      <div>{suspicious ? <img src={suspicious} alt="Compared photograph with chosen privacy covers" onLoad={e => { const image = e.currentTarget; setRatios(prev => [prev[0], image.naturalHeight / image.naturalWidth]) }} /> : <p>Suspicious photograph concealed.</p>}</div>
      {original && suspicious && <svg viewBox="0 0 2000 1000" preserveAspectRatio="none" className="photo-proof-overlay" aria-label="Measured background correspondences" key={replay}>{record.result.residuals.map(r => {
        const a = record.sourceGraph.room_objects.find(p => p.name.toLowerCase() === r.name.toLowerCase()), b = record.suspectGraph.room_objects.find(p => p.name.toLowerCase() === r.name.toLowerCase())
        if (!a || !b) return null
        const maxRatio = Math.max(...ratios), x = a.x + a.width / 2, y = (a.y + a.height / 2) * ratios[0] / maxRatio
        const x2 = 1000 + b.x + b.width / 2, y2 = (b.y + b.height / 2) * ratios[1] / maxRatio
        return <g key={r.name} className="photo-proof-connection" style={{ color: r.aligned ? '#50DDE8' : '#d99591' }}><title>{r.name}: {r.aligned ? 'within' : 'outside'} alignment threshold, residual {r.distance.toFixed(2)}</title>{lines && <line x1={x} y1={y} x2={x2} y2={y2} />}<circle cx={x} cy={y} r="7" /><circle cx={x2} cy={y2} r="7" /></g>
      })}</svg>}
    </div><div className="actions"><Button variant="secondary" to="/check">Return to this comparison</Button></div>
  </section>
}
