import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useCaseRecord } from '../components/case'
import { Button, PageHeader, usePageTitle } from '../components/ui'
import { runCheck } from '../lib/check'
import { verifyWithPython } from '../lib/engine'
import { sha256 } from '../lib/hash'
import { readGraph } from '../lib/graphs'
import { sceneStore, settingsStore } from '../lib/storage'
import type { SceneGraph, StageUpdate } from '../lib/types'

type SuspectHold = {
  name: string
  hash: string | null
  graph: SceneGraph | null
  kind: 'graph' | 'image' | 'other'
}

export function Check() {
  usePageTitle('Check')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const { setRecord } = useCaseRecord()
  const scenes = useMemo(() => sceneStore().list(), [])
  const [settings, setSettings] = useState(() => settingsStore().load())
  const [suspect, setSuspect] = useState<SuspectHold | null>(null)
  const [sourceId, setSourceId] = useState(params.get('scene') ?? scenes[0]?.id ?? '')
  const [sourceGraph, setSourceGraph] = useState<SceneGraph | null>(null)
  const [sourceName, setSourceName] = useState('')
  const [stages, setStages] = useState<StageUpdate[]>([])
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [over, setOver] = useState(false)
  const blind = settings.blindMode

  const selected = scenes.find((scene) => scene.id === sourceId) ?? null
  const activeSource = sourceGraph ?? selected?.graph ?? null
  const sourceLabel = sourceGraph ? sourceName || 'Imported scene graph' : selected?.label ?? 'Source'

  function setBlind(next: boolean) {
    const updated = { ...settings, blindMode: next }
    settingsStore().save(updated)
    setSettings(updated)
  }

  async function takeSuspect(file: File) {
    setError('')
    if (file.size > 20 * 1024 * 1024) {
      setError('That file is larger than 20 MB.')
      return
    }
    const hash = await sha256(file)
    const looksJson = file.type.includes('json') || file.name.toLowerCase().endsWith('.json')
    if (looksJson) {
      try {
        const parsed = readGraph(JSON.parse(await file.text()))
        if (!parsed.ok) {
          setError(parsed.error)
          return
        }
        setSuspect({ name: file.name, hash, graph: parsed.graph, kind: 'graph' })
        return
      } catch {
        setError('That file is not a scene graph.')
        return
      }
    }
    if (file.type.startsWith('image/')) {
      setSuspect({ name: file.name, hash, graph: null, kind: 'image' })
      return
    }
    setSuspect({ name: file.name, hash, graph: null, kind: 'other' })
    setError('Use a scene graph JSON file. Other files stay sealed and cannot be compared.')
  }

  async function takeSource(file: File) {
    try {
      const parsed = readGraph(JSON.parse(await file.text()))
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      setSourceGraph(parsed.graph)
      setSourceName(file.name)
      setError('')
    } catch {
      setError('The original file is not a scene graph.')
    }
  }

  function upsert(stage: StageUpdate) {
    setStages((current) => {
      const index = current.findIndex((item) => item.id === stage.id)
      if (index === -1) return [...current, stage]
      const next = [...current]
      next[index] = stage
      return next
    })
  }

  async function run() {
    setRunning(true)
    setError('')
    setStages([])
    const outcome = await runCheck(
      {
        source: activeSource,
        suspect: suspect?.graph ?? null,
        sourceLabel,
        suspectLabel: suspect?.name ?? 'Suspect',
        sourceHash: selected?.fileHash ?? null,
        suspectHash: suspect?.hash ?? null,
        sourceMask: selected?.mask ?? null,
        maskApplied: selected?.maskConfirmed ?? false,
        blind,
        sample: false,
      },
      upsert,
    )
    if (!outcome.ok) {
      setError(outcome.reason)
      setRunning(false)
      return
    }
    if (settings.pythonEngine) {
      const checked = await verifyWithPython(outcome.record.sourceGraph, outcome.record.suspectGraph)
      outcome.record.pythonNote = checked.ok
        ? checked.result.verdict === outcome.record.result.verdict
          ? 'Local Python engine returned the same verdict.'
          : `Local Python engine returned “${checked.result.verdict}”. The on-device verdict is the one shown.`
        : checked.error
    }
    setRecord(outcome.record)
    setRunning(false)
    navigate('/results')
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Check"
        title="Check without looking"
        lede="A trusted contact can supply the suspicious file. You choose what happens next."
      />
      <div className="split">
        <div className="stack">
          <section className={blind ? 'seal seal-on' : 'seal'} aria-live="polite">
            <p className="privacy">
              <i />
              {blind ? 'Blind Mode is on.' : 'Blind Mode is off.'}
            </p>
            <h2 style={{ marginTop: 12 }}>{blind ? "You won't be shown the suspicious image." : 'Photographs stay hidden in this build.'}</h2>
            <p className="muted">
              {suspect
                ? `${suspect.name} is sealed. ${suspect.kind === 'graph' ? 'A scene graph was read.' : 'The file was not displayed.'}`
                : 'No suspicious file is selected.'}
            </p>
            <label className="checkline">
              <input type="checkbox" checked={blind} onChange={(event) => setBlind(event.target.checked)} />
              <span>Keep Blind Mode on</span>
            </label>
          </section>

          <label
            className={over ? 'drop drop-over' : 'drop'}
            onDragOver={(event) => {
              event.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(event) => {
              event.preventDefault()
              setOver(false)
              const file = event.dataTransfer.files[0]
              if (file) void takeSuspect(file)
            }}
          >
            <input
              type="file"
              accept="application/json,.json,image/*"
              aria-label="Suspicious scene graph or sealed image"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void takeSuspect(file)
                event.currentTarget.value = ''
              }}
            />
            <b>Add the suspicious file</b>
            <span className="muted">Scene graph JSON can be compared. An image stays hidden and is not decoded.</span>
          </label>

          <label className="field">
            <span className="field-label">Your protected scene</span>
            <select value={sourceId} onChange={(event) => { setSourceId(event.target.value); setSourceGraph(null) }}>
              <option value="">Choose a saved scene</option>
              {scenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field-label">Or import your original scene graph</span>
            <input
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) void takeSource(file)
              }}
            />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <Button onClick={() => void run()} disabled={running || !activeSource || !suspect?.graph}>
            Compare viewpoints
          </Button>
          {!suspect?.graph && suspect?.kind === 'image' && (
            <p className="note">Photograph scene mapping is not available in this build, so this image cannot be compared until a scene graph is provided.</p>
          )}
          {stages.length > 0 && (
            <ol className="stages" aria-live="polite">
              {stages.map((stage) => (
                <li key={stage.id} className={stage.state === 'done' ? 'stage stage-done' : 'stage'}>
                  <b>{stage.label}</b>
                  <span>{stage.detail}</span>
                  {stage.state === 'active' && <span className="indet" />}
                </li>
              ))}
            </ol>
          )}
        </div>
        <aside className="stack">
          <div className="panel">
            <h2>Synthetic samples</h2>
            <p className="muted">These are the bundled room graphs, not photographs of a person.</p>
            <div className="actions">
              <Button to="/results?sample=derivative" variant="secondary">Sample derivative</Button>
              <Button to="/results?sample=moved" variant="secondary">Sample moved camera</Button>
            </div>
          </div>
          <p className="note">Nothing on this page is uploaded. A scene graph sent to the optional local Python engine stays on this computer, and only if you turn that on in Settings.</p>
          <p className="footer-note">Computed on this device.</p>
        </aside>
      </div>
    </div>
  )
}
