import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Button, PageHeader, usePageTitle } from '../components/ui'
import { sceneStore } from '../lib/storage'
import { sampleOriginal } from '../lib/samples'
import { runProtectionTests, testStatus } from '../lib/tests'
import type { SceneGraph } from '../lib/types'

export function TestProtection() {
  usePageTitle('Test')
  const [params] = useSearchParams()
  const scenes = useMemo(() => sceneStore().list(), [])
  const [sourceId, setSourceId] = useState(params.get('scene') ?? 'sample')
  const [ran, setRan] = useState(false)
  const graph: SceneGraph = sourceId === 'sample'
    ? sampleOriginal
    : scenes.find((scene) => scene.id === sourceId)?.graph ?? sampleOriginal
  const usingSample = sourceId === 'sample' || !scenes.some((scene) => scene.id === sourceId)
  const results = ran ? runProtectionTests(graph) : []

  return (
    <div className="page">
      <PageHeader
        eyebrow="Test"
        title="Test my protection"
        lede="Only test images and scene graphs you are allowed to use. The bundled sample is a synthetic room graph, not a photograph of a person."
      />
      <div className="stack">
        <label className="field">
          <span className="field-label">Scene graph to test</span>
          <select value={usingSample ? 'sample' : sourceId} onChange={(event) => { setSourceId(event.target.value); setRan(false) }}>
            <option value="sample">Bundled sample graph</option>
            {scenes.map((scene) => (
              <option key={scene.id} value={scene.id}>{scene.label}</option>
            ))}
          </select>
        </label>
        <Button onClick={() => setRan(true)}>Run scene-graph tests</Button>
        {usingSample && <p className="note">The sample is synthetic geometry. These tests do not alter a photograph.</p>}
        {results.map((item) => (
          <article key={item.id} className="test-row">
            <header>
              <b>{item.title}</b>
              <span className={`status ${item.ran ? statusClass(testStatus(item)) : 'status-neutral'}`}>{testStatus(item)}</span>
            </header>
            <p className="muted">{item.detail}</p>
            {item.result && (
              <p className="num">
                {item.result.verdict} · {item.result.aligned_points} of {item.result.usable_points} aligned · {item.result.agreement_percent.toFixed(1)}% geometric agreement
              </p>
            )}
          </article>
        ))}
        <p className="note">Scene matching cannot establish the source when the background has been replaced. Sealed identity verification is not available in this build.</p>
      </div>
    </div>
  )
}

function statusClass(label: string) {
  if (label === 'Protected') return 'status-success'
  if (label === 'Limited protection') return 'status-amber'
  if (label === 'Not protected') return 'status-slate'
  return 'status-neutral'
}
