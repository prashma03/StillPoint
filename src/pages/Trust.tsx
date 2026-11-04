import { useState } from 'react'
import { Button, Dialog, PageHeader, usePageTitle } from '../components/ui'
import { PUNISHMENT_RULE, SCIENCE_LIMIT } from '../lib/report'
import { reviewStore } from '../lib/storage'
import type { ReviewNote } from '../lib/types'

const categories = [
  {
    title: 'Original-file possession',
    body: 'You can show that a file was on your device by keeping its scene graph and file hash here. This build does not ask a third party to certify that possession.',
  },
  {
    title: 'Scene provenance or optional room access',
    body: 'A scene graph records background layout. A live room scan could add context, and it is optional because someone may no longer have access to the place. Room scan is not available in this build.',
  },
  {
    title: 'Optional sealed identity verification',
    body: 'A separate check could speak to identity without showing a photograph to a reviewer. That workflow is not built. Nothing here performs identity verification.',
  },
  {
    title: 'Accountable non-consent statement',
    body: 'A person can write that sharing was without consent. In this build the statement stays on the device. It is not witnessed, signed, or sent.',
  },
]

export function Trust() {
  usePageTitle('Trust')
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<ReviewNote['kind']>('appeal')
  const [note, setNote] = useState('')
  const [saved, setSaved] = useState('')

  function save() {
    reviewStore().save({
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      kind,
      note: note.trim(),
      caseId: null,
    })
    setSaved('Saved on this device. It was not sent anywhere.')
    setNote('')
    setOpen(false)
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Trust"
        title="How Stillpoint protects both sides."
        lede="These are supporting evidence categories. They have different limits. No one has to complete all four."
      />
      <div className="stack">
        {categories.map((item, index) => (
          <article key={item.title} className="key">
            <span className="key-n">{index + 1}</span>
            <div>
              <h2>{item.title}</h2>
              <p className="muted">{item.body}</p>
            </div>
          </article>
        ))}
        <p className="note rule">{PUNISHMENT_RULE}</p>
        <section>
          <h2>Conflicting claims</h2>
          <p className="muted">If two people claim the same material, a person should pause and review before anyone acts. This build does not detect conflicts and does not take action against anyone.</p>
        </section>
        <section>
          <h2>Appeal and counter-notice</h2>
          <p className="muted">Someone who is affected should be able to respond. You can save an appeal or counter-notice on this device. There is no reviewer inbox attached.</p>
          <Button variant="secondary" onClick={() => setOpen(true)}>Save a private note</Button>
          {saved && <p role="status">{saved}</p>}
        </section>
        <section>
          <h2>Evidence retention</h2>
          <p className="muted">Scene graphs, mask rectangles, file hashes, and notes stay in this browser until you delete them in Settings. Photographs are not stored. There is no server copy.</p>
        </section>
        <section>
          <h2>Privacy controls</h2>
          <p className="muted">Blind Mode hides the suspicious file. Deletion removes the saved records. The app does not include analytics.</p>
          <p className="muted">Masking keeps the person out of analysis but cannot guarantee anonymization: backgrounds and other details may still be identifying.</p>
          <Button to="/settings" variant="secondary">Open settings</Button>
        </section>
        <section>
          <h2>Verification limitations</h2>
          <p className="note">{SCIENCE_LIMIT}</p>
          <p className="muted">The engine compares named background positions. It does not identify a face, decide consent, or name who made an edit. A replaced background cannot be matched, and that case is not detected automatically.</p>
        </section>
        <section>
          <h2>Human review</h2>
          <p className="muted">A person should look at a case before any account or content decision. Human review is not connected in this build.</p>
          <Button to="/test" variant="ghost">Test a scene graph</Button>
        </section>
      </div>
      <Dialog open={open} title="Private note" confirmLabel="Save on this device" onConfirm={save} onClose={() => setOpen(false)}>
        <label className="field">
          <span className="field-label">Kind</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as ReviewNote['kind'])}>
            <option value="appeal">Appeal</option>
            <option value="counter-notice">Counter-notice</option>
            <option value="review">Review note</option>
          </select>
        </label>
        <label className="field">
          <span className="field-label">Note</span>
          <textarea value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
      </Dialog>
    </div>
  )
}
