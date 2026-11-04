import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './ui'
import type { PhotoInput } from '../lib/checkSession'
import type { Mask, RoomObject, SceneGraph } from '../lib/types'
import type { PixelMask } from '../lib/checkSession'
import { PersonMaskControls } from './PersonMaskControls'

export function useObjectUrl(file: Blob | null) {
  const [url, setUrl] = useState<{ file: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!file) { setUrl(null); return }
    const next = URL.createObjectURL(file); setUrl({ file, url: next })
    return () => URL.revokeObjectURL(next)
  }, [file])
  return file && url?.file === file ? url.url : null
}

type Props = { title: string; photo: PhotoInput; visible: boolean; mode: 'preview' | 'privacy' | 'features'; names?: string[]; disabled?: boolean; onChange?: (photo: PhotoInput) => void; onContinue?: () => void }
export function ImageReview({ title, photo, visible, mode, names = [], disabled = false, onChange, onContinue }: Props) {
  const url = useObjectUrl(visible ? photo.file : null)
  const [drawing, setDrawing] = useState(false), [selected, setSelected] = useState(''), [label, setLabel] = useState('')
  const [history, setHistory] = useState<SceneGraph[]>([])
  const start = useRef<{ x: number; y: number } | null>(null)
  function masks(next: Mask[]) { onChange?.({ ...photo, masks: next, confirmed: false }) }
  function edit(points: RoomObject[]) { setHistory(prev => [...prev.slice(-29), photo.graph]); onChange?.({ ...photo, graph: { room_objects: points } }) }
  function add(x = 500, y = 500) {
    let index = photo.graph.room_objects.length + 1
    while (photo.graph.room_objects.some(p => p.name.toLowerCase() === `manual detail ${index}`)) index++
    const name = label.trim() || `Manual detail ${index}`
    if (photo.graph.room_objects.some(p => p.name.toLowerCase() === name.toLowerCase())) { setSelected(name); return }
    edit([...photo.graph.room_objects, { name, x, y, width: 0, height: 0, pointOrigin: 'manual', confirmed: true }]); setSelected(name)
  }
  const chosen = photo.graph.room_objects.find(p => p.name === selected)
  let overlay: ReactNode = null
  if (mode === 'privacy' && drawing) overlay = <div className="check-draw" aria-label="Draw a privacy cover" onPointerDown={e => {
    const r = e.currentTarget.getBoundingClientRect(); start.current = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }; e.currentTarget.setPointerCapture(e.pointerId)
  }} onPointerUp={e => {
    const a = start.current; if (!a) return
    const r = e.currentTarget.getBoundingClientRect(), x = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y = Math.max(0, Math.min(1, (e.clientY - r.top) / r.height))
    if (Math.abs(x - a.x) > .01 && Math.abs(y - a.y) > .01) masks([...photo.masks, { x: Math.min(a.x, x), y: Math.min(a.y, y), w: Math.abs(x - a.x), h: Math.abs(y - a.y) }])
    start.current = null; setDrawing(false)
  }} />
  if (mode === 'features') overlay = <svg className="check-feature-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={`${title} background features`} onClick={e => {
    if (disabled || e.target !== e.currentTarget) return
    const r = e.currentTarget.getBoundingClientRect(); add(Math.round((e.clientX - r.left) / r.width * 1000), Math.round((e.clientY - r.top) / r.height * 1000))
  }}>{photo.graph.room_objects.map(p => <g key={p.name} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Select ${p.name}`} onClick={() => { if (!disabled) setSelected(p.name) }} onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelected(p.name) } }}><circle cx={p.x + p.width / 2} cy={p.y + p.height / 2} r={selected === p.name ? 14 : 9} /><text x={p.x + p.width / 2 + 14} y={p.y + p.height / 2 - 12}>{p.name}</text></g>)}</svg>
  return <section className={mode === 'preview' ? 'stack' : 'panel stack'} aria-label={`${title} ${mode}`}>
    {mode !== 'preview' && <h3>{title}</h3>}
    {url ? <div className="check-photo"><img src={url} alt={`${title} for review`} draggable={false} />{overlay}{photo.masks.map((m, i) => <span key={i} className="check-cover" style={{ left: `${m.x * 100}%`, top: `${m.y * 100}%`, width: `${m.w * 100}%`, height: `${m.h * 100}%` }} />)}{photo.pixelMask && <PixelMaskOverlay mask={photo.pixelMask} />}</div> : <div className="check-concealed">{visible ? photo.label ? 'The saved background map is available; no photograph is stored.' : 'Choose a photograph to begin.' : 'Suspicious image concealed. Local processing still works.'}</div>}
    {mode === 'privacy' && <fieldset className="check-editor-controls" disabled={disabled}>
      <div className="actions">{url && <Button variant="secondary" disabled={disabled} onClick={() => setDrawing(!drawing)}>{drawing ? 'Cancel drawing' : 'Draw privacy cover'}</Button>}<Button variant="secondary" disabled={disabled} onClick={() => masks([...photo.masks, { x: .3, y: .1, w: .4, h: .8 }])}>Add privacy cover</Button></div>
      {drawing && <p role="status">Drag across the person or private region. You can also adjust covers with the controls below.</p>}
      {photo.masks.map((m, i) => <fieldset className="check-mask-controls" key={i}><legend>Cover {i + 1}</legend>{(['x', 'y', 'w', 'h'] as const).map(key => <label key={key}>{({ x: 'Left', y: 'Top', w: 'Width', h: 'Height' })[key]} (%)<input type="range" min={0} max={100} aria-label={`${title} cover ${i + 1} ${key}`} value={Math.round(m[key] * 100)} onChange={e => {
        const next = { ...m, [key]: Number(e.target.value) / 100 }; next.w = Math.min(next.w, 1 - next.x); next.h = Math.min(next.h, 1 - next.y); masks(photo.masks.map((p, j) => j === i ? next : p))
      }} /><output>{Math.round(m[key] * 100)}</output></label>)}<Button variant="ghost" disabled={disabled} onClick={() => masks(photo.masks.filter((_, j) => j !== i))}>Remove cover {i + 1}</Button></fieldset>)}
      {photo.file && <PersonMaskControls photo={photo} visible={visible} onMask={(pixelMask: PixelMask) => onChange?.({ ...photo, pixelMask, confirmed: false })} onContinue={() => onContinue?.()} />}
      <label className="checkline"><input type="checkbox" disabled={disabled || (!!photo.pixelMask && !visible)} checked={photo.confirmed} onChange={e => onChange?.({ ...photo, confirmed: e.target.checked })} /><span>I reviewed these exclusions, or confirm no cover is needed. {!visible && 'Concealed covers require a privacy warning and explicit reveal before review.'}</span></label>
    </fieldset>}
    {mode === 'features' && <fieldset className="check-editor-controls stack" disabled={disabled}>
      <label className="field"><span>Detail to adjust or remove</span><select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select a detail</option>{photo.graph.room_objects.map(p => <option key={p.name}>{p.name}</option>)}</select></label>
      {chosen && <><p className="muted">Position in image (%)</p>{(['x', 'y'] as const).map(key => <label className="field" key={key}><span>{key === 'x' ? 'Horizontal' : 'Vertical'}</span><input type="number" min={0} max={100} value={chosen[key] / 10} onChange={e => {
        const value = Number(e.target.value); if (Number.isFinite(value)) edit(photo.graph.room_objects.map(p => p.name === selected ? { ...p, [key]: Math.max(0, Math.min(100, value)) * 10, width: 0, height: 0, pointOrigin: 'manual', confirmed: true } : p))
      }} /></label>)}<Button variant="ghost" disabled={disabled} onClick={() => { edit(photo.graph.room_objects.filter(p => p.name !== selected)); setSelected('') }}>Remove selected detail</Button></>}
      <label className="field"><span>New detail label (reuse for the same detail in the other image)</span><input value={label} list={`details-${title.replaceAll(' ', '-')}`} onChange={e => setLabel(e.target.value)} /><datalist id={`details-${title.replaceAll(' ', '-')}`}>{names.map(name => <option key={name} value={name} />)}</datalist></label>
      <p className="muted">Click the photograph to place a detail, or add it at the center and adjust its position. Covered details are excluded.</p>
      <div className="actions"><Button variant="secondary" disabled={disabled} onClick={() => add()}>Add detail</Button><Button variant="secondary" disabled={disabled || !history.length} onClick={() => { const previous = history[history.length - 1]; if (previous) { onChange?.({ ...photo, graph: previous }); setHistory(history.slice(0, -1)) } }}>Undo edit</Button></div>
    </fieldset>}
  </section>
}

function PixelMaskOverlay({ mask }: { mask: PixelMask }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current, context = canvas?.getContext('2d')
    if (!canvas || !context) return
    canvas.width = mask.width; canvas.height = mask.height
    const image = context.createImageData(mask.width, mask.height)
    for (let index = 0; index < mask.data.length; index++) if (mask.data[index]) {
      const pixel = index * 4; image.data[pixel] = 0; image.data[pixel + 1] = 0; image.data[pixel + 2] = 0; image.data[pixel + 3] = 255
    }
    context.putImageData(image, 0, 0)
  }, [mask])
  return <canvas ref={ref} className="check-pixel-mask" aria-label="Opaque pixel-level person mask" />
}
