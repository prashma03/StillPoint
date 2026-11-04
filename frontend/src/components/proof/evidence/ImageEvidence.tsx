import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { getProofMedia } from '../../../lib/checkSession'
import type { CaseRecord } from '../../../lib/types'
import { useReducedMotion } from '../../ui'
import styles from './EvidenceConnections.module.css'

type Size = { width: number; height: number }
type Point = { x: number; y: number }
type ProjectedMatch = { name: string; source: Point; suspect: Point; status: string; errorPx: number | null }
const phases = [
  { title: 'Measured points', detail: 'Every point and line below comes from the image measurements saved with this comparison.' },
  { title: 'Patch candidates', detail: 'Amber lines are tentative patch matches. They have not passed geometric verification.' },
  { title: 'Geometric verification', detail: 'Cyan pairs fit the image-plane homography. Coral pairs were rejected by that fit.' },
]

function useBlobUrl(blob: Blob | null) {
  const [url, setUrl] = useState('')
  useEffect(() => {
    if (!blob) { setUrl(''); return }
    const value = URL.createObjectURL(blob)
    setUrl(value)
    return () => URL.revokeObjectURL(value)
  }, [blob])
  return url
}

function projectPoint(frame: DOMRect, root: DOMRect, ratio: number, point: { x: number; y: number }): Point {
  const boxRatio = frame.width / Math.max(frame.height, 1)
  let width = frame.width, height = frame.height, left = 0, top = 0
  if (ratio >= boxRatio) { height = frame.width / ratio; top = (frame.height - height) / 2 }
  else { width = frame.height * ratio; left = (frame.width - width) / 2 }
  return { x: frame.left - root.left + left + point.x * width, y: frame.top - root.top + top + point.y * height }
}

function lineColor(status: string) { return status === 'verified' ? '#50DDE8' : status === 'rejected' ? '#E47C83' : '#F3B75E' }

export function ImageEvidence({ record }: { record: CaseRecord }) {
  const fit = record.correspondence
  const reduced = useReducedMotion()
  const media = getProofMedia(record.id)
  const originalUrl = useBlobUrl(media?.original ?? null)
  const [view, setView] = useState(false)
  const revealSuspicious = Boolean(media && (!media.blind || view))
  const suspiciousUrl = useBlobUrl(revealSuspicious ? media?.suspicious ?? null : null)
  const [dimensions, setDimensions] = useState<[Size | null, Size | null]>([null, null])
  const [failed, setFailed] = useState<[boolean, boolean]>([false, false])
  const [retryKey, setRetryKey] = useState(0)
  const [selected, setSelected] = useState<string | null>(null)
  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(true)
  const rootRef = useRef<HTMLDivElement>(null)
  const leftRef = useRef<HTMLDivElement>(null)
  const rightRef = useRef<HTMLDivElement>(null)
  const [overlaySize, setOverlaySize] = useState<Size>({ width: 1, height: 1 })
  const matches = fit?.matches ?? []
  const defaultMatch = matches.find(match => match.status === 'verified') ?? matches[0] ?? null
  const selectedMatch = matches.find(match => match.name === selected) ?? defaultMatch
  const noReliableMatches = !matches.some(match => match.status === 'verified')
  const selectable = matches.slice(0, 48)

  useEffect(() => {
    if (!rootRef.current || !leftRef.current || !rightRef.current) return
    const measure = () => {
      const root = rootRef.current, left = leftRef.current, right = rightRef.current
      if (!root || !left || !right) return
      const box = root.getBoundingClientRect()
      setOverlaySize(current => current.width === box.width && current.height === box.height ? current : { width: box.width, height: box.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(rootRef.current); observer.observe(leftRef.current); observer.observe(rightRef.current)
    return () => observer.disconnect()
  }, [originalUrl, suspiciousUrl, dimensions])

  useEffect(() => {
    if (reduced || !playing) return
    let start = performance.now() - progress * 4200
    let frame = 0
    const tick = (now: number) => {
      const next = Math.min(1, (now - start) / 4200)
      setProgress(next)
      if (next < 1) frame = requestAnimationFrame(tick)
      else setPlaying(false)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, reduced])
  useEffect(() => { if (reduced) { setProgress(1); setPlaying(false) } }, [reduced])

  const projected = useMemo(() => {
    const root = rootRef.current?.getBoundingClientRect()
    const left = leftRef.current?.getBoundingClientRect(), right = rightRef.current?.getBoundingClientRect()
    if (!root || !left || !right || !dimensions[0] || !dimensions[1]) return [] as ProjectedMatch[]
    return matches.slice(0, fit?.renderedLimit ?? 0).map(match => ({
      name: match.name,
      source: projectPoint(left, root, dimensions[0]!.width / dimensions[0]!.height, { x: match.sourceX, y: match.sourceY }),
      suspect: projectPoint(right, root, dimensions[1]!.width / dimensions[1]!.height, { x: match.suspectX, y: match.suspectY }),
      status: match.status, errorPx: match.errorPx,
    }))
  }, [matches, fit?.renderedLimit, dimensions, overlaySize])

  if (!fit) return null
  const missingMedia = !media || !media.original || !media.suspicious
  const imageError = failed[0] || (revealSuspicious && failed[1])
  const unmatched = [
    ...(fit.unmatchedSource ?? []).map(point => ({ side: 'source' as const, point })),
    ...(fit.unmatchedSuspect ?? []).map(point => ({ side: 'suspect' as const, point })),
  ]

  function keySelect(event: React.KeyboardEvent<SVGCircleElement>, name: string) {
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setSelected(name) }
  }

  return <section className={styles.stage} aria-label="Image correspondence visualization">
    <div className={styles.hud}><span>Measured image correspondences</span><span>Photographs retain their original aspect ratio</span></div>
    {missingMedia ? <div className={styles.emptyState} role="status"><h3>Comparison photographs unavailable</h3><p>Image previews are kept in memory for the current Check session. Return to Check and rerun the comparison to restore them.</p><Link to="/check">Return to Check</Link></div>
      : imageError ? <div className={styles.emptyState} role="alert"><h3>A photograph could not be displayed</h3><p>The image preview failed to load. The stored comparison measurements are unchanged.</p><button type="button" onClick={() => { setFailed([false, false]); setDimensions([null, null]); setRetryKey(value => value + 1) }}>Retry image loading</button></div>
      : <>
        <div className={styles.pairStage} ref={rootRef}>
          <div className={styles.photoCard}>
            <div className={styles.photoHeading}>Original photograph<span>{record.sourceFile?.name || record.sourceLabel}</span></div>
            <div className={styles.photoFrame} ref={leftRef}>
              {originalUrl ? <img key={`source-${retryKey}`} src={originalUrl} alt="Original photograph with measured feature points" onLoad={event => { const image = event.currentTarget; setDimensions(([_, right]) => [{ width: image.naturalWidth, height: image.naturalHeight }, right]) }} onError={() => setFailed(([_, right]) => [true, right])} /> : <span className={styles.loading}>Loading original photograph…</span>}
            </div>
          </div>
          <div className={styles.photoCard}>
            <div className={styles.photoHeading}>{revealSuspicious ? 'Suspected photograph' : 'Suspected photograph concealed'}<span>{record.suspectFile?.name || record.suspectLabel}</span></div>
            <div className={styles.photoFrame} ref={rightRef}>
              {revealSuspicious ? suspiciousUrl ? <img key={`suspect-${retryKey}`} src={suspiciousUrl} alt="Redacted suspected photograph with measured feature points" onLoad={event => { const image = event.currentTarget; setDimensions(([left]) => [left, { width: image.naturalWidth, height: image.naturalHeight }]) }} onError={() => setFailed(([left]) => [left, true])} /> : <span className={styles.loading}>Loading suspected photograph…</span> : <span className={styles.concealed}>Hidden by Blind Mode. Reveal is optional.</span>}
            </div>
          </div>
          {dimensions[0] && (revealSuspicious ? dimensions[1] : true) && <svg className={styles.overlay} viewBox={`0 0 ${overlaySize.width} ${overlaySize.height}`} preserveAspectRatio="none" aria-label="Measured image points and matched feature connections">
            {projected.map((match, index) => {
              const active = selectedMatch?.name === match.name
              const shown = progress >= Math.min(.85, index / Math.max(projected.length, 1) * .85)
              if (!shown) return null
              return <g key={match.name} className={`${styles.connection} ${active ? styles.activeConnection : ''}`}>
                {revealSuspicious && <line x1={match.source.x} y1={match.source.y} x2={match.suspect.x} y2={match.suspect.y} stroke={lineColor(match.status)} />}
                <circle className={styles.hitArea} cx={match.source.x} cy={match.source.y} r="15" role="button" tabIndex={0} aria-label={`${match.name} on original, ${match.status}. Select to highlight its corresponding point.`} onClick={() => setSelected(match.name)} onKeyDown={event => keySelect(event, match.name)} />
                <circle className={styles.featurePoint} cx={match.source.x} cy={match.source.y} r={active ? 7 : 5} fill={lineColor(match.status)} />
                {revealSuspicious && <><circle className={styles.hitArea} cx={match.suspect.x} cy={match.suspect.y} r="15" role="button" tabIndex={0} aria-label={`${match.name} on suspected photograph, ${match.status}. Select to highlight its corresponding point.`} onClick={() => setSelected(match.name)} onKeyDown={event => keySelect(event, match.name)} /><circle className={styles.featurePoint} cx={match.suspect.x} cy={match.suspect.y} r={active ? 7 : 5} fill={lineColor(match.status)} /></>}
              </g>
            })}
            {unmatched.map(({ side, point }, index) => {
              if (side === 'suspect' && !revealSuspicious) return null
              const ref = side === 'source' ? leftRef.current : rightRef.current
              const ratio = side === 'source' ? dimensions[0]!.width / dimensions[0]!.height : dimensions[1]!.width / dimensions[1]!.height
              if (!ref) return null
              const pos = projectPoint(ref.getBoundingClientRect(), rootRef.current!.getBoundingClientRect(), ratio, point)
              return <circle key={`${side}-${index}`} className={styles.unmatchedPoint} cx={pos.x} cy={pos.y} r="3.5"><title>Detected corner without a retained patch match</title></circle>
            })}
          </svg>}
        </div>
        {media?.blind && <label className="checkline"><input type="checkbox" checked={view} onChange={event => setView(event.target.checked)} /><span>I choose to reveal the redacted suspected photograph. Areas outside the privacy cover may still be sensitive.</span></label>}
      </>}
    {noReliableMatches && !missingMedia && !imageError && <p className={styles.noMatches} role="status">No reliable feature matches available. The viewer shows only measured corners and any unverified candidates; no matches were invented.</p>}
    <div className={styles.explanation} aria-live="polite"><div><span className={styles.phaseKicker}>ANALYSIS VIEW · {progress < .35 ? phases[0].title.toUpperCase() : progress < .75 ? phases[1].title.toUpperCase() : phases[2].title.toUpperCase()}</span><p>{progress < .35 ? phases[0].detail : progress < .75 ? phases[1].detail : phases[2].detail}</p></div><span>{Math.min(matches.length, fit.renderedLimit)} of {matches.length} measured pairs shown</span></div>
    <div className={styles.controls}><button type="button" onClick={() => { if (progress < 1) { setProgress(1); setPlaying(false) } else { setProgress(0); setPlaying(true) } }}>{progress < 1 ? 'Show all measured connections' : 'Replay connection reveal'}</button>{!reduced && progress < 1 && <button type="button" onClick={() => setPlaying(value => !value)}>{playing ? 'Pause reveal' : 'Resume reveal'}</button>}<span className={styles.legend}><i className={styles.cyan} />Verified <i className={styles.amber} />Candidate <i className={styles.coral} />Rejected <i className={styles.slate} />Unpaired corner</span></div>
    <div className={styles.bottom}>
      <div className={styles.panel}><h3>Explore a correspondence</h3><div className={styles.featureButtons}>{selectable.slice(0, 12).map(match => <button type="button" aria-pressed={selectedMatch?.name === match.name} key={match.name} onClick={() => setSelected(match.name)}>{match.name}</button>)}</div><p>{selectedMatch ? `${selectedMatch.name}: original (${selectedMatch.sourceX.toFixed(3)}, ${selectedMatch.sourceY.toFixed(3)}), suspected (${selectedMatch.suspectX.toFixed(3)}, ${selectedMatch.suspectY.toFixed(3)}). ${selectedMatch.status}. ${selectedMatch.errorPx == null ? 'No reprojection error was recorded.' : `Reprojection ${selectedMatch.errorPx.toFixed(2)} px.`}` : 'No measured correspondence pair is available to inspect.'}</p></div>
      <div className={styles.panel}><h3>Measured counts</h3><p>Original corners: {fit.sourceFeatures}. Suspected corners: {fit.suspectFeatures}. Patch candidates: {fit.candidates}. Verified: {fit.verified}. Rejected: {fit.rejected}.</p><p>Mean verified error: {fit.meanVerifiedErrorPx == null ? 'not available' : `${fit.meanVerifiedErrorPx.toFixed(2)} px`} at a {fit.thresholdPx} px threshold. Model: {fit.model}.</p><p className={styles.hint}>{fit.limitation}</p></div>
    </div>
    {!missingMedia && imageError === false && dimensions[0] && (revealSuspicious ? dimensions[1] : true) && projected.length === 0 && matches.length > 0 && <div className={styles.loading} role="status">Positioning measured points over the photographs…</div>}
  </section>
}
