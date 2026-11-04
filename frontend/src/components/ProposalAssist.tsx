import { useState } from 'react'
import { analyzeBuffer } from '../lib/analysis'
import { STABLE_OBJECTS } from '../lib/graphs'
import { decodeToPixels } from '../lib/redact'
import type { Mask, RoomObject } from '../lib/types'
import { Button } from './ui'

type Props = {
  file: File | null
  mask: Mask | null
  maskConfirmed: boolean
  takenNames?: Set<string>
  onAdd?: (obj: RoomObject) => void
  onSuggestions?: (regions: { x: number; y: number; width: number; height: number }[]) => void
  visualOnly?: boolean
}

/**
 * Local detail proposals. Classical edge-density regions found on-device;
 * the user labels each one with a real background name or discards it.
 * Proposals come only from outside the person mask. Nothing is uploaded.
 */
export function ProposalAssist({ file, mask, maskConfirmed, takenNames = new Set(), onAdd, onSuggestions, visualOnly = false }: Props) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [count, setCount] = useState(0)
  const [proposals, setProposals] = useState<{ x: number; y: number; width: number; height: number; label: string; done: boolean }[]>([])
  const [note, setNote] = useState('')

  async function run() {
    if (!file) return
    setWorking(true)
    setError('')
    setNote('')
    try {
      const pixels = await decodeToPixels(file)
      const outcome = analyzeBuffer(pixels.data, pixels.width, pixels.height, mask, maskConfirmed)
      if (!outcome.ok) {
        setError(`${outcome.error.message} Manual points below still work.`)
        setCount(0)
        return
      }
      const regions = outcome.proposals.map(({ x, y, width, height }) => ({ x, y, width, height }))
      setCount(regions.length)
      setProposals(regions.map((item) => ({ ...item, label: '', done: false })))
      onSuggestions?.(regions)
      setNote(regions.length === 0 ? 'No clear background regions found. You can mark features by hand.' : outcome.detail_note)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Manual points below still work.')
      setCount(0)
    } finally {
      setWorking(false)
    }
  }

  function add(index: number) {
    const item = proposals[index]
    if (!item || item.done || !onAdd) return
    onAdd({ name: item.label, x: item.x, y: item.y, width: item.width, height: item.height })
    setProposals((current) => current.map((entry, i) => i === index ? { ...entry, done: true } : entry))
  }

  return (
    <section className="stack" aria-label="Local detail proposals, experimental">
      <h2>Background proposals · on-device</h2>
      <p className="muted">
        Finds detailed regions outside the mask using local edge detection — not object recognition.
        You label each region; nothing is uploaded.
      </p>
      <div className="actions">
        <Button onClick={() => void run()} disabled={working || !file || !maskConfirmed}>
          {working ? 'Scanning…' : 'Find background regions'}
        </Button>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {note && !error && <p role="status">{note}</p>}
      {visualOnly && count > 0 && <p role="status" className="muted">{count} regions marked on the photo as unidentified suggestions. Accept, relabel, or dismiss each one there.</p>}
      {!visualOnly && proposals.length > 0 && <ul className="object-list">{proposals.map((item, index) => <li key={`${item.x}-${item.y}-${index}`}><span>Unidentified region {index + 1}{item.done ? ' · added' : ''}{takenNames.has(item.label) && !item.done ? ` · “${item.label}” is already used` : ''}</span>{!item.done && <span className="actions"><select aria-label={`Label for region ${index + 1}`} value={item.label} onChange={(event) => setProposals((current) => current.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry))}><option value="">Choose a category</option>{STABLE_OBJECTS.map((name) => <option key={name} value={name}>{name}</option>)}</select><button className="btn btn-secondary" type="button" disabled={!item.label} onClick={() => add(index)}>Add</button><button className="btn btn-ghost" type="button" onClick={() => setProposals((current) => current.filter((_, i) => i !== index))}>Dismiss</button></span>}</li>)}</ul>}
    </section>
  )
}
