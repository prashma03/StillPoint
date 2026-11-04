import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AdvancedCheck } from './AdvancedCheck'
import { Button, Dialog, PageHeader, usePageTitle } from '../components/ui'
import { useCaseRecord } from '../components/case'
import { ImageReview } from '../components/ImageReview'
import { runCheck } from '../lib/check'
import { clearCheckSession, clearProofMedia, emptyCheck, emptyPhoto, getCheckSession, getProofMedia, proofNeedsViewingChoice, saveCheckSession, setProofMedia, type CheckSession, type PhotoInput } from '../lib/checkSession'
import { backgroundOnly, buildCorrespondence, matchPhotographs, photoFileError } from '../lib/photoCompare'
import { decodeToPixels, redactImage } from '../lib/redact'
import { segmentLocally, LOCAL_MASK_MODEL } from '../lib/localSegmentation'
import { compareFaceLandmarks, runFaceLandmarks } from '../lib/facialGeometry'
import { inspectComposition, type MethodChoice } from '../lib/composition'
import { makeFaceCase } from '../lib/faceCase'
import { AnalysisMethodPanel } from '../components/AnalysisMethodPanel'
import { AnalysisResults } from '../components/AnalysisResults'
import './Check.css'
import { sha256 } from '../lib/hash'
import { sceneStore, settingsStore } from '../lib/storage'
import { verifyWithPython } from '../lib/engine'
import { takeDiscoveryHandoff } from '../lib/discover'
import type { StageUpdate } from '../lib/types'
import { modalVerificationConfigured, verifyModalGeometry } from '../lib/modal'

const STEPS = ['Upload Images', 'Protect Privacy', 'Review Evidence', 'Analyze', 'Results', 'Evidence Report']
type Side = 'original' | 'suspicious'
const sides: Side[] = ['original', 'suspicious']
const title = (side: Side) => side === 'original' ? 'Original Photograph' : 'Suspicious Photograph'
const hasAppliedMask = (photo: PhotoInput) => photo.masks.some(mask => [mask.x, mask.y, mask.w, mask.h].every(Number.isFinite) && mask.w > 0 && mask.h > 0 && mask.x < 1 && mask.y < 1 && mask.x + mask.w > 0 && mask.y + mask.h > 0) || !!photo.pixelMask?.data.some(pixel => pixel > 0)

export function Check() {
  usePageTitle('Check an Image')
  const [params] = useSearchParams()
  const { record, setRecord, faceEvidence, setFaceEvidence } = useCaseRecord()
  const [session, setSession] = useState<CheckSession>(() => {
    const saved = getCheckSession(), id = params.get('scene')
    const scene = id ? sceneStore().get(id) : null
    return scene && (!saved.original.label || saved.original.hash !== scene.fileHash || (!saved.original.file && saved.original.label !== scene.label)) ? { ...emptyCheck(), original: { ...emptyPhoto(), label: scene.label, hash: scene.fileHash, graph: scene.graph, masks: scene.mask ? [scene.mask] : [] } } : saved
  })
  const [error, setError] = useState(''), [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false), [stages, setStages] = useState<StageUpdate[]>([])
  const [scenes] = useState(() => sceneStore().list())
  const [advanced, setAdvanced] = useState(false)
  const [includeMaskedThumbnails, setIncludeMaskedThumbnails] = useState(false)
  const [closeDialog, setCloseDialog] = useState(false)
  const [faceConsent, setFaceConsent] = useState(false), [faceBusy, setFaceBusy] = useState(false)
  const [modalConfigured, setModalConfigured] = useState(false), [modalConsent, setModalConsent] = useState(false)
  const [scanning, setScanning] = useState(false), [scanError, setScanError] = useState('')
  const compositionRequest = useRef<AbortController | null>(null)
  const faceRequest = useRef<AbortController | null>(null)
  const uploadTokens = useRef<Record<Side, number>>({ original: 0, suspicious: 0 })
  const pendingUploads = useRef(0)
  const sequence = useRef(0), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; uploadTokens.current.original++; uploadTokens.current.suspicious++; faceRequest.current?.abort(); compositionRequest.current?.abort() } }, [])
  useEffect(() => saveCheckSession(session), [session])
  useEffect(() => { const controller = new AbortController(); void modalVerificationConfigured(controller.signal).then(setModalConfigured); return () => controller.abort() }, [])
  const discovery = params.get('discover') ? takeDiscoveryHandoff() : null
  const current = session.caseId === record?.id ? record : null
  const hasOriginal = !!session.original.file || !!session.original.graph.room_objects.length
  const hasSuspect = !!session.suspicious.file
  const choice = session.methodChoice ?? 'automatic'
  const method = choice === 'automatic' ? session.composition?.recommended ?? 'background' : choice
  useEffect(() => {
    const controller = new AbortController()
    compositionRequest.current?.abort(); compositionRequest.current = controller
    setScanError('')
    if (!session.original.file || !session.suspicious.file || session.composition) { setScanning(false); return () => controller.abort() }
    setScanning(true)
    inspectComposition(session.original, session.suspicious, controller.signal).then(composition => {
      if (controller.signal.aborted) return
      setSession(previous => ({ ...previous, composition }))
    }).catch(error => { if (!controller.signal.aborted) setScanError(error instanceof Error ? error.message : 'Composition inspection unavailable.') })
      .finally(() => { if (!controller.signal.aborted) setScanning(false) })
    return () => controller.abort()
  }, [session.original.file, session.suspicious.file])
  function selectMethod(methodChoice: MethodChoice) {
    sequence.current++; faceRequest.current?.abort(); setFaceBusy(false); setFaceConsent(false); setModalConsent(false)
    clearProofMedia(); setRecord(null); setError(''); setNotice('')
    update({ ...session, methodChoice, reviewed: false, caseId: null, step: session.step > 1 ? 2 : 1, suspicious: { ...session.suspicious, confirmed: false } })
  }
  function cancelInspection() { compositionRequest.current?.abort(); setScanning(false); setScanError('Composition inspection cancelled. Choose a method manually.') }
  const methodPanel = <AnalysisMethodPanel choice={choice} method={method} composition={session.composition ?? null} scanning={scanning} scanError={scanError} consent={faceConsent} disabled={busy || faceBusy} onChoice={selectMethod} onConsent={value => { setFaceConsent(value); if (!value) { faceRequest.current?.abort(); setFaceEvidence(null) } }} onCancel={cancelInspection} />
  function update(next: CheckSession) { saveCheckSession(next); setSession(next) }
  function change(side: Side, value: PhotoInput) { sequence.current++; uploadTokens.current.original++; uploadTokens.current.suspicious++; faceRequest.current?.abort(); setFaceBusy(false); const sameFile = value.file === session[side].file && value.hash === session[side].hash && value.label === session[side].label; clearProofMedia(); setRecord(null); setFaceConsent(false); setModalConsent(false); update({ ...session, [side]: value, reviewed: false, caseId: null, detectedKeypoints: sameFile ? session.detectedKeypoints : null, localDetection: sameFile ? session.localDetection : null, composition: sameFile ? session.composition : null }) }
  function go(step: number) { setError(''); update({ ...session, step }); window.scrollTo({ top: 0, behavior: 'instant' }) }
  async function upload(side: Side, file: File) {
    const token = ++uploadTokens.current[side]
    pendingUploads.current++
    setBusy(true); setError('')
    try {
      const fileError = photoFileError(file)
      if (fileError) throw new Error(fileError)
      await decodeToPixels(file, 256)
      const hash = await sha256(file)
      if (!alive.current || token !== uploadTokens.current[side]) return
      clearProofMedia(); setRecord(null); setFaceConsent(false)
      const other = side === 'original' ? 'suspicious' : 'original'
      const latest = getCheckSession()
      update({ ...latest, [side]: { ...emptyPhoto(), file, hash, label: file.name }, [other]: { ...latest[other], graph: latest[other].file ? { room_objects: [] } : latest[other].graph }, reviewed: false, caseId: null, detectedKeypoints: null, localDetection: null, composition: null })
      setNotice(`${title(side)} ready. Nothing was uploaded to a server.`)
    } catch (err) { if (alive.current && token === uploadTokens.current[side]) setError(err instanceof Error ? err.message : 'Could not open that image.') }
    finally { pendingUploads.current = Math.max(0, pendingUploads.current - 1); if (alive.current) setBusy(pendingUploads.current > 0) }
  }
  async function findFeatures(input: CheckSession = session) {
    setFaceConsent(false); setFaceEvidence(null)
    if (!input.original.confirmed || !input.suspicious.confirmed) { setError('Confirm the original photograph’s privacy review first.'); return }
    if (!input.original.file || !input.suspicious.file) { setNotice('The saved original contains positions, not pixels. Mark corresponding details by hand, or upload the original photo to use local suggestions.'); go(3); return }
    const token = ++sequence.current
    setBusy(true); setError(''); setNotice('Finding background features on this device…')
    try {
      const a = await decodeToPixels(input.original.file, 640), b = await decodeToPixels(input.suspicious.file, 640)
      const result = matchPhotographs(a, b, input.original.masks, input.suspicious.masks, input.original.pixelMask, input.suspicious.pixelMask)
      if (!alive.current || token !== sequence.current) return
      update({ ...input, step: 3, original: { ...input.original, graph: result.source }, suspicious: { ...input.suspicious, graph: result.suspect }, reviewed: false, caseId: null, detectedKeypoints: { source: result.detected[0], suspect: result.detected[1] }, localDetection: result.detection })
      setRecord(null)
      setNotice(`${result.source.room_objects.length} tentative paired details found from ${result.detected[0]} and ${result.detected[1]} measured corners. Review or edit them. These are visual patches, not recognized objects. No server received the images.`)
      window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (err) { if (alive.current && token === sequence.current) { setError(err instanceof Error ? err.message : 'Feature search failed.'); update({ ...input, step: 3 }) } }
    finally { if (alive.current && token === sequence.current) setBusy(false) }
  }
  async function analyzeFaces() {
    if (!session.reviewed || !session.original.confirmed || !session.suspicious.confirmed) { setError('Finish privacy and method review first.'); return }
    if (method !== 'facial' || !faceConsent) { setError('Explicit consent is required before facial landmark geometry is processed.'); return }
    if (!session.original.file || !session.suspicious.file) { setError('Both original photo files are required for local facial geometry.'); return }
    const token = ++sequence.current, controller = new AbortController()
    faceRequest.current?.abort(); faceRequest.current = controller
    clearProofMedia(); setRecord(null); setIncludeMaskedThumbnails(false); setStages([])
    update({ ...session, caseId: null })
    setFaceBusy(true); setError(''); setNotice('Preparing privacy-covered images for consented on-device facial geometry…')
    try {
      const prepared = await Promise.all(sides.map(async side => {
        const photo = session[side]
        if (!photo.file) throw new Error('Both original photo files are required.')
        const image = await redactImage(photo.file, photo.masks, photo.pixelMask)
        return (await fetch(image.dataUrl)).blob() // Local data URL conversion only.
      }))
      controller.signal.throwIfAborted()
      const source = await runFaceLandmarks(prepared[0], controller.signal, true)
      const suspect = await runFaceLandmarks(prepared[1], controller.signal, true)
      if (!alive.current || token !== sequence.current) return
      const comparison = compareFaceLandmarks(source, suspect)
      const completed = makeFaceCase(session, comparison)
      setProofMedia({ caseId: completed.id, original: prepared[0], suspicious: prepared[1], blind: proofNeedsViewingChoice(session) })
      setRecord(completed); setFaceEvidence(comparison); setFaceConsent(false)
      update({ ...session, step: 5, caseId: completed.id })
      window.scrollTo({ top: 0, behavior: 'instant' })
      setNotice(`Local facial geometry complete: ${comparison.alignedLandmarks} of ${comparison.sourceLandmarkCount} reference landmarks fall within ${comparison.alignmentThreshold.toFixed(2)} inter-eye spacings after 3D-relative normalization. This is not identity verification.`)
    } catch (err) {
      if (alive.current && token === sequence.current) setError(err instanceof Error ? err.message : 'Local facial landmark analysis failed.')
    } finally { if (alive.current && token === sequence.current) { setFaceBusy(false); faceRequest.current = null } }
  }
  async function continuePrivacy() {
    if (method === 'facial') {
      if (!faceConsent) { setError('Confirm separate consent for local facial landmark analysis, or choose Background Geometry.'); return }
      if (!session.original.confirmed || !session.original.file || !session.suspicious.file) { setError('Upload both files and confirm the original privacy setup first.'); return }
      update({ ...session, suspicious: { ...session.suspicious, confirmed: true }, step: 3 }); setError(''); return
    }
    if (!session.original.confirmed) { setError('Review and confirm the original photograph’s privacy setup first.'); return }
    if (!hasOriginal || !session.suspicious.file) { setError('Choose an original photograph or scene map and upload the compared photograph.'); return }
    const token = ++sequence.current
    setBusy(true); setError(''); setNotice('Automatically masking people in the suspicious photograph on this device…')
    try {
      const pixelMask = await segmentLocally(session.suspicious.file, new AbortController().signal)
      if (!alive.current || token !== sequence.current) return
      const suspicious = { ...session.suspicious, pixelMask, confirmed: true }
      const next = { ...session, suspicious }
      update(next)
      if (pixelMask.data.some(value => value > 0)) setNotice(`Automatic person masking completed with ${LOCAL_MASK_MODEL}. The suspicious image will continue to feature review.`)
      else setNotice('Automatic masking found no person pixels. Continuing with the original’s privacy review; inspect the feature review carefully.')
      await findFeatures(next)
    } catch (err) {
      if (alive.current && token === sequence.current) setError(err instanceof Error ? `Automatic masking could not run: ${err.message}` : 'Automatic masking failed. Try again or check this browser’s local model support.')
    } finally { if (alive.current && token === sequence.current) setBusy(false) }
  }
  async function analyze() {
    if (method === 'facial') { await analyzeFaces(); return }
    if (!hasOriginal || !hasSuspect || !session.original.confirmed || !session.suspicious.confirmed || !session.reviewed) { setError('Add both photographs and finish privacy and feature review first.'); return }
    const token = ++sequence.current
    setBusy(true); setError(''); setStages([]); setRecord(null); setIncludeMaskedThumbnails(false)
    try {
      const source = backgroundOnly(session.original.graph, session.original.masks, session.original.pixelMask), suspect = backgroundOnly(session.suspicious.graph, session.suspicious.masks, session.suspicious.pixelMask)
      const sourceMaskApplied = hasAppliedMask(session.original)
      const suspectMaskApplied = hasAppliedMask(session.suspicious)
      const outcome = await runCheck({ source, suspect, sourceLabel: session.original.label, suspectLabel: session.suspicious.label, sourceHash: session.original.hash, suspectHash: session.suspicious.hash, detectedKeypoints: session.detectedKeypoints, sourceFile: session.original.file ? { name: session.original.file.name, mimeType: session.original.file.type || 'unknown', sizeBytes: session.original.file.size } : null, suspectFile: session.suspicious.file ? { name: session.suspicious.file.name, mimeType: session.suspicious.file.type || 'unknown', sizeBytes: session.suspicious.file.size } : null, sourceMaskApplied, suspectMaskApplied, sourceMask: null, maskApplied: sourceMaskApplied || suspectMaskApplied, blind: session.blind, sample: false, allowEmpty: true, sourceOrigin: source.room_objects.some(p => p.pointOrigin === 'local') ? 'local' : 'manual', suspectOrigin: suspect.room_objects.some(p => p.pointOrigin === 'local') ? 'local' : 'manual' }, stage => {
        if (alive.current && token === sequence.current) setStages(prev => [...prev.filter(item => item.id !== stage.id), stage])
      })
      if (!outcome.ok) throw new Error(outcome.reason)
      const redactedPair = await Promise.all(sides.map(async side => {
        const photo = session[side]
        if (!photo.file) return null
        const redacted = await redactImage(photo.file, photo.masks, photo.pixelMask)
        return { dataUrl: redacted.dataUrl, blob: await (await fetch(redacted.dataUrl)).blob() } // Local data URL conversion only.
      }))
      const blobs = redactedPair.map(item => item?.blob ?? null)
      if (settingsStore().load().pythonEngine) {
        const checked = await verifyWithPython(source, suspect)
        outcome.record.pythonNote = checked.ok ? `Python cross-check: ${checked.result.verdict}.` : checked.error
      }
      if (!alive.current || token !== sequence.current) return
      outcome.record.correspondence = buildCorrespondence(source, suspect, session.localDetection ?? null)
      outcome.record.analysisMethod = 'background'
      outcome.record.photoMethod = session.localDetection
        ? 'On-device Harris corners and normalized patch descriptors, then a Hartley-normalized homography checked with deterministic RANSAC. Reviewed edits are included and masked regions are excluded before detection. The homography is a 2D image-plane map, not a 3D room reconstruction or an authenticity score.'
        : 'Reviewed scene-map coordinates only. Image corners were not detected for this case.'
      outcome.record.faceGeometrySummary = null
      if (modalConsent && modalConfigured && redactedPair[0] && redactedPair[1]) {
        setNotice('Sending only downscaled, metadata-stripped, opaque-mask copies for opt-in Modal geometric verification…')
        try {
          const evidence = await verifyModalGeometry(redactedPair[0].dataUrl, redactedPair[1].dataUrl)
          outcome.record.modalGeometry = { status: 'completed', evidence }
          setNotice(`Modal measured ${evidence.verified_inliers} geometric inliers from ${evidence.candidate_matches} image-feature candidates. Uncertainty: ${evidence.uncertainty.status}. The local verdict is unchanged.`)
        } catch (modalError) {
          outcome.record.modalGeometry = { status: 'fallback', reason: modalError instanceof Error ? modalError.message : 'Modal unavailable.' }
          setNotice('Modal verification was unavailable; the on-device comparison is retained unchanged.')
        }
      } else if (modalConsent) {
        outcome.record.modalGeometry = { status: 'fallback', reason: 'Both privacy-redacted image copies were unavailable or the Modal service is not configured.' }
      }
      if (discovery) outcome.record.discovery = { provider: 'TinEye', domain: discovery.candidate.domain, providerRelevance: discovery.candidate.provider_score, sourceLinks: discovery.candidate.links.map(link => link.page).filter((link): link is string => !!link) }
      setProofMedia({ caseId: outcome.record.id, original: blobs[0], suspicious: blobs[1], blind: proofNeedsViewingChoice(session) })
      setRecord(outcome.record); setFaceEvidence(null); update({ ...session, step: 5, caseId: outcome.record.id }); window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (err) { if (alive.current && token === sequence.current) setError(err instanceof Error ? err.message : 'Analysis failed.') }
    finally { if (alive.current && token === sequence.current) setBusy(false) }
  }
  function startOver() { compositionRequest.current?.abort(); setScanning(false); setScanError(''); sequence.current++; uploadTokens.current.original++; uploadTokens.current.suspicious++; faceRequest.current?.abort(); setFaceBusy(false); setFaceConsent(false); setBusy(false); setAdvanced(false); setIncludeMaskedThumbnails(false); clearCheckSession(); setRecord(null); update(emptyCheck()); setError(''); setNotice('Images and the previous comparison have been cleared from this workflow.') }
  async function downloadPdf() {
    if (!current) { setError('The completed comparison is unavailable. Run the Check workflow again to generate its report.'); return }
    setError('')
    try {
      const media = getProofMedia(current.id)
      const thumbnails = includeMaskedThumbnails && current.analysisMethod !== 'facial' ? { original: current.sourceMaskApplied ? media?.original : null, suspicious: current.suspectMaskApplied ? media?.suspicious : null } : undefined
      const { buildEvidencePdf } = await import('../lib/pdfReport')
      const blob = await buildEvidencePdf(current, thumbnails ? { thumbnails } : {})
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Stillpoint-Evidence-${current.id.slice(0, 8)}.pdf`
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setNotice('PDF Evidence Report generated locally and downloaded. It contains the comparison record, not uploaded image pixels.')
    } catch (err) { setError(err instanceof Error ? `Could not generate the PDF report: ${err.message}` : 'Could not generate the PDF report.') }
  }
  function closeCase() {
    compositionRequest.current?.abort(); setScanning(false); setScanError(''); sequence.current++; uploadTokens.current.original++; uploadTokens.current.suspicious++; faceRequest.current?.abort(); setFaceBusy(false); setFaceConsent(false); setBusy(false); setAdvanced(false); setIncludeMaskedThumbnails(false); clearCheckSession(); clearProofMedia(); setRecord(null); update(emptyCheck()); setCloseDialog(false); setError('')
    setNotice('Case closed. This tab’s uploaded files, mask buffers, redacted previews, and comparison record were cleared from the workflow and session storage. Saved scene graphs, account or backup copies, and reports already downloaded remain under their own retention.')
  }
  const visible = (side: Side) => side === 'original' || (!session.blind && session.viewing)

  return <div className="page check-workflow">
    <PageHeader eyebrow="Check" title="Check an Image" lede="Compare an original photograph with a suspected altered image, without unnecessarily exposing sensitive content." />
    <ol className="check-progress" aria-label="Comparison stages">{STEPS.map((label, i) => <li key={label} aria-current={session.step === i + 1 ? 'step' : undefined}><span>{i + 1}</span>{label}</li>)}</ol>
    <p className="footer-note">No account needed. Photos and comparison data stay in this tab and clear on refresh or reopening. Page navigation keeps your comparison. Delete images clears it now.</p>
    {discovery && <p className="note">TinEye candidate: {discovery.candidate.domain}. Add an authorized local copy. Search relevance is not geometric verification.</p>}
    {notice && <p role="status" className="note">{notice}</p>}{error && <p role="alert" className="error">{error}</p>}
    {session.step > 1 && session.step < 5 && methodPanel}
    {session.step === 1 && <section className="stack check-upload-step"><h2>1. Upload Images</h2><div className="check-columns">{sides.map(side => <section className="panel stack" key={side}>
      <h3>{title(side)}</h3><label className="drop"><input disabled={busy} type="file" accept="image/jpeg,image/png,image/webp" aria-label={`Upload ${side} photograph`} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(side, file); e.currentTarget.value = '' }} /><b>{session[side].label ? 'Replace photograph' : 'Choose photograph'}</b><span>JPEG, PNG, WebP · up to 20 MB</span></label>
      {session[side].label && <div className="check-upload-metadata"><p>{session[side].label} · {session[side].file?.type ?? 'Registered original'} · Ready</p><Button variant="ghost" disabled={busy} onClick={() => change(side, emptyPhoto())}>Remove photograph</Button></div>}
      <ImageReview photo={session[side]} visible={side === 'original'} title={title(side)} mode="preview" compact />
      {side === 'original' && <details className="analysis-saved-source"><summary>Use a registered original instead</summary><label className="field"><span>Or choose a saved scene map</span><select disabled={busy} value="" onChange={e => { const scene = scenes.find(s => s.id === e.target.value); if (scene) change('original', { ...emptyPhoto(), label: scene.label, hash: scene.fileHash, graph: scene.graph, masks: scene.mask ? [scene.mask] : [] }) }}><option value="">Choose a registered original</option>{scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label><p className="muted">Saved originals contain feature positions. Upload the photograph to find new details automatically.</p></details>}
    </section>)}</div>{methodPanel}<Button disabled={busy || faceBusy || (scanning && choice === 'automatic') || !hasOriginal || !hasSuspect} onClick={() => go(2)}>Continue to Privacy Review</Button></section>}
    {session.step === 2 && <section className="stack"><h2>2. Protect Privacy</h2><p>Blind Mode keeps the suspicious image concealed while you prepare the comparison.</p>
      <label className="checkline"><input disabled={busy} type="checkbox" checked={session.blind} onChange={e => update({ ...session, blind: e.target.checked, viewing: false })} /><span>Keep Blind Mode on</span></label>
      {!session.blind && <label className="checkline"><input disabled={busy} type="checkbox" checked={session.viewing} onChange={e => update({ ...session, viewing: e.target.checked })} /><span>I choose to view the suspicious photograph. It may contain sensitive content.</span></label>}
      <div className="check-columns"><ImageReview title={title('original')} photo={session.original} visible onChange={photo => change('original', photo)} mode="privacy" disabled={busy} /><section className="panel stack" aria-label="Suspicious Photograph automatic privacy masking"><h3>Suspicious Photograph</h3><ImageReview title={title('suspicious')} photo={session.suspicious} visible={visible('suspicious')} mode="preview" /><p className="note">{method === 'facial' ? 'Existing covers are retained. Automatic person masking is not added for facial geometry, because it would hide the face from the local model. Blind Mode still conceals this preview. Only explicit consent enables processing.' : 'People are masked automatically on this device when you continue. Manual masking and mask positioning are not offered for this photograph.'}</p>{session.suspicious.confirmed && <p role="status" className="muted">Automatic masking complete{session.suspicious.pixelMask?.data.some(value => value > 0) ? ' · person pixels covered' : ' · no person pixels detected'}.</p>}</section></div>
      <p className="note">Existing covers are always respected. {method === 'facial' ? 'Covered facial areas may prevent a measurement.' : 'People masks are excluded before background feature detection.'} Blind Mode keeps the suspicious image concealed. No photo is sent to a server by this local workflow.</p>
      <div className="actions"><Button variant="secondary" disabled={busy} onClick={() => go(1)}>Back</Button><Button disabled={busy || faceBusy || !session.original.confirmed || (scanning && choice === 'automatic') || (method === 'facial' && !faceConsent)} onClick={() => void continuePrivacy()}>{busy ? 'Masking and continuing…' : 'Continue to Feature Review'}</Button></div>
    </section>}
    {session.step === 3 && <section className="stack"><h2>3. Review Available Features</h2>
      {method === 'facial' ? <p className="note">This method uses consented facial reference landmarks, not background points. Landmark processing runs only after consent and Analyze Images. Review the method above, then continue. Privacy-covered faces may be undetectable.</p> : <>
        <p>Cyan points are tentative local details, or points you added. Labels describe paired positions, not recognized objects. The background matcher is experimental and may miss crops, blur, repetition, or changed backgrounds.</p>
        <div className="check-columns">{sides.map(side => <ImageReview key={side} title={title(side)} photo={session[side]} visible={visible(side)} mode="features" disabled={busy || faceBusy} names={session.original.graph.room_objects.map(p => p.name)} onChange={photo => change(side, photo)} />)}</div>
        <Button variant="secondary" disabled={busy || faceBusy} onClick={() => void findFeatures()}>Reset suggestions from images</Button>
      </>}
      <label className="checkline"><input disabled={busy || faceBusy} type="checkbox" checked={session.reviewed} onChange={e => update({ ...session, reviewed: e.target.checked })} /><span>{method === 'facial' ? 'I reviewed this method and understand its limitations.' : 'I reviewed the available details and understand concealed-image details have not been visually confirmed.'}</span></label>
      <div className="actions"><Button variant="secondary" disabled={busy || faceBusy} onClick={() => go(2)}>Back</Button><Button disabled={busy || faceBusy || !session.reviewed || (method === 'facial' && !faceConsent)} onClick={() => go(4)}>Continue to Analysis</Button></div>
    </section>}
    {session.step === 4 && <section className="panel stack"><h2>4. Analyze</h2>
      {method !== 'facial' && <div className="modal-opt-in"><label className="checkline"><input type="checkbox" checked={modalConsent} disabled={!modalConfigured || busy || !session.original.confirmed || !session.suspicious.confirmed} onChange={event => setModalConsent(event.target.checked)} /><span><strong>Optional remote verification with Modal</strong><br />{modalConfigured ? 'If selected, Stillpoint sends downscaled JPEG copies with opaque privacy masks and metadata removed to the configured Modal service. Unmasked areas may still contain sensitive details. Your local result remains separate.' : 'Modal service is not configured on this computer. The existing on-device workflow is available.'}</span></label><p className="muted">{modalConfigured ? 'Unchecked by default. Both image privacy reviews must be confirmed.' : 'To enable this option, deploy the service and configure the local backend environment.'}</p></div>}
      <p>{method === 'facial' ? 'Measure selected facial reference points locally after consent. Existing covers are applied first. No background or identity comparison will run.' : `Compare ${session.original.graph.room_objects.length} original details with ${session.suspicious.graph.room_objects.length} compared-image details. Covered regions are excluded again. Sparse pairs may be inconclusive.`}</p>
      <div className="actions"><Button variant="secondary" disabled={busy || faceBusy} onClick={() => go(3)}>Back</Button><Button disabled={busy || faceBusy || (method === 'facial' && !faceConsent) || (scanning && choice === 'automatic')} onClick={() => void analyze()}>{busy || faceBusy ? 'Analyzing…' : 'Analyze Images'}</Button>{faceBusy && <Button variant="ghost" onClick={() => { faceRequest.current?.abort(); sequence.current++; setFaceBusy(false); setFaceConsent(false); setNotice('Facial analysis cancelled. Temporary results discarded; nothing sent externally.') }}>Cancel analysis</Button>}</div><ol className="stages" aria-live="polite">{stages.map(stage => <li className="stage" key={stage.id}><b>{stage.label}</b><span>{stage.detail}</span></li>)}</ol>
    </section>}
    {session.step === 5 && <section className="panel stack"><h2>5. Comparison Results</h2>{current ? <><AnalysisResults record={current} face={faceEvidence} /><div className="actions"><Button variant="secondary" onClick={() => go(3)}>Review method and features</Button><Button variant="secondary" onClick={() => go(6)}>Generate Evidence Report</Button></div></> : <><p>The comparison is no longer available. Photos must be reselected after refreshing.</p><Button onClick={startOver}>Start a new comparison</Button></>}</section>}
    {session.step === 6 && <section className="panel stack"><h2>6. Generate Evidence Report</h2>{current ? <><p>Create a downloadable PDF from this completed comparison’s real metadata, measurements, reviewed correspondences, and limitations. Report generation happens on this device. It is explanatory and is not legally certified.</p><div className="panel check-report-preview"><p><b>Report {current.id}</b></p><p>Analyzed: {new Date(current.createdAt).toLocaleString()}</p><p>{current.analysisMethod === 'facial' ? `Facial geometry: ${current.faceGeometrySummary?.alignedLandmarks} of ${current.faceGeometrySummary?.sourceLandmarks} landmarks within the normalized threshold. Raw coordinates omitted.` : `${current.result.aligned_points} aligned pairs of ${current.result.usable_points} usable reviewed background features.`}</p><p>SHA-256: {current.sourceHash ? 'original available' : 'original unavailable'} · {current.suspectHash ? 'suspected file available' : 'suspected file unavailable'}</p></div><label className="checkline"><input type="checkbox" checked={includeMaskedThumbnails} disabled={current.analysisMethod === 'facial' || (!current.sourceMaskApplied && !current.suspectMaskApplied)} onChange={e => setIncludeMaskedThumbnails(e.target.checked)} /><span>Include masked image thumbnails (off by default). Selected, privacy-covered image pixels will be embedded in the downloaded PDF and may be retained in copies or backups. Images without a recorded mask cannot be included.</span></label>{!current.sourceMaskApplied && !current.suspectMaskApplied && <p className="muted">No masked image thumbnails are available for this case.</p>}<p className="note">The report identifies the chosen method and its measured results. Raw facial coordinates are never included. Facial geometry reports always omit photograph pixels and raw landmark coordinates. Background reports omit pixels unless you opt into eligible masked thumbnails. Masking reduces exposure but is not a guarantee of anonymization.</p><div className="actions"><Button disabled={!current} onClick={() => void downloadPdf()}>Download PDF Report</Button><Button variant="secondary" onClick={() => go(5)}>Return to Proof</Button><Button variant="secondary" onClick={startOver}>Start New Comparison</Button><Button variant="ghost" onClick={() => setCloseDialog(true)}>Close Case Securely</Button></div></> : <><p>No completed comparison is open. This workflow keeps uploaded photos in memory only, while a report you already downloaded remains on your device.</p><Button onClick={startOver}>Start New Comparison</Button></>}</section>}
    <div className="actions check-secondary"><Button variant="ghost" onClick={startOver}>Delete images and start a new comparison</Button></div>
    <details className="panel check-secondary" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>Advanced Tools</summary>{advanced && <><p>Existing manual mapping, consented model assistance, saved-reference comparison, import tools, and diagnostics.</p><AdvancedCheck /><div className="actions">{sides.map(side => <Button key={side} variant="secondary" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(session[side].graph, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${side}-background.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>Export {side} background map</Button>)}</div></>}</details>
    <details className="panel check-secondary"><summary>Try a Sample Comparison</summary><p>Synthetic examples, separate from your photographs.</p><div className="actions"><Button to="/results?sample=derivative" variant="secondary">Sample shared background</Button><Button to="/results?sample=moved" variant="secondary">Sample moved camera</Button></div></details>
    <Dialog open={closeDialog} title="Close this case securely?" confirmLabel="Close Case Securely" onConfirm={closeCase} onClose={() => setCloseDialog(false)}><p>This clears the current comparison record from this tab’s session storage and releases the uploaded files, mask buffers, and redacted previews held in memory by Stillpoint.</p><p>It does not delete saved scene graphs, account or backup copies, browser downloads, or reports you have already downloaded. Those copies follow their own retention and deletion controls.</p></Dialog>
  </div>
}
