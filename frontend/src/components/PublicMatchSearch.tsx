import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from './ui'
import { discoverRequest, readSearchImage, safeLink, setDiscoveryHandoff, type Candidate, type DiscoverStatus } from '../lib/discover'
import { sha256 } from '../lib/hash'
import { sceneStore } from '../lib/storage'

export function PublicMatchSearch({ initialSceneId = '', startOpen = false }: { initialSceneId?: string; startOpen?: boolean }) {
  const navigate = useNavigate()
  const scenes = sceneStore().list()
  const [open, setOpen] = useState(startOpen)
  const [sceneId, setSceneId] = useState(initialSceneId || scenes[0]?.id || '')
  const scene = scenes.find(item => item.id === sceneId)
  const [status, setStatus] = useState<DiscoverStatus | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [consent, setConsent] = useState(false)
  const [nonSensitive, setNonSensitive] = useState(false)
  const [candidates, setCandidates] = useState<Candidate[] | null>(null)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [running, setRunning] = useState(false)
  const request = useRef<AbortController | null>(null)
  const panel = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    void discoverRequest<DiscoverStatus>('status', AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
      .then(setStatus)
      .catch(() => { if (!controller.signal.aborted) setStatus({ provider: 'TinEye', configured: false, sources: '', missing: ['unavailable'] }) })
    return () => { controller.abort(); request.current?.abort() }
  }, [open])
  useEffect(() => { if (open && startOpen) panel.current?.scrollIntoView?.({ block: 'start' }) }, [open, startOpen])

  function reset() { request.current?.abort(); setConsent(false); setNonSensitive(false); setCandidates(null); setError(''); setMessage(''); setRunning(false) }
  async function search() {
    if (!scene || !file || !consent || !nonSensitive || !status?.configured) return
    const controller = new AbortController()
    request.current = controller
    setRunning(true); setCandidates(null); setError(''); setMessage('Checking the original on this device…')
    try {
      const image = await readSearchImage(file)
      if (!scene.fileHash || await sha256(file) !== scene.fileHash) throw new Error('This file does not match the saved scene map. Graph-only records cannot be searched.')
      controller.signal.throwIfAborted()
      setMessage('Searching TinEye’s public image index…')
      const result = await discoverRequest<{ candidates: Candidate[] }>('search', AbortSignal.any([controller.signal, AbortSignal.timeout(40000)]), { image, consent: true, non_sensitive: true })
      if (!controller.signal.aborted) { setCandidates(result.candidates); setConsent(false); setMessage('Search complete. All candidates remain unverified.') }
    } catch (err) {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : 'Search failed.'); setMessage('') }
    } finally { if (request.current === controller && !controller.signal.aborted) { setRunning(false); setConsent(false) } }
  }

  return <section className="discover-public" ref={panel} aria-labelledby="public-match-title">
    <div className="discover-public-intro">
      <div><p className="eyebrow">Optional</p><h2 id="public-match-title">Search for Public Matches</h2><p className="muted">This is separate from the local discovery scan. The scan does not need it, and it does not run unless you open it and authorize a search.</p></div>
      <button type="button" className="btn btn-secondary" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide public search' : 'Search for Public Matches'}</button>
    </div>
    {open && <div className="panel stack">
      <p>An authorized search sends the complete unmasked original image through the local backend to TinEye, an external provider. The image is not masked. No public upload URL is created. TinEye’s processing is subject to its <a href="https://services.tineye.com/privacy" target="_blank" rel="noreferrer">privacy policy</a>.</p>
      {!status && <p role="status">Checking whether public image search is available.</p>}
      {status && !status.configured && <p className="note" role="status">Public image search is currently unavailable. You can still finish the local discovery scan on this page. Stillpoint will not invent search results.</p>}
      {status?.configured && <>
        <p className="muted">Provider: TinEye public web index. Coverage is incomplete. Search relevance is not geometric verification.</p>
        {!scenes.length && <p className="note">No saved scene maps are on this device. A public search can only resubmit a photograph that already matches a saved scene hash.</p>}
        <label className="field"><span>Registered original</span><select disabled={running} value={sceneId} onChange={event => { reset(); setSceneId(event.target.value); setFile(null) }}>
          <option value="">Choose an original</option>{scenes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <p className="muted">Stillpoint does not retain your photograph. Reselect the exact registered file; its hash is checked locally.</p>
        <label className="field"><span>Reselect original (JPEG, PNG, WebP; 8 MB maximum)</span><input disabled={running} type="file" accept="image/jpeg,image/png,image/webp" onChange={event => { reset(); setFile(event.target.files?.[0] ?? null) }} /></label>
        <h3>Authorize one search</h3>
        <label className="checkline"><input type="checkbox" disabled={running} checked={nonSensitive} onChange={event => setNonSensitive(event.target.checked)} /><span>This is a non-intimate, non-sensitive image I am authorized to submit.</span></label>
        <label className="checkline"><input type="checkbox" disabled={running} checked={consent} onChange={event => setConsent(event.target.checked)} /><span>I explicitly authorize sending this original to TinEye for this search.</span></label>
        <div className="actions"><Button disabled={running || !scene?.fileHash || !file || !consent || !nonSensitive} onClick={() => void search()}>Search public images</Button>
          {running && <Button variant="secondary" onClick={() => { request.current?.abort(); setRunning(false); setConsent(false); setMessage('Search cancelled. An upload already received by TinEye cannot be recalled; any pending response is discarded.') }}>Cancel search</Button>}</div>
        {running && <span className="indet" />}
        <p role="status" aria-live="polite">{message}</p>
        {error && <p className="error" role="alert">{error}</p>}
        {candidates && <div className="stack" aria-label="Search candidates"><h3>Potential candidates ({candidates.length})</h3>
          {!candidates.length && <p>No candidates returned. This does not establish that no derivatives exist.</p>}
          <p className="muted">Remote previews are disabled because display permission has not been established. Stillpoint does not fetch candidate URLs.</p>
          <div className="discover-gallery">{candidates.map(candidate => <article key={candidate.id} className="panel discover-candidate stack">
            <div className="discover-preview" aria-label="Preview unavailable">Preview unavailable</div>
            <span className="status status-amber">Unverified candidate</span><h3>{candidate.domain || 'TinEye candidate'}</h3>
            <p className="muted">TinEye relevance: {candidate.provider_score ?? 'Not supplied'} · Not a geometry score</p>
            {candidate.links.map((link, index) => <div key={index}>{safeLink(link.page) && <a target="_blank" rel="noreferrer" href={safeLink(link.page)}>Source page {index + 1}</a>} {safeLink(link.image) && <a target="_blank" rel="noreferrer" href={safeLink(link.image)}>Image link</a>}<p className="footer-note">Indexed: {link.crawl_date || 'Not supplied'}</p></div>)}
            {safeLink(candidate.image) && <a target="_blank" rel="noreferrer" href={safeLink(candidate.image)}>Provider image link</a>}
            <Button variant="secondary" onClick={() => { setDiscoveryHandoff({ sceneId, candidate }); navigate(`/check?scene=${encodeURIComponent(sceneId)}&discover=1`) }}>Verify Candidate</Button>
          </article>)}</div>
        </div>}
      </>}
    </div>}
  </section>
}
