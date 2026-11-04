import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useCaseRecord } from '../components/case'
import { EvidenceDiagram } from '../components/EvidenceDiagram'
import { Button, MetricList, PageHeader, usePageTitle, useReducedMotion } from '../components/ui'
import { mappingLabel, metricRows, verdictExplanation } from '../lib/report'
import { buildSample } from '../lib/sampleCase'
import type { CaseRecord } from '../lib/types'

export function Results() {
  usePageTitle('Results')
  const reduced = useReducedMotion()
  const [params] = useSearchParams()
  const { record } = useCaseRecord()
  const sample = params.get('sample')
  const sampleRecord = useMemo(
    () => (sample === 'derivative' || sample === 'moved' ? buildSample(sample) : null),
    [sample],
  )
  const current = sampleRecord ?? record
  return (
    <div className="page">
      <PageHeader
        eyebrow="Results"
        title="Your result"
        lede="The alignment engine would rather say it cannot tell than overstate a connection."
      />
      {current ? <ResultBody record={current} reduced={reduced} sampleQuery={sampleRecord ? sample : null} /> : <EmptyResults />}
    </div>
  )
}

function ResultBody({ record, reduced, sampleQuery }: { record: CaseRecord; reduced: boolean; sampleQuery: string | null }) {
  const tone = record.presentation.tone
  return (
    <div className={reduced ? 'stack' : 'stack reveal'}>
      {record.sample && <p className="note">Sample scene graphs shipped with Stillpoint. Not your photographs.</p>}
      <section className={`panel verdict-${tone}`}>
        <span className={`status status-${tone}`}>{record.presentation.label}</span>
        <h2 style={{ marginTop: 12 }}>{record.presentation.summary}</h2>
        {record.presentation.note && <p className="muted">{record.presentation.note}</p>}
        <p className="muted">Source mapping: {mappingLabel(record.sourceOrigin, record.sourceModel)} Suspect mapping: {mappingLabel(record.suspectOrigin, record.suspectModel)}</p>
        <MetricList rows={metricRows(record.result, record.hashComparison)} />
        {record.pythonNote && <p className="footer-note">{record.pythonNote}</p>}
      </section>
      <EvidenceDiagram
        source={record.sourceGraph}
        suspect={record.suspectGraph}
        residuals={record.result.residuals}
        showLines
        replayKey={record.id}
        reduced={reduced}
        sourceCaption={record.sourceLabel}
        suspectCaption={record.suspectLabel}
      />
      <div className="actions">
        <Button to={sampleQuery ? `/proof?sample=${sampleQuery}` : '/proof'}>Open redacted proof</Button>
        <Button to="/check" variant="secondary">Run another check</Button>
      </div>
      <section className="panel">
        <h2>Why this verdict</h2>
        <ul className="limits">
          {verdictExplanation(record.result).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {record.result.residuals.length > 0 && (
          <>
            <h2>Correspondence measurements</h2>
            <ul className="limits">
              {record.result.residuals.map((item) => (
                <li key={item.name}>
                  {item.name}: residual {item.distance.toFixed(2)}, shift ({item.dx.toFixed(2)}, {item.dy.toFixed(2)}) — {item.aligned ? 'aligned' : 'not aligned'}
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
      <section className="panel">
        <h2>How a result is chosen</h2>
        <p className="muted">Likely derivative — the visible backgrounds strongly align from the same viewpoint.</p>
        <p className="muted">Cannot determine, different viewpoint — the viewpoints do not align closely enough to establish a reliable connection.</p>
        <p className="muted">Cannot determine, insufficient background — not enough background is visible.</p>
        <p className="muted">No link found — no reliable visual connection was established. This does not prove the images are unrelated.</p>
        <p className="note">Background replaced. Scene matching cannot establish the source when the background has been replaced. Automatic detection is not available in this build. Sealed identity verification is not available in this build.</p>
      </section>
    </div>
  )
}

function EmptyResults() {
  return (
    <div className="panel">
      <h2>No comparison yet</h2>
      <p className="muted">Run a check, or open a sample measurement. Samples are synthetic room graphs.</p>
      <div className="actions">
        <Button to="/check">Check a suspicious photo</Button>
        <Link to="/results?sample=derivative">View the sample derivative</Link>
      </div>
    </div>
  )
}
