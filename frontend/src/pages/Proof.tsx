import { useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useCaseRecord } from '../components/case'
import { EvidenceDiagram } from '../components/EvidenceDiagram'
import { PhotoProof } from '../components/PhotoProof'
import EvidenceConnections from '../components/proof/evidence/EvidenceConnections'
import { ImageEvidence } from '../components/proof/evidence/ImageEvidence'
import { FacialGeometryProof } from '../components/FacialGeometryProof'
import { Button, Dialog, MetricList, PageHeader, usePageTitle, useReducedMotion } from '../components/ui'
import { PROOF_LIMITS, PUNISHMENT_RULE, SCIENCE_LIMIT, mappingLabel, metricRows, reportText, verdictExplanation } from '../lib/report'
import { buildSample } from '../lib/sampleCase'
import { reviewStore } from '../lib/storage'

export function Proof() {
  usePageTitle('Proof')
  const reduced = useReducedMotion()
  const [params] = useSearchParams()
  const location = useLocation()
  const discoveryScan = (location.state as { discoveryScan?: { fileName: string; cornerCount: number; edgeCount: number; mode?: 'approximate-layout' | 'feature-map' } } | null)?.discoveryScan
  const { record, faceEvidence } = useCaseRecord()
  const sample = params.get('sample')
  const caseId = params.get('case')
  const sampleRecord = useMemo(
    () => (sample === 'derivative' || sample === 'moved' ? buildSample(sample) : null),
    [sample],
  )
  const sessionRecord = caseId && record?.id !== caseId ? null : record
  const current = sampleRecord ?? sessionRecord
  const [mode, setMode] = useState<'comparison' | 'demo'>(current || discoveryScan ? 'comparison' : 'demo')
  const [lines, setLines] = useState(true)
  const [replay, setReplay] = useState(0)
  const [copied, setCopied] = useState('')
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState('')
  const [exporting, setExporting] = useState(false)

  async function copySummary() {
    if (!current) return
    const text = reportText(current)
    try {
      await navigator.clipboard.writeText(text)
      setCopied('Summary copied. It contains no photograph.')
    } catch {
      setCopied('Copy was blocked by the browser. Use export instead.')
    }
  }

  async function exportReport() {
    if (!current || exporting) return
    setExporting(true)
    try {
      const { buildEvidencePdf } = await import('../lib/pdfReport')
      // Do not pass thumbnails: Proof exports contain no photograph pixels.
      const blob = await buildEvidencePdf(current)
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Stillpoint-Redacted-Evidence-${current.id.slice(0, 8)}.pdf`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setCopied('Redacted PDF exported locally. It contains no photograph pixels.')
    } catch (error) {
      setCopied(error instanceof Error ? `Could not generate PDF: ${error.message}` : 'Could not generate PDF report.')
    } finally { setExporting(false) }
  }

  function saveReview() {
    if (!current) return
    reviewStore().save({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      kind: 'review',
      note: note.trim(),
      caseId: current.id,
    })
    setSaved('Saved on this device. It was not sent to a reviewer.')
    setNote('')
    setOpen(false)
  }

  return (
    <div className="page proof-page">
      <PageHeader
        eyebrow="Proof"
        title="Evidence without exposure"
        lede="Explore the correspondences from this comparison, or open the simulated room separately."
      />
      <div className="proof-mode-switch" role="group" aria-label="Choose evidence visualization">
        <button type="button" aria-pressed={mode === 'comparison'} onClick={() => setMode('comparison')}>My Image Comparison</button>
        <button type="button" aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>Concept Demo</button>
      </div>
      {mode === 'comparison' ? <section className="proof-evidence proof-evidence-feature" aria-labelledby="evidence-connects-title">
        <div className="proof-evidence-heading">
          <div>
            <p className="eyebrow">My Image Comparison</p>
            <h2 id="evidence-connects-title">{current?.correspondence ? 'Correspondences from this comparison' : 'What matched in your scene maps'}</h2>
          </div>
          <p className="muted">{current?.correspondence ? 'Cyan lines are homography inliers. Amber lines are unverified patch matches. Coral lines were rejected. Blue-gray points are detected corners that were not kept as pairs. This is a 2.5D presentation, not a reconstructed room.' : 'These points come from the reviewed scene map. Image-plane matching is shown when this comparison includes local photograph features.'}</p>
        </div>
        {current?.correspondence ? <ImageEvidence key={current.id} record={current} /> : current ? <><EvidenceDiagram source={current.sourceGraph} suspect={current.suspectGraph} residuals={current.result.residuals} showLines={lines} replayKey={replay} reduced={reduced} sourceCaption="Original scene map" suspectCaption="Compared scene map" responsive /><div className="proof-connection-legend"><span><i className="legend-cyan" />Aligned scene-map points</span><span><i className="legend-amber" />Compared points outside the alignment threshold</span></div>{current.sample && <p className="note">Illustrative sample scene graphs. These are not uploaded photographs.</p>}</> : discoveryScan ? <div className="panel stack"><h2>Local discovery scan</h2><p>{discoveryScan.fileName}</p><p>{discoveryScan.cornerCount} measured corners · {discoveryScan.edgeCount} high contrast regions.</p><p className="note">This is a visual-structure scan of one image. It did not compare a second image and does not determine whether the photograph is authentic, manipulated, safe, or derivative. {discoveryScan.mode === 'approximate-layout' ? 'The spatial view is an approximate layout; its depth is illustrative, not a verified reconstruction.' : 'No room was inferred. Depth in the spatial view is illustrative.'}</p><Button to="/check">Compare with another image</Button></div> : <div className="panel"><h2>No comparison is open</h2><p className="muted">Run a Check to inspect its measured correspondences. Stillpoint will not invent image feature points.</p><div className="actions"><Button to="/check">Start a check</Button><Button variant="secondary" onClick={() => setMode('demo')}>Open Concept Demo</Button></div></div>}
      </section> : <section className="proof-evidence proof-evidence-feature" aria-labelledby="evidence-connects-title">
        <div className="proof-evidence-heading"><div><p className="eyebrow">Concept Demo</p><h2 id="evidence-connects-title">Spatial correspondence, made visible.</h2></div><p className="muted">Conceptual visualization — simulated data, not reconstructed from uploaded photographs.</p></div>
        <EvidenceConnections />
      </section>}
      {mode === 'comparison' && current && faceEvidence && !current.sample && <FacialGeometryProof key={current.id} evidence={faceEvidence} caseId={current.id} blind={current.blind} />}
      {mode === 'comparison' && current?.photoMethod?.includes('A separate local facial landmark geometry comparison') && !faceEvidence && <p className="note">Temporary facial landmark coordinates were cleared when the active analysis session ended. Only non-coordinate report metadata remains.</p>}
      <div className={`proof-layout${current ? '' : ' proof-empty'}`}>
        <section className="proof-main">
          <h2 className="proof-section-title">Your comparison</h2>
          {current && <PhotoProof key={current.id} record={current} lines={lines} replay={replay} />}
          {current?.photoMethod && <p className="note">{current.photoMethod}</p>}
          {current && <>
            {current.sample && <p className="note proof-sample">Sample scene graphs. Not your photographs.</p>}
            <p className="muted">The diagram above visualizes the measured background landmarks in the comparison record. It is a scene-map view, not a view of the original pixels.</p>
          </>}
        </section>
        <aside className="proof-side">
          {!current ? <section className="panel proof-empty-card">
            <h2>No proof is open</h2>
            <p className="muted">Finish a check, or open the sample document.</p>
            <Button to="/results?sample=derivative">Open the sample proof</Button>
          </section> : <>
            <section className={`panel proof-result verdict-${current.presentation.tone}`} aria-labelledby="proof-summary-title">
              <p className="eyebrow" id="proof-summary-title">Verification summary</p>
              {current.sample && <span className="status status-neutral">Illustrative sample</span>}
              <span className={`status status-${current.presentation.tone}`}>{current.presentation.label}</span>
              <h2>{current.presentation.summary}</h2>
              <p className="proof-match">{current.result.aligned_points} of {current.result.usable_points} reference points align.</p>
              {current.presentation.note && <p>{current.presentation.note}</p>}
              <p className="muted">Source mapping: {mappingLabel(current.sourceOrigin, current.sourceModel)} Suspect mapping: {mappingLabel(current.suspectOrigin, current.suspectModel)}</p>
              <MetricList rows={metricRows(current.result, current.hashComparison)} />
              <h3>What this result means</h3>
              <ul className="limits proof-explanation">
                {verdictExplanation(current.result).map((item) => <li key={item}>{item}</li>)}
              </ul>
            </section>
            <div className="actions proof-actions">
              {mode === 'comparison' && <><Button variant="secondary" onClick={() => setReplay((value) => value + 1)}>Replay measured correspondences</Button>
              <Button variant="secondary" onClick={() => setLines((value) => !value)} pressed={lines}>
                {lines ? 'Hide correspondence lines' : 'Show correspondence lines'}
              </Button></>}
              <Button variant="secondary" onClick={() => void copySummary()}>Copy summary</Button>
              <Button variant="secondary" disabled={exporting} onClick={() => void exportReport()}>{exporting ? 'Generating PDF…' : 'Export redacted PDF'}</Button>
              <Button onClick={() => setOpen(true)}>Request review</Button>
            </div>
            {copied && <p role="status">{copied}</p>}
            {saved && <p role="status">{saved}</p>}
            <section className="proof-limitations">
              <h2>What this proof does not establish</h2>
              <ul className="limits">{PROOF_LIMITS.map((item) => <li key={item}>{item}</li>)}</ul>
              <p className="note">{SCIENCE_LIMIT}</p>
              <p className="note rule">{PUNISHMENT_RULE}</p>
              <p className="muted">Human review is not connected in this build. A review request stays on this device.</p>
            </section>
            <Dialog open={open} title="Request review" confirmLabel="Save on this device" onConfirm={saveReview} onClose={() => setOpen(false)}>
              <p className="muted">This note is stored in this browser. It is not sent to a school, platform, or reviewer.</p>
              <label className="field"><span className="field-label">Note</span><textarea value={note} onChange={(event) => setNote(event.target.value)} /></label>
            </Dialog>
          </>}
        </aside>
      </div>
    </div>
  )
}
