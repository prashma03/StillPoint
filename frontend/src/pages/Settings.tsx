import { useState } from 'react'
import { Button, Dialog, PageHeader, usePageTitle } from '../components/ui'
import {
  checkDraftHasWork,
  clearCheckDraft,
  clearProtectDraft,
  draftHasWork,
  draftMemory,
  loadCheckDraft,
  loadProtectDraft,
} from '../lib/draft'
import { photoVault } from '../lib/images'
import { reviewStore, sceneStore, settingsStore } from '../lib/storage'
import type { Settings as SettingsShape } from '../lib/types'

type DraftInfo = { label: string; savedAt: string; photo: boolean } | null

function describeDrafts(): { protect: DraftInfo; check: DraftInfo } {
  const memory = draftMemory()
  const protect = loadProtectDraft(memory)
  const check = loadCheckDraft(memory)
  return {
    protect:
      protect && draftHasWork(protect)
        ? { label: protect.label, savedAt: protect.savedAt, photo: protect.photoVault !== null }
        : null,
    check:
      check && checkDraftHasWork(check)
        ? { label: check.suspectName ?? 'Untitled check', savedAt: check.savedAt, photo: check.photoVault !== null }
        : null,
  }
}

export function Settings() {
  usePageTitle('Settings')
  const [settings, setSettings] = useState<SettingsShape>(() => settingsStore().load())
  const [scenes, setScenes] = useState(() => sceneStore().list().length)
  const [notes, setNotes] = useState(() => reviewStore().list().length)
  const [drafts, setDrafts] = useState(describeDrafts)
  const [open, setOpen] = useState(false)
  const [draftsOpen, setDraftsOpen] = useState(false)
  const [message, setMessage] = useState('')

  function update(next: SettingsShape) {
    settingsStore().save(next)
    setSettings(next)
  }

  function clearScenes() {
    sceneStore().clear()
    setScenes(0)
    setOpen(false)
    setMessage('Saved scene graphs were removed from this browser. Photographs were not stored, so none were deleted.')
  }

  function clearNotes() {
    reviewStore().clear()
    setNotes(0)
    setMessage('Private notes were removed from this browser.')
  }

  function clearDrafts() {
    const memory = draftMemory()
    clearProtectDraft(memory)
    clearCheckDraft(memory)
    void photoVault().clear().catch(() => {})
    setDrafts({ protect: null, check: null })
    setDraftsOpen(false)
    setMessage('Drafts and any photos kept for them were removed from this browser.')
  }

  return (
    <div className="page">
      <PageHeader
        eyebrow="Settings"
        title="Privacy on this device"
        lede="Stillpoint keeps scene graphs in this browser. It does not upload photographs."
      />
      <div className="stack">
        <label className="checkline">
          <input
            type="checkbox"
            checked={settings.blindMode}
            onChange={(event) => update({ ...settings, blindMode: event.target.checked })}
          />
          <span>Start checks with Blind Mode on. With Blind Mode off, a suspicious photo is shown for mapping only after you acknowledge viewing.</span>
        </label>
        <label className="checkline">
          <input
            type="checkbox"
            checked={settings.pythonEngine}
            onChange={(event) => update({ ...settings, pythonEngine: event.target.checked })}
          />
          <span>Also compare scene graphs with the local Python engine at 127.0.0.1. Only graphs are sent, and only to this computer. Leave this off unless that engine is running.</span>
        </label>
        <section className="panel">
          <h2>What is stored</h2>
          <ul className="limits">
            <li>{scenes} scene graph{scenes === 1 ? '' : 's'}, including object positions, an optional mask rectangle, and a file hash when one was computed</li>
            <li>{notes} private note{notes === 1 ? '' : 's'}</li>
            <li>
              {drafts.protect ? `Protect draft “${drafts.protect.label}”` : 'No Protect draft'}
              {drafts.protect ? `, saved ${new Date(drafts.protect.savedAt).toLocaleString()}${drafts.protect.photo ? ', photo kept on this device' : ''}` : ''}
            </li>
            <li>
              {drafts.check ? `Check draft “${drafts.check.label}”` : 'No Check draft'}
              {drafts.check ? `, saved ${new Date(drafts.check.savedAt).toLocaleString()}${drafts.check.photo ? ', photo kept on this device' : ''}` : ''}
            </li>
            <li>The latest comparison, in this tab only, until you close it</li>
          </ul>
          <h2>What is not stored</h2>
          <ul className="limits">
            <li>Photograph pixels, unless you enabled photo storage for a draft</li>
            <li>Face or body measurements</li>
            <li>Consents or viewing acknowledgments</li>
            <li>A copy on a server</li>
          </ul>
        </section>
        <section className="panel">
          <h2>Engine rules</h2>
          <p className="muted">A shared object counts as aligned when its center moves fewer than 25 units on a 0–1000 scale. With at least 4 shared objects, 80% or more aligned is Likely derivative. 40% or less is No link found. Anything else is Cannot determine.</p>
          <p className="muted">AI-assisted mapping needs the local backend at 127.0.0.1:8787 and a configured model key; otherwise manual mapping is the working path. Room scan and sealed identity verification are not available in this build.</p>
        </section>
        {message && <p role="status">{message}</p>}
        <div className="actions">
          <Button onClick={() => setOpen(true)}>Delete saved scene graphs</Button>
          <Button variant="secondary" onClick={clearNotes}>Delete private notes</Button>
          <Button variant="secondary" onClick={() => setDraftsOpen(true)} disabled={!drafts.protect && !drafts.check}>Delete drafts</Button>
        </div>
      </div>
      <Dialog open={open} title="Delete saved scene graphs?" confirmLabel="Delete" onConfirm={clearScenes} onClose={() => setOpen(false)}>
        <p className="muted">This removes scene graphs from this browser. It cannot delete a photograph Stillpoint never stored.</p>
      </Dialog>
      <Dialog open={draftsOpen} title="Delete drafts?" confirmLabel="Delete drafts" onConfirm={clearDrafts} onClose={() => setDraftsOpen(false)}>
        <p className="muted">This removes unfinished Protect and Check drafts, including any photos kept for them. Saved scenes stay untouched.</p>
      </Dialog>
    </div>
  )
}
