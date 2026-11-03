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
  takenNames: Set<string>
  onAdd: (obj: RoomObject) => void
}

/**
 * Local detail proposals. Classical edge-density regions found on-device;
 * the user labels each one with a real background name or discards it.
 * Proposals come only from outside the person mask. Nothing is uploaded.
 */
export function ProposalAssist({ file, mask, maskConfirmed, takenNames, onAdd }: Props) {
  const [working, setWorking] = useState(false)
  const [error, setError] = useState('')
  const [proposals, setProposals] = useState<
    { x: number; y: number; width: number; height: number; score: number; label: string; done: boolean }[]
  >([])
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
        setProposals([])
        return
      }
      setProposals(
        outcome.proposals.map((item) => ({ ...item, label: STABLE_OBJECTS[0], done: false })),
      )
      setNote(outcome.detail_note)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Analysis failed. Manual points below still work.')
      setProposals([])
    } finally {
      setWorking(false)
    }
  }

  function add(index: number) {
    const item = proposals[index]
    if (!item || item.done) return
    onAdd({ name: item.label, x: item.x, y: item.y, width: item.width, height: item.height })
    setProposals((current) => current.map((entry, i) => (i === index ? { ...entry, done: true } : entry)))
  }

  function discard(index: number) {
    setProposals((current) => current.filter((_, i) => i !== index))
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
      {proposals.length > 0 && (
        <ul className="object-list">
          {proposals.map((item, index) => (
            <li key={`${item.x}-${item.y}-${index}`}>
              <span>
                Region {index + 1} · score {item.score.toFixed(2)}
                {item.done ? ' · added' : ''}
                {takenNames.has(item.label) && !item.done ? ` · “${item.label}” is already used` : ''}
              </span>
              {!item.done && (
                <span className="actions">
                  <select
                    aria-label={`Label for region ${index + 1}`}
                    value={item.label}
                    onChange={(event) =>
                      setProposals((current) =>
                        current.map((entry, i) => (i === index ? { ...entry, label: event.target.value } : entry)),
                      )
                    }
                  >
                    {STABLE_OBJECTS.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <button className="btn btn-secondary" type="button" onClick={() => add(index)}>
                    Add
                  </button>
                  <button className="btn btn-ghost" type="button" onClick={() => discard(index)}>
                    Discard
                  </button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
