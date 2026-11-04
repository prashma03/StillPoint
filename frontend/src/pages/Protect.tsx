import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AIAssist } from '../components/AIAssist'
import { ProposalAssist } from '../components/ProposalAssist'
import { SegmentAssist } from '../components/SegmentAssist'
import { Button, Dialog, LeaveDialog, PageHeader, useLeaveGuard, usePageTitle } from '../components/ui'
import type { SegmentRect } from '../lib/ai'
import { rgbaToGrayscale, snapToCorner } from '../lib/detect'
import {
  clearProtectDraft,
  draftHasWork,
  draftMemory,
  loadProtectDraft,
  needsUnloadWarning,
  saveProtectDraft,
  type ProtectDraft,
} from '../lib/draft'
import { STABLE_OBJECTS, readGraph } from '../lib/graphs'
import { sha256 } from '../lib/hash'
import {
  LANDMARK_DEFAULT_LIMIT,
  LANDMARK_MAX_LIMIT,
  LANDMARK_MIN_LIMIT,
  MIN_POINT_SEPARATION,
  assessLandmarks,
  centerInMaskWithMargin,
  clampLimit,
  clientToImageCoords,
  consentScope,
  isConfirmed,
  landmarkCenter,
  landmarkToPercent,
  mergeLandmarks,
  pointOriginOf,
  sanitizeAiPoints,
} from '../lib/landmarks'
import { canRedo, canUndo, emptyHistory, pushHistory, redoHistory, undoHistory, type GraphHistory } from '../lib/history'
import { photoVault, vaultAvailable } from '../lib/images'
import { decodeToPixels } from '../lib/redact'
import { mergeRectsToMask } from '../lib/segment'
import { sceneStore } from '../lib/storage'
import type { MappingOrigin, Mask, RoomObject, SceneGraph } from '../lib/types'

const emptyGraph: SceneGraph = { room_objects: [] }
const STAGE_NAMES = ['Photo', 'Person', 'Background', 'Review']
const DEFAULT_MASK: Mask = { x: 0.34, y: 0.1, w: 0.32, h: 0.72 }

export function Protect() {
  usePageTitle('Protect')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // A saved draft waits for an explicit choice: resume it or start new.
  // Nothing restores silently, and consents are never restored.
  const [pendingResume, setPendingResume] = useState<ProtectDraft | null>(() => {
    const draft = loadProtectDraft(draftMemory())
    return draft && draftHasWork(draft) ? draft : null
  })
  const step = Math.min(4, Math.max(1, Number(params.get('step') || 1)))
  const scenes = useMemo(() => sceneStore().list(), [])
  const [label, setLabel] = useState('Protected scene')
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileHash, setFileHash] = useState<string | null>(null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [graph, setGraph] = useState<SceneGraph>(emptyGraph)
  const [model, setModel] = useState<string | null>(null)
  const [aiNote, setAiNote] = useState('')
  const [imported, setImported] = useState(false)
  const [mask, setMask] = useState<Mask>({ ...DEFAULT_MASK })
  const [suggested, setSuggested] = useState<SegmentRect[] | null>(null)
  const [suggestModel, setSuggestModel] = useState<string | null>(null)
  const [maskConfirmed, setMaskConfirmed] = useState(false)
  const [personAck, setPersonAck] = useState(false)
  const [selectedName, setSelectedName] = useState<string>(STABLE_OBJECTS[0])
  const [landmarkLimit, setLandmarkLimit] = useState(LANDMARK_DEFAULT_LIMIT)
  const [photoVaultRef, setPhotoVaultRef] = useState<ProtectDraft['photoVault']>(null)
  const [persistOk, setPersistOk] = useState(true)
  // Original AI room objects from the latest analysis, kept apart from edits
  // so deleted suggestions restore without another model request.
  const [aiSnapshot, setAiSnapshot] = useState<RoomObject[] | null>(null)
  const [history, setHistory] = useState<GraphHistory>(emptyHistory)
  const [selectedPoint, setSelectedPoint] = useState<string | null>(null)
  const [confirmRerun, setConfirmRerun] = useState(false)
  const [rerunToken, setRerunToken] = useState(0)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [confirmSaveAnyway, setConfirmSaveAnyway] = useState(false)
  const [saved, setSaved] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const pixelsRef = useRef<{ hash: string; gray: Float32Array; width: number; height: number } | null>(null)
  // A drag ending on its own dot must not also select it.
  const suppressClickRef = useRef(false)
  // Latest committed graph for late-arriving AI results: merging against a
  // stale closure would drop edits made while the analysis was in flight.
  const graphRef = useRef(graph)
  graphRef.current = graph
  // Set before programmatic navigation so saving never trips the leave guard.
  const leavingRef = useRef(false)

  // The photo lives in memory unless explicitly kept for the draft. Without
  // it, the user re-selects the file and the content hash proves sameness.
  const photoMissing = !imported && fileName !== null && photoFile === null

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function snapshot(): ProtectDraft {
    return {
      version: 1,
      step,
      label,
      fileName,
      fileHash,
      imageWidth: imageSize?.w ?? null,
      imageHeight: imageSize?.h ?? null,
      imported,
      graph,
      origin: graph.room_objects.some((obj) => pointOriginOf(obj) === 'ai') ? 'ai-assist' : 'manual',
      model,
      aiNote,
      mask,
      maskConfirmed,
      personAck,
      suggested,
      suggestModel,
      selectedName,
      landmarkLimit,
      photoVault: photoVaultRef,
      aiSnapshot,
      historyPast: history.past,
      historyFuture: history.future,
      savedAt: new Date().toISOString(),
    }
  }

  /** Commit an edited graph as one undoable step. */
  function commit(next: SceneGraph) {
    setHistory((current) => pushHistory(current, graph))
    setGraph(next)
    setSelectedPoint((selected) => (selected && next.room_objects.some((obj) => obj.name === selected) ? selected : null))
  }

  function undo() {
    const result = undoHistory(history, graph)
    if (!result) return
    setHistory(result.history)
    setGraph(result.graph)
    setSelectedPoint((selected) =>
      selected && result.graph.room_objects.some((obj) => obj.name === selected) ? selected : null,
    )
    setError('')
    setNotice('Undid the last edit.')
  }

  function redo() {
    const result = redoHistory(history, graph)
    if (!result) return
    setHistory(result.history)
    setGraph(result.graph)
    setSelectedPoint((selected) =>
      selected && result.graph.room_objects.some((obj) => obj.name === selected) ? selected : null,
    )
    setError('')
    setNotice('Redid the edit.')
  }

  // Autosave descriptive progress every render it changes. Image pixels are
  // refused by the store; the vault holds a photo only with explicit opt-in.
  // While a resume choice is pending, the stored draft is left untouched.
  useEffect(() => {
    if (saved) return
    if (pendingResume && !currentHasWork()) return
    try {
      saveProtectDraft(draftMemory(), snapshot())
      setPersistOk(true)
    } catch {
      // Storage full or unavailable: the session continues in memory.
      setPersistOk(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, pendingResume, step, label, fileName, fileHash, imageSize, imported, graph, model, aiNote, aiSnapshot, history, mask, maskConfirmed, personAck, suggested, suggestModel, selectedName, landmarkLimit, photoVaultRef])

  // Warn before the tab closes only when something would actually be lost:
  // photo pixels without a vault copy, or progress whose autosave failed.
  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (
        needsUnloadWarning({
          saved,
          photoInMemory: photoFile !== null,
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
  }, [saved, photoFile, photoVaultRef, persistOk, fileName, graph, maskConfirmed, personAck, suggested])

  function go(next: number) {
    setError('')
    // Step changes only flip the visible stage. Nothing is re-fetched and no
    // paid call repeats: AI runs solely through its own consented buttons.
    setParams({ step: String(next) })
  }

  function currentHasWork(): boolean {
    return (
      fileName !== null ||
      graph.room_objects.length > 0 ||
      maskConfirmed ||
      personAck ||
      suggested !== null
    )
  }

  // Route changes with unsaved work open the leave dialog. Same-page step
  // flips never block, and neither does navigation after saving.
  const leave = useLeaveGuard(currentHasWork() && !saved && !leavingRef.current)

  function dropVaultPhoto(ref: ProtectDraft['photoVault']) {
    if (ref) void photoVault().deletePhoto(ref.id).catch(() => {})
  }

  /** Resume applies descriptive state only. Consents stay unchecked, and no AI call repeats. */
  async function resumeDraft() {
    const draft = pendingResume
    if (!draft) return
    setLabel(draft.label)
    setFileName(draft.fileName)
    setFileHash(draft.fileHash)
    setImageSize(draft.imageWidth && draft.imageHeight ? { w: draft.imageWidth, h: draft.imageHeight } : null)
    setImported(draft.imported)
    setGraph(draft.graph)
    setModel(draft.model)
    setAiNote(draft.aiNote)
    setMask(draft.mask)
    setMaskConfirmed(draft.maskConfirmed)
    setPersonAck(draft.personAck)
    setSuggested(draft.suggested)
    setSuggestModel(draft.suggestModel)
    setSelectedName(draft.selectedName)
    setLandmarkLimit(draft.landmarkLimit)
    setPhotoVaultRef(draft.photoVault)
    setAiSnapshot(draft.aiSnapshot)
    setHistory({ past: draft.historyPast, future: draft.historyFuture })
    setSelectedPoint(null)
    setPendingResume(null)
    setError('')
    setParams({ step: String(draft.step) })
    if (draft.photoVault) {
      try {
        const stored = await photoVault().loadPhoto(draft.photoVault.id)
        if (stored && stored.blob.size > 0) {
          const file = new File([stored.blob], stored.name, { type: stored.type })
          if (preview) URL.revokeObjectURL(preview)
          setPreview(URL.createObjectURL(file))
          setPhotoFile(file)
          setNotice('Draft resumed. The photo was restored from this device.')
          return
        }
      } catch {
        // Vault unreadable: fall through to hash-verified re-selection.
      }
    }
    setNotice(
      draft.fileName && !draft.imported
        ? 'Draft resumed. Re-select the photo to continue — it is verified by hash.'
        : 'Draft resumed.',
    )
  }

  function discardResume() {
    dropVaultPhoto(pendingResume?.photoVault ?? null)
    clearProtectDraft(draftMemory())
    setPendingResume(null)
    setNotice('')
  }

  async function togglePhotoVault(keep: boolean) {
    if (keep && photoFile && fileHash) {
      const ref = { id: `protect:${fileHash}`, name: photoFile.name, type: photoFile.type }
      try {
        await photoVault().savePhoto(ref.id, photoFile, ref.name, ref.type)
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

  async function takeFile(file: File) {
    setError('')
    if (file.size > 20 * 1024 * 1024) {
      setError('That file is larger than 20 MB.')
      return
    }
    const isJson = file.type.includes('json') || file.name.toLowerCase().endsWith('.json')
    if (!isJson && !file.type.startsWith('image/')) {
      setError('Choose a photograph or a scene graph.')
      return
    }
    const hash = await sha256(file)
    if (hash === fileHash) {
      // Same content: re-attach the photo (after a reload) or keep going.
      if (!isJson) {
        if (preview) URL.revokeObjectURL(preview)
        setPreview(URL.createObjectURL(file))
        setPhotoFile(file)
        setNotice('Photo re-attached. Your mask and points were kept.')
      } else {
        setNotice('That file is already loaded.')
      }
      setPendingFile(null)
      return
    }
    if (currentHasWork()) {
      // A different file would replace the current mask and points: ask first.
      setPendingFile(file)
      return
    }
    void doTakeFile(file, hash)
  }

  async function doTakeFile(file: File, hash: string | null) {
    const isJson = file.type.includes('json') || file.name.toLowerCase().endsWith('.json')
    if (isJson) {
      try {
        const parsed = readGraph(JSON.parse(await file.text()))
        if (!parsed.ok) {
          setError(parsed.error)
          return
        }
        if (preview) URL.revokeObjectURL(preview)
        setPreview(null)
        setPhotoFile(null)
        pixelsRef.current = null
        dropVaultPhoto(photoVaultRef)
        setPhotoVaultRef(null)
        setImported(true)
        setGraph(withConfirmed(parsed.graph))
        setModel(null)
        setAiNote('')
        setAiSnapshot(null)
        setHistory(emptyHistory())
        setSelectedPoint(null)
        setFileName(file.name)
        setFileHash(hash)
        setImageSize(null)
        setMaskConfirmed(false)
        setNotice('Scene graph read. Review the imported points, then continue.')
        setError('')
      } catch {
        setError('That file is not a scene graph.')
      }
      return
    }
    if (preview) URL.revokeObjectURL(preview)
    setPreview(URL.createObjectURL(file))
    setPhotoFile(file)
    pixelsRef.current = null
    // A new photo needs fresh photo-storage permission: never inherit it.
    dropVaultPhoto(photoVaultRef)
    setPhotoVaultRef(null)
    setImageSize(await imageDims(file))
    setSuggested(null)
    setSuggestModel(null)
    setImported(false)
    setGraph(emptyGraph)
    setModel(null)
    setAiNote('')
    setAiSnapshot(null)
    setHistory(emptyHistory())
    setSelectedPoint(null)
    setFileName(file.name)
    setFileHash(hash)
    setMask({ ...DEFAULT_MASK })
    setMaskConfirmed(false)
    setPersonAck(false)
    setNotice('')
    setError('')
  }

  function takeAIGraph(data: unknown, modelName: string) {
    const parsed = readGraph(data)
    if (!parsed.ok) {
      setError(`The AI output was rejected: ${parsed.error} Nothing was saved.`)
      return
    }
    // Keep the original response apart from edits: restoring reuses it with
    // no new model request.
    setAiSnapshot(structuredClone(parsed.graph.room_objects))
    // Merge, never overwrite: existing work always survives AI mapping.
    const base = graphRef.current
    const { kept, dropped } = sanitizeAiPoints(parsed.graph.room_objects, {
      mask: preview ? mask : null,
      limit: landmarkLimit,
      existing: base.room_objects,
    })
    const merged = mergeLandmarks(base, kept)
    setHistory((current) => pushHistory(current, base))
    setGraph(merged.graph)
    if (merged.added > 0) setModel(modelName)
    const skipped =
      dropped.outOfBounds + dropped.inMask + dropped.duplicate + dropped.personNamed + dropped.overLimit
    const parts = [`AI suggested ${merged.added} background point(s). Review each amber point below — drag to correct, then confirm.`]
    if (merged.skipped > 0) parts.push(`${merged.skipped} kept your existing version.`)
    if (dropped.inMask > 0) parts.push(`${dropped.inMask} inside the cover were rejected.`)
    if (dropped.duplicate > 0) parts.push(`${dropped.duplicate} duplicate(s) were rejected.`)
    if (dropped.outOfBounds > 0) parts.push(`${dropped.outOfBounds} out-of-bounds point(s) were rejected.`)
    if (dropped.personNamed > 0) parts.push(`${dropped.personNamed} person-named object(s) were excluded.`)
    if (dropped.overLimit > 0) parts.push(`${dropped.overLimit} beyond the limit of ${landmarkLimit} were held back.`)
    if (merged.added === 0 && skipped === 0) parts.push('Nothing new arrived.')
    setAiNote(parts.join(' '))
    setError('')
  }

  /**
   * Restore deleted AI suggestions from the latest analysis on this device.
   * Pure local merge with the same duplicate guards as intake: no model
   * request, and already-placed suggestions are skipped, never duplicated.
   */
  function restoreAiSuggestions() {
    if (!aiSnapshot) return
    const { kept } = sanitizeAiPoints(aiSnapshot, {
      mask: preview ? mask : null,
      limit: landmarkLimit,
      existing: graph.room_objects,
    })
    const merged = mergeLandmarks(graph, kept)
    if (merged.added === 0) {
      setNotice('Everything from the last analysis is already placed — nothing was added, and no new request was made.')
      return
    }
    commit(merged.graph)
    setError('')
    setNotice(`Restored ${merged.added} suggestion(s) from the last analysis. No new request was made.`)
  }

  function tooClose(name: string | null, x: number, y: number): RoomObject | null {
    return (
      graph.room_objects.find((obj) => {
        if (name !== null && obj.name === name) return false
        const center = landmarkCenter(obj)
        return Math.hypot(center.x - x, center.y - y) < MIN_POINT_SEPARATION
      }) ?? null
    )
  }

  function place(event: React.MouseEvent<HTMLImageElement>) {
    const coords = clientToImageCoords(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    const x = Math.round(coords.x)
    const y = Math.round(coords.y)
    if (graph.room_objects.length >= landmarkLimit) {
      setError(`The limit of ${landmarkLimit} points is reached. Remove one or raise the limit.`)
      return
    }
    if (graph.room_objects.some((item) => item.name === selectedName)) {
      setError(`“${selectedName}” is already placed. Drag it to move, relabel it, or remove it first.`)
      return
    }
    const point: RoomObject = {
      name: selectedName,
      x,
      y,
      width: 0,
      height: 0,
      pointOrigin: 'manual',
      confirmed: true,
    }
    if (centerInMaskWithMargin(point, mask)) {
      setError('That point is inside the person cover or too close to its edge and will not be kept.')
      return
    }
    const neighbor = tooClose(null, x, y)
    if (neighbor) {
      setError(`That point is almost on top of “${neighbor.name}” and will not be kept.`)
      return
    }
    setError('')
    setNotice('')
    commit({ ...graph, room_objects: [...graph.room_objects, point] })
  }

  function takeSuggested(rects: SegmentRect[], modelName: string) {
    setSuggested(rects)
    setSuggestModel(modelName)
    setError('')
  }

  function useSuggested() {
    if (!suggested) return
    const merged = mergeRectsToMask(suggested)
    if (!merged) {
      setError('The suggestion could not be used. Draw the mask yourself.')
      return
    }
    setMask(clampMask(merged))
    setMaskConfirmed(false)
    setSuggested(null)
    setNotice('Suggested cover applied. Adjust it by hand, then confirm.')
    setError('')
  }

  function takeProposal(obj: RoomObject) {
    if (graph.room_objects.length >= landmarkLimit) {
      setError(`The limit of ${landmarkLimit} points is reached. Remove one or raise the limit.`)
      return
    }
    if (graph.room_objects.some((item) => item.name === obj.name)) {
      setError(`“${obj.name}” is already placed. Relabel the region or remove the existing point first.`)
      return
    }
    const labeled: RoomObject = { ...obj, pointOrigin: 'local', confirmed: true }
    // The mask may have moved since proposals were computed.
    if (centerInMaskWithMargin(labeled, mask)) {
      setError('That region is now inside the cover or too close to its edge and will not be kept.')
      return
    }
    const center = landmarkCenter(labeled)
    const neighbor = tooClose(null, center.x, center.y)
    if (neighbor) {
      setError(`That region is almost on top of “${neighbor.name}” and will not be kept.`)
      return
    }
    setError('')
    commit({ ...graph, room_objects: [...graph.room_objects, labeled] })
  }

  function dragMask(event: React.PointerEvent, mode: 'move' | 'resize') {
    const frame = frameRef.current
    if (!frame) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = frame.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY, mask: { ...mask } }
    let moved = false
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / bounds.width
      const dy = (ev.clientY - start.y) / bounds.height
      if (dx !== 0 || dy !== 0) moved = true
      const next = mode === 'move'
        ? { ...start.mask, x: start.mask.x + dx, y: start.mask.y + dy }
        : { ...start.mask, w: start.mask.w + dx, h: start.mask.h + dy }
      setMask(clampMask(next))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      // A moved cover is a new cover: the old confirmation no longer applies.
      if (moved) {
        setMaskConfirmed(false)
        setNotice('Cover moved — confirm the new cover before continuing.')
      }
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function dragPoint(event: React.PointerEvent, name: string) {
    const frame = frameRef.current
    if (!frame) return
    event.preventDefault()
    event.stopPropagation()
    const startObj = graph.room_objects.find((obj) => obj.name === name)
    if (!startObj) return
    const beforeDrag = graph
    let last = landmarkCenter(startObj)
    let moved = false
    const move = (ev: PointerEvent) => {
      const coords = clientToImageCoords(ev.clientX, ev.clientY, frame.getBoundingClientRect())
      last = { x: Math.round(coords.x), y: Math.round(coords.y) }
      moved = true
      setGraph((current) => ({
        ...current,
        room_objects: current.room_objects.map((obj) =>
          obj.name === name
            ? { ...obj, x: Math.round(last.x - obj.width / 2), y: Math.round(last.y - obj.height / 2) }
            : obj,
        ),
      }))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      suppressClickRef.current = moved
      if (!moved) return
      const candidate: RoomObject = {
        ...startObj,
        x: Math.round(last.x - startObj.width / 2),
        y: Math.round(last.y - startObj.height / 2),
      }
      if (centerInMaskWithMargin(candidate, mask)) {
        setGraph((current) => ({
          ...current,
          room_objects: current.room_objects.map((obj) => (obj.name === name ? startObj : obj)),
        }))
        setError(`“${name}” cannot sit inside the cover or near its edge. It was moved back.`)
        return
      }
      const neighbor = tooClose(name, last.x, last.y)
      if (neighbor) {
        setGraph((current) => ({
          ...current,
          room_objects: current.room_objects.map((obj) => (obj.name === name ? startObj : obj)),
        }))
        setError(`“${name}” would land almost on top of “${neighbor.name}”. It was moved back.`)
        return
      }
      // A corrected point counts as reviewed. One history entry per drag.
      setHistory((current) => pushHistory(current, beforeDrag))
      setGraph((current) => ({
        ...current,
        room_objects: current.room_objects.map((obj) => (obj.name === name ? { ...candidate, confirmed: true } : obj)),
      }))
      setError('')
      setNotice(`Moved “${name}” and marked it reviewed.`)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  function nudgePoint(event: React.KeyboardEvent, name: string) {
    const deltas: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const delta = deltas[event.key]
    if (!delta) return
    event.preventDefault()
    event.stopPropagation()
    const jump = event.shiftKey ? 10 : 2
    const obj = graph.room_objects.find((item) => item.name === name)
    if (!obj) return
    const center = landmarkCenter(obj)
    const next: RoomObject = {
      ...obj,
      x: Math.min(1000 - obj.width, Math.max(0, Math.round(center.x + delta[0] * jump - obj.width / 2))),
      y: Math.min(1000 - obj.height, Math.max(0, Math.round(center.y + delta[1] * jump - obj.height / 2))),
      confirmed: true,
    }
    if (centerInMaskWithMargin(next, preview ? mask : null)) {
      setError(`“${name}” cannot move into the cover.`)
      return
    }
    const nextCenter = landmarkCenter(next)
    const neighbor = tooClose(name, nextCenter.x, nextCenter.y)
    if (neighbor) {
      setError(`“${name}” would land almost on top of “${neighbor.name}”.`)
      return
    }
    setError('')
    commit({ ...graph, room_objects: graph.room_objects.map((item) => (item.name === name ? next : item)) })
  }

  function renamePoint(name: string, next: string) {
    const cleaned = next.trim().replace(/\s+/g, ' ')
    if (!cleaned || cleaned === name) return
    if (cleaned.length > 80) {
      setError('That label is too long.')
      return
    }
    if (['person', 'face', 'body', 'hair', 'skin', 'clothes', 'head'].includes(cleaned.toLowerCase())) {
      setError('People are never reference points. Pick a background label.')
      return
    }
    if (graph.room_objects.some((item) => item.name.toLowerCase() === cleaned.toLowerCase())) {
      setError(`“${cleaned}” is already used. Pick a different label.`)
      return
    }
    setError('')
    setNotice(`Relabeled “${name}” as “${cleaned}” and marked it reviewed.`)
    commit({
      ...graph,
      room_objects: graph.room_objects.map((item) =>
        item.name === name ? { ...item, name: cleaned, confirmed: true } : item,
      ),
    })
  }

  function confirmPoint(name: string) {
    setGraph((current) => ({
      ...current,
      room_objects: current.room_objects.map((item) => (item.name === name ? { ...item, confirmed: true } : item)),
    }))
    setNotice(`Confirmed “${name}”.`)
  }

  function confirmAll() {
    setGraph((current) => ({
      ...current,
      room_objects: current.room_objects.map((item) => ({ ...item, confirmed: true })),
    }))
    setNotice('Confirmed every point.')
  }

  function removePoint(name: string) {
    commit({ ...graph, room_objects: graph.room_objects.filter((item) => item.name !== name) })
    setNotice(`Removed “${name}”. Undo brings it back.`)
  }

  async function pixelCache(): Promise<{ gray: Float32Array; width: number; height: number } | null> {
    if (!photoFile || !fileHash) return null
    const cached = pixelsRef.current
    if (cached && cached.hash === fileHash) return cached
    const decoded = await decodeToPixels(photoFile)
    const entry = {
      hash: fileHash,
      gray: rgbaToGrayscale(decoded.data, decoded.width, decoded.height),
      width: decoded.width,
      height: decoded.height,
    }
    pixelsRef.current = entry
    return entry
  }

  async function snapPoint(name: string) {
    const obj = graph.room_objects.find((item) => item.name === name)
    if (!obj || !photoFile) return
    setError('')
    setNotice('')
    try {
      const pixels = await pixelCache()
      if (!pixels) {
        setError('The photo is not available for corner snapping.')
        return
      }
      const center = landmarkCenter(obj)
      const snapped = snapToCorner(pixels.gray, pixels.width, pixels.height, center.x, center.y)
      if (!snapped) {
        setNotice(`No stronger corner near “${name}”; kept as placed.`)
        return
      }
      const next: RoomObject = {
        ...obj,
        x: Math.round(snapped.x - obj.width / 2),
        y: Math.round(snapped.y - obj.height / 2),
        confirmed: true,
      }
      if (centerInMaskWithMargin(next, mask)) {
        setNotice(`Snapping “${name}” would enter the cover; kept as placed.`)
        return
      }
      const neighbor = tooClose(name, snapped.x, snapped.y)
      if (neighbor) {
        setNotice(`Snapping “${name}” would collide with “${neighbor.name}”; kept as placed.`)
        return
      }
      setHistory((current) => pushHistory(current, graphRef.current))
      setGraph((current) => ({
        ...current,
        room_objects: current.room_objects.map((item) => (item.name === name ? next : item)),
      }))
      setNotice(`Snapped “${name}” ${Math.round(snapped.moved)} units onto the nearest measured corner and marked it reviewed.`)
    } catch {
      setError('Corner snapping failed. The point was kept as placed.')
    }
  }

  async function snapAll() {
    const pending = graph.room_objects.filter((obj) => !isConfirmed(obj))
    if (pending.length === 0 || !photoFile) return
    setError('')
    try {
      const pixels = await pixelCache()
      if (!pixels) {
        setError('The photo is not available for corner snapping.')
        return
      }
      let moved = 0
      let kept = 0
      let next = [...graph.room_objects]
      for (const obj of pending) {
        const center = landmarkCenter(obj)
        const snapped = snapToCorner(pixels.gray, pixels.width, pixels.height, center.x, center.y)
        if (!snapped) {
          kept += 1
          continue
        }
        const candidate: RoomObject = {
          ...obj,
          x: Math.round(snapped.x - obj.width / 2),
          y: Math.round(snapped.y - obj.height / 2),
          confirmed: true,
        }
        const blocked =
          centerInMaskWithMargin(candidate, mask) ||
          next.some(
            (other) =>
              other.name !== obj.name &&
              Math.hypot(landmarkCenter(other).x - snapped.x, landmarkCenter(other).y - snapped.y) <
                MIN_POINT_SEPARATION,
          )
        if (blocked) {
          kept += 1
          continue
        }
        next = next.map((item) => (item.name === obj.name ? candidate : item))
        moved += 1
      }
      if (moved > 0) {
        setHistory((current) => pushHistory(current, graphRef.current))
        const applied = new Map(next.map((item) => [item.name, item]))
        setGraph((current) => ({
          ...current,
          room_objects: current.room_objects.map((item) => applied.get(item.name) ?? item),
        }))
      }
      setNotice(
        moved === 0
          ? 'No stronger corners found nearby; every suggestion was kept as placed.'
          : `Snapped ${moved} point(s) onto measured corners.${kept > 0 ? ` ${kept} kept as placed.` : ''}`,
      )
    } catch {
      setError('Corner snapping failed. The points were kept as placed.')
    }
  }

  function restart() {
    if (preview) URL.revokeObjectURL(preview)
    pixelsRef.current = null
    dropVaultPhoto(photoVaultRef)
    setPhotoVaultRef(null)
    setPendingResume(null)
    setLabel('Protected scene')
    setFileName(null)
    setFileHash(null)
    setImageSize(null)
    setPreview(null)
    setPhotoFile(null)
    setGraph(emptyGraph)
    setModel(null)
    setAiNote('')
    setAiSnapshot(null)
    setHistory(emptyHistory())
    setSelectedPoint(null)
    setImported(false)
    setMask({ ...DEFAULT_MASK })
    setSuggested(null)
    setSuggestModel(null)
    setMaskConfirmed(false)
    setPersonAck(false)
    setSelectedName(STABLE_OBJECTS[0])
    setLandmarkLimit(LANDMARK_DEFAULT_LIMIT)
    setError('')
    setNotice('')
    setConfirmRestart(false)
    clearProtectDraft(draftMemory())
    setParams({ step: '1' })
  }

  const outside = graph.room_objects.filter((obj) => !centerInMaskWithMargin(obj, preview ? mask : null))
  const unconfirmed = outside.filter((obj) => !isConfirmed(obj)).length
  const hasAi = graph.room_objects.some((obj) => pointOriginOf(obj) === 'ai')
  const issues = assessLandmarks(graph, preview ? mask : null)
  const strong = outside.length >= 4
  const canSave = imported ? personAck : Boolean(preview && maskConfirmed)
  const wide = step >= 2 && step <= 3 && preview !== null

  function save() {
    if (!canSave) {
      setError(imported ? 'Confirm this scene graph does not describe a person.' : photoMissing ? 'Re-select the photo to review the cover, then save.' : 'Confirm the person is inside the opaque rectangle.')
      return
    }
    if (unconfirmed > 0 && !confirmSaveAnyway) {
      setConfirmSaveAnyway(true)
      return
    }
    const scene = {
      id: crypto.randomUUID(),
      label: label.trim() || 'Protected scene',
      createdAt: new Date().toISOString(),
      fileHash,
      mask: preview ? mask : null,
      maskConfirmed: Boolean(preview && maskConfirmed),
      personExcludedConfirmed: imported ? personAck : maskConfirmed,
      graph: { room_objects: outside, coverage_percent: graph.coverage_percent },
      origin: (hasAi ? 'ai-assist' : 'manual') as MappingOrigin,
      model: hasAi ? model : null,
    }
    sceneStore().save(scene)
    clearProtectDraft(draftMemory())
    dropVaultPhoto(photoVaultRef)
    setPhotoVaultRef(null)
    leavingRef.current = true
    setSaved(true)
    setConfirmSaveAnyway(false)
    if (preview) URL.revokeObjectURL(preview)
    setPhotoFile(null)
    navigate(`/protected/${scene.id}`)
  }

  /**
   * Photo with mask overlay, landmark dots at their scored centers, AI box
   * outlines, and suggestion outlines. Dots are buttons: drag (or arrow keys)
   * to correct, which marks a suggestion reviewed.
   */
  function photoCanvas(clickable: boolean, interactivePoints: boolean) {
    if (!preview) return null
    return (
      <div className="mask-frame mask-frame-fit">
        <div className="mask-canvas" ref={frameRef}>
          <img
            src={preview}
            alt="Your selected photograph. Cover the person with the opaque rectangle."
            onClick={clickable ? place : undefined}
            draggable={false}
          />
          <div
            className="mask-rect"
            data-mask="true"
            style={{ left: `${mask.x * 100}%`, top: `${mask.y * 100}%`, width: `${mask.w * 100}%`, height: `${mask.h * 100}%` }}
            onPointerDown={(event) => dragMask(event, 'move')}
            onClick={(event) => event.stopPropagation()}
          >
            <button className="mask-handle" type="button" aria-label="Resize mask" onPointerDown={(event) => dragMask(event, 'resize')} />
          </div>
          {graph.room_objects.map((obj) => {
            const needsReview = !isConfirmed(obj)
            const boxStyle =
              obj.width > 0 && obj.height > 0
                ? {
                    position: 'absolute' as const,
                    left: `${obj.x / 10}%`,
                    top: `${obj.y / 10}%`,
                    width: `${obj.width / 10}%`,
                    height: `${obj.height / 10}%`,
                    pointerEvents: 'none' as const,
                  }
                : null
            const pos = landmarkToPercent(obj)
            // No positioned wrapper: dot and box percentages must resolve
            // against the photo canvas itself.
            return (
              <Fragment key={obj.name}>
                {boxStyle && (
                  <span
                    aria-hidden="true"
                    className={needsReview ? 'point-box point-box-ai' : 'point-box'}
                    style={boxStyle}
                  />
                )}
                {interactivePoints ? (
                  <button
                    type="button"
                    className={`${needsReview ? 'point-dot point-ai' : 'point-dot point-ok'}${selectedPoint === obj.name ? ' point-selected' : ''}`}
                    style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                    aria-label={`${obj.name} landmark${needsReview ? ', AI suggestion needing review' : ''}. Activate to edit, drag or use arrow keys to move.`}
                    aria-pressed={selectedPoint === obj.name}
                    title={`${obj.name}${needsReview ? ' · needs review' : ''}`}
                    onPointerDown={(event) => dragPoint(event, obj.name)}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (suppressClickRef.current) {
                        suppressClickRef.current = false
                        return
                      }
                      setSelectedPoint((current) => (current === obj.name ? null : obj.name))
                    }}
                    onFocus={() => setSelectedPoint(obj.name)}
                    onKeyDown={(event) => nudgePoint(event, obj.name)}
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className={needsReview ? 'point-dot point-ai' : 'point-dot point-ok'}
                    style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                  />
                )}
              </Fragment>
            )
          })}
          {(suggested ?? []).map((rect, index) => (
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
      </div>
    )
  }

  function photoNeededNotice() {
    if (!photoMissing) return null
    return (
      <div className="panel" role="status">
        <h2>Re-select the photo to continue</h2>
        <p className="muted">
          {fileName} left memory when you navigated away, but your cover, points, and step were kept. Choose the same
          file{fileHash ? ` (hash ${fileHash.slice(0, 12)})` : ''} to re-attach it — anything else starts a checked
          replacement.
        </p>
        <label className="drop">
          <input
            type="file"
            accept="image/*"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void takeFile(file)
              event.currentTarget.value = ''
            }}
          />
          <b>Re-select {fileName}</b>
          <span className="muted">Verified by content hash before anything is restored.</span>
        </label>
      </div>
    )
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={`Protect · Step ${step} of 4`}
        title="Protect a photo"
        lede="Save a map of the room. The photograph itself is not kept."
      />
      <ol className="wizard-steps" aria-label="Protect progress">
        {STAGE_NAMES.map((name, index) => {
          const number = index + 1
          const state = number < step ? 'done' : number === step ? 'now' : 'todo'
          return (
            <li key={name} className={`wizard-step wizard-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="wizard-n num" aria-hidden="true">{number}</span>
              <span className="wizard-name">{name}</span>
            </li>
          )
        })}
      </ol>
      {pendingResume && !currentHasWork() && (
        <div className="panel" role="status">
          <h2>Resume your draft?</h2>
          <p className="muted">
            {pendingResume.label} · step {pendingResume.step} of 4 · saved {new Date(pendingResume.savedAt).toLocaleString()}.{' '}
            {pendingResume.photoVault
              ? 'The photo was kept on this device and will restore.'
              : 'The photo must be re-selected; it is verified by hash before anything continues.'}
          </p>
          <div className="actions">
            <Button onClick={() => void resumeDraft()}>Resume draft</Button>
            <Button variant="secondary" onClick={discardResume}>Start new</Button>
          </div>
        </div>
      )}
      {notice && !error && <p className="note" role="status">{notice}</p>}
      <div className={wide ? 'split split-protect-wide' : 'split'}>
        <div className="wizard-stage">
          {step === 1 && (
            <section className="stack" aria-labelledby="protect-stage-title">
              <h2 id="protect-stage-title">Choose a photo</h2>
              <p className="muted">Pick the original photograph. It stays in this browser tab — it is never uploaded or stored.</p>
              <label className="drop">
                <input
                  type="file"
                  accept="image/*,application/json,.json"
                  onChange={(event) => {
                    const file = event.target.files?.[0]
                    if (file) void takeFile(file)
                    event.currentTarget.value = ''
                  }}
                />
                <b>{fileName ? 'Replace the photograph or scene graph' : 'Choose a photograph or a scene graph'}</b>
                <span className="muted">It stays in this browser tab until you leave.</span>
              </label>
              {fileName && <p>Selected {fileName}.{imageSize ? ` ${imageSize.w}×${imageSize.h}px.` : ''} {imported ? 'Scene graph read.' : 'Photograph held in memory only.'}</p>}
              {preview && fileHash && !imported && (
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
                <span className="field-label">Name this scene</span>
                <input value={label} onChange={(event) => setLabel(event.target.value)} />
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="wizard-bar">
                <Button onClick={() => go(2)} disabled={!fileName}>Continue</Button>
                {currentHasWork() && <Button variant="ghost" onClick={() => setConfirmRestart(true)}>Start over</Button>}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="stack" aria-labelledby="protect-stage-title">
              <h2 id="protect-stage-title">{preview || photoMissing ? 'Cover the person' : 'Confirm no person'}</h2>
              {photoNeededNotice()}
              {preview ? (
                <>
                  <p className="muted">Drag the black rectangle over the person. Nothing is analyzed until you confirm the cover.</p>
                  <SegmentAssist file={photoFile} onRects={takeSuggested} consentScope={consentScope(fileHash, 'segment', null)} />
                  {suggested && suggested.length > 0 && (
                    <div className="actions">
                      <Button variant="secondary" onClick={useSuggested}>Use suggested cover{suggestModel ? ` (${suggestModel})` : ''}</Button>
                      <Button variant="ghost" onClick={() => { setSuggested(null); setSuggestModel(null) }}>Dismiss suggestion</Button>
                    </div>
                  )}
                  {photoCanvas(false, false)}
                  <label className="checkline">
                    <input type="checkbox" checked={maskConfirmed} onChange={(event) => setMaskConfirmed(event.target.checked)} />
                    <span>The person is inside the opaque rectangle.</span>
                  </label>
                  <p className="note">Masking hides the person from analysis but cannot guarantee anonymization — backgrounds and other details may still be identifying.</p>
                </>
              ) : photoMissing ? null : (
                <>
                  <p className="note">Imported graphs are stored as written. Stillpoint cannot see the photograph, so it cannot remove a person from the file.</p>
                  <label className="checkline">
                    <input type="checkbox" checked={personAck} onChange={(event) => setPersonAck(event.target.checked)} />
                    <span>This scene graph does not describe a person.</span>
                  </label>
                </>
              )}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="wizard-bar">
                <Button variant="secondary" onClick={() => go(1)}>Back</Button>
                <Button onClick={() => go(3)} disabled={preview || imported ? (preview ? !maskConfirmed : !personAck) : true}>Continue</Button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="stack" aria-labelledby="protect-stage-title">
              <h2 id="protect-stage-title">Map the background</h2>
              {photoNeededNotice()}
              {preview ? (
                <>
                  <p className="muted">Mark stable background details — furniture corners, doors, windows. Points inside the person cover are rejected. Drag any point to correct it.</p>
                  <div className="landmark-bar">
                    <span className="num" role="status">
                      {graph.room_objects.length} / {landmarkLimit} points{unconfirmed > 0 ? ` · ${unconfirmed} need review` : ' · all reviewed'}
                    </span>
                    <span className="actions">
                      <Button variant="ghost" onClick={undo} disabled={!canUndo(history)}>Undo</Button>
                      <Button variant="ghost" onClick={redo} disabled={!canRedo(history)}>Redo</Button>
                    </span>
                    <label className="field-inline">
                      <span className="field-label">Max points</span>
                      <input
                        type="number"
                        min={LANDMARK_MIN_LIMIT}
                        max={LANDMARK_MAX_LIMIT}
                        value={landmarkLimit}
                        onChange={(event) => {
                          const next = clampLimit(Number(event.target.value))
                          setLandmarkLimit(next)
                          if (next < graph.room_objects.length) {
                            setNotice(`Limit set to ${next}, below the current ${graph.room_objects.length} points. Nothing was removed — new points stay blocked until you remove some or raise it.`)
                          } else {
                            setNotice('')
                          }
                        }}
                      />
                    </label>
                  </div>
                  {photoCanvas(true, true)}
                  {(() => {
                    const selected = selectedPoint
                      ? (graph.room_objects.find((obj) => obj.name === selectedPoint) ?? null)
                      : null
                    if (!selected) return null
                    const center = landmarkCenter(selected)
                    const reviewed = isConfirmed(selected)
                    return (
                      <div className="panel" role="group" aria-label={`Edit ${selected.name}`}>
                        <h2>{selected.name}</h2>
                        <p className="muted num">
                          at {Math.round(center.x)}, {Math.round(center.y)} · {pointOriginOf(selected)} ·{' '}
                          {reviewed ? 'reviewed' : 'needs review'}
                        </p>
                        <RenameField key={selected.name} name={selected.name} onRename={renamePoint} />
                        <div className="actions">
                          {!reviewed && (
                            <Button variant="secondary" onClick={() => confirmPoint(selected.name)}>
                              Confirm
                            </Button>
                          )}
                          {photoFile && (
                            <Button variant="secondary" onClick={() => void snapPoint(selected.name)}>
                              Snap to corner
                            </Button>
                          )}
                          <Button
                            variant="secondary"
                            onClick={() => {
                              removePoint(selected.name)
                              setSelectedPoint(null)
                            }}
                          >
                            Delete
                          </Button>
                          <Button variant="ghost" onClick={() => setSelectedPoint(null)}>
                            Close
                          </Button>
                        </div>
                        <p className="muted">Tip: drag the dot on the photo to move it, or focus it and use arrow keys.</p>
                      </div>
                    )
                  })()}
                  <p className="legend" aria-hidden="true">
                    <span className="legend-dot legend-ok" /> Reviewed
                    <span className="legend-dot legend-ai" /> AI suggestion — drag to correct, then confirm
                  </p>
                  <ul className="issue-list" aria-label="Landmark checks">
                    {issues.map((issue, index) => (
                      <li key={index} className={`issue issue-${issue.level}`} role={issue.level === 'error' ? 'alert' : 'status'}>
                        {issue.message}
                      </li>
                    ))}
                  </ul>
                  <AIAssist
                    file={photoFile}
                    mask={mask}
                    ready={maskConfirmed}
                    blockedReason={maskConfirmed ? null : 'Confirm the cover on the previous step before AI mapping.'}
                    ctaLabel="Map background with AI"
                    onGraph={takeAIGraph}
                    consentScope={consentScope(fileHash, 'analyze', mask)}
                    maxPoints={landmarkLimit}
                    runToken={rerunToken}
                  />
                  {aiNote && <p role="status">{aiNote}</p>}
                  <div className="actions">
                    <Button variant="secondary" onClick={restoreAiSuggestions} disabled={!aiSnapshot}>
                      Restore AI suggestions
                    </Button>
                    <Button variant="ghost" onClick={() => setConfirmRerun(true)} disabled={!photoFile}>
                      Re-run AI analysis
                    </Button>
                  </div>
                  {aiSnapshot && (
                    <p className="muted">
                      Restoring reuses the last analysis on this device — no new model request. Re-running sends a new
                      request and may consume credits.
                    </p>
                  )}
                  <ProposalAssist
                    file={photoFile}
                    mask={mask}
                    maskConfirmed={maskConfirmed}
                    takenNames={new Set(graph.room_objects.map((item) => item.name))}
                    onAdd={takeProposal}
                  />
                  <section className="stack" aria-label="Mark points by hand">
                    <h2>Mark points by hand</h2>
                    <p className="muted">Choose a background object, then click where it sits in the photo. This always works, with or without AI.</p>
                    <div className="chips" role="listbox" aria-label="Background objects">
                      {STABLE_OBJECTS.map((name) => (
                        <button key={name} type="button" className={selectedName === name ? 'chip on' : 'chip'} onClick={() => setSelectedName(name)}>
                          {name}
                        </button>
                      ))}
                    </div>
                  </section>
                  <ObjectList
                    graph={graph}
                    editable
                    canSnap={photoFile !== null}
                    onRemove={removePoint}
                    onRename={renamePoint}
                    onConfirm={confirmPoint}
                    onConfirmAll={confirmAll}
                    onSnap={snapPoint}
                    onSnapAll={snapAll}
                  />
                </>
              ) : (
                <>
                  <p className="note">This scene graph was imported as written. Photo-based mapping needs a photograph, so review the imported points below.</p>
                  <ObjectList
                    graph={graph}
                    editable
                    canSnap={false}
                    onRemove={removePoint}
                    onRename={renamePoint}
                    onConfirm={confirmPoint}
                    onConfirmAll={confirmAll}
                    onSnap={snapPoint}
                    onSnapAll={snapAll}
                  />
                </>
              )}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="wizard-bar">
                <Button variant="secondary" onClick={() => go(2)}>Back</Button>
                <Button onClick={() => go(4)}>Continue</Button>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="stack" aria-labelledby="protect-stage-title">
              <h2 id="protect-stage-title">Review and save</h2>
              {photoNeededNotice()}
              <p className={strong ? 'status status-success' : 'status status-amber'}>
                {strong ? 'Strong scene coverage.' : 'Not enough background detail for a reliable comparison.'}
              </p>
              <p>
                {preview
                  ? `${outside.length} reference points sit outside the person cover.`
                  : `${outside.length} reference points are in the scene graph.`}{' '}
                {unconfirmed > 0 && `${unconfirmed} still need review. `}
                {graph.coverage_percent == null
                  ? 'No coverage percentage was provided.'
                  : `The file records coverage of ${graph.coverage_percent}%.`}
              </p>
              <p className="muted">
                Mapped {hasAi ? 'with AI assistance' : 'by hand'}
                {hasAi && model ? ` (${model})` : ''}. A background match alone never proves who is in a photo.
              </p>
              <ObjectList graph={graph} onRemove={removePoint} />
              <h2>What is kept on this device</h2>
              <ul className="limits">
                <li>Object names and positions</li>
                <li>The cover rectangle, if you drew one — not the pixels under it</li>
                <li>The file name is not saved. A SHA-256 of the file is saved when hashing succeeds</li>
                <li>The date</li>
              </ul>
              <p className="note">The photograph is not written to storage. Closing this page releases it from memory.</p>
              {fileHash && <p className="num muted">SHA-256 prefix {fileHash.slice(0, 12)}</p>}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="wizard-bar">
                <Button variant="secondary" onClick={() => go(3)}>Back</Button>
                <Button onClick={save} disabled={!canSave}>Save scene</Button>
                {currentHasWork() && <Button variant="ghost" onClick={() => setConfirmRestart(true)}>Start over</Button>}
              </div>
            </section>
          )}
        </div>
        <aside className="stack">
          <div className="panel">
            <h2>Saved on this device</h2>
            {scenes.length === 0 ? (
              <p className="muted">No scene is saved on this device yet.</p>
            ) : (
              <ul className="scene-list">
                {scenes.map((scene) => (
                  <li key={scene.id}>
                    <Link to={`/protected/${scene.id}`}>
                      <span>{scene.label}</span>
                      <span className="num">{scene.graph.room_objects.length}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
      <Dialog
        open={pendingFile !== null}
        title="Replace the current photo?"
        confirmLabel="Replace"
        onConfirm={() => {
          const file = pendingFile
          setPendingFile(null)
          if (file) void takeFileReplace(file)
        }}
        onClose={() => setPendingFile(null)}
      >
        <p className="muted">
          {pendingFile?.name} is a different file. Replacing discards the current cover{graph.room_objects.length > 0 ? ` and ${graph.room_objects.length} point(s)` : ''}.
        </p>
      </Dialog>
      <Dialog
        open={confirmRestart}
        title="Discard this scene and start over?"
        confirmLabel="Discard"
        onConfirm={restart}
        onClose={() => setConfirmRestart(false)}
      >
        <p className="muted">The cover, points, and step are cleared from this tab. Saved scenes stay untouched.</p>
      </Dialog>
      <Dialog
        open={confirmSaveAnyway}
        title="Save with unreviewed suggestions?"
        confirmLabel="Save anyway"
        onConfirm={save}
        onClose={() => setConfirmSaveAnyway(false)}
      >
        <p className="muted">
          {unconfirmed} AI-suggested point(s) are not reviewed yet. They will be saved as unconfirmed. Confirming them
          first makes a stronger scene.
        </p>
      </Dialog>
      <Dialog
        open={confirmRerun}
        title="Run the analysis again?"
        confirmLabel="Run again"
        onConfirm={() => {
          setConfirmRerun(false)
          setRerunToken((token) => token + 1)
        }}
        onClose={() => setConfirmRerun(false)}
      >
        <p className="muted">
          This sends the redacted photo to the model service again through the local backend and may consume API
          credits. Your current points stay untouched — new suggestions merge in, and anything already placed is kept.
        </p>
      </Dialog>
      <LeaveDialog
        open={leave.blocked}
        title="Leave with unsaved work?"
        onSaveLeave={() => {
          try {
            saveProtectDraft(draftMemory(), snapshot())
          } catch {
            // Final flush failed; the last autosave still stands.
          }
          leave.proceed()
        }}
        onDiscard={() => {
          dropVaultPhoto(photoVaultRef)
          clearProtectDraft(draftMemory())
          leave.proceed()
        }}
        onCancel={leave.cancel}
      >
        <p className="muted">
          Your cover, points, and step are auto-saved as a draft on this device
          {photoFile && !photoVaultRef ? ', but the photo itself lives in memory only and will be lost' : ''}.
        </p>
      </LeaveDialog>
    </div>
  )

  async function takeFileReplace(file: File) {
    const hash = await sha256(file)
    setPendingFile(null)
    void doTakeFile(file, hash)
  }
}

function RenameField({ name, onRename }: { name: string; onRename: (name: string, next: string) => void }) {
  const [value, setValue] = useState(name)
  return (
    <label className="field-inline rename-field">
      <span className="field-label">Label</span>
      <input value={value} maxLength={80} onChange={(event) => setValue(event.target.value)} aria-label={`Label for ${name}`} />
      <button className="btn btn-secondary" type="button" onClick={() => onRename(name, value)}>
        Apply
      </button>
    </label>
  )
}

function ObjectList({
  graph,
  detail = false,
  editable = false,
  canSnap = false,
  onRemove,
  onRename,
  onConfirm,
  onConfirmAll,
  onSnap,
  onSnapAll,
}: {
  graph: SceneGraph
  detail?: boolean
  editable?: boolean
  canSnap?: boolean
  onRemove: (name: string) => void
  onRename?: (name: string, next: string) => void
  onConfirm?: (name: string) => void
  onConfirmAll?: () => void
  onSnap?: (name: string) => void
  onSnapAll?: () => void
}) {
  if (graph.room_objects.length === 0) return <p className="muted">No background points yet.</p>
  const unconfirmed = graph.room_objects.filter((obj) => !isConfirmed(obj)).length
  return (
    <div className="stack">
      {editable && unconfirmed > 0 && (
        <div className="actions">
          <span className="muted">{unconfirmed} need review.</span>
          {onConfirmAll && <button className="btn btn-secondary" type="button" onClick={onConfirmAll}>Confirm all</button>}
          {canSnap && onSnapAll && <button className="btn btn-secondary" type="button" onClick={() => void onSnapAll()}>Snap all to corners</button>}
        </div>
      )}
      <ul className="object-list">
        {graph.room_objects.map((obj) => {
          const center = landmarkCenter(obj)
          const reviewed = isConfirmed(obj)
          const origin = pointOriginOf(obj)
          const options = STABLE_OBJECTS.includes(obj.name as (typeof STABLE_OBJECTS)[number])
            ? [...STABLE_OBJECTS]
            : [obj.name, ...STABLE_OBJECTS.filter((name) => name !== obj.name)]
          return (
            <li key={obj.name}>
              <span>
                <span className={reviewed ? 'badge badge-ok' : 'badge badge-ai'} aria-label={reviewed ? 'reviewed' : 'needs review'}>
                  {origin === 'ai' ? 'AI' : origin === 'local' ? 'local' : 'hand'}
                  {reviewed ? '' : ' · review'}
                </span>{' '}
                {obj.name}
                {(detail || editable) && (
                  <span className="muted num"> · {Math.round(center.x)}, {Math.round(center.y)}{obj.width > 0 || obj.height > 0 ? ` · ${Math.round(obj.width)}×${Math.round(obj.height)}` : ''}</span>
                )}
              </span>
              <span className="actions">
                {editable && onRename && (
                  <select aria-label={`Relabel ${obj.name}`} value={obj.name} onChange={(event) => onRename(obj.name, event.target.value)}>
                    {options.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                )}
                {editable && canSnap && onSnap && (
                  <button className="btn btn-ghost" type="button" onClick={() => void onSnap(obj.name)}>Snap</button>
                )}
                {editable && !reviewed && onConfirm && (
                  <button className="btn btn-secondary" type="button" onClick={() => onConfirm(obj.name)}>Confirm</button>
                )}
                <button className="btn btn-ghost" type="button" onClick={() => onRemove(obj.name)}>Remove</button>
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function withConfirmed(graph: SceneGraph): SceneGraph {
  return {
    ...graph,
    room_objects: graph.room_objects.map((obj) => ({
      ...obj,
      pointOrigin: pointOriginOf(obj),
      confirmed: isConfirmed(obj),
    })),
  }
}

async function imageDims(file: File): Promise<{ w: number; h: number } | null> {
  try {
    if (typeof createImageBitmap !== 'function') return null
    const bitmap = await createImageBitmap(file)
    const dims = { w: bitmap.width, h: bitmap.height }
    bitmap.close()
    return dims
  } catch {
    return null
  }
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
