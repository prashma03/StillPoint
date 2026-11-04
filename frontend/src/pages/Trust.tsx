import { useMemo, useState } from 'react'
import { Button, usePageTitle } from '../components/ui'
import { sceneStore } from '../lib/storage'
import { localTrustOwnerId, trustStore, type EvidenceKind, type EvidenceStatus, type TrustClaim } from '../lib/trust'

const evidenceInfo: { kind: EvidenceKind; title: string; description: string }[] = [
  { kind: 'source-possession', title: 'Source possession', description: 'A source file hash can link a report to a file. It does not prove who made the image or owns it.' },
  { kind: 'scene-access', title: 'Scene access · optional', description: 'A randomized live scene challenge is not available. Access to a room would not prove ownership of a photograph.' },
  { kind: 'identity', title: 'Identity · optional', description: 'No identity provider is connected. Stillpoint does not collect identity documents, and identity alone would not prove who is depicted.' },
  { kind: 'consent', title: 'Consent declaration', description: 'A declaration can be recorded as self-declared. This local demo cannot witness or independently verify a signature.' },
]
const statusText: Record<EvidenceStatus, string> = {
  'not-provided': 'Not provided', 'self-declared': 'Self-declared · unverified', 'submitted-unverified': 'Submitted · unverified',
  'verified-externally': 'Verified by external provider', unavailable: 'Unavailable in this build',
}
const cards = [
  { id: 'evidence', icon: '◈', title: 'Evidence Integrity', text: 'Four independent evidence categories, local claim records, and response safeguards.' },
  { id: 'privacy', icon: '⌑', title: 'Privacy & Consent', text: 'See what stays in this session and when a separate consent is needed.' },
  { id: 'limits', icon: '◎', title: 'Analysis Limits', text: 'Understand what image geometry can show, and where it stops.' },
  { id: 'verify', icon: '▤', title: 'Verify a Report', text: 'Check report authenticity and integrity status.' },
] as const
type Detail = typeof cards[number]['id']

function freshEvidence() {
  return evidenceInfo.map(({ kind }) => ({ kind, status: kind === 'source-possession' ? 'submitted-unverified' as const : kind === 'consent' ? 'self-declared' as const : 'unavailable' as const }))
}
function outcomeDescription(outcome: TrustClaim['outcome']) {
  switch (outcome) {
    case 'Supported Match': return 'Available evidence supports a relationship between images. This does not establish identity, consent, or wrongdoing.'
    case 'Insufficient Evidence': return 'There is not enough reliable information to establish a relationship.'
    case 'Conflicting Claims': return 'Incompatible registrations require review. Automated enforcement is frozen.'
    case 'Cannot Determine': return 'The system cannot reach a reliable conclusion.'
  }
}
function Icon({ name }: { name: string }) {
  const common = { width: 25, height: 25, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, 'aria-hidden': true as const }
  if (name === 'evidence') return <svg {...common}><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z"/><path d="m8 12 2.5 2.5L16 9"/></svg>
  if (name === 'privacy') return <svg {...common}><rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3"/></svg>
  if (name === 'limits') return <svg {...common}><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2m5-2h-3"/></svg>
  return <svg {...common}><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h7M9 17h5"/></svg>
}

export function Trust() {
  usePageTitle('Trust & Verification')
  const ownerId = useMemo(localTrustOwnerId, [])
  const store = useMemo(trustStore, [])
  const [revision, setRevision] = useState(0)
  const [detail, setDetail] = useState<Detail | null>(null)
  const [selectedScene, setSelectedScene] = useState('')
  const [declaredNonConsent, setDeclaredNonConsent] = useState(false)
  const [appealTarget, setAppealTarget] = useState('')
  const [appealKind, setAppealKind] = useState<'appeal' | 'counter-notice'>('appeal')
  const [appealText, setAppealText] = useState('')
  const [message, setMessage] = useState('')
  const [scenario, setScenario] = useState<'supported' | 'missing'>('supported')
  const scenes = sceneStore().list()
  const claims = store.listForOwner(ownerId)
  const responses = store.responsesForOwner(ownerId)
  const summaries = store.reviewerSummary(ownerId)
  const latestEvidence = claims.at(-1)?.evidence ?? []

  function submitClaim() {
    if (!declaredNonConsent) { setMessage('Confirm the non-consent declaration to submit a claim.'); return }
    const scene = scenes.find((item) => item.id === selectedScene)
    if (!scene?.fileHash) { setMessage('Choose a saved source with a file hash. No photograph is submitted.'); return }
    try {
      store.submit(ownerId, scene.fileHash, freshEvidence())
      setSelectedScene(''); setDeclaredNonConsent(false)
      setMessage('Claim metadata saved on this device. Nothing was sent to a reviewer or service.')
      setRevision((n) => n + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Claim could not be saved.') }
  }
  function saveAppeal() {
    try {
      store.submitAppeal(ownerId, appealTarget, appealKind, appealText)
      setAppealText(''); setAppealTarget('')
      setMessage('Your private response was saved on this device. It was not sent.')
      setRevision((n) => n + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Response could not be saved.') }
  }
  const activeCard = cards.find(card => card.id === detail)

  return <main className={`page trust-page trust-redesign${detail ? ' has-detail' : ''}`} data-revision={revision}>
    <header className="trust-hero">
      <div><span className="eyebrow">STILLPOINT · TRUST CENTER</span><h1>{detail ? activeCard?.title : 'Trust is built on transparency.'}</h1><p>{detail ? activeCard?.text : 'See how Stillpoint handles evidence, privacy, and the limits of image analysis.'}</p></div>
      {!detail && <div className="trust-hero-mark" aria-hidden="true"><span>◇</span><i /><i /><i /></div>}
    </header>
    {!detail ? <>
      <div className="trust-session-status"><span className="trust-status-dot" /><div><strong>Guest session · local only</strong><span>Claims and private responses stay in this tab session. No live reviewer, identity provider, or external enforcement service is connected.</span></div></div>
      <nav className="trust-dashboard-grid" aria-label="Trust topics">{cards.map(card => <button key={card.id} className="trust-dashboard-card" type="button" onClick={() => { setDetail(card.id); setMessage('') }}><span className="trust-card-icon"><Icon name={card.id} /></span><span className="trust-card-copy"><strong>{card.title}</strong><span>{card.text}</span></span><span className="trust-card-arrow" aria-hidden="true">↗</span></button>)}</nav>
      <footer className="trust-dashboard-footer"><span>Evidence is shown with its source and status.</span><Button to="/settings" variant="ghost">Privacy settings</Button></footer>
    </> : <section className="trust-detail-view" key={detail} aria-labelledby="trust-detail-title">
      <div className="trust-detail-bar"><Button variant="secondary" onClick={() => { setDetail(null); setMessage('') }}>← Back to Trust</Button><span className="trust-detail-index">TRUST CENTER / {activeCard?.title.toUpperCase()}</span></div>
      <h2 id="trust-detail-title" className="sr-only">{activeCard?.title}</h2>
      {detail === 'evidence' && <div className="trust-detail-content">
        <section className="trust-detail-block"><div className="trust-detail-heading"><div><span className="eyebrow">01 · EVIDENCE INTEGRITY</span><h2>Four independent evidence categories</h2></div><p>Submitted and self-declared evidence is never shown as verified.</p></div>
          <div className="trust-evidence-grid">{evidenceInfo.map((item, i) => { const status = latestEvidence.find(entry => entry.kind === item.kind)?.status ?? (item.kind === 'source-possession' || item.kind === 'consent' ? 'not-provided' : 'unavailable'); return <article className="trust-evidence" key={item.kind}><div className="trust-evidence-top"><span className="trust-index">0{i + 1}</span><span className="trust-status">{statusText[status]}</span></div><h3>{item.title}</h3><p>{item.description}</p></article> })}</div>
        </section>
        <details className="trust-disclosure"><summary>How duplicate claims and responses are handled</summary><div className="trust-flow"><div><b>01</b><strong>Conflict detected</strong><span>Automated action pauses. A non-sensitive state record is kept.</span></div><i aria-hidden="true">→</i><div><b>02</b><strong>Both sides can respond</strong><span>Private appeals and counter-notices can be added locally.</span></div><i aria-hidden="true">→</i><div><b>03</b><strong>Independent human review</strong><span>Required before any consequential decision. No reviewer inbox is connected.</span></div></div><div className="trust-review panel"><div><h3>Reviewer summary</h3><p>Summary fields only: state, evidence status, timestamps, and conflict count. Images, faces, and private evidence are not shown.</p></div><span className="demo-pill">DEMO · LOCAL ONLY</span>{summaries.length === 0 ? <p className="muted">No locally visible conflicts are awaiting review.</p> : summaries.map(item => <div className="review-summary" key={item.claimId}><strong>{item.outcome}</strong><span>{item.conflictsWith} conflict(s) · {item.evidence.length} evidence categories · {new Date(item.createdAt).toLocaleString()}</span><span>Attestation workflow: {item.approvals}/2 approvals recorded from {item.assigned} assigned reviewers</span></div>)}</div><p className="note rule">High-impact actions require 2 independent approvals out of 3 assigned reviewers before a claim could be eligible for an external enforcement request. This is a workflow gate, not proof. This build has no reviewer identities or external enforcement connection and never sends takedowns.</p></details>
        <details className="trust-disclosure"><summary>Register a source claim</summary><p className="muted">Deterministic duplicate-source checks flag a conflict for review. Flags describe activity; they never label a person dishonest.</p><div className="trust-register panel"><label className="field"><span className="field-label">Saved source</span><select value={selectedScene} onChange={event => setSelectedScene(event.target.value)}><option value="">Choose a source with a file hash</option>{scenes.filter(scene => scene.fileHash).map(scene => <option key={scene.id} value={scene.id}>{scene.label} · {new Date(scene.createdAt).toLocaleDateString()}</option>)}</select></label><label className="checkline trust-declaration"><input type="checkbox" checked={declaredNonConsent} onChange={event => setDeclaredNonConsent(event.target.checked)} /><span>I declare that I am reporting use of this image without consent. This is a self-declaration, not a verified or witnessed signature.</span></label><p className="muted">Only the source file hash and claim metadata are stored. Stillpoint does not store or submit the photo. Limit: 5 submissions per hour on this device.</p><Button onClick={submitClaim} disabled={!selectedScene || !declaredNonConsent}>Save a local claim</Button></div></details>
        {claims.length > 0 && <section className="trust-detail-block"><h2>Local claims</h2><div className="trust-claims">{claims.map(claim => <article className={`trust-claim ${claim.state === 'conflict-frozen' ? 'is-frozen' : ''}`} key={claim.id}><div className="trust-claim-head"><div><span className="eyebrow">Claim · {claim.id.slice(0, 8)}</span><h3>{claim.outcome}</h3></div><span className={`claim-state ${claim.state === 'conflict-frozen' ? 'frozen' : ''}`}>{claim.state === 'conflict-frozen' ? 'Actions frozen' : claim.state.replaceAll('-', ' ')}</span></div><p>{outcomeDescription(claim.outcome)}</p><div className="claim-evidence-list">{claim.evidence.map(({ kind, status }) => <div key={kind}><span>{evidenceInfo.find(item => item.kind === kind)?.title}</span><span>{statusText[status]}</span></div>)}</div><div className="claim-meta"><span>Recorded {new Date(claim.createdAt).toLocaleString()}</span>{claim.conflictsWith.length > 0 && <span>{claim.conflictsWith.length} conflicting registration{claim.conflictsWith.length === 1 ? '' : 's'}</span>}</div>{claim.suspiciousFlags.length > 0 && <p className="trust-flag">Activity flagged for human review. This is not a finding about anyone's honesty.</p>}<div className="actions"><Button variant="secondary" onClick={() => { setAppealTarget(claim.id); setAppealKind('appeal') }}>Add information / appeal</Button>{claim.conflictsWith[0] && <Button variant="ghost" onClick={() => { setAppealTarget(claim.conflictsWith[0]); setAppealKind('counter-notice') }}>Respond to conflicting claim</Button>}</div></article>)}</div></section>}
        {responses.length > 0 && <section className="trust-responses"><h3>Your private responses</h3>{responses.map(response => <article key={response.id}><span>{response.kind === 'appeal' ? 'Appeal' : 'Counter-notice'} · {new Date(response.createdAt).toLocaleString()}</span><p>{response.text}</p><small>Visible in this browser tab session; not protected by an account.</small></article>)}</section>}
      </div>}
      {detail === 'privacy' && <div className="trust-detail-content"><div className="trust-session-status"><span className="trust-status-dot" /><div><strong>Guest session · account features unavailable</strong><span>Local Trust claims and responses are not protected by an account and do not sync across sessions.</span></div></div><section className="trust-detail-block"><span className="eyebrow">DATA HANDLING</span><h2>Keep private evidence private</h2><div className="trust-privacy-grid"><p>Stillpoint stores no face embeddings or identity documents. Identity checks and live scene challenges are unavailable.</p><p>Claim metadata and response text stay in this tab’s session storage and are not sent to another claimant, the Guide, or a reviewer service. Browser storage can be inspected or changed by someone with access to this browser profile; it is not a protected account or tamper-proof server ledger.</p></div></section><section className="trust-detail-block"><span className="eyebrow">CONSENT</span><h2>External processing is a separate choice</h2><p className="trust-detail-copy">External image processing requires separate explicit consent in the mapping workflow. Settings availability does not grant consent for any photograph. A provider may see image contents; retention is not verified. Cancelling cannot recall data already received by an external provider.</p><Button to="/settings" variant="secondary">Review privacy settings</Button></section></div>}
      {detail === 'limits' && <div className="trust-detail-content"><section className="trust-detail-block"><span className="eyebrow">ANALYSIS LIMITS</span><h2>Similarity is one measured signal</h2><p className="trust-detail-copy">Background similarity may support a relationship between images. It cannot prove identity, consent, ownership, authorship, manipulation, responsibility, or wrongdoing.</p><div className="trust-scenarios"><div className="chips" role="group" aria-label="Choose a simulated claim scenario"><button className={`chip${scenario === 'supported' ? ' on' : ''}`} type="button" aria-pressed={scenario === 'supported'} onClick={() => setScenario('supported')}>Independent checks support a claim</button><button className={`chip${scenario === 'missing' ? ' on' : ''}`} type="button" aria-pressed={scenario === 'missing'} onClick={() => setScenario('missing')}>Ownership evidence missing</button></div><article className="scenario-panel panel" aria-live="polite"><span className="status status-neutral">Simulated scenario · no real claim</span><h3>{scenario === 'supported' ? 'Several independent checks agree' : 'Similarity alone is not ownership evidence'}</h3><p>{scenario === 'supported' ? 'A source file link, a separately verified ownership record, and a valid consent record could support a claim when each comes from an independent check. Stillpoint’s current build cannot verify those external records or make a reviewer decision.' : 'A background match may support a relationship between images. If independent ownership evidence is missing, the claim remains insufficient: no accusation or enforcement action should follow from the match alone.'}</p><div className="scenario-state"><strong>{scenario === 'supported' ? 'Evidence state · supported in principle' : 'Evidence state · insufficient'}</strong><span>{scenario === 'supported' ? 'A human review and response opportunity are still required.' : 'Pause the claim, preserve the state, and allow both sides to respond.'}</span></div></article></div></section><details className="trust-disclosure"><summary>What a matching background does not establish</summary><ul className="trust-limit-list"><li>Who created the image</li><li>Whether distribution was consensual</li><li>The identity of the depicted person</li><li>Whether unrelated content was composited into the background</li></ul><p className="note">Background alignment alone cannot establish the identity of the depicted person, consent, or wrongdoing.</p><p className="note rule">A background match alone cannot trigger automatic punishment or removal.</p><p className="muted">Scene matching cannot establish the source when the background has been replaced. That condition is not detected automatically in this build. Sealed identity verification is not available in this build.</p></details><details className="trust-disclosure"><summary>How to interpret a result</summary><p>A result summarizes geometric correspondence between reviewed background features. The local matcher is experimental and can miss crops, rotation, repeated textures, occlusion, or changed backgrounds. Sparse or masked features may leave the result indeterminate. A no-link result does not establish that images are unrelated.</p><p>These examples explain evidence handling. They do not represent a reviewer decision or a live verification result.</p></details></div>}
      {detail === 'verify' && <div className="trust-detail-content"><section className="trust-unavailable"><span className="trust-unavailable-icon"><Icon name="verify" /></span><span className="status status-amber">Unavailable in this build</span><h2>Report verification is not connected</h2><p>Stillpoint can generate an explanatory PDF report, but this page cannot verify a report signature, issuer, or tamper-evident provenance. A file hash identifies bytes only; it does not establish who created the report or whether its claims are true.</p><p className="muted">No report-upload verifier, signing service, or trusted verification key is configured. We will not display a simulated verification result.</p><Button to="/check" variant="secondary">Open Check reports</Button></section></div>}
      {message && <p role="status" className="trust-message">{message}</p>}
    </section>}
    {appealTarget && <div className="trust-modal-backdrop" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) setAppealTarget('') }}><section className="trust-modal" role="dialog" aria-modal="true" aria-labelledby="response-title"><button className="trust-modal-close" onClick={() => setAppealTarget('')} aria-label="Close">×</button><span className="eyebrow">Private response · local only</span><h2 id="response-title">{appealKind === 'appeal' ? 'Add information or appeal' : 'Submit a counter-notice'}</h2><label className="field"><span className="field-label">Message</span><textarea value={appealText} maxLength={2000} onChange={event => setAppealText(event.target.value)} placeholder="Do not include images or identity documents." /></label><p className="muted">Saved only in this browser under your local profile. It is not sent to the other claimant or a reviewer.</p><div className="actions"><Button onClick={saveAppeal}>Save response</Button><Button variant="secondary" onClick={() => setAppealTarget('')}>Cancel</Button></div></section></div>}
  </main>
}
