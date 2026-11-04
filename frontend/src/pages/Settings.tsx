import { useState } from 'react'
import { Button, Dialog, PageHeader, usePageTitle } from '../components/ui'
import { reviewStore, sceneStore, settingsStore } from '../lib/storage'
import type { Settings as SettingsShape } from '../lib/types'
import { clearCheckSession } from '../lib/checkSession'
import { useCaseRecord } from '../components/case'

export function Settings() {
  const { setRecord } = useCaseRecord()
  usePageTitle('Settings')
  const [settings, setSettings] = useState<SettingsShape>(() => settingsStore().load())
  const [scenes, setScenes] = useState(() => sceneStore().list().length)
  const [notes, setNotes] = useState(() => reviewStore().list().length)
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState('')

  function update(next: SettingsShape) {
    settingsStore().save(next)
    setSettings(next)
  }

  function clearScenes() {
    sceneStore().clear()
    setScenes(0)
    setOpen(false)
    setMessage('Saved scene graphs were removed from this tab session. Photographs were not stored, so none were deleted.')
  }

  function clearNotes() {
    reviewStore().clear()
    setNotes(0)
    setMessage('Private notes were removed from this tab session.')
  }

  return (
    <div className="page settings-page">
      <PageHeader
        eyebrow="Settings"
        title="Privacy on this device"
        lede="Comparisons run in this browser. Guest scene graphs, notes, drafts, and results are kept in this tab session; optional AI mapping sends image data to the configured model provider only after separate consent."
      />
      <div className="settings-layout">
        <section className="settings-section panel">
          <p className="eyebrow">01 · Privacy and data</p><h2>Verification choices</h2>
        <label className="checkline settings-control">
          <input
            type="checkbox"
            checked={settings.blindMode}
            onChange={(event) => update({ ...settings, blindMode: event.target.checked })}
          />
          <span>Start checks with Blind Mode on. With Blind Mode off, a suspicious photo is shown for mapping only after you acknowledge viewing.</span>
        </label>
        <label className="checkline settings-control">
          <input
            type="checkbox"
            checked={settings.pythonEngine}
            onChange={(event) => update({ ...settings, pythonEngine: event.target.checked })}
          />
          <span>Also compare scene graphs with the local Python engine at 127.0.0.1. Only graphs are sent, and only to this computer. Leave this off unless that engine is running.</span>
        </label>
        </section>
        <section className="panel settings-section">
          <h2>What is stored</h2>
          <ul className="limits">
            <li>{scenes} scene graph{scenes === 1 ? '' : 's'}, including object positions, an optional mask rectangle, and a file hash when one was computed</li>
            <li>{notes} private note{notes === 1 ? '' : 's'}</li>
            <li>The latest comparison, in this tab only, until you close it</li>
          </ul>
          <h2>What is not stored</h2>
          <ul className="limits">
            <li>Photograph pixels saved to browser storage or written to disk by the local backend</li>
            <li>Face or body measurements</li>
            <li>Face or body embeddings in the configured Stillpoint backend</li>
          </ul>
          <h2>Optional model processing</h2>
          <p className="muted">AI-assisted mapping creates a downscaled JPEG in this browser and removes image metadata. Scene mapping sends the masked image; person detection sends the image with the person visible. Both requests pass through the local backend and then to the configured model endpoint. The local backend handles request bytes in memory and does not write them to disk or log request bodies. Stillpoint cannot verify or control the model provider’s retention, training, or backup practices. Use manual mapping if you do not want image data sent to that provider.</p>
        </section>
        <section className="panel settings-section">
          <h2>Engine rules</h2>
          <p className="muted">A shared object counts as aligned when its center moves fewer than 25 units on a 0ΓÇô1000 scale. With at least 4 shared objects, 80% or more aligned is Likely derivative. 40% or less is No link found. Anything else is Cannot determine.</p>
          <p className="muted">AI-assisted mapping needs the local backend at 127.0.0.1:8787 and a configured model key; otherwise manual mapping is the working path. Room scan and sealed identity verification are not available in this build.</p>
        </section>
        <section className="panel settings-section">
          <p className="eyebrow">03 · Session management</p><h2>Remove local records</h2>
          <p className="muted">{scenes} saved scene graphs and {notes} private notes are currently available in this tab session. Deletion cannot remove photographs that were never stored.</p>
        <div className="actions">
          <Button onClick={() => setOpen(true)}>Delete saved scene graphs</Button>
          <Button variant="secondary" onClick={clearNotes}>Delete private notes</Button>
          <Button variant="secondary" onClick={() => { clearCheckSession(); setRecord(null); setMessage('Temporary Check photographs, redacted Proof previews, and comparison results were cleared from this tab.') }}>Delete temporary comparison images</Button>
        </div>
        </section>
        <section className="settings-section settings-about"><p className="eyebrow">04 · Application information</p><h2>Stillpoint, in this build</h2><p className="muted">Room scan, sealed identity verification, external identity checks, and a connected reviewer service are not available. AI mapping is optional; manual mapping remains available.</p></section>
        {message && <p role="status" className="settings-message">{message}</p>}
      </div>
      <Dialog open={open} title="Delete saved scene graphs?" confirmLabel="Delete" onConfirm={clearScenes} onClose={() => setOpen(false)}>
          <p className="muted">This removes scene graphs from this tab session. It cannot delete a photograph Stillpoint never stored.</p>
      </Dialog>
    </div>
  )
}
