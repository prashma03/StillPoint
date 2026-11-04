import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AIAssist } from '../components/AIAssist'
import { ProposalAssist } from '../components/ProposalAssist'
import { SegmentAssist } from '../components/SegmentAssist'
import { useCaseRecord } from '../components/case'
import { Button, LeaveDialog, PageHeader, useLeaveGuard, usePageTitle } from '../components/ui'
import type { SegmentRect } from '../lib/ai'
import { runCheck } from '../lib/check'
import {
  checkDraftHasWork,
  clearCheckDraft,
  draftMemory,
  loadCheckDraft,
  needsUnloadWarning,
  saveCheckDraft,
  type CheckDraft,
} from '../lib/draft'
import { photoVault, vaultAvailable } from '../lib/images'
import { verifyWithPython } from '../lib/engine'
import { sha256 } from '../lib/hash'
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
  // A saved draft waits for an explicit choice: resume it or start new.
  // Viewing acknowledgments and consents are never restored.
  const [pendingResume, setPendingResume] = useState<CheckDraft | null>(() => {
    const draft = loadCheckDraft(draftMemory())
    return draft && checkDraftHasWork(draft) ? draft : null
  })
  const [photoVaultRef, setPhotoVaultRef] = useState<CheckDraft['photoVault']>(null)
  const [persistOk, setPersistOk] = useState(true)
  const [notice, setNotice] = useState('')
  // Set before programmatic navigation so comparing never trips the leave guard.
  const leavingRef = useRef(false)

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

  function currentHasWork(): boolean {
    return (
      suspect !== null ||
      sourceGraph !== null ||
      (photoGraph !== null && photoGraph.room_objects.length > 0) ||
      photoMaskConfirmed ||
      suggested !== null
    )
  }

  function snapshot(): CheckDraft {
    return {
      version: 1,
      suspectName: suspect?.name ?? null,
      suspectHash: suspect?.hash ?? null,
      suspectKind: suspect?.kind ?? null,
      suspectGraph: suspect?.graph ?? null,
      sourceId,
      sourceName,
      sourceGraph,
      photoMask,
      photoMaskConfirmed,
      suggested,
      photoGraph,
      photoOrigin,
      photoModel,
      photoNote,
      photoVault: photoVaultRef,
      savedAt: new Date().toISOString(),
    }
  }

  // Autosave descriptive progress. Pixels are refused by the store; the vault
  // holds a photo only with explicit opt-in. A pending resume choice leaves
  // the stored draft untouched.
  useEffect(() => {
    if (pendingResume && !currentHasWork()) return
    try {
      saveCheckDraft(draftMemory(), snapshot())
      setPersistOk(true)
    } catch {
      setPersistOk(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingResume, suspect, sourceId, sourceName, sourceGraph, photoMask, photoMaskConfirmed, suggested, photoGraph, photoOrigin, photoModel, photoNote, photoVaultRef])

  // Warn before the tab closes only when something would actually be lost.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (
        needsUnloadWarning({
          saved: leavingRef.current,
          photoInMemory: suspectFile !== null,
          photoPersisted: photoVaultRef !== null,
          persistOk,
          hasWork: currentHasWork(),
        })
      ) {
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspectFile, photoVaultRef, persistOk, suspect, sourceGraph, photoGraph, photoMaskConfirmed, suggested])

  const leave = useLeaveGuard(currentHasWork() && !leavingRef.current)

  function dropVaultPhoto(ref: CheckDraft['photoVault']) {
    if (ref) void photoVault().deletePhoto(ref.id).catch(() => {})
  }

  /** Resume applies descriptive state only. Viewing must be re-acknowledged. */
  async function resumeDraft() {
    const draft = pendingResume
    if (!draft) return
    if (draft.suspectName) {
      setSuspect({ name: draft.suspectName, hash: draft.suspectHash, graph: draft.suspectGraph, kind: draft.suspectKind ?? 'other' })
    }
    setSourceId(draft.sourceId)
    setSourceName(draft.sourceName)
    setSourceGraph(draft.sourceGraph)
    setPhotoMask(draft.photoMask)
    setPhotoMaskConfirmed(draft.photoMaskConfirmed)
    setSuggested(draft.suggested)
    setPhotoGraph(draft.photoGraph)
    setPhotoOrigin(draft.photoOrigin)
    setPhotoModel(draft.photoModel)
    setPhotoNote(draft.photoNote)
    setPhotoVaultRef(draft.photoVault)
    setPendingResume(null)
    setError('')
    if (draft.photoVault) {
      try {
        const stored = await photoVault().loadPhoto(draft.photoVault.id)
        if (stored && stored.blob.size > 0) {
          setSuspectFile(new File([stored.blob], stored.name, { type: stored.type }))
          setNotice('Draft resumed. The photo was restored from this device; viewing still needs your acknowledgment.')
          return
        }
      } catch {
        // Vault unreadable: fall through to hash-verified re-selection.
      }
    }
    setNotice(
      draft.suspectKind === 'image'
        ? 'Draft resumed. Re-select the suspect photo to continue — it is verified by hash.'
        : 'Draft resumed.',
    )
  }

  function discardResume() {
    dropVaultPhoto(pendingResume?.photoVault ?? null)
    clearCheckDraft(draftMemory())
    setPendingResume(null)
    setNotice('')
  }

  async function togglePhotoVault(keep: boolean) {
    if (keep && suspectFile && suspect?.hash) {
      const ref = { id: `check:${suspect.hash}`, name: suspectFile.name, type: suspectFile.type }
      try {
        await photoVault().savePhoto(ref.id, suspectFile, ref.name, ref.type)
        setPhotoVaultRef(ref)
        setNotice('This photo will restore with the draft on this device.')
      } catch {
        setError('The photo could not be kept on this device.')
      }
      return
    }
    dropVaultPhoto(photoVaultRef)
    setPhotoVaultRef(null)
  }

  /** Re-attach the same suspect photo after a resume, verified by hash. */
  async function reattachSuspect(file: File) {
    const hash = await sha256(file)
    if (suspect?.kind === 'image' && hash !== null && hash === suspect.hash) {
      setSuspectFile(file)
      setNotice('Photo re-attached. Your mask and points were kept.')
      setError('')
      return
    }
    void takeSuspect(file)
  }

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
    if (suspect?.kind === 'image' && hash !== null && hash === suspect.hash && !suspectFile) {
      // Same sealed photo re-selected after a resume: keep the mapping work.
      setSuspectFile(file)
      setNotice('Photo re-attached. Your mask and points were kept.')
      return
    }
    // A different file starts fresh mapping and needs fresh photo permission.
    dropVaultPhoto(photoVaultRef)
    setPhotoVaultRef(null)
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
        suspectLabel: suspect?.name ?? 'Suspect',
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
          : `Local Python engine returned “${checked.result.verdict}”. The on-device verdict is the one shown.`
        : checked.error
    }
    setRecord(outcome.record)
    clearCheckDraft(draftMemory())
    dropVaultPhoto(photoVaultRef)
    leavingRef.current = true
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
      {pendingResume && !currentHasWork() && (
        <div className="panel" role="status">
          <h2>Resume your draft?</h2>
          <p className="muted">
            {pendingResume.suspectName ?? 'Untitled check'} · saved {new Date(pendingResume.savedAt).toLocaleString()}.{' '}
            {pendingResume.photoVault
              ? 'The photo was kept on this device and will restore.'
              : 'Any photo must be re-selected; it is verified by hash before anything continues.'}
          </p>
          <div className="actions">
            <Button onClick={() => void resumeDraft()}>Resume draft</Button>
            <Button variant="secondary" onClick={discardResume}>Start new</Button>
          </div>
        </div>
      )}
      {notice && !error && <p className="note" role="status">{notice}</p>}
      <div className="split">
        <div className="stack">
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
          {suspect?.kind === 'image' && !suspectFile && (
            <div className="panel" role="status">
              <h2>Re-select the suspect photo to continue</h2>
              <p className="muted">
                {suspect.name} left memory, but your cover and points were kept. Choose the same
                file{suspect.hash ? ` (hash ${suspect.hash.slice(0, 12)})` : ''} — anything else starts fresh mapping.
              </p>
              <label className="drop">
                <input
                  type="file"
                  accept="image/*"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void reattachSuspect(file)
                    event.currentTarget.value = ''
                  }}
                />
                <b>Re-select {suspect.name}</b>
                <span className="muted">Verified by content hash before anything is restored.</span>
              </label>
            </div>
          )}
          {suspect?.kind === 'image' && suspectFile && suspect.hash && (
            vaultAvailable() ? (
              <label className="checkline">
                <input
                  type="checkbox"
                  checked={photoVaultRef !== null}
                  onChange={(event) => void togglePhotoVault(event.target.checked)}
                />
                <span>Keep this photo on this device for this draft. Otherwise it stays in memory only and must be re-selected after closing the browser.</span>
              </label>
            ) : (
              <p className="note">This browser blocks local photo storage, so the photo stays in memory only.</p>
            )
          )}

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
      <LeaveDialog
        open={leave.blocked}
        title="Leave with unsaved work?"
        onSaveLeave={() => {
          try {
            saveCheckDraft(draftMemory(), snapshot())
          } catch {
            // Final flush failed; the last autosave still stands.
          }
          leave.proceed()
        }}
        onDiscard={() => {
          dropVaultPhoto(photoVaultRef)
          clearCheckDraft(draftMemory())
          leave.proceed()
        }}
        onCancel={leave.cancel}
      >
        <p className="muted">
          Your suspect file, cover, and points are auto-saved as a draft on this device
          {suspectFile && !photoVaultRef ? ', but the photo itself lives in memory only and will be lost' : ''}.
        </p>
      </LeaveDialog>
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
