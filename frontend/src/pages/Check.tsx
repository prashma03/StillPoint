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
import { compareFaceLandmarks, runFaceLandmarks, type FaceGeometryEvidence } from '../lib/facialGeometry'
import { sha256 } from '../lib/hash'
import { sceneStore, settingsStore } from '../lib/storage'
import { verifyWithPython } from '../lib/engine'
import { takeDiscoveryHandoff } from '../lib/discover'
import type { StageUpdate } from '../lib/types'

const STEPS = ['Upload Images', 'Protect Privacy', 'Review Features', 'Analyze', 'Explore Proof', 'Generate Evidence Report']
type Side = 'original' | 'suspicious'
const sides: Side[] = ['original', 'suspicious']
const title = (side: Side) => side === 'original' ? 'Original Photograph' : 'Suspicious Photograph'
const hasAppliedMask = (photo: PhotoInput) => photo.masks.some(mask => [mask.x, mask.y, mask.w, mask.h].every(Number.isFinite) && mask.w > 0 && mask.h > 0 && mask.x < 1 && mask.y < 1 && mask.x + mask.w > 0 && mask.y + mask.h > 0) || !!photo.pixelMask?.data.some(pixel => pixel > 0)

export function Check() {
  usePageTitle('Check an Image')
  const [params] = useSearchParams()
  const { record, setRecord, setFaceEvidence } = useCaseRecord()
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
  const [facePreview, setFacePreview] = useState<FaceGeometryEvidence | null>(null)
  const faceRequest = useRef<AbortController | null>(null)
  const sequence = useRef(0), alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false; sequence.current++; faceRequest.current?.abort() } }, [])
  useEffect(() => saveCheckSession(session), [session])
  const discovery = params.get('discover') ? takeDiscoveryHandoff() : null
  const current = session.caseId === record?.id ? record : null
  const hasOriginal = !!session.original.file || !!session.original.graph.room_objects.length
  const hasSuspect = !!session.suspicious.file
  function update(next: CheckSession) { saveCheckSession(next); setSession(next) }
  function change(side: Side, value: PhotoInput) { const sameFile = value.file === session[side].file && value.hash === session[side].hash && value.label === session[side].label; clearProofMedia(); setRecord(null); setFacePreview(null); setFaceConsent(false); update({ ...session, [side]: value, reviewed: false, caseId: null, detectedKeypoints: sameFile ? session.detectedKeypoints : null, localDetection: sameFile ? session.localDetection : null }) }
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
      clearProofMedia(); setRecord(null); setFacePreview(null); setFaceConsent(false)
      const other = side === 'original' ? 'suspicious' : 'original'
      update({ ...session, [side]: { ...emptyPhoto(), file, hash, label: file.name }, [other]: { ...session[other], graph: session[other].file ? { room_objects: [] } : session[other].graph }, reviewed: false, caseId: null })
      setNotice(`${title(side)} ready. Nothing was uploaded to a server.`)
    } catch (err) { if (alive.current && token === sequence.current) setError(err instanceof Error ? err.message : 'Could not open that image.') }
    finally { if (alive.current && token === sequence.current) setBusy(false) }
  }
  async function findFeatures(input: CheckSession = session) {
    setFacePreview(null); setFaceConsent(false); setFaceEvidence(null)
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
    if (!faceConsent) { setError('Explicit consent is required before facial landmark geometry is processed.'); return }
    if (!session.original.file || !session.suspicious.file) { setError('Both original photo files are required for local facial geometry.'); return }
    const token = ++sequence.current, controller = new AbortController()
    faceRequest.current?.abort(); faceRequest.current = controller
    setFaceBusy(true); setError(''); setNotice('Preparing privacy-covered images for consented on-device facial geometry…')
    try {
      const prepared = await Promise.all(sides.map(async side => {
        const photo = session[side]
        if (!photo.file) throw new Error('Both original photo files are required.')
        const image = await redactImage(photo.file, photo.masks, photo.pixelMask)
        return (await fetch(image.dataUrl)).blob() // Local data URL conversion only.
      }))
      const [source, suspect] = await Promise.all(prepared.map(file => runFaceLandmarks(file, controller.signal)))
      if (!alive.current || token !== sequence.current) return
      const comparison = compareFaceLandmarks(source, suspect)
      setFacePreview(comparison); setFaceConsent(false)
      setNotice(`Local facial geometry complete: ${comparison.alignedLandmarks} of ${comparison.sourceLandmarkCount} reference landmarks fall within ${comparison.alignmentThreshold.toFixed(2)} inter-eye spacings after 3D-relative normalization. This is not identity verification.`)
    } catch (err) {
      if (alive.current && token === sequence.current) setError(err instanceof Error ? err.message : 'Local facial landmark analysis failed.')
    } finally { if (alive.current && token === sequence.current) { setFaceBusy(false); faceRequest.current = null } }
  }
  async function continuePrivacy() {
    if (!session.original.confirmed) { setError('Review and confirm the original photograph’s privacy setup first.'); return }
    if (!session.original.file || !session.suspicious.file) { setError('Upload both photographs before continuing.'); return }
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
      outcome.record.correspondence = buildCorrespondence(source, suspect, session.localDetection ?? null)
      outcome.record.photoMethod = `${session.localDetection
        ? 'On-device Harris corners and normalized patch descriptors, then a Hartley-normalized homography checked with deterministic RANSAC. Reviewed edits are included and masked regions are excluded before detection. The homography is a 2D image-plane map, not a 3D room reconstruction or an authenticity score.'
        : 'Reviewed scene-map coordinates only. Image corners were not detected for this case.'}${facePreview ? ' A separate local facial landmark geometry comparison was run after explicit consent. Raw landmark coordinates are not included in the report and the face result does not change the background verdict.' : ''}`
      outcome.record.faceGeometrySummary = facePreview ? {
        sourceLandmarks: facePreview.sourceLandmarkCount,
        suspectLandmarks: facePreview.suspectLandmarkCount,
        alignedLandmarks: facePreview.alignedLandmarks,
        alignmentThreshold: facePreview.alignmentThreshold,
        meanResidual: facePreview.meanResidual,
      } : null
      if (discovery) outcome.record.discovery = { provider: 'TinEye', domain: discovery.candidate.domain, providerRelevance: discovery.candidate.provider_score, sourceLinks: discovery.candidate.links.map(link => link.page).filter((link): link is string => !!link) }
      setProofMedia({ caseId: outcome.record.id, original: blobs[0], suspicious: blobs[1], blind: proofNeedsViewingChoice(session) })
      setRecord(outcome.record); setFaceEvidence(facePreview); update({ ...session, step: 5, caseId: outcome.record.id }); window.scrollTo({ top: 0, behavior: 'instant' })
    } catch (err) { if (alive.current && token === sequence.current) setError(err instanceof Error ? err.message : 'Analysis failed.') }
    finally { if (alive.current && token === sequence.current) setBusy(false) }
  }
  function startOver() { sequence.current++; faceRequest.current?.abort(); setFaceBusy(false); setFacePreview(null); setFaceConsent(false); setBusy(false); setAdvanced(false); setIncludeMaskedThumbnails(false); clearCheckSession(); setRecord(null); update(emptyCheck()); setError(''); setNotice('Images and the previous comparison have been cleared from this workflow.') }
  async function downloadPdf() {
    if (!current) { setError('The completed comparison is unavailable. Run the Check workflow again to generate its report.'); return }
    setError('')
    try {
      const media = getProofMedia(current.id)
      const thumbnails = includeMaskedThumbnails ? { original: current.sourceMaskApplied ? media?.original : null, suspicious: current.suspectMaskApplied ? media?.suspicious : null } : undefined
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
    sequence.current++; faceRequest.current?.abort(); setFaceBusy(false); setFacePreview(null); setFaceConsent(false); setBusy(false); setAdvanced(false); setIncludeMaskedThumbnails(false); clearCheckSession(); clearProofMedia(); setRecord(null); update(emptyCheck()); setCloseDialog(false); setError('')
    setNotice('Case closed. This tab’s uploaded files, mask buffers, redacted previews, and comparison record were cleared from the workflow and session storage. Saved scene graphs, account or backup copies, and reports already downloaded remain under their own retention.')
  }
  const visible = (side: Side) => side === 'original' || (!session.blind && session.viewing)
  const sourceFeatureNames = new Set(session.original.graph.room_objects.map(point => point.name.toLowerCase()))
  const backgroundPairCount = session.suspicious.graph.room_objects.filter(point => sourceFeatureNames.has(point.name.toLowerCase())).length
  const limitedBackgroundEvidence = !!session.localDetection && backgroundPairCount < 4

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
      {side === 'original' && <><label className="field"><span>Or choose a saved scene map</span><select disabled={busy} value="" onChange={e => { const scene = scenes.find(s => s.id === e.target.value); if (scene) change('original', { ...emptyPhoto(), label: scene.label, hash: scene.fileHash, graph: scene.graph, masks: scene.mask ? [scene.mask] : [] }) }}><option value="">Choose a registered original</option>{scenes.map(scene => <option key={scene.id} value={scene.id}>{scene.label}</option>)}</select></label><p className="muted">Saved originals contain feature positions. Upload the photograph to find new details automatically.</p></>}
    </section>)}</div><Button disabled={busy || !hasOriginal || !hasSuspect} onClick={() => go(2)}>Continue to Privacy Review</Button></section>}
    {session.step === 2 && <section className="stack"><h2>2. Protect Privacy</h2><p>Blind Mode keeps the suspicious image concealed while you prepare the comparison.</p>
      <label className="checkline"><input disabled={busy} type="checkbox" checked={session.blind} onChange={e => update({ ...session, blind: e.target.checked, viewing: false })} /><span>Keep Blind Mode on</span></label>
      {!session.blind && <label className="checkline"><input disabled={busy} type="checkbox" checked={session.viewing} onChange={e => update({ ...session, viewing: e.target.checked })} /><span>I choose to view the suspicious photograph. It may contain sensitive content.</span></label>}
      <div className="check-columns"><ImageReview title={title('original')} photo={session.original} visible onChange={photo => change('original', photo)} mode="privacy" disabled={busy} /><section className="panel stack" aria-label="Suspicious Photograph automatic privacy masking"><h3>Suspicious Photograph</h3><ImageReview title={title('suspicious')} photo={session.suspicious} visible={visible('suspicious')} mode="preview" /><p className="note">People are masked automatically on this device when you continue. Manual masking and mask positioning are not offered for this photograph.</p>{session.suspicious.confirmed && <p role="status" className="muted">Automatic masking complete{session.suspicious.pixelMask?.data.some(value => value > 0) ? ' · person pixels covered' : ' · no person pixels detected'}.</p>}</section></div>
      <p className="note">Your original’s covers and the suspicious photograph’s automatic person mask are excluded from local feature detection. Blind Mode keeps the suspicious image concealed. No photo is sent to a server by this local workflow.</p>
      <div className="actions"><Button variant="secondary" disabled={busy} onClick={() => go(1)}>Back</Button><Button disabled={busy || !session.original.confirmed} onClick={() => void continuePrivacy()}>{busy ? 'Masking and continuing…' : 'Continue to Feature Review'}</Button></div>
    </section>}
    {session.step === 3 && <section className="stack"><h2>3. Review Available Features</h2><p>Cyan points are tentative local visual details, or points you added. “Detail 1” is a label, not object recognition. Select the comparison mode that fits these photographs.</p><p className="note">The background matcher is experimental and can miss crops, rotation, repeated textures, blur, occlusion, or changed backgrounds. Masked pixels are excluded. Concealed-image features remain visually unconfirmed.</p>
      <section className="panel stack adaptive-analysis"><h3>Adaptive analysis</h3><div className="check-columns adaptive-mode-grid"><article><span className="status status-neutral">Mode A · Default</span><h4>Background geometry</h4><p>{session.detectedKeypoints ? `${session.detectedKeypoints.source} / ${session.detectedKeypoints.suspect} corners measured; ${backgroundPairCount} tentative point pairs available.` : 'Compare reviewed points from the background and environment.'} Masks are excluded before detection.</p></article><article><span className={`status ${limitedBackgroundEvidence ? 'status-amber' : 'status-neutral'}`}>Mode C · Evidence availability</span><h4>{limitedBackgroundEvidence ? 'Limited visual evidence' : 'Background feature coverage'}</h4><p>{limitedBackgroundEvidence ? 'Fewer than four background point pairs are available. The background result may be inconclusive; do not treat missing matches as proof that images are unrelated.' : 'Feature counts and mask exclusions are shown above. Sparse or low-quality photos can still produce an inconclusive result.'}</p></article></div>
        {session.original.file && session.suspicious.file && <div className="face-consent-panel"><span className="status status-neutral">Mode B · Optional · On device</span><h4>Facial landmark geometry</h4><p>Use only for two close-up headshots with one visible face in each image; the model analyzes one face per image. It detects 18 named reference points from a 478-point mesh, but only the selected points are retained temporarily in memory to draw Proof. No identity search, database lookup, face template, external service, session-storage coordinates, or PDF coordinates.</p><p className="muted">Masked pixels are blacked out first and can make landmarks unavailable. Normalization uses estimated 3D eye/chin axes and inter-eye spacing. Pose, camera angle, lighting, expression, blur, and occlusion can still change the measurement. This compares facial shape only; it cannot identify a person or establish shared image origin.</p><label className="checkline"><input disabled={busy || faceBusy || !!facePreview} type="checkbox" checked={faceConsent} onChange={event => setFaceConsent(event.target.checked)} /><span>I explicitly consent to local facial landmark processing of both photographs for this comparison. No image or landmark data will be sent externally.</span></label><div className="actions"><Button variant="secondary" disabled={busy || faceBusy || !faceConsent || !!facePreview} onClick={() => void analyzeFaces()}>{faceBusy ? 'Analyzing facial geometry locally…' : 'Analyze facial geometry'}</Button>{faceBusy && <Button variant="ghost" onClick={() => { faceRequest.current?.abort(); faceRequest.current = null; sequence.current++; setFaceBusy(false); setFaceConsent(false); setNotice('Facial analysis cancelled. Images and landmarks were not sent externally.') }}>Cancel</Button>}{facePreview && <Button variant="ghost" onClick={() => { setFacePreview(null); setFaceConsent(false); setNotice('Temporary facial landmark coordinates cleared from the current view.') }}>Clear facial geometry</Button>}</div>{facePreview && <p role="status" className="note">{facePreview.alignedLandmarks}/{facePreview.sourceLandmarkCount} reference landmarks fall within {facePreview.alignmentThreshold.toFixed(2)} inter-eye spacings after local 3D-relative normalization. Mean residual: {facePreview.meanResidual?.toFixed(3)} inter-eye spacings. This is not an identity or source-image score.</p>}</div>}
      </section>
      <div className="check-columns">{sides.map(side => <ImageReview key={side} title={title(side)} photo={session[side]} visible={visible(side)} mode="features" disabled={busy || faceBusy} names={session.original.graph.room_objects.map(p => p.name)} onChange={photo => change(side, photo)} />)}</div>
      <Button variant="secondary" disabled={busy || faceBusy} onClick={() => void findFeatures()}>Reset background suggestions from images</Button>
      <label className="checkline"><input disabled={busy || faceBusy} type="checkbox" checked={session.reviewed} onChange={e => update({ ...session, reviewed: e.target.checked })} /><span>I reviewed the available details and understand concealed-image details have not been visually confirmed.</span></label>
      <div className="actions"><Button variant="secondary" disabled={busy || faceBusy} onClick={() => go(2)}>Back</Button><Button disabled={busy || faceBusy || !session.reviewed} onClick={() => go(4)}>Continue to Analysis</Button></div>
    </section>}
    {session.step === 4 && <section className="panel stack"><h2>4. Analyze</h2><p>Compare {session.original.graph.room_objects.length} original details with {session.suspicious.graph.room_objects.length} suspicious-image details. Covered regions are excluded again before comparison.</p><p className="muted">The engine measures agreement between paired detail positions. At least four pairs are needed for a decisive result. Ambiguous or sparse details can produce insufficient evidence.</p><div className="actions"><Button variant="secondary" disabled={busy} onClick={() => go(3)}>Back</Button><Button disabled={busy} onClick={() => void analyze()}>{busy ? 'Analyzing…' : 'Analyze Images'}</Button></div><ol className="stages" aria-live="polite">{stages.map(stage => <li className="stage" key={stage.id}><b>{stage.label}</b><span>{stage.detail}</span></li>)}</ol></section>}
    {session.step === 5 && <section className="panel stack"><h2>5. Explore Proof</h2>{current ? <><h3>{current.result.verdict === 'Likely derivative' ? 'Background correspondence supported' : current.result.verdict === 'No link found' ? 'No reliable geometric correspondence found' : 'Insufficient evidence'}</h3><p>{current.result.aligned_points} of {current.result.usable_points} paired details fall within the alignment threshold.</p><p className="note">This does not prove AI manipulation, identity, consent, ownership, or wrongdoing. No matches does not prove the photos are unrelated.</p><div className="actions"><Button to={`/proof?case=${encodeURIComponent(current.id)}`}>Explore Evidence Connections</Button><Button variant="secondary" to="/results">Detailed results</Button><Button variant="secondary" onClick={() => go(3)}>Review features again</Button></div><Button onClick={() => go(6)}>Continue to Generate Evidence Report</Button></> : <><p>The comparison is no longer available. Photos must be reselected after refreshing.</p><Button onClick={startOver}>Start a new comparison</Button></>}</section>}
    {session.step === 6 && <section className="panel stack"><h2>6. Generate Evidence Report</h2>{current ? <><p>Create a downloadable PDF from this completed comparison’s real metadata, measurements, reviewed correspondences, and limitations. Report generation happens on this device. It is explanatory and is not legally certified.</p><div className="panel check-report-preview"><p><b>Report {current.id}</b></p><p>Analyzed: {new Date(current.createdAt).toLocaleString()}</p><p>{current.result.aligned_points} aligned pairs of {current.result.usable_points} usable reviewed features · {current.detectedKeypoints ? `${current.detectedKeypoints.source} / ${current.detectedKeypoints.suspect} detected image corners` : 'detected image corner totals not captured'}</p><p>SHA-256: {current.sourceHash ? 'original available' : 'original unavailable'} · {current.suspectHash ? 'suspected file available' : 'suspected file unavailable'}</p></div><label className="checkline"><input type="checkbox" checked={includeMaskedThumbnails} disabled={!current.sourceMaskApplied && !current.suspectMaskApplied} onChange={e => setIncludeMaskedThumbnails(e.target.checked)} /><span>Include masked image thumbnails (off by default). Selected, privacy-covered image pixels will be embedded in the downloaded PDF and may be retained in copies or backups. Images without a recorded mask cannot be included.</span></label>{!current.sourceMaskApplied && !current.suspectMaskApplied && <p className="muted">No masked image thumbnails are available for this case.</p>}<p className="note">The report uses feature maps after masking exclusions. The PDF omits original photograph pixels unless you explicitly opt into eligible masked thumbnails. Masking reduces exposure but is not a guarantee of anonymization.</p><div className="actions"><Button disabled={!current} onClick={() => void downloadPdf()}>Download PDF Report</Button><Button variant="secondary" onClick={() => go(5)}>Return to Proof</Button><Button variant="secondary" onClick={startOver}>Start New Comparison</Button><Button variant="ghost" onClick={() => setCloseDialog(true)}>Close Case Securely</Button></div></> : <><p>No completed comparison is open. This workflow keeps uploaded photos in memory only, while a report you already downloaded remains on your device.</p><Button onClick={startOver}>Start New Comparison</Button></>}</section>}
    <div className="actions check-secondary"><Button variant="ghost" onClick={startOver}>Delete images and start a new comparison</Button></div>
    <details className="panel check-secondary" open={advanced} onToggle={e => setAdvanced(e.currentTarget.open)}><summary>Advanced Tools</summary>{advanced && <><p>Existing manual mapping, consented model assistance, saved-reference comparison, import tools, and diagnostics.</p><AdvancedCheck /><div className="actions">{sides.map(side => <Button key={side} variant="secondary" onClick={() => { const url = URL.createObjectURL(new Blob([JSON.stringify(session[side].graph, null, 2)], { type: 'application/json' })); const link = document.createElement('a'); link.href = url; link.download = `${side}-background.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }}>Export {side} background map</Button>)}</div></>}</details>
    <details className="panel check-secondary"><summary>Try a Sample Comparison</summary><p>Synthetic examples, separate from your photographs.</p><div className="actions"><Button to="/results?sample=derivative" variant="secondary">Sample shared background</Button><Button to="/results?sample=moved" variant="secondary">Sample moved camera</Button></div></details>
    <Dialog open={closeDialog} title="Close this case securely?" confirmLabel="Close Case Securely" onConfirm={closeCase} onClose={() => setCloseDialog(false)}><p>This clears the current comparison record from this tab’s session storage and releases the uploaded files, mask buffers, and redacted previews held in memory by Stillpoint.</p><p>It does not delete saved scene graphs, account or backup copies, browser downloads, or reports you have already downloaded. Those copies follow their own retention and deletion controls.</p></Dialog>
  </div>
}
