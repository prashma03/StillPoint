import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { Button } from './ui'
import type { PhotoInput } from '../lib/checkSession'
import type { Mask, RoomObject, SceneGraph } from '../lib/types'
import type { PixelMask } from '../lib/checkSession'
import { PersonMaskControls } from './PersonMaskControls'
import { settingsStore } from '../lib/storage'

export function useObjectUrl(file: Blob | null) {
  const [url, setUrl] = useState<{ file: Blob; url: string } | null>(null)
  useEffect(() => {
    if (!file) { setUrl(null); return }
    const next = URL.createObjectURL(file); setUrl({ file, url: next })
    return () => URL.revokeObjectURL(next)
  }, [file])
  return file && url?.file === file ? url.url : null
}

type Props = { title: string; photo: PhotoInput; visible: boolean; mode: 'preview' | 'privacy' | 'features'; names?: string[]; disabled?: boolean; compact?: boolean; onChange?: (photo: PhotoInput) => void }
export function ImageReview({ title, photo, visible, mode, names = [], disabled = false, compact = false, onChange }: Props) {
  const [imageAspect, setImageAspect] = useState(1)
  const [manualMasking, setManualMasking] = useState(false), [revealed, setRevealed] = useState(false)
  const [maskMode, setMaskMode] = useState<'automatic' | 'manual'>(() => settingsStore().load().maskingPreference === 'manual' ? 'manual' : 'automatic')
  const [selectedMask, setSelectedMask] = useState<number | null>(null)
  const url = useObjectUrl((visible || (mode === 'privacy' && manualMasking && revealed)) ? photo.file : null)
  const [selected, setSelected] = useState(''), [label, setLabel] = useState('')
  const [history, setHistory] = useState<SceneGraph[]>([])
  const frame = useRef<HTMLDivElement>(null)
  const gesture = useRef<{ pointerId: number; index: number; kind: 'move' | 'resize'; edges: string; startX: number; startY: number; initial: Mask } | null>(null)
  const pct = (value: number) => `${Number((value * 100).toFixed(5))}%`
  useEffect(() => {
    const manualDefault = settingsStore().load().maskingPreference === 'manual'
    setManualMasking(manualDefault)
    setRevealed(false)
    setMaskMode(manualDefault ? 'manual' : 'automatic')
    setSelectedMask(manualDefault && photo.masks.length ? photo.masks.length - 1 : null)
    gesture.current = null
    if (manualDefault && photo.file && !photo.masks.length) {
      onChange?.({ ...photo, masks: [{ x: .3, y: .18, w: .4, h: .55 }], confirmed: false })
      setSelectedMask(0)
    }
  }, [photo.file, photo.hash])
  function masks(next: Mask[]) { onChange?.({ ...photo, masks: next, confirmed: false }) }
  function beginManualMasking() {
    setManualMasking(true)
    setMaskMode('manual')
    if (!photo.masks.length) { masks([{ x: .3, y: .18, w: .4, h: .55 }]); setSelectedMask(0) }
    else setSelectedMask(Math.max(0, photo.masks.length - 1))
  }
  function addMask() {
    const next = [...photo.masks, { x: .32, y: .2, w: .36, h: .5 }]
    masks(next); setSelectedMask(next.length - 1); setManualMasking(true)
  }
  function pointerPosition(event: ReactPointerEvent) {
    const rect = frame.current?.getBoundingClientRect()
    if (!rect || !rect.width || !rect.height) return null
    return { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) }
  }
  function startMaskGesture(event: ReactPointerEvent<HTMLElement>, index: number) {
    if (disabled || !frame.current) return
    const position = pointerPosition(event)
    if (!position) return
    event.preventDefault(); event.stopPropagation()
    const handle = (event.target as HTMLElement).closest<HTMLElement>('[data-mask-edge]')
    const shell = event.currentTarget.closest<HTMLDivElement>('.check-cover')
    if (!shell) return
    shell.setPointerCapture(event.pointerId)
    setSelectedMask(index)
    gesture.current = { pointerId: event.pointerId, index, kind: handle ? 'resize' : 'move', edges: handle?.dataset.maskEdge ?? '', startX: position.x, startY: position.y, initial: { ...photo.masks[index] } }
  }
  function moveMaskGesture(event: React.PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active || active.pointerId !== event.pointerId) return
    const position = pointerPosition(event)
    if (!position) return
    const dx = position.x - active.startX, dy = position.y - active.startY, initial = active.initial
    let next = { ...initial }
    if (active.kind === 'move') {
      next.x = Math.max(0, Math.min(1 - initial.w, initial.x + dx))
      next.y = Math.max(0, Math.min(1 - initial.h, initial.y + dy))
    } else {
      const min = .025
      let left = initial.x, right = initial.x + initial.w, top = initial.y, bottom = initial.y + initial.h
      if (active.edges.includes('w')) left = Math.max(0, Math.min(right - min, left + dx))
      if (active.edges.includes('e')) right = Math.min(1, Math.max(left + min, right + dx))
      if (active.edges.includes('n')) top = Math.max(0, Math.min(bottom - min, top + dy))
      if (active.edges.includes('s')) bottom = Math.min(1, Math.max(top + min, bottom + dy))
      next = { x: left, y: top, w: right - left, h: bottom - top }
    }
    masks(photo.masks.map((item, i) => i === active.index ? next : item))
  }
  function edit(points: RoomObject[]) { setHistory(prev => [...prev.slice(-29), photo.graph]); onChange?.({ ...photo, graph: { room_objects: points } }) }
  function add(x = 500, y = 500) {
    let index = photo.graph.room_objects.length + 1
    while (photo.graph.room_objects.some(p => p.name.toLowerCase() === `manual detail ${index}`)) index++
    const name = label.trim() || `Manual detail ${index}`
    if (photo.graph.room_objects.some(p => p.name.toLowerCase() === name.toLowerCase())) { setSelected(name); return }
    edit([...photo.graph.room_objects, { name, x, y, width: 0, height: 0, pointOrigin: 'manual', confirmed: true }]); setSelected(name)
  }
  function removeSelected() {
    if (disabled || !photo.graph.room_objects.some(p => p.name === selected)) return
    edit(photo.graph.room_objects.filter(p => p.name !== selected)); setSelected('')
  }
  const chosen = photo.graph.room_objects.find(p => p.name === selected)
  let overlay: ReactNode = null
  if (mode === 'features') overlay = <svg className="check-feature-layer" viewBox="0 0 1000 1000" preserveAspectRatio="none" aria-label={`${title} background features`} onClick={e => {
    if (disabled || e.target !== e.currentTarget) return
    const r = e.currentTarget.getBoundingClientRect(); add(Math.round((e.clientX - r.left) / r.width * 1000), Math.round((e.clientY - r.top) / r.height * 1000))
    }}>{photo.graph.room_objects.map(p => <g key={p.name} role="button" tabIndex={disabled ? -1 : 0} aria-label={`Select ${p.name}`} aria-pressed={selected === p.name} onClick={e => { if (!disabled) { setSelected(p.name); e.currentTarget.focus() } }} onKeyDown={e => { if (!disabled && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); setSelected(p.name) } }}><circle cx={p.x + p.width / 2} cy={p.y + p.height / 2} r={selected === p.name ? 14 : 9} /><text x={p.x + p.width / 2 + 14} y={p.y + p.height / 2 - 12}>{p.name}</text></g>)}</svg>
  return <section className={mode === 'preview' ? 'stack' : 'panel stack'} aria-label={`${title} ${mode}`} onKeyDown={e => {
    if (mode !== 'features' || disabled || !chosen || (e.key !== 'Backspace' && e.key !== 'Delete') || e.altKey || e.ctrlKey || e.metaKey) return
    const target = e.target as Element
    if (target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return
    e.preventDefault(); e.stopPropagation(); removeSelected()
  }}>
    {mode !== 'preview' && <h3>{title}</h3>}
    {url ? <div className={`check-photo${manualMasking ? ' check-photo-mask-editing' : ''}`} ref={frame} style={compact && mode === 'preview' ? { width: '100%', maxWidth: `${160 * imageAspect}px`, marginInline: 'auto' } : undefined}><img src={url} alt={`${title} for review`} draggable={false} onLoad={e => { const image = e.currentTarget; if (image.naturalWidth && image.naturalHeight) setImageAspect(image.naturalWidth / image.naturalHeight) }} />{overlay}{mode === 'features' && chosen && !disabled && <button type="button" className="check-detail-remove" aria-label={`Remove ${chosen.name}`} title="Remove detail (Backspace or Delete)" style={{ left: `${Math.max(8, Math.min(92, (chosen.x + chosen.width / 2) / 10))}%`, top: `${Math.max(2, Math.min(85, (chosen.y + chosen.height / 2) / 10))}%` }} onClick={removeSelected}>Remove</button>}{photo.masks.map((m, i) => <div key={i} className={`check-cover${manualMasking && selectedMask === i ? ' is-selected' : ''}`} role={manualMasking ? 'group' : undefined} aria-label={manualMasking ? `Mask ${i + 1}; drag to move, use handles to resize` : undefined} tabIndex={manualMasking && !disabled ? 0 : undefined} onPointerDown={manualMasking ? e => startMaskGesture(e, i) : undefined} onPointerMove={manualMasking ? moveMaskGesture : undefined} onPointerUp={manualMasking ? e => { if (gesture.current?.pointerId === e.pointerId) gesture.current = null; if (typeof e.currentTarget.hasPointerCapture === 'function' && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId) } : undefined} onPointerCancel={() => { gesture.current = null }} onKeyDown={manualMasking ? e => { if (disabled) return; const target = e.target as HTMLElement; if ((e.key === 'Backspace' || e.key === 'Delete') && !target.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) { e.preventDefault(); const remaining = photo.masks.filter((_, j) => j !== i); masks(remaining); setSelectedMask(remaining.length ? Math.min(i, remaining.length - 1) : null); return } const step = e.shiftKey ? .025 : .005; const next = { ...photo.masks[i] }; if (e.key === 'ArrowLeft') next.x = Math.max(0, next.x - step); else if (e.key === 'ArrowRight') next.x = Math.min(1 - next.w, next.x + step); else if (e.key === 'ArrowUp') next.y = Math.max(0, next.y - step); else if (e.key === 'ArrowDown') next.y = Math.min(1 - next.h, next.y + step); else return; e.preventDefault(); masks(photo.masks.map((item, j) => j === i ? next : item)) } : undefined} style={{ left: pct(m.x), top: pct(m.y), width: pct(m.w), height: pct(m.h) }}>
      {manualMasking && selectedMask === i && !disabled && ['nw','n','ne','e','se','s','sw','w'].map(edge => <button key={edge} className={`check-mask-handle check-mask-handle-${edge}`} data-mask-edge={edge} type="button" aria-label={`Resize mask ${i + 1} ${edge}`} onPointerDown={e => startMaskGesture(e, i)} />)}
    </div>)}{photo.pixelMask && <PixelMaskOverlay mask={photo.pixelMask} />}</div> : <div className="check-concealed">{visible ? photo.label ? 'The saved background map is available; no photograph is stored.' : 'Choose a photograph to begin.' : 'Suspicious image concealed. Local processing still works.'}</div>}
    {mode === 'privacy' && <fieldset className="check-editor-controls mask-review-controls" disabled={disabled}>
      <PersonMaskControls photo={photo} mode={maskMode} canManual={!!photo.file} onMode={next => { setMaskMode(next); if (next === 'automatic' && (photo.pixelMask || photo.masks.length)) setManualMasking(true) }} onManual={beginManualMasking} onAutomatic={() => setManualMasking(true)} onMask={(pixelMask: PixelMask) => onChange?.({ ...photo, pixelMask, confirmed: false })} />
      {manualMasking && !visible && !revealed && <div className="note" role="status">Blind Mode keeps this photograph concealed. An opaque rectangle is ready. Reveal is optional and only enables you to position it visually.<label className="checkline"><input type="checkbox" checked={revealed} onChange={e => setRevealed(e.target.checked)} /><span>I choose to reveal this suspicious photograph for mask positioning.</span></label></div>}
      {manualMasking && <div className="mask-rectangle-tools"><div className="actions"><Button variant="secondary" onClick={addMask}>Add Another Rectangle</Button><Button variant="ghost" disabled={selectedMask === null} onClick={() => { if (selectedMask === null) return; masks(photo.masks.filter((_, i) => i !== selectedMask)); setSelectedMask(null) }}>Remove selected</Button><Button variant="ghost" disabled={!photo.masks.length} onClick={() => { masks([]); setSelectedMask(null) }}>Reset rectangles</Button></div><p className="muted">Rectangles are fully opaque and excluded from local feature extraction. Drag one to move it; use its cyan handles to resize.</p></div>}
      <label className="checkline mask-confirm"><input type="checkbox" disabled={disabled} checked={photo.confirmed} onChange={e => onChange?.({ ...photo, confirmed: e.target.checked })} /><span>I reviewed this mask and confirm the areas to exclude. {!visible && 'The concealed image has not been visually reviewed.'}</span></label>
    </fieldset>}
    {mode === 'features' && <fieldset className="check-editor-controls stack" disabled={disabled}>
      <label className="field"><span>Detail to adjust or remove</span><select value={selected} onChange={e => setSelected(e.target.value)}><option value="">Select a detail</option>{photo.graph.room_objects.map(p => <option key={p.name}>{p.name}</option>)}</select></label>
      {chosen && <><p className="muted">Position in image (%)</p>{(['x', 'y'] as const).map(key => <label className="field" key={key}><span>{key === 'x' ? 'Horizontal' : 'Vertical'}</span><input type="number" min={0} max={100} value={chosen[key] / 10} onChange={e => {
        const value = Number(e.target.value); if (Number.isFinite(value)) edit(photo.graph.room_objects.map(p => p.name === selected ? { ...p, [key]: Math.max(0, Math.min(100, value)) * 10, width: 0, height: 0, pointOrigin: 'manual', confirmed: true } : p))
      }} /></label>)}<Button variant="ghost" disabled={disabled} onClick={removeSelected}>Remove selected detail</Button></>}
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
