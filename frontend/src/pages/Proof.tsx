import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCaseRecord } from '../components/case'
import { EvidenceDiagram } from '../components/EvidenceDiagram'
import { PhotoProof } from '../components/PhotoProof'
import EvidenceConnections from '../components/proof/evidence/EvidenceConnections'
import { Button, Dialog, MetricList, PageHeader, usePageTitle, useReducedMotion } from '../components/ui'
import { PROOF_LIMITS, PUNISHMENT_RULE, SCIENCE_LIMIT, mappingLabel, metricRows, reportText, verdictExplanation } from '../lib/report'
import { buildSample } from '../lib/sampleCase'
import { reviewStore } from '../lib/storage'

export function Proof() {
  usePageTitle('Proof')
  const reduced = useReducedMotion()
  const [params] = useSearchParams()
  const { record } = useCaseRecord()
  const sample = params.get('sample')
  const caseId = params.get('case')
  const sampleRecord = useMemo(
    () => (sample === 'derivative' || sample === 'moved' ? buildSample(sample) : null),
    [sample],
  )
  const sessionRecord = caseId && record?.id !== caseId ? null : record
  const current = sampleRecord ?? sessionRecord
  const [mode, setMode] = useState<'comparison' | 'demo'>('comparison')
  const [lines, setLines] = useState(true)
  const [replay, setReplay] = useState(0)
  const [copied, setCopied] = useState('')
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState('')

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

  function exportReport() {
    if (!current) return
    const blob = new Blob([reportText(current)], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'stillpoint-redacted-report.txt'
    link.click()
    URL.revokeObjectURL(url)
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
        lede="Explore measured scene-map correspondences from your check, or switch to a clearly labeled 3D concept demonstration."
      />
      <div className="proof-mode-switch" role="group" aria-label="Choose evidence visualization">
        <button type="button" aria-pressed={mode === 'comparison'} onClick={() => setMode('comparison')}>My image comparison</button>
        <button type="button" aria-pressed={mode === 'demo'} onClick={() => setMode('demo')}>How it works · 3D</button>
      </div>
      {mode === 'comparison' ? <section className="proof-evidence proof-evidence-feature" aria-labelledby="evidence-connects-title">
        <div className="proof-evidence-heading">
          <div>
            <p className="eyebrow">Your comparison · scene-map correspondences</p>
            <h2 id="evidence-connects-title">What matched in your scene maps</h2>
          </div>
          <p className="muted">These points and lines come from the actual reviewed coordinates and alignment result. The guided photo workflow can propose local corner and patch correspondences, but does not fit a camera transformation. Temporary photographs, when available, appear below.</p>
        </div>
        {current ? <><EvidenceDiagram source={current.sourceGraph} suspect={current.suspectGraph} residuals={current.result.residuals} showLines={lines} replayKey={replay} reduced={reduced} sourceCaption="Original scene map" suspectCaption="Compared scene map" responsive /><div className="proof-connection-legend"><span><i className="legend-cyan" />Aligned scene-map points</span><span><i className="legend-amber" />Compared points outside the alignment threshold</span><span>Positions come from reviewed coordinate maps; local photo proposals remain experimental.</span></div>{current.sample && <p className="note">Illustrative sample scene graphs. These are not uploaded photographs.</p>}</> : <div className="panel"><h2>No comparison is open</h2><p className="muted">Run a Check to inspect its actual scene-map measurements here. Stillpoint will not invent image feature points when they are unavailable.</p><div className="actions"><Button to="/check">Start a check</Button><Button variant="secondary" onClick={() => setMode('demo')}>View the simulated 3D demonstration</Button></div></div>}
      </section> : <section className="proof-evidence proof-evidence-feature" aria-labelledby="evidence-connects-title">
        <div className="proof-evidence-heading"><div><p className="eyebrow">How the Evidence Connects · Simulated</p><h2 id="evidence-connects-title">Spatial correspondence, made visible.</h2></div><p className="muted">Simulated conceptual demonstration — not reconstructed from uploaded photographs or a verification result.</p></div>
        <EvidenceConnections />
      </section>}
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
              <Button variant="secondary" onClick={exportReport}>Export redacted report</Button>
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
