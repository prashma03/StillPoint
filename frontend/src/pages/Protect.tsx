import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AIAssist } from '../components/AIAssist'
import { ProposalAssist } from '../components/ProposalAssist'
import { SegmentAssist } from '../components/SegmentAssist'
import { Button, Dialog, PageHeader, usePageTitle } from '../components/ui'
import type { SegmentRect } from '../lib/ai'
import { rgbaToGrayscale, snapToCorner } from '../lib/detect'
import { clearProtectDraft, draftHasWork, draftMemory, loadProtectDraft, saveProtectDraft } from '../lib/draft'
import { STABLE_OBJECTS, readGraph } from '../lib/graphs'
import { sha256 } from '../lib/hash'
import {
  LANDMARK_DEFAULT_LIMIT,
  MIN_POINT_SEPARATION,
  centerInMaskWithMargin,
  clientToImageCoords,
  consentScope,
  isConfirmed,
  landmarkCenter,
  landmarkToPercent,
  pointOriginOf,
  validateRename,
} from '../lib/landmarks'
import { decodeToPixels } from '../lib/redact'
import { mergeRectsToMask } from '../lib/segment'
import { acceptVisualSuggestion, canAdvanceProtectStep, categoryLabel, imageClickToCoordinates, placeManualAnnotation, removeAnnotation, renameAnnotation, suggestionFromAiPoint, suggestionFromRegion, validatePhotoSelection, type ProtectCategory, type VisualSuggestion } from '../lib/protectFlow'
import { sceneStore } from '../lib/storage'
import type { MappingOrigin, Mask, RoomObject, SceneGraph } from '../lib/types'

const emptyGraph: SceneGraph = { room_objects: [] }
const STAGE_NAMES = ['Choose photo', 'Mark features', 'Review']
const DEFAULT_MASK: Mask = { x: 0.34, y: 0.1, w: 0.32, h: 0.72 }

export function Protect() {
  usePageTitle('Protect')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  // In-progress descriptive state survives navigation inside this tab through
  // the session draft. The photo itself lives in memory only.
  const restored = useMemo(() => loadProtectDraft(draftMemory()), [])
  const hasRestoredWork = restored !== null && draftHasWork(restored)
  const stepParam = params.get('step')
  const step = stepParam ? Math.min(3, Math.max(1, Number(stepParam) || 1)) : (restored?.step ?? 1)
  const scenes = useMemo(() => sceneStore().list(), [])
  const [label, setLabel] = useState(restored?.label ?? 'Protected scene')
  const [fileName, setFileName] = useState<string | null>(restored?.fileName ?? null)
  const [fileHash, setFileHash] = useState<string | null>(restored?.fileHash ?? null)
  const [imageSize, setImageSize] = useState<{ w: number; h: number } | null>(
    restored?.imageWidth && restored?.imageHeight ? { w: restored.imageWidth, h: restored.imageHeight } : null,
  )
  const [preview, setPreview] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [graph, setGraph] = useState<SceneGraph>(restored?.graph ?? emptyGraph)
  const [model, setModel] = useState<string | null>(restored?.model ?? null)
  const [aiNote, setAiNote] = useState(restored?.aiNote ?? '')
  const [imported, setImported] = useState(restored?.imported ?? false)
  const [mask, setMask] = useState<Mask>(restored?.mask ?? DEFAULT_MASK)
  const [suggested, setSuggested] = useState<SegmentRect[] | null>(restored?.suggested ?? null)
  const [suggestModel, setSuggestModel] = useState<string | null>(restored?.suggestModel ?? null)
  const [maskConfirmed, setMaskConfirmed] = useState(restored?.maskConfirmed ?? false)
  const [personAck, setPersonAck] = useState(restored?.personAck ?? false)
  const [selectedName, setSelectedName] = useState<string>(restored?.selectedName ?? 'window')
  const [annotationCategory, setAnnotationCategory] = useState<ProtectCategory>('window')
  const [annotationMode, setAnnotationMode] = useState(false)
  const [visualSuggestions, setVisualSuggestions] = useState<VisualSuggestion[]>([])
  const [pointHistory, setPointHistory] = useState<RoomObject[][]>([])
  const [editingPoint, setEditingPoint] = useState<string | null>(null)
  const [landmarkLimit, setLandmarkLimit] = useState(restored?.landmarkLimit ?? LANDMARK_DEFAULT_LIMIT)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState(hasRestoredWork ? 'Restored your in-progress scene from this tab.' : '')
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [confirmRestart, setConfirmRestart] = useState(false)
  const [confirmSaveAnyway, setConfirmSaveAnyway] = useState(false)
  const [saved, setSaved] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const pixelsRef = useRef<{ hash: string; gray: Float32Array; width: number; height: number } | null>(null)

  // The photo cannot survive a reload; everything descriptive can. When the
  // tab restores a draft without its photo, the user re-selects the file and
  // the content hash proves it is the same one.
  const photoMissing = !imported && fileName !== null && photoFile === null

  useEffect(() => {
    if (!stepParam && restored && draftHasWork(restored)) {
      setParams({ step: String(restored.step) }, { replace: true })
    }
    // Once, on mount: adopt the restored step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  // Autosave descriptive progress every render it changes. Image pixels are
  // refused by the store; only the tab session holds this draft.
  useEffect(() => {
    if (saved) return
    try {
      saveProtectDraft(draftMemory(), {
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
        savedAt: new Date().toISOString(),
      })
    } catch {
      // Storage full or unavailable: the session continues in memory.
    }
  }, [saved, step, label, fileName, fileHash, imageSize, imported, graph, model, aiNote, mask, maskConfirmed, personAck, suggested, suggestModel, selectedName, landmarkLimit])

  // Never discard progress silently: warn before the tab closes with work.
  useEffect(() => {
    if (saved) return
    const handler = (event: BeforeUnloadEvent) => {
      if (fileName || graph.room_objects.length > 0 || maskConfirmed || personAck) {
        event.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [saved, fileName, graph, maskConfirmed, personAck])

  function go(next: number) {
    if (next > step && step === 1 && !canAdvanceProtectStep(step, fileName !== null, maskConfirmed, personAck)) {
      setError('Choose a photograph before continuing.')
      return
    }
    if (next > step && step === 2 && !canAdvanceProtectStep(step, fileName !== null, maskConfirmed, imported && personAck)) {
      setError('Confirm the person cover before continuing.')
      return
    }
    setError('')
    // Step changes only flip the visible stage. Nothing is re-fetched and no
    // paid call repeats: AI runs solely through its own consented buttons.
    setParams({ step: String(Math.min(3, next)) })
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

  async function takeFile(file: File) {
    setError('')
    const validationError = validatePhotoSelection(file)
    if (validationError) { setError(validationError); return }
    const isJson = file.type.includes('json') || file.name.toLowerCase().endsWith('.json')
    let hash: string | null
    try { hash = await sha256(file) } catch {
      setError('This file could not be read. Try another JPEG, PNG, or WebP image.')
      return
    }
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
        setImported(true)
        setGraph(withConfirmed(parsed.graph))
        setModel(null)
        setAiNote('')
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
    try { setImageSize(await imageDims(file)) } catch {
      setPreview(null)
      setPhotoFile(null)
      setFileName(null)
      setError('This image could not be opened. Try a different JPEG, PNG, or WebP photograph.')
      return
    }
    setSuggested(null)
    setSuggestModel(null)
    setImported(false)
    setGraph(emptyGraph)
    setVisualSuggestions([])
    setPointHistory([])
    setModel(null)
    setAiNote('')
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
    const candidates = parsed.graph.room_objects.filter((item) => {
      const name = item.name.toLowerCase().trim()
      return !name.includes('person') && !name.includes('human')
    }).slice(0, landmarkLimit)
    setVisualSuggestions(candidates.map(suggestionFromAiPoint))
    setModel(modelName)
    setAiNote(candidates.length ? `Review ${candidates.length} AI suggestions on the photo. Accept, correct, or dismiss each one before it is added.` : 'AI did not identify any background features. You can mark them by hand.')
    setError('')
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

  function place(event: React.MouseEvent<HTMLDivElement>) {
    if (!annotationMode || !preview) return
    const coords = imageClickToCoordinates(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())
    const { x, y } = coords
    if (graph.room_objects.length >= landmarkLimit) {
      setError(`The limit of ${landmarkLimit} points is reached. Remove one or raise the limit.`)
      return
    }
    const point = placeManualAnnotation(annotationCategory, x, y, graph.room_objects)
    if (!point) return
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
    setPointHistory((history) => [...history, graph.room_objects])
    setGraph((current) => ({ ...current, room_objects: [...current.room_objects, point] }))
    setAnnotationMode(false)
    setNotice(`${categoryLabel(annotationCategory)} added at the point you marked.`)
  }

  function acceptSuggestion(suggestion: VisualSuggestion, category: ProtectCategory) {
    if (graph.room_objects.length >= landmarkLimit) { setError(`The limit of ${landmarkLimit} points is reached.`); return }
    const point = acceptVisualSuggestion(suggestion, graph.room_objects, category)
    if (!point) return
    if (centerInMaskWithMargin(point, mask)) { setError('That suggestion overlaps the person cover. Dismiss it or choose a different region.'); return }
    const center = landmarkCenter(point)
    if (tooClose(null, center.x, center.y)) { setError('That suggestion overlaps another selected feature. Dismiss it or mark the other feature instead.'); return }
    setPointHistory((history) => [...history, graph.room_objects])
    setGraph((current) => ({ ...current, room_objects: [...current.room_objects, point] }))
    setVisualSuggestions((current) => current.map((item) => item.id === suggestion.id ? { ...item, accepted: true } : item))
    setNotice(`${point.name} suggestion added. You can edit or remove it below.`)
    setError('')
  }

  function undoAnnotation() {
    const previous = pointHistory.at(-1)
    if (!previous) return
    const removed = graph.room_objects.filter((point) => !previous.some((saved) => saved.name === point.name))
    if (removed.length) setVisualSuggestions((current) => current.map((suggestion) => removed.some((point) => point.x === suggestion.x && point.y === suggestion.y) ? { ...suggestion, accepted: false } : suggestion))
    setGraph((current) => ({ ...current, room_objects: previous }))
    setPointHistory((history) => history.slice(0, -1))
    setNotice('Last annotation undone.')
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
    setGraph((current) => ({ ...current, room_objects: [...current.room_objects, labeled] }))
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
      // A corrected point counts as reviewed.
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
    setGraph((current) => ({
      ...current,
      room_objects: current.room_objects.map((item) => (item.name === name ? next : item)),
    }))
  }

  function renamePoint(name: string, next: string) {
    const checked = validateRename(graph, name, next)
    if (!checked.ok) {
      setError(checked.error)
      return
    }
    if (checked.name === name) return
    setError('')
    setNotice(`Relabeled “${name}” as “${checked.name}” and marked it reviewed.`)
    setPointHistory((history) => [...history, graph.room_objects])
    setGraph((current) => ({
      ...current,
      room_objects: renameAnnotation(current.room_objects, name, checked.name),
    }))
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
    setPointHistory((history) => [...history, graph.room_objects])
    setGraph((current) => ({ ...current, room_objects: removeAnnotation(current.room_objects, name) }))
    setNotice(`Removed “${name}”.`)
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
      setGraph((current) => ({ ...current, room_objects: next }))
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
    setLabel('Protected scene')
    setFileName(null)
    setFileHash(null)
    setImageSize(null)
    setPreview(null)
    setPhotoFile(null)
    setGraph(emptyGraph)
    setModel(null)
    setAiNote('')
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
        <div className={`mask-canvas${annotationMode && clickable ? ' annotation-active' : ''}`} ref={frameRef} onClick={clickable ? place : undefined}>
          <img
            src={preview}
            alt={clickable ? 'Selected photo. Click to place the chosen background feature marker.' : 'Selected photo with the person cover overlay.'}
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
                    className={needsReview ? 'point-dot point-ai' : 'point-dot point-ok'}
                    style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
                    aria-label={`${obj.name} landmark${needsReview ? ', AI suggestion needing review' : ''}. Drag or use arrow keys to move.`}
                    title={`${obj.name}${needsReview ? ' · needs review' : ''}`}
                    onPointerDown={(event) => dragPoint(event, obj.name)}
                    onClick={(event) => event.stopPropagation()}
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
          {visualSuggestions.filter((item) => !item.accepted).map((item, index) => (
            <div key={item.id} className="visual-suggestion" style={{ left: `${item.x / 10}%`, top: `${item.y / 10}%`, width: `${item.width / 10}%`, height: `${item.height / 10}%` }}>
              <span>Unidentified object · suggestion {index + 1}</span>
            </div>
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
        eyebrow={`Protect · Step ${step} of 3`}
        title="Protect an original photo"
        lede="Create a reference map of stable background features. A later comparison can find a possible relationship between images; it cannot establish identity, consent, ownership, or wrongdoing."
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
      {notice && !error && <p className="note" role="status">{notice}</p>}
      <div className={wide ? 'split split-protect-wide' : 'split'}>
        <div className="wizard-stage">
          {step === 1 && (
            <section className="stack" aria-labelledby="protect-stage-title">
              <h2 id="protect-stage-title">Start with the original photo</h2>
              <p className="muted">Stillpoint maps stable details in the background so you can compare another image later. Choose the original scene you want to keep as a reference.</p>
              <div className="protect-intro"><strong>What happens next</strong><span>Cover any person, mark recognizable background features, then review the scene map before saving.</span><span>Stillpoint saves feature names, positions, a cover rectangle, and a file hash when available. The image is kept in memory during this session; optional AI processing sends it only after separate consent. See each tool’s notice for what is sent and retained.</span></div>
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
                <b>{fileName ? 'Replace the photograph or scene graph' : 'Choose a photograph'}</b>
                <span className="muted">JPEG, PNG, or WebP · up to 20 MB</span>
              </label>
              {fileName && <p>Selected {fileName}.{imageSize ? ` ${imageSize.w}×${imageSize.h}px.` : ''} {imported ? 'Scene graph read.' : 'Photograph held in memory only.'}</p>}
              <label className="field">
                <span className="field-label">Name this scene</span>
                <input value={label} onChange={(event) => setLabel(event.target.value)} />
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <div className="wizard-bar">
                <Button onClick={() => go(2)} disabled={!canAdvanceProtectStep(1, fileName !== null, maskConfirmed, personAck)}>Continue</Button>
                {currentHasWork() && <Button variant="ghost" onClick={() => setConfirmRestart(true)}>Start over</Button>}
              </div>
            </section>
          )}

          {step === 2 && (
            <section className="stack" aria-labelledby="protect-stage-title">
              <h2 id="protect-stage-title">Identify background features</h2>
              {photoNeededNotice()}
              {preview ? (
                <>
                  <p className="muted">First cover any person. Then choose a feature and click its location in the photo. Manual marking works even when AI is unavailable.</p>
                  <details className="protect-cover"><summary>Privacy cover for a person</summary><p className="muted">Move and resize the opaque cover over the person. Nothing is analyzed until you confirm it. Masking cannot guarantee anonymization; backgrounds may still identify a place.</p><SegmentAssist file={photoFile} onRects={takeSuggested} consentScope={consentScope(fileHash, 'segment', null)} />{suggested && suggested.length > 0 && <div className="actions"><Button variant="secondary" onClick={useSuggested}>Use suggested cover</Button><Button variant="ghost" onClick={() => { setSuggested(null); setSuggestModel(null) }}>Dismiss cover suggestion</Button></div>}{photoCanvas(false, false)}<label className="checkline"><input type="checkbox" checked={maskConfirmed} onChange={(event) => setMaskConfirmed(event.target.checked)} /><span>The person is inside the opaque rectangle.</span></label></details>
                  <div className="protect-annotator">
                    <h3>Mark a background feature</h3>
                    <p className="muted">Select what you see, then mark it in the photo.</p>
                    <div className="protect-category-grid" role="group" aria-label="Choose background feature category">{(['window','door','desk','bed','poster','chair','shelf','table','rug','other'] as ProtectCategory[]).map((category) => <button type="button" key={category} className={`protect-category${annotationCategory === category ? ' selected' : ''}`} aria-pressed={annotationCategory === category} onClick={() => { setAnnotationCategory(category); setAnnotationMode(true); setNotice(`Now click the ${category === 'other' ? 'background feature' : category} in your photo.`); setError('') }}>{categoryLabel(category)}</button>)}</div>
                    <p className={`annotation-instruction${annotationMode ? ' active' : ''}`} role="status">{annotationMode ? `Now click the ${annotationCategory === 'other' ? 'background feature' : annotationCategory} in your photo.` : 'Choose a category to start placing a marker.'}</p>
                    <div className="photo-annotation-stage">{photoCanvas(annotationMode, true)}</div>
                    <div className="actions"><Button variant="secondary" disabled={pointHistory.length === 0} onClick={undoAnnotation}>Undo last marker</Button><Button variant="ghost" onClick={() => setAnnotationMode(false)}>Cancel marking</Button></div>
                    <section className="selected-features"><h3>Selected features <span>{graph.room_objects.length}</span></h3>{graph.room_objects.length === 0 ? <p className="muted">Your marked features will appear here.</p> : graph.room_objects.map((point) => <div key={point.name} className="feature-row"><span className={`feature-source ${pointOriginOf(point) === 'ai' || pointOriginOf(point) === 'local' ? 'suggested' : ''}`}>{point.name}<small>{pointOriginOf(point) === 'manual' ? 'Marked by you' : pointOriginOf(point) === 'ai' ? 'AI suggestion · reviewed' : 'On-device suggestion'}</small></span><div className="actions"><button className="btn btn-ghost" type="button" onClick={() => setEditingPoint(point.name === editingPoint ? null : point.name)}>{editingPoint === point.name ? 'Close edit' : 'Edit label'}</button><button className="btn btn-ghost" type="button" onClick={() => removePoint(point.name)}>Remove</button></div>{editingPoint === point.name && <select aria-label={`Edit ${point.name} category`} value={point.name.replace(/ \d+$/, '')} onChange={(event) => { renamePoint(point.name, event.target.value); setEditingPoint(null) }}>{['window','door','desk','bed','poster','chair','shelf','table','rug','other background feature'].map((name) => <option key={name} value={name}>{categoryLabel(name === 'other background feature' ? 'other' : name as ProtectCategory)}</option>)}</select>}</div>)}</section>
                    <ProposalAssist file={photoFile} mask={mask} maskConfirmed={maskConfirmed} takenNames={new Set(graph.room_objects.map((point) => point.name))} onAdd={takeProposal} visualOnly onSuggestions={(regions) => setVisualSuggestions(regions.map((region, index) => suggestionFromRegion(region, index)))} />
                    {visualSuggestions.filter((item) => !item.accepted).map((item, index) => <div className="suggestion-review" key={item.id}><div><strong>{item.label === 'Unidentified object' ? 'Unidentified object' : `Suggested ${item.label.toLowerCase()}`}</strong><span>On-device visual region {index + 1}; this tool does not recognize object categories.</span></div><select aria-label={`Correct suggestion ${index + 1} category`} value={item.label === 'Unidentified object' ? 'other' : item.label.toLowerCase()} onChange={(event) => setVisualSuggestions((current) => current.map((entry) => entry.id === item.id ? { ...entry, label: event.target.value === 'other' ? 'Unidentified object' : categoryLabel(event.target.value as ProtectCategory) } : entry))}>{['window','door','desk','bed','poster','chair','shelf','table','rug','other'].map((name) => <option key={name} value={name}>{name === 'other' ? 'Unidentified object' : `Suggested ${name}`}</option>)}</select><Button variant="secondary" onClick={() => acceptSuggestion(item, (item.label === 'Unidentified object' ? 'other' : item.label.toLowerCase()) as ProtectCategory)}>Accept suggestion</Button><Button variant="ghost" onClick={() => setVisualSuggestions((current) => current.filter((entry) => entry.id !== item.id))}>Dismiss</Button></div>)}
                    <AIAssist file={photoFile} mask={mask} ready={maskConfirmed} blockedReason={maskConfirmed ? null : 'Confirm the person cover above before using AI.'} ctaLabel="Suggest background features with AI" onGraph={takeAIGraph} consentScope={consentScope(fileHash, 'analyze', mask)} maxPoints={landmarkLimit} />
                    {aiNote && <p role="status">{aiNote}</p>}
                  </div>
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
                <Button onClick={() => go(3)} disabled={!canAdvanceProtectStep(2, fileName !== null, Boolean(preview && maskConfirmed), Boolean(imported && personAck))}>Review setup</Button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="stack" aria-labelledby="protect-stage-title">
              <h2 id="protect-stage-title">Review and save</h2>
              {photoNeededNotice()}
              {preview && <div className="review-photo"><img src={preview} alt="Original photo preview for review" /></div>}
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
              <ObjectList graph={graph} editable canSnap={false} onRemove={removePoint} onRename={renamePoint} onConfirm={confirmPoint} onConfirmAll={confirmAll} onSnap={snapPoint} onSnapAll={snapAll} />
              <h2>What is kept on this device</h2>
              <ul className="limits">
                <li>Object names and positions</li>
                <li>The cover rectangle, if you drew one — not the pixels under it</li>
                <li>The file name is not saved. A SHA-256 of the file is saved when hashing succeeds</li>
                <li>The date</li>
              </ul>
              <p className="note">The photograph is not written to Stillpoint storage; it remains in session memory while this page is open. If you chose an optional external AI feature, that step sent an image only after your explicit consent; provider retention is not verified by Stillpoint.</p>
              {fileHash && <p className="num muted">SHA-256 prefix {fileHash.slice(0, 12)}</p>}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="wizard-bar">
                <Button variant="secondary" onClick={() => go(2)}>Edit</Button>
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
    </div>
  )

  async function takeFileReplace(file: File) {
    const hash = await sha256(file)
    setPendingFile(null)
    void doTakeFile(file, hash)
  }
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

