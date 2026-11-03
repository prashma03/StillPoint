import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AIAssist } from '../components/AIAssist'
import { ProposalAssist } from '../components/ProposalAssist'
import { SegmentAssist } from '../components/SegmentAssist'
import { Button, PageHeader, usePageTitle } from '../components/ui'
import type { SegmentRect } from '../lib/ai'
import { STABLE_OBJECTS, centerInsideMask, readGraph } from '../lib/graphs'
import { sha256 } from '../lib/hash'
import { mergeRectsToMask } from '../lib/segment'
import { sceneStore } from '../lib/storage'
import type { MappingOrigin, Mask, RoomObject, SceneGraph } from '../lib/types'

const emptyGraph: SceneGraph = { room_objects: [] }

export function Protect() {
  usePageTitle('Protect')
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const step = Math.min(4, Math.max(1, Number(params.get('step') || 1)))
  const scenes = useMemo(() => sceneStore().list(), [])
  const [label, setLabel] = useState('Protected scene')
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileHash, setFileHash] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [graph, setGraph] = useState<SceneGraph>(emptyGraph)
  const [origin, setOrigin] = useState<MappingOrigin>('manual')
  const [model, setModel] = useState<string | null>(null)
  const [aiNote, setAiNote] = useState('')
  const [imported, setImported] = useState(false)
  const [mask, setMask] = useState<Mask>({ x: 0.34, y: 0.1, w: 0.32, h: 0.72 })
  const [suggested, setSuggested] = useState<SegmentRect[] | null>(null)
  const [suggestModel, setSuggestModel] = useState<string | null>(null)
  const [maskConfirmed, setMaskConfirmed] = useState(false)
  const [personAck, setPersonAck] = useState(false)
  const [selectedName, setSelectedName] = useState<string>(STABLE_OBJECTS[0])
  const [error, setError] = useState('')
  const frameRef = useRef<HTMLDivElement>(null)

  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function go(next: number) {
    setError('')
    setParams({ step: String(next) })
  }

  async function takeFile(file: File) {
    setError('')
    if (file.size > 20 * 1024 * 1024) {
      setError('That file is larger than 20 MB.')
      return
    }
    if (file.type.includes('json') || file.name.toLowerCase().endsWith('.json')) {
      try {
        const parsed = readGraph(JSON.parse(await file.text()))
        if (!parsed.ok) {
          setError(parsed.error)
          return
        }
        if (preview) URL.revokeObjectURL(preview)
        setPreview(null)
        setPhotoFile(null)
        setImported(true)
        setGraph(parsed.graph)
        setOrigin('manual')
        setModel(null)
        setAiNote('')
        setFileName(file.name)
        setFileHash(await sha256(file))
        setMaskConfirmed(false)
      } catch {
        setError('That file is not a scene graph.')
      }
      return
    }
    if (!file.type.startsWith('image/')) {
      setError('Choose a photograph or a scene graph.')
      return
    }
    if (preview) URL.revokeObjectURL(preview)
    setPreview(URL.createObjectURL(file))
    setPhotoFile(file)
    setSuggested(null)
    setSuggestModel(null)
    setImported(false)
    setGraph(emptyGraph)
    setOrigin('manual')
    setModel(null)
    setAiNote('')
    setFileName(file.name)
    setFileHash(await sha256(file))
    setMaskConfirmed(false)
    setPersonAck(false)
  }

  function takeAIGraph(data: unknown, modelName: string) {
    const parsed = readGraph(data)
    if (!parsed.ok) {
      setError(`The AI output was rejected: ${parsed.error} Nothing was saved.`)
      return
    }
    setGraph(parsed.graph)
    setOrigin('ai-assist')
    setModel(modelName)
    setAiNote(
      `AI-mapped ${parsed.graph.room_objects.length} background points. Review them below and remove any that look wrong — manual points still work.`,
    )
    setError('')
  }

  function place(event: React.MouseEvent<HTMLImageElement>) {
    const rect = event.currentTarget.getBoundingClientRect()
    const px = (event.clientX - rect.left) / rect.width
    const py = (event.clientY - rect.top) / rect.height
    const point: RoomObject = {
      name: selectedName,
      x: px * 1000,
      y: py * 1000,
      width: 0,
      height: 0,
    }
    if (centerInsideMask(point, mask)) {
      setError('That point is inside the masked area and will not be kept.')
      return
    }
    setError('')
    setGraph((current) => ({
      room_objects: [...current.room_objects.filter((item) => item.name !== selectedName), point],
    }))
    setOrigin('manual')
    setModel(null)
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
    setError('')
  }

  function takeProposal(obj: RoomObject) {
    // The mask may have moved since proposals were computed.
    if (centerInsideMask(obj, mask)) {
      setError('That region is now inside the mask and will not be kept.')
      return
    }
    setError('')
    setGraph((current) => ({
      room_objects: [...current.room_objects.filter((item) => item.name !== obj.name), obj],
    }))
    setOrigin('manual')
    setModel(null)
  }

  function dragMask(event: React.PointerEvent, mode: 'move' | 'resize') {
    const frame = frameRef.current
    if (!frame) return
    event.preventDefault()
    event.stopPropagation()
    const bounds = frame.getBoundingClientRect()
    const start = { x: event.clientX, y: event.clientY, mask: { ...mask } }
    const move = (ev: PointerEvent) => {
      const dx = (ev.clientX - start.x) / bounds.width
      const dy = (ev.clientY - start.y) / bounds.height
      const next = mode === 'move'
        ? { ...start.mask, x: start.mask.x + dx, y: start.mask.y + dy }
        : { ...start.mask, w: start.mask.w + dx, h: start.mask.h + dy }
      setMask(clampMask(next))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const outside = graph.room_objects.filter((obj) => !centerInsideMask(obj, preview ? mask : null))
  const strong = outside.length >= 4
  const canSave = imported ? personAck : Boolean(preview && maskConfirmed)

  function save() {
    if (!canSave) {
      setError(imported ? 'Confirm this scene graph does not describe a person.' : 'Confirm the person is inside the opaque rectangle.')
      return
    }
    const cleaned = outside
    const scene = {
      id: crypto.randomUUID(),
      label: label.trim() || 'Protected scene',
      createdAt: new Date().toISOString(),
      fileHash,
      mask: preview ? mask : null,
      maskConfirmed: Boolean(preview && maskConfirmed),
      personExcludedConfirmed: imported ? personAck : maskConfirmed,
      graph: { room_objects: cleaned, coverage_percent: graph.coverage_percent },
      origin,
      model,
    }
    sceneStore().save(scene)
    if (preview) URL.revokeObjectURL(preview)
    setPhotoFile(null)
    navigate(`/protected/${scene.id}`)
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow={`Protect · ${step} of 4`}
        title="Protect a photo"
        lede="Save a map of the room. The photograph itself is not kept."
      />
      <div className="split">
        <div className="stack">
          {step === 1 && (
            <section className="stack">
              <h2>Select original</h2>
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
                <b>Choose a photograph or a scene graph</b>
                <span className="muted">It stays in this browser tab until you leave.</span>
              </label>
              {fileName && <p>Selected {fileName}. {imported ? 'Scene graph read.' : 'Photograph held in memory only.'}</p>}
              <label className="field">
                <span className="field-label">Name this scene</span>
                <input value={label} onChange={(event) => setLabel(event.target.value)} />
              </label>
              {error && <p className="error" role="alert">{error}</p>}
              <Button onClick={() => go(2)} disabled={!fileName}>Continue</Button>
            </section>
          )}

          {step === 2 && (
            <section className="stack">
              <h2>Mask the person</h2>
              <div className="mask-demo" aria-hidden="true">
                <span className="mask-demo-figure" />
                <span className="mask-demo-cover" />
              </div>
              <p>Your appearance is excluded from scene analysis.</p>
              {preview ? (
                <>
                  <SegmentAssist file={photoFile} onRects={takeSuggested} />
                  {suggested && suggested.length > 0 && (
                    <div className="actions">
                      <Button variant="secondary" onClick={useSuggested}>Use suggested mask{suggestModel ? ` (${suggestModel})` : ''}</Button>
                      <Button variant="ghost" onClick={() => { setSuggested(null); setSuggestModel(null) }}>Dismiss suggestion</Button>
                    </div>
                  )}
                  <div className="mask-frame" ref={frameRef}>
                    <img src={preview} alt="Your selected photograph. Cover the person with the opaque rectangle." onClick={place} draggable={false} />
                    <div
                      className="mask-rect"
                      data-mask="true"
                      style={{ left: `${mask.x * 100}%`, top: `${mask.y * 100}%`, width: `${mask.w * 100}%`, height: `${mask.h * 100}%` }}
                      onPointerDown={(event) => dragMask(event, 'move')}
                      onClick={(event) => event.stopPropagation()}
                    >
                      <button className="mask-handle" type="button" aria-label="Resize mask" onPointerDown={(event) => dragMask(event, 'resize')} />
                    </div>
                    {graph.room_objects.map((obj) => (
                      <span key={obj.name} className="point-dot" style={{ left: `${obj.x / 10}%`, top: `${obj.y / 10}%` }} />
                    ))}
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
                  <p className="muted">Drag the black rectangle until the person is inside it. Then choose a background object and click its corner. Points inside the mask are rejected.</p>
                  <div className="chips" role="listbox" aria-label="Background objects">
                    {STABLE_OBJECTS.map((name) => (
                      <button key={name} type="button" className={selectedName === name ? 'chip on' : 'chip'} onClick={() => setSelectedName(name)}>
                        {name}
                      </button>
                    ))}
                  </div>
                  <label className="checkline">
                    <input type="checkbox" checked={maskConfirmed} onChange={(event) => setMaskConfirmed(event.target.checked)} />
                    <span>The person is inside the opaque rectangle.</span>
                  </label>
                  <p className="note">Masking hides the person from analysis but cannot guarantee anonymization — backgrounds and other details may still be identifying.</p>
                  <AIAssist
                    file={photoFile}
                    mask={mask}
                    ready={maskConfirmed}
                    blockedReason={maskConfirmed ? null : 'Confirm the mask above before AI mapping.'}
                    ctaLabel="Extract background with AI"
                    onGraph={takeAIGraph}
                  />
                  {aiNote && <p role="status">{aiNote}</p>}
                  <ProposalAssist
                    file={photoFile}
                    mask={mask}
                    maskConfirmed={maskConfirmed}
                    takenNames={new Set(graph.room_objects.map((item) => item.name))}
                    onAdd={takeProposal}
                  />
                </>
              ) : (
                <>
                  <p className="note">Imported graphs are stored as written. Stillpoint cannot see the photograph, so it cannot remove a person from the file.</p>
                  <label className="checkline">
                    <input type="checkbox" checked={personAck} onChange={(event) => setPersonAck(event.target.checked)} />
                    <span>This scene graph does not describe a person.</span>
                  </label>
                </>
              )}
              <ObjectList graph={graph} onRemove={(name) => setGraph((current) => ({ room_objects: current.room_objects.filter((item) => item.name !== name) }))} />
              {error && <p className="error" role="alert">{error}</p>}
              <div className="actions">
                <Button variant="secondary" onClick={() => go(1)}>Back</Button>
                <Button onClick={() => go(3)} disabled={preview ? !maskConfirmed : !personAck}>Continue</Button>
              </div>
            </section>
          )}

          {step === 3 && (
            <section className="stack">
              <h2>Optional live scene challenge</h2>
              <p>Still have access to this room? A short camera scan may strengthen your evidence.</p>
              <p className="muted">A victim may no longer have access to the location. Skipping is a complete choice.</p>
              <p className="note">Room scan is not available in this build. No camera is opened, and no footage is recorded.</p>
              <div className="actions">
                <Button onClick={() => go(4)}>Continue without a scan</Button>
                <Button variant="secondary" onClick={() => go(4)}>Skip — I don’t have access to this room</Button>
              </div>
            </section>
          )}

          {step === 4 && (
            <section className="stack">
              <h2>Coverage</h2>
              <p className={strong ? 'status status-success' : 'status status-amber'}>
                {strong ? 'Strong scene coverage.' : 'Not enough background detail for a reliable comparison.'}
              </p>
              <p>
                {preview
                  ? `${outside.length} reference points sit outside the person mask.`
                  : `${outside.length} reference points are in the scene graph.`}{' '}
                {graph.coverage_percent == null
                  ? 'No coverage percentage was provided.'
                  : `The file records coverage of ${graph.coverage_percent}%.`}
              </p>
              <h2>What is retained on this device</h2>
              <ul className="limits">
                <li>Object names and positions</li>
                <li>The mask rectangle, if you drew one — not the pixels under it</li>
                <li>The file name is not saved. A SHA-256 of the file is saved when hashing succeeds</li>
                <li>The date</li>
              </ul>
              <p className="note">The photograph is not written to storage. Closing this page releases it from memory.</p>
              {fileHash && <p className="num muted">SHA-256 prefix {fileHash.slice(0, 12)}</p>}
              {error && <p className="error" role="alert">{error}</p>}
              <div className="actions">
                <Button variant="secondary" onClick={() => go(3)}>Back</Button>
                <Button onClick={save} disabled={!canSave}>Save scene graph</Button>
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
    </div>
  )
}

function ObjectList({ graph, onRemove }: { graph: SceneGraph; onRemove: (name: string) => void }) {
  if (graph.room_objects.length === 0) return <p className="muted">No background points yet.</p>
  return (
    <ul className="object-list">
      {graph.room_objects.map((obj) => (
        <li key={obj.name}>
          <span>{obj.name}</span>
          <button className="btn btn-ghost" type="button" onClick={() => onRemove(obj.name)}>Remove</button>
        </li>
      ))}
    </ul>
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
