import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, PageHeader, usePageTitle } from '../components/ui'
import { DiscoverScan } from '../components/DiscoverScan'
import { discoverRequest, readSearchImage, safeLink, setDiscoveryHandoff, type Candidate, type DiscoverStatus } from '../lib/discover'
import { sha256 } from '../lib/hash'
import { sceneStore } from '../lib/storage'

export function Discover() {
  usePageTitle('Discover')
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const scenes = useMemo(() => sceneStore().list(), [])
  const [sceneId, setSceneId] = useState(params.get('scene') ?? scenes[0]?.id ?? '')
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
  useEffect(() => {
    const controller = new AbortController()
    void discoverRequest<DiscoverStatus>('status', AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]))
      .then(setStatus).catch(() => { if (!controller.signal.aborted) setError('Discovery backend unavailable. Start the local backend, then reload this page.') })
    return () => { controller.abort(); request.current?.abort() }
  }, [])

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
  return <div className="page discover">
    <PageHeader eyebrow="Discover" title="Find possible visual derivatives" lede="Search a supported public image index, then examine background geometry in Check." />
    <DiscoverScan onContinue={summary => navigate('/proof', { state: { discoveryScan: summary } })} />
    <div className="split"><div className="stack">
      <section className="panel stack">
        <h2>Original photograph</h2>
        {!scenes.length && <p className="note">No saved scene maps are on this device. New background comparisons start in Check. Protect changes a photograph; it does not create a scene map.</p>}
        <label className="field"><span>Registered original</span><select disabled={running} value={sceneId} onChange={e => { reset(); setSceneId(e.target.value); setFile(null) }}>
          <option value="">Choose an original</option>{scenes.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select></label>
        <p className="muted">Stillpoint does not retain your photograph. Reselect the exact registered file; its hash is checked locally.</p>
        <label className="field"><span>Reselect original (JPEG, PNG, WebP; 8 MB maximum)</span><input disabled={running} type="file" accept="image/jpeg,image/png,image/webp" onChange={e => { reset(); setFile(e.target.files?.[0] ?? null) }} /></label>
        <h2>Authorize one search</h2>
        <p className="muted">The complete original image bytes will travel through your local backend to TinEye, an external reverse image search service. The image is not masked for this search. No public upload URL is created. TinEye’s processing is subject to its <a href="https://services.tineye.com/privacy" target="_blank" rel="noreferrer">privacy policy</a>. Backgrounds can also reveal personal information.</p>
        <label className="checkline"><input type="checkbox" disabled={running} checked={nonSensitive} onChange={e => setNonSensitive(e.target.checked)} /><span>This is a non-intimate, non-sensitive image I am authorized to submit.</span></label>
        <label className="checkline"><input type="checkbox" disabled={running} checked={consent} onChange={e => setConsent(e.target.checked)} /><span>I explicitly authorize sending this original to TinEye for this search.</span></label>
        <div className="actions"><Button disabled={running || !status?.configured || !scene?.fileHash || !file || !consent || !nonSensitive} onClick={() => void search()}>Search public images</Button>
          {running && <Button variant="secondary" onClick={() => { request.current?.abort(); setRunning(false); setConsent(false); setMessage('Search cancelled. An upload already received by TinEye cannot be recalled; any pending response is discarded.') }}>Cancel search</Button>}</div>
        {running && <span className="indet" />}
        <p role="status" aria-live="polite">{message}</p>
        {error && <p className="error" role="alert">{error}</p>}
      </section>
    </div><aside className="panel stack"><h2>Provider configuration</h2>
      <span className="status status-amber">{status ? status.configured ? 'TinEye key configured · access unverified' : 'TinEye not configured' : 'Checking backend…'}</span>
      <p className="muted">{status?.sources ?? 'TinEye public web index. Coverage is incomplete.'}</p>
      {status && !status.configured && <p className="note">Set TINEYE_API_KEY in the backend environment or .env and restart it. A paid TinEye API account with search credits is required. A model API key cannot enable search.</p>}
      <p className="muted">Direct image-upload search is supported by this adapter. No keyword fallback or demonstration results are used.</p>
      <p className="note">Search relevance is not geometric verification. Background correspondence cannot prove identity, manipulation, or wrongdoing.</p>
    </aside></div>
    {candidates && <section className="stack" aria-label="Search candidates"><h2>Potential candidates ({candidates.length})</h2>
      {!candidates.length && <p className="panel">No candidates returned. This does not establish that no derivatives exist.</p>}
      <p className="muted">Remote previews are disabled because display permission has not been established. Stillpoint does not fetch candidate URLs. Open the source and, where authorized, save a local copy for Check. Website authentication and access restrictions still apply.</p>
      <div className="discover-gallery">{candidates.map(candidate => <article key={candidate.id} className="panel discover-candidate stack">
        <div className="discover-preview" aria-label="Preview unavailable">Preview unavailable</div>
        <span className="status status-amber">Unverified candidate</span><h3>{candidate.domain || 'TinEye candidate'}</h3>
        <p className="muted">TinEye relevance: {candidate.provider_score ?? 'Not supplied'} · Not a geometry score</p>
        {candidate.links.map((link, index) => <div key={index}>{safeLink(link.page) && <a target="_blank" rel="noreferrer" href={safeLink(link.page)}>Source page {index + 1}</a>} {safeLink(link.image) && <a target="_blank" rel="noreferrer" href={safeLink(link.image)}>Image link</a>}<p className="footer-note">Indexed: {link.crawl_date || 'Not supplied'}</p></div>)}
        {safeLink(candidate.image) && <a target="_blank" rel="noreferrer" href={safeLink(candidate.image)}>Provider image link</a>}
        <Button variant="secondary" onClick={() => { setDiscoveryHandoff({ sceneId, candidate }); navigate(`/check?scene=${encodeURIComponent(sceneId)}&discover=1`) }}>Verify Candidate</Button>
      </article>)}</div>
    </section>}
  </div>
}
