import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AIAssist } from '../components/AIAssist'
import { ProposalAssist } from '../components/ProposalAssist'
import { SegmentAssist } from '../components/SegmentAssist'
import { useCaseRecord } from '../components/case'
import { Button, PageHeader } from '../components/ui'
import type { SegmentRect } from '../lib/ai'
import { runCheck } from '../lib/check'
import { verifyWithPython } from '../lib/engine'
import { sha256 } from '../lib/hash'
import { safeLink, takeDiscoveryHandoff } from '../lib/discover'
import { LANDMARK_DEFAULT_LIMIT, consentScope } from '../lib/landmarks'
import { readGraph } from '../lib/graphs'
import { mergeRectsToMask } from '../lib/segment'
import { sceneStore, settingsStore } from '../lib/storage'
import type { MappingOrigin, Mask, RoomObject, SceneGraph, StageUpdate } from '../lib/types'

type SuspectHold = {
  name: string
  hash: string | null
  graph: SceneGraph | null
  kind: 'graph' | 'image' | 'other'
}

export function AdvancedCheck() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [discovery] = useState(() => params.get('discover') ? takeDiscoveryHandoff() : null)
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
  // Suspect-photo mapping. The photo is shown only with Blind Mode off plus
  // an explicit acknowledgment, and only after a person mask is confirmed.
  const [suspectFile, setSuspectFile] = useState<File | null>(null)
  const [viewAck, setViewAck] = useState(false)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [photoMask, setPhotoMask] = useState<Mask>({ x: 0.34, y: 0.1, w: 0.32, h: 0.72 })
  const [photoMaskConfirmed, setPhotoMaskConfirmed] = useState(false)
  const [suggested, setSuggested] = useState<SegmentRect[] | null>(null)
  const [photoGraph, setPhotoGraph] = useState<SceneGraph | null>(null)
  const [photoOrigin, setPhotoOrigin] = useState<MappingOrigin>('manual')
  const [photoModel, setPhotoModel] = useState<string | null>(null)
  const [photoNote, setPhotoNote] = useState('')
  const photoFrameRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
  }, [photoUrl])

  useEffect(() => {
    if (blind) {
      setViewAck(false)
      if (photoUrl) URL.revokeObjectURL(photoUrl)
      setPhotoUrl(null)
    }
  }, [blind, photoUrl])

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
        resetPhotoMapping(null)
        return
      } catch {
        setError('That file is not a scene graph.')
        return
      }
    }
    if (file.type.startsWith('image/')) {
      setSuspect({ name: file.name, hash, graph: null, kind: 'image' })
      resetPhotoMapping(file)
      return
    }
    setSuspect({ name: file.name, hash, graph: null, kind: 'other' })
    resetPhotoMapping(null)
    setError('Use a scene graph JSON file. Other files stay sealed and cannot be compared.')
  }

  function resetPhotoMapping(file: File | null) {
    if (photoUrl) URL.revokeObjectURL(photoUrl)
    setSuspectFile(file)
    setViewAck(false)
    setPhotoUrl(null)
    setPhotoMaskConfirmed(false)
    setSuggested(null)
    setPhotoGraph(null)
    setPhotoOrigin('manual')
    setPhotoModel(null)
    setPhotoNote('')
  }

  function acknowledgeViewing(next: boolean) {
    setViewAck(next)
    if (next && suspectFile && !blind) {
      if (photoUrl) URL.revokeObjectURL(photoUrl)
      setPhotoUrl(URL.createObjectURL(suspectFile))
    } else if (photoUrl) {
      URL.revokeObjectURL(photoUrl)
      setPhotoUrl(null)
    }
  }

  function takeSuggested(rects: SegmentRect[]) {
    setSuggested(rects)
  }

  function useSuggested() {
    if (!suggested) return
    const merged = mergeRectsToMask(suggested)
    if (!merged) {
      setError('The suggestion could not be used. Draw the mask yourself.')
      return
    }
    setPhotoMask(clampMask(merged))
    setPhotoMaskConfirmed(false)
    setSuggested(null)
  }

  function takePhotoGraph(data: unknown, modelName: string) {
    const parsed = readGraph(data)
    if (!parsed.ok) {
      setError(`The AI output was rejected: ${parsed.error} Nothing was saved.`)
      return
    }
    setPhotoGraph(parsed.graph)
    setPhotoOrigin('ai-assist')
    setPhotoModel(modelName)
    setPhotoNote(`AI-mapped ${parsed.graph.room_objects.length} background points. Review the result before comparing.`)
    setError('')
  }

  function takeProposal(obj: RoomObject) {
    setPhotoGraph((current) => ({
      room_objects: [...(current?.room_objects ?? []).filter((item) => item.name !== obj.name), obj],
    }))
    setPhotoOrigin('manual')
    setPhotoModel(null)
    setPhotoNote('')
  }

  function dragPhotoMask(event: React.PointerEvent, mode: 'move' | 'resize') {
    const frame = photoFrameRef.current
    if (!frame) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = frame.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY, mask: { ...photoMask } }
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / bounds.width
      const dy = (ev.clientY - start.y) / bounds.height
      const next = mode === 'move'
        ? { ...start.mask, x: start.mask.x + dx, y: start.mask.y + dy }
        : { ...start.mask, w: start.mask.w + dx, h: start.mask.h + dy }
      setPhotoMask(clampMask(next))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
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

  const mappedSuspect = suspect?.graph ?? photoGraph
  const mappedOrigin = suspect?.graph ? undefined : photoOrigin
  const mappedModel = suspect?.graph ? null : photoModel

  async function run() {
    setRunning(true)
    setError('')
    setStages([])
    const outcome = await runCheck(
      {
        source: activeSource,
        suspect: mappedSuspect,
        sourceLabel,
        suspectLabel: discovery ? `TinEye candidate: ${discovery.candidate.domain} (local file: ${suspect?.name ?? 'none'}; source association supplied by user)` : suspect?.name ?? 'Suspect',
        sourceHash: selected?.fileHash ?? null,
        suspectHash: suspect?.hash ?? null,
        sourceMask: selected?.mask ?? null,
        maskApplied: selected?.maskConfirmed ?? false,
        blind,
        sample: false,
        sourceOrigin: sourceGraph ? undefined : (selected?.origin ?? 'manual'),
        suspectOrigin: mappedSuspect ? mappedOrigin : undefined,
        sourceModel: sourceGraph ? null : (selected?.model ?? null),
        suspectModel: mappedModel,
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
          : `Local Python engine returned ΓÇ£${checked.result.verdict}ΓÇ¥. The on-device verdict is the one shown.`
        : checked.error
    }
    if (discovery) outcome.record.discovery = {
      provider: 'TinEye', domain: discovery.candidate.domain,
      sourceLinks: discovery.candidate.links.map(link => safeLink(link.page)).filter((link): link is string => !!link),
      providerRelevance: discovery.candidate.provider_score,
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
          {params.get('discover') && <section className="panel discover-candidate">
            <h2>Verify discovered candidate</h2>
            {discovery ? <><p className="muted">Selected from TinEye: {discovery.candidate.domain}. Provider relevance: {discovery.candidate.provider_score ?? 'not supplied'}; geometry remains unverified.</p>
              {discovery.candidate.links.map((link, i) => safeLink(link.page) && <p key={i}><a href={safeLink(link.page)} target="_blank" rel="noreferrer">Candidate source {i + 1}</a></p>)}</> : <p className="note">Candidate metadata is no longer available. Return to Discover to select it again.</p>}
            <p className="note">Add an authorized local copy of this candidate below. Stillpoint cannot confirm that a local file came from the linked source. Blind Mode and all existing viewing, masking, and model consent controls apply. Use the original feature names when mapping corresponding background features, then compare viewpoints and open Proof from Results.</p>
          </section>}
          <section className={blind ? 'seal seal-on' : 'seal'} aria-live="polite">
            <p className="privacy">
              <i />
              {blind ? 'Blind Mode is on.' : 'Blind Mode is off.'}
            </p>
            <h2 style={{ marginTop: 12 }}>{blind ? "You won't be shown the suspicious image." : 'A photo is shown only for mapping, and only after you acknowledge viewing.'}</h2>
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
            <span className="muted">Scene graph JSON can be compared. An image stays sealed until you map it below.</span>
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
          <Button onClick={() => void run()} disabled={running || !activeSource || !mappedSuspect}>
            Compare viewpoints
          </Button>
          {suspect?.kind === 'image' && !suspect.graph && (
            <SuspectPhotoMapping
              blind={blind}
              viewAck={viewAck}
              onAck={acknowledgeViewing}
              photoUrl={photoUrl}
              file={suspectFile}
              hash={suspect?.hash ?? null}
              mask={photoMask}
              maskConfirmed={photoMaskConfirmed}
              onMaskConfirm={setPhotoMaskConfirmed}
              suggested={suggested}
              onSuggested={takeSuggested}
              onUseSuggested={useSuggested}
              onDismissSuggested={() => setSuggested(null)}
              frameRef={photoFrameRef}
              onDragMask={dragPhotoMask}
              photoGraph={photoGraph}
              onPhotoGraph={takePhotoGraph}
              onProposal={takeProposal}
              photoNote={photoNote}
            />
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
          <p className="note">Scene graphs stay on this device. AI mapping sends a redacted photo through the local backend only with your explicit consent per photo.</p>
          <p className="footer-note">Computed on this device.</p>
        </aside>
      </div>
    </div>
  )
}

type MappingProps = {
  blind: boolean
  viewAck: boolean
  onAck: (next: boolean) => void
  photoUrl: string | null
  file: File | null
  hash: string | null
  mask: Mask
  maskConfirmed: boolean
  onMaskConfirm: (next: boolean) => void
  suggested: SegmentRect[] | null
  onSuggested: (rects: SegmentRect[]) => void
  onUseSuggested: () => void
  onDismissSuggested: () => void
  frameRef: React.RefObject<HTMLDivElement | null>
  onDragMask: (event: React.PointerEvent, mode: 'move' | 'resize') => void
  photoGraph: SceneGraph | null
  onPhotoGraph: (data: unknown, model: string) => void
  onProposal: (obj: RoomObject) => void
  photoNote: string
}

function SuspectPhotoMapping(props: MappingProps) {
  if (props.blind) {
    return (
      <p className="note">
        Blind Mode hides this photo. Turn Blind Mode off and acknowledge viewing to map it here, or ask your
        contact for a scene graph file instead.
      </p>
    )
  }
  if (!props.viewAck) {
    return (
      <label className="checkline">
        <input type="checkbox" checked={props.viewAck} onChange={(event) => props.onAck(event.target.checked)} />
        <span>I understand I will see the suspicious photo, and that viewing it is my choice.</span>
      </label>
    )
  }
  return (
    <div className="stack">
      <label className="checkline">
        <input type="checkbox" checked={props.viewAck} onChange={(event) => props.onAck(event.target.checked)} />
        <span>Viewing acknowledged. Uncheck to seal the photo again.</span>
      </label>
      {props.photoUrl && (
        <>
          <SegmentAssist file={props.file} onRects={props.onSuggested} consentScope={consentScope(props.hash, 'segment', null)} />
          {props.suggested && props.suggested.length > 0 && (
            <div className="actions">
              <Button variant="secondary" onClick={props.onUseSuggested}>Use suggested mask</Button>
              <Button variant="ghost" onClick={props.onDismissSuggested}>Dismiss suggestion</Button>
            </div>
          )}
          <div className="mask-frame" ref={props.frameRef}>
            <img src={props.photoUrl} alt="Suspicious photograph. Cover any person with the opaque rectangle." draggable={false} />
            <div
              className="mask-rect"
              data-mask="true"
              style={{ left: `${props.mask.x * 100}%`, top: `${props.mask.y * 100}%`, width: `${props.mask.w * 100}%`, height: `${props.mask.h * 100}%` }}
              onPointerDown={(event) => props.onDragMask(event, 'move')}
            >
              <button className="mask-handle" type="button" aria-label="Resize mask" onPointerDown={(event) => props.onDragMask(event, 'resize')} />
            </div>
            {(props.suggested ?? []).map((rect, index) => (
              <span
                key={`suggest-${index}`}
                aria-hidden="true"
                style={{
                  position: 'absolute',
                  left: `${rect.x / 10}%`,
                  top: `${rect.y / 10}%`,
                  width: `${rect.width / 10}%`,
                  height: `${rect.height / 10}%`,
                  border: '2px dashed #E8B4B8',
                  borderRadius: 4,
                  pointerEvents: 'none',
                }}
              />
            ))}
          </div>
          <p className="muted">Drag the black rectangle until any person is inside it. Mapping stays blocked until the mask is confirmed.</p>
          <label className="checkline">
            <input type="checkbox" checked={props.maskConfirmed} onChange={(event) => props.onMaskConfirm(event.target.checked)} />
            <span>Any person is inside the opaque rectangle.</span>
          </label>
          <AIAssist
            file={props.file}
            mask={props.mask}
            ready={props.maskConfirmed}
            blockedReason={props.maskConfirmed ? null : 'Confirm the mask above before AI mapping.'}
            ctaLabel="Extract suspect background with AI"
            onGraph={props.onPhotoGraph}
            consentScope={consentScope(props.hash, 'analyze', props.mask)}
            maxPoints={LANDMARK_DEFAULT_LIMIT}
          />
          <ProposalAssist
            file={props.file}
            mask={props.mask}
            maskConfirmed={props.maskConfirmed}
            takenNames={new Set((props.photoGraph?.room_objects ?? []).map((item) => item.name))}
            onAdd={props.onProposal}
          />
          {props.photoNote && <p role="status">{props.photoNote}</p>}
          {props.photoGraph && (
            <p className="muted">{props.photoGraph.room_objects.length} suspect background point(s) mapped. Compare when ready.</p>
          )}
        </>
      )}
    </div>
  )
}

function clampMask(mask: Mask): Mask {
  const w = Math.min(0.9, Math.max(0.12, mask.w))
  const h = Math.min(0.9, Math.max(0.12, mask.h))
  return {
    w,
    h,
    x: Math.min(1 - w, Math.max(0, mask.x)),
    y: Math.min(1 - h, Math.max(0, mask.y)),
  }
}
