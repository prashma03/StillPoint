import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AdvancedCheck } from './AdvancedCheck'
import { Button, PageHeader, usePageTitle } from '../components/ui'
import { useCaseRecord } from '../components/case'
import { ImageReview } from '../components/ImageReview'
import { runCheck } from '../lib/check'
import { clearCheckSession, clearProofMedia, emptyCheck, emptyPhoto, getCheckSession, proofNeedsViewingChoice, saveCheckSession, setProofMedia, type CheckSession, type PhotoInput } from '../lib/checkSession'
import { backgroundOnly, matchPhotographs, photoFileError } from '../lib/photoCompare'
import { decodeToPixels, redactImage } from '../lib/redact'
import { sha256 } from '../lib/hash'
import { sceneStore, settingsStore } from '../lib/storage'
import { verifyWithPython } from '../lib/engine'
import { takeDiscoveryHandoff } from '../lib/discover'
import type { StageUpdate } from '../lib/types'

const STEPS = ['Upload Images', 'Protect Privacy', 'Review Features', 'Analyze', 'Explore Proof']
type Side = 'original' | 'suspicious'
const sides: Side[] = ['original', 'suspicious']
const title = (side: Side) => side === 'original' ? 'Original Photograph' : 'Suspicious Photograph'

export function Check() {
  usePageTitle('Check an Image')
  const [params] = useSearchParams()
  const { record, setRecord } = useCaseRecord()
  const [session, setSession] = useState<CheckSession>(() => {
    const saved = getCheckSession(), id = params.get('scene')
    const scene = id ? sceneStore().get(id) : null
    return scene && (!saved.original.label || saved.original.hash !== scene.fileHash || (!saved.original.file && saved.original.label !== scene.label)) ? { ...emptyCheck(), original: { ...emptyPhoto(), label: scene.label, hash: scene.fileHash, graph: scene.graph, masks: scene.mask ? [scene.mask] : [] } } : saved
  })
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [stages, setStages] = useState<StageUpdate[]>([])
  const [scenes] = useState(() => sceneStore().list())
  const [advanced, setAdvanced] = useState(false)
  const sequence = useRef(0), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++ } }, [])
  useEffect(() => saveCheckSession(session), [session])
  const discovery = params.get('discover') ? takeDiscoveryHandoff() : null
  const current = session.caseId === record?.id ? record : null
  const hasOriginal = !!session.original.file || !!session.original.graph.room_objects.length
  const hasSuspect = !!session.suspicious.file
  function update(next: CheckSession) { saveCheckSession(next); setSession(next) }
  function change(side: Side, value: PhotoInput) { clearProofMedia(); setRecord(null); update({ ...session, [side]: value, reviewed: false, caseId: null }) }
  function go(step: number) { setError(''); update({ ...session, step }); window.scrollTo({ top: 0, behavior: 'instant' }) }
  async function upload(side: Side, file: File) {
    const token = ++sequence.current
    setBusy(true); setError('')
    try {
      const fileError = photoFileError(file)
      if (fileError) throw new Error(fileError)
      await decodeToPixels(file, 256)
      const hash = await sha256(file)
      if (!alive.current || token !== sequence.current) return
      clearProofMedia(); setRecord(null)
      const other = side === 'original' ? 'suspicious' : 'original'
      update({ ...session, [side]: { ...emptyPhoto(), file, hash, label: file.name }, [other]: { ...session[other], graph: session[other].file ? { room_objects: [] } : session[other].graph }, reviewed: false, caseId: null })
      setNotice(`${title(side)} ready. Nothing was uploaded to a server.`)
    } catch (err) { if (alive.current && token === sequence.current) setError(err instanceof Error ? err.message : 'Could not open that image.') }
    finally { if (alive.current && token === sequence.current) setBusy(false) }
  }
  async function findFeatures() {
    if (!session.original.confirmed || !session.suspicious.confirmed) { setError('Confirm privacy review for both photographs first.'); return }
    if (!session.original.file || !session.suspicious.file) { setNotice('The saved original contains positions, not pixels. Mark corresponding details by hand, or upload the original photo to use local suggestions.'); go(3); return }
    const token = ++sequence.current
    setBusy(true); setError(''); setNotice('Finding background features on this device…')
    try {
      const a = await decodeToPixels(session.original.file, 640), b = await decodeToPixels(session.suspicious.file, 640)
      const result = matchPhotographs(a, b, session.original.masks, session.suspicious.masks, session.original.pixelMask, session.suspicious.pixelMask)
      if (!alive.current || token !== sequence.current) return
      update({ ...session, step: 3, original: { ...session.original, graph: result.source }, suspicious: { ...session.suspicious, graph: result.suspect }, reviewed: false, caseId: null })
      setRecord(null)
      setNotice(`${result.source.room_objects.length} tentative paired details found from ${result.detected[0]} and ${result.detected[1]} measured corners. Review or edit them. These are visual patches, not recognized objects. No server received the images.`)
      window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (err) { if (alive.current && token === sequence.current) { setError(err instanceof Error ? err.message : 'Feature search failed.'); update({ ...session, step: 3 }) } }
    finally { if (alive.current && token === sequence.current) setBusy(false) }
  }
  async function analyze() {
    if (!hasOriginal || !hasSuspect || !session.original.confirmed || !session.suspicious.confirmed || !session.reviewed) { setError('Add both photographs and finish privacy and feature review first.'); return }
    const token = ++sequence.current
    setBusy(true); setError(''); setStages([]); setRecord(null)
    try {
      const source = backgroundOnly(session.original.graph, session.original.masks, session.original.pixelMask), suspect = backgroundOnly(session.suspicious.graph, session.suspicious.masks, session.suspicious.pixelMask)
      const outcome = await runCheck({ source, suspect, sourceLabel: session.original.label, suspectLabel: session.suspicious.label, sourceHash: session.original.hash, suspectHash: session.suspicious.hash, sourceMask: null, maskApplied: !!(session.original.masks.length || session.original.pixelMask || session.suspicious.masks.length || session.suspicious.pixelMask), blind: session.blind, sample: false, allowEmpty: true, sourceOrigin: source.room_objects.some(p => p.pointOrigin === 'local') ? 'local' : 'manual', suspectOrigin: suspect.room_objects.some(p => p.pointOrigin === 'local') ? 'local' : 'manual' }, stage => {
        if (alive.current && token === sequence.current) setStages(prev => [...prev.filter(item => item.id !== stage.id), stage])
      })
      if (!outcome.ok) throw new Error(outcome.reason)
      const blobs = await Promise.all(sides.map(async side => {
        const photo = session[side]
        if (!photo.file) return null
        const redacted = await redactImage(photo.file, photo.masks, photo.pixelMask)
        return (await fetch(redacted.dataUrl)).blob() // Local data URL; no network request.
      }))
      if (settingsStore().load().pythonEngine) {
        const checked = await verifyWithPython(source, suspect)
        outcome.record.pythonNote = checked.ok ? `Python cross-check: ${checked.result.verdict}.` : checked.error
      }
      if (!alive.current || token !== sequence.current) return
      outcome.record.photoMethod = 'Experimental local Harris corners and normalized patch matching, followed by reviewed coordinate comparison. Manual edits are included. No fitted image transform or forensic authenticity determination.'
      if (discovery) outcome.record.discovery = { provider: 'TinEye', domain: discovery.candidate.domain, providerRelevance: discovery.candidate.provider_score, sourceLinks: discovery.candidate.links.map(link => link.page).filter((link): link is string => !!link) }
      setProofMedia({ caseId: outcome.record.id, original: blobs[0], suspicious: blobs[1], blind: proofNeedsViewingChoice(session) })
      setRecord(outcome.record); update({ ...session, step: 5, caseId: outcome.record.id }); window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (err) { if (alive.current && token === sequence.current) setError(err instanceof Error ? err.message : 'Analysis failed.') }
    finally { if (alive.current && token === sequence.current) setBusy(false) }
  }
  function startOver() { sequence.current++; setBusy(false); setAdvanced(false); clearCheckSession(); setRecord(null); update(emptyCheck()); setError(''); setNotice('Images and the previous comparison have been cleared from this workflow.') }
  const visible = (side: Side) => side === 'original' || (!session.blind && session.viewing)

  return <div className="page check-workflow">
    <PageHeader eyebrow="Check" title="Check an Image" lede="Compare an original photograph with a suspected altered image, without unnecessarily exposing sensitive content." />
    <ol className="check-progress" aria-label="Comparison stages">{STEPS.map((label, i) => <li key={label} aria-current={session.step === i + 1 ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
    <p className="footer-note">No account needed. Images and comparison data are cleared whenever you fully reopen or refresh the app. Moving between pages keeps your current comparison available. Use Delete images to clear it immediately.</p>
    {discovery && <p className="note">TinEye candidate: {discovery.candidate.domain}. Add an authorized local copy. Search relevance is not geometric verification.</p>}
    {notice && <p role="status" className="note">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}
    {session.step === 1 && <section className="stack"><h2>1. Upload Images</h2><div className="check-columns">{sides.map(side => <section className="panel stack" key={side}>
      <h3>{title(side)}</h3><label className="drop"><input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Upload ${side} photograph`} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(side, file); e.currentTarget.value = '' }} /><b>{session[side].label ? 'Replace photograph' : 'Choose photograph'}</b><span>JPEG, PNG, WebP · up to 20 MB</span></label>
      {session[side].label && <><p>{session[side].label} · {session[side].file?.type ?? 'Registered original'} · Ready</p><Button variant="ghost" disabled={busy} onClick={() => change(side, emptyPhoto())}>Remove photograph</Button></>}
      <ImageReview photo={session[side]} visible={side === 'original'} title={title(side)} mode="preview" />
      {side === 'original' && <><label className="field"><span>Or choose an original from Protect</span><select disabled={busy} value="" onChange={e => { const scene = scenes.find(s => s.id === e.target.value); if (scene) change('original', { ...emptyPhoto(), label: scene.label, hash: scene.fileHash, graph: scene.graph, masks: scene.mask ? [scene.mask] : [] }) }}><option value="">Choose a registered original</option>{scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label><p className="muted">Saved originals contain feature positions. Upload the photograph to find new details automatically.</p></>}
    </section>)}</div><Button disabled={busy || !hasOriginal || !hasSuspect} onClick={() => go(2)}>Continue to Privacy Review</Button></section>}
    {session.step === 2 && <section className="stack"><h2>2. Protect Privacy</h2><p>Blind Mode keeps the suspicious image concealed while you prepare the comparison.</p>
      <label className="checkline"><input disabled={busy} type="checkbox" checked={session.blind} onChange={e => update({ ...session, blind: e.target.checked, viewing: false })} /><span>Keep Blind Mode on</span></label>
      {!session.blind && <label className="checkline"><input disabled={busy} type="checkbox" checked={session.viewing} onChange={e => update({ ...session, viewing: e.target.checked })} /><span>I choose to view the suspicious photograph. It may contain sensitive content.</span></label>}
      <div className="check-columns">{sides.map(side => <ImageReview key={side} title={title(side)} photo={session[side]} visible={visible(side)} mode="privacy" disabled={busy} onChange={photo => change(side, photo)} onContinue={() => void findFeatures()} />)}</div>
      <p className="note">Covers exclude pixels and regions from analysis. Concealed covers cannot be visually checked here: a trusted helper can review them, or you can choose to view the photo. Local feature comparison sends no images to a server.</p>
      <div className="actions"><Button variant="secondary" disabled={busy} onClick={() => go(1)}>Back</Button><Button disabled={busy || !session.original.confirmed || !session.suspicious.confirmed} onClick={() => void findFeatures()}>{busy ? 'Finding background features…' : 'Continue to Feature Review'}</Button></div>
    </section>}
    {session.step === 3 && <section className="stack"><h2>3. Review Background Features</h2><p>Cyan points are tentative details measured from pixels, or points you added. “Detail 1” is a label, not object recognition. Matching labels connect the same background detail in both images.</p><p className="note">The local matcher is experimental and can miss crops, rotation, repeated textures, and changed backgrounds. No camera transform is fitted. Concealed-image suggestions remain visually unconfirmed.</p>
      <div className="check-columns">{sides.map(side => <ImageReview key={side} title={title(side)} photo={session[side]} visible={visible(side)} mode="features" disabled={busy} names={session.original.graph.room_objects.map(p => p.name)} onChange={photo => change(side, photo)} />)}</div>
      <Button variant="secondary" disabled={busy} onClick={() => void findFeatures()}>Reset suggestions from images</Button>
      <label className="checkline"><input disabled={busy} type="checkbox" checked={session.reviewed} onChange={e => update({ ...session, reviewed: e.target.checked })} /><span>I reviewed the available details and understand concealed details have not been visually confirmed.</span></label>
      <div className="actions"><Button variant="secondary" disabled={busy} onClick={() => go(2)}>Back</Button><Button disabled={busy || !session.reviewed} onClick={() => go(4)}>Continue to Analysis</Button></div>
    </section>}
    {session.step === 4 && <section className="panel stack"><h2>4. Analyze</h2><p>Compare {session.original.graph.room_objects.length} original details with {session.suspicious.graph.room_objects.length} suspicious-image details. Covered regions are excluded again before comparison.</p><p className="muted">The engine measures agreement between paired detail positions. At least four pairs are needed for a decisive result. Ambiguous or sparse details can produce insufficient evidence.</p><div className="actions"><Button variant="secondary" disabled={busy} onClick={() => go(3)}>Back</Button><Button disabled={busy} onClick={() => void analyze()}>{busy ? 'Analyzing…' : 'Analyze Images'}</Button></div><ol className="stages" aria-live="polite">{stages.map(stage => <li className="stage" key={stage.id}><b>{stage.label}</b><span>{stage.detail}</span></li>)}</ol></section>}
    {session.step === 5 && <section className="panel stack"><h2>5. Explore Proof</h2>{current ? <><h3>{current.result.verdict === 'Likely derivative' ? 'Background correspondence supported' : current.result.verdict === 'No link found' ? 'No reliable geometric correspondence found' : 'Insufficient evidence'}</h3><p>{current.result.aligned_points} of {current.result.usable_points} paired details fall within the alignment threshold.</p><p className="note">This does not prove AI manipulation, identity, consent, ownership, or wrongdoing. No matches does not prove the photos are unrelated.</p><div className="actions"><Button to={`/proof?case=${encodeURIComponent(current.id)}`}>Explore Evidence Connections</Button><Button variant="secondary" to="/results">Detailed results</Button><Button variant="secondary" onClick={() => go(3)}>Review features again</Button></div></> : <><p>The comparison is no longer available. Photos must be reselected after refreshing.</p><Button onClick={startOver}>Start a new comparison</Button></>}</section>}
    <div className="actions check-secondary"><Button variant="ghost" onClick={startOver}>Delete images and start a new comparison</Button></div>
    <details className="panel check-secondary" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>Advanced Tools</summary>{advanced && <><p>Existing manual mapping, consented model assistance, saved-reference comparison, import tools, and diagnostics.</p><AdvancedCheck /><div className="actions">{sides.map(side => <Button key={side} variant="secondary" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(session[side].graph, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${side}-background.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>Export {side} background map</Button>)}</div></>}</details>
    <details className="panel check-secondary"><summary>Try a Sample Comparison</summary><p>Synthetic examples, separate from your photographs.</p><div className="actions"><Button to="/results?sample=derivative" variant="secondary">Sample shared background</Button><Button to="/results?sample=moved" variant="secondary">Sample moved camera</Button></div></details>
  </div>
}
