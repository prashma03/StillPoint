import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useCaseRecord } from '../components/case'
import { EvidenceDiagram } from '../components/EvidenceDiagram'
import { Button, Dialog, MetricList, PageHeader, usePageTitle, useReducedMotion } from '../components/ui'
import { PROOF_LIMITS, PUNISHMENT_RULE, SCIENCE_LIMIT, metricRows, reportText } from '../lib/report'
import { buildSample } from '../lib/sampleCase'
import { reviewStore } from '../lib/storage'

export function Proof() {
  usePageTitle('Proof')
  const reduced = useReducedMotion()
  const [params] = useSearchParams()
  const { record } = useCaseRecord()
  const sample = params.get('sample')
  const sampleRecord = useMemo(
    () => (sample === 'derivative' || sample === 'moved' ? buildSample(sample) : null),
    [sample],
  )
  const current = sampleRecord ?? record
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
    <div className="page">
      <PageHeader
        eyebrow="Proof"
        title="Evidence without exposure"
        lede="A drawing of the room lineup. No photograph travels with this report."
      />
      {!current ? (
        <div className="panel">
          <h2>No proof is open</h2>
          <p className="muted">Finish a check, or open the sample document.</p>
          <Button to="/results?sample=derivative">Open the sample proof</Button>
        </div>
      ) : (
        <div className="stack">
          {current.sample && <p className="note">Sample scene graphs. Not your photographs.</p>}
          <section className={`panel verdict-${current.presentation.tone}`}>
            <span className={`status status-${current.presentation.tone}`}>{current.presentation.label}</span>
            <h2 style={{ marginTop: 12 }}>{current.presentation.summary}</h2>
            {current.presentation.note && <p>{current.presentation.note}</p>}
            <MetricList rows={metricRows(current.result, current.hashComparison)} />
          </section>
          <EvidenceDiagram
            source={current.sourceGraph}
            suspect={current.suspectGraph}
            residuals={current.result.residuals}
            showLines={lines}
            replayKey={replay}
            reduced={reduced}
            sourceCaption="Original viewpoint"
            suspectCaption="Compared viewpoint"
          />
          <div className="actions">
            <Button variant="secondary" onClick={() => setReplay((value) => value + 1)}>Replay alignment</Button>
            <Button variant="secondary" onClick={() => setLines((value) => !value)} pressed={lines}>
              {lines ? 'Hide reference lines' : 'Show reference lines'}
            </Button>
            <Button variant="secondary" onClick={() => void copySummary()}>Copy summary</Button>
            <Button variant="secondary" onClick={exportReport}>Export redacted report</Button>
            <Button onClick={() => setOpen(true)}>Request review</Button>
          </div>
          {copied && <p role="status">{copied}</p>}
          {saved && <p role="status">{saved}</p>}
          <section>
            <h2>What this proof does not establish</h2>
            <ul className="limits">
              {PROOF_LIMITS.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <p className="note">{SCIENCE_LIMIT}</p>
            <p className="note rule">{PUNISHMENT_RULE}</p>
            <p className="muted">Human review is not connected in this build. A review request stays on this device.</p>
          </section>
          <Dialog open={open} title="Request review" confirmLabel="Save on this device" onConfirm={saveReview} onClose={() => setOpen(false)}>
            <p className="muted">This note is stored in this browser. It is not sent to a school, platform, or reviewer.</p>
            <label className="field">
              <span className="field-label">Note</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} />
            </label>
          </Dialog>
        </div>
      )}
    </div>
  )
}
