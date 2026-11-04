import { useEffect, useState } from 'react'
import type { FaceGeometryEvidence, FaceLandmark } from '../lib/facialGeometry'
import { getProofMedia } from '../lib/checkSession'

const connections: [string, string][] = [
  ['Forehead','Left brow'],['Forehead','Right brow'],['Left brow','Left outer eye'],['Left brow','Left inner eye'],['Right brow','Right inner eye'],['Right brow','Right outer eye'],
  ['Left outer eye','Left inner eye'],['Left inner eye','Nose bridge'],['Nose bridge','Right inner eye'],['Right inner eye','Right outer eye'],
  ['Nose bridge','Nose tip'],['Nose tip','Left nose edge'],['Nose tip','Right nose edge'],['Left cheek','Left nose edge'],['Right cheek','Right nose edge'],
  ['Left cheek','Mouth left'],['Mouth left','Upper lip'],['Upper lip','Mouth right'],['Mouth right','Right cheek'],['Upper lip','Lower lip'],['Lower lip','Mouth left'],
  ['Left cheek','Chin'],['Right cheek','Chin'],['Mouth left','Chin'],['Mouth right','Chin'],
]
const anchorColors: Record<string, string> = { Forehead:'#7ce8ef','Left brow':'#7ce8ef','Right brow':'#7ce8ef','Left outer eye':'#72d9ff','Left inner eye':'#72d9ff','Right inner eye':'#72d9ff','Right outer eye':'#72d9ff','Nose bridge':'#f1c579','Nose tip':'#f1c579','Left nose edge':'#f1c579','Right nose edge':'#f1c579','Left cheek':'#af9cff','Right cheek':'#af9cff','Mouth left':'#ff9eaa','Upper lip':'#ff9eaa','Lower lip':'#ff9eaa','Mouth right':'#ff9eaa','Chin':'#af9cff' }

function useBlobUrl(blob: Blob | null) {
  const [url, setUrl] = useState('')
  useEffect(() => { if (!blob) { setUrl(''); return } const next = URL.createObjectURL(blob); setUrl(next); return () => URL.revokeObjectURL(next) }, [blob])
  return url
}

function Mesh({ landmarks }: { landmarks: FaceLandmark[] }) {
  const byName = new Map(landmarks.map(point => [point.name, point]))
  return <svg viewBox="0 0 1 1" preserveAspectRatio="none" aria-label="Selected facial landmark mesh">
    {connections.map(([start, end], index) => { const a = byName.get(start), b = byName.get(end); return a && b ? <line key={index} x1={a.x} y1={a.y} x2={b.x} y2={b.y} /> : null })}
    {landmarks.map(point => <circle key={point.name} cx={point.x} cy={point.y} r=".008" fill={anchorColors[point.name] ?? '#8ff6ff'}><title>{point.name}</title></circle>)}
  </svg>
}

export function FacialGeometryProof({ evidence, caseId, blind }: { evidence: FaceGeometryEvidence; caseId: string; blind: boolean }) {
  const media = getProofMedia(caseId)
  const originalUrl = useBlobUrl(media?.original ?? null), suspectUrl = useBlobUrl(media?.suspicious ?? null)
  const [overlay, setOverlay] = useState(true), [revealed, setRevealed] = useState(false)
  const [ratios, setRatios] = useState<Record<string, number>>({})
  const showSuspect = !blind || revealed
  return <section className="panel facial-proof" aria-labelledby="facial-proof-title">
    <div className="facial-proof-heading"><div><span className="eyebrow">OPTIONAL · LOCAL · CONSENTED</span><h2 id="facial-proof-title">Facial landmark geometry</h2></div><label className="checkline"><input type="checkbox" checked={overlay} onChange={event => setOverlay(event.target.checked)} /><span>Show landmark mesh</span></label></div>
    {blind && <label className="checkline facial-reveal"><input type="checkbox" checked={revealed} onChange={event => setRevealed(event.target.checked)} /><span>I choose to reveal the redacted suspected photograph and its facial landmarks. Areas outside masks may remain sensitive.</span></label>}
    <div className="facial-photo-pair">{([
      { title:'Original photograph', url:originalUrl, points:evidence.source, hidden:false },
      { title:'Suspected photograph', url:suspectUrl, points:evidence.suspect, hidden:!showSuspect },
    ]).map(side => <article className="facial-photo-card" key={side.title}><h3>{side.title}</h3><div className="facial-photo-frame" style={{ aspectRatio: String(ratios[side.title] ?? 4 / 3) }}>{side.url && !side.hidden ? <img src={side.url} alt={`${side.title} with local facial reference points`} onLoad={event => { const image = event.currentTarget; const ratio = image.naturalWidth / image.naturalHeight; if (Number.isFinite(ratio) && ratio > 0) setRatios(current => current[side.title] === ratio ? current : { ...current, [side.title]: ratio }) }} /> : <div className="facial-concealed">{side.hidden ? 'Photograph concealed' : 'Redacted preview unavailable'}</div>}{overlay && !side.hidden && <Mesh landmarks={side.points} />}</div></article>)}</div>
    <dl className="facial-metrics"><div><dt>Reference landmarks</dt><dd>{evidence.sourceLandmarkCount} / {evidence.suspectLandmarkCount}</dd></div><div><dt>Within threshold</dt><dd>{evidence.alignedLandmarks} of {evidence.sourceLandmarkCount}</dd></div><div><dt>Mean normalized residual</dt><dd>{evidence.meanResidual == null ? 'Not available' : `${evidence.meanResidual.toFixed(3)} inter-eye spacings`}</dd></div><div><dt>Worst normalized residual</dt><dd>{evidence.maxResidual == null ? 'Not available' : `${evidence.maxResidual.toFixed(3)} inter-eye spacings`}</dd></div></dl>
    <p className="note">This is facial-shape geometry only. It does not identify a person, compare against a face database, or show that the photographs share a source image. Coordinates are held only in active memory for this Proof view and are omitted from session storage and reports.</p>
    <details className="facial-limitations"><summary>Pose, quality, and interpretation limits</summary><p>{evidence.limitations}</p></details>
  </section>
}
