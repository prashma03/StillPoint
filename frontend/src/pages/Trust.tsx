import { useMemo, useState } from 'react'
import { Button, PageHeader, usePageTitle } from '../components/ui'
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

export function Trust() {
  usePageTitle('Trust & Verification')
  const ownerId = useMemo(localTrustOwnerId, [])
  const store = useMemo(trustStore, [])
  const [revision, setRevision] = useState(0)
  const [selectedScene, setSelectedScene] = useState('')
  const [appealTarget, setAppealTarget] = useState('')
  const [appealKind, setAppealKind] = useState<'appeal' | 'counter-notice'>('appeal')
  const [appealText, setAppealText] = useState('')
  const [message, setMessage] = useState('')
  const scenes = sceneStore().list()
  const claims = store.listForOwner(ownerId)
  const summaries = store.reviewerSummary(ownerId)

  function submitClaim() {
    const scene = scenes.find((item) => item.id === selectedScene)
    if (!scene?.fileHash) { setMessage('Choose a saved source with a file hash. No photograph is submitted.'); return }
    try {
      store.submit(ownerId, scene.fileHash, freshEvidence())
      setSelectedScene('')
      setMessage('Claim metadata saved on this device. Nothing was sent to a reviewer or service.')
      setRevision((n) => n + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Claim could not be saved.') }
  }

  function saveAppeal() {
    try {
      store.submitAppeal(ownerId, appealTarget, appealKind, appealText)
      setAppealText('')
      setAppealTarget('')
      setMessage('Your private response was saved on this device. It was not sent.')
      setRevision((n) => n + 1)
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Response could not be saved.') }
  }

  return <div className="page trust-page" data-revision={revision}>
    <PageHeader eyebrow="Trust & Verification" title="Evidence with limits, safeguards for both sides." lede="Background similarity can support a relationship between images. It cannot prove identity, consent, ownership, or wrongdoing." />
    <div className="trust-banner"><strong>Local demo workflow</strong><span>Claims and private responses stay in this browser. There is no live reviewer service, identity provider, or external enforcement integration.</span></div>

    <section className="trust-section">
      <div className="section-heading"><div><span className="eyebrow">01 · Evidence</span><h2>Four independent categories</h2></div><p>Submitted and self-declared evidence is never displayed as verified.</p></div>
      <div className="trust-evidence-grid">{evidenceInfo.map((item, i) => <article className="trust-evidence" key={item.kind}><div className="trust-evidence-top"><span className="trust-index">0{i + 1}</span><span className="trust-status">{statusText[item.kind === 'source-possession' ? 'submitted-unverified' : item.kind === 'consent' ? 'self-declared' : 'unavailable']}</span></div><h3>{item.title}</h3><p>{item.description}</p></article>)}</div>
    </section>

    <section className="trust-section">
      <div className="section-heading"><div><span className="eyebrow">02 · Claim integrity</span><h2>Register a source claim</h2></div><p>Deterministic duplicate-source checks flag a conflict for review. Flags describe activity; they never label a person dishonest.</p></div>
      <div className="trust-register panel"><label className="field"><span className="field-label">Saved source</span><select value={selectedScene} onChange={(event) => setSelectedScene(event.target.value)}><option value="">Choose a source with a file hash</option>{scenes.filter((scene) => scene.fileHash).map((scene) => <option key={scene.id} value={scene.id}>{scene.label} · {new Date(scene.createdAt).toLocaleDateString()}</option>)}</select></label><p className="muted">Only the source file hash and claim metadata are stored. Stillpoint does not store or submit the photo. Limit: 5 submissions per hour on this device.</p><Button onClick={submitClaim} disabled={!selectedScene}>Save a local claim</Button></div>
      {claims.length > 0 && <div className="trust-claims">{claims.map((claim) => <article className={`trust-claim ${claim.state === 'conflict-frozen' ? 'is-frozen' : ''}`} key={claim.id}>
        <div className="trust-claim-head"><div><span className="eyebrow">Claim · {claim.id.slice(0, 8)}</span><h3>{claim.outcome}</h3></div><span className={`claim-state ${claim.state === 'conflict-frozen' ? 'frozen' : ''}`}>{claim.state === 'conflict-frozen' ? 'Actions frozen' : claim.state.replaceAll('-', ' ')}</span></div>
        <p>{outcomeDescription(claim.outcome)}</p>
        <div className="claim-evidence-list">{claim.evidence.map(({ kind, status }) => <div key={kind}><span>{evidenceInfo.find((x) => x.kind === kind)?.title}</span><span>{statusText[status]}</span></div>)}</div>
        <div className="claim-meta"><span>Recorded {new Date(claim.createdAt).toLocaleString()}</span>{claim.conflictsWith.length > 0 && <span>{claim.conflictsWith.length} conflicting registration{claim.conflictsWith.length === 1 ? '' : 's'}</span>}</div>
        {claim.suspiciousFlags.length > 0 && <p className="trust-flag">Activity flagged for human review. This is not a finding about anyone's honesty.</p>}
        <div className="actions"><Button variant="secondary" onClick={() => { setAppealTarget(claim.id); setAppealKind('appeal') }}>Add information / appeal</Button><Button variant="ghost" onClick={() => { setAppealTarget(claim.id); setAppealKind('counter-notice') }}>Submit counter-notice</Button></div>
      </article>)}</div>}
      {message && <p role="status" className="trust-message">{message}</p>}
    </section>

    <section className="trust-section">
      <div className="section-heading"><div><span className="eyebrow">03 · Conflicts & review</span><h2>Pause, preserve, allow a response</h2></div></div>
      <div className="trust-flow"><div><b>01</b><strong>Conflict detected</strong><span>Automated action pauses. A non-sensitive state record is kept.</span></div><i aria-hidden="true">→</i><div><b>02</b><strong>Both sides can respond</strong><span>Private appeals and counter-notices can be added locally.</span></div><i aria-hidden="true">→</i><div><b>03</b><strong>Independent human review</strong><span>Required before any consequential decision. No reviewer inbox is connected.</span></div></div>
      <div className="trust-review panel"><div><h3>Reviewer summary</h3><p>Summary fields only: state, evidence status, timestamps, and conflict count. Images, faces, and private evidence are not shown.</p></div><span className="demo-pill">DEMO · LOCAL ONLY</span>{summaries.length === 0 ? <p className="muted">No locally visible conflicts are awaiting review.</p> : summaries.map((item) => <div className="review-summary" key={item.claimId}><strong>{item.outcome}</strong><span>{item.conflictsWith} conflict(s) · {item.evidence.length} evidence categories · {new Date(item.createdAt).toLocaleString()}</span><span>Attestation workflow: {item.approvals}/2 approvals recorded from {item.assigned} assigned reviewers</span></div>)}</div>
      <p className="note rule">High-impact actions require 2 independent approvals out of 3 assigned reviewers before a claim could be eligible for an external enforcement request. This is a workflow gate, not proof. This build has no reviewer identities or external enforcement connection and never sends takedowns.</p>
    </section>

    <section className="trust-section"><div className="section-heading"><div><span className="eyebrow">04 · Privacy</span><h2>Keep private evidence private</h2></div></div><div className="trust-privacy-grid"><p>Stillpoint stores no face embeddings or identity documents. Identity checks and live scene challenges are unavailable. External image processing requires separate explicit consent in the mapping workflow.</p><p>Private claimant evidence is not exposed to other claimants or the Guide. Local audit entries record state changes without image content; browser storage is editable and is not a tamper-proof server ledger.</p></div></section>

    <section className="trust-section trust-final"><div><span className="eyebrow">Stillpoint Guide</span><h2>What does a matching background mean?</h2><p>No. A background match may support a relationship between images, but it cannot establish identity, consent, ownership, or responsibility.</p></div><Button to="/settings" variant="secondary">Privacy settings</Button></section>

    {appealTarget && <div className="trust-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setAppealTarget('') }}><section className="trust-modal" role="dialog" aria-modal="true" aria-labelledby="response-title"><button className="trust-modal-close" onClick={() => setAppealTarget('')} aria-label="Close">×</button><span className="eyebrow">Private response · local only</span><h2 id="response-title">{appealKind === 'appeal' ? 'Add information or appeal' : 'Submit a counter-notice'}</h2><label className="field"><span className="field-label">Response type</span><select value={appealKind} onChange={(event) => setAppealKind(event.target.value as typeof appealKind)}><option value="appeal">Appeal / additional information</option><option value="counter-notice">Counter-notice</option></select></label><label className="field"><span className="field-label">Message</span><textarea value={appealText} maxLength={2000} onChange={(event) => setAppealText(event.target.value)} placeholder="Do not include images or identity documents." /></label><p className="muted">Saved only in this browser. It is not sent to the other claimant or a reviewer.</p><div className="actions"><Button onClick={saveAppeal}>Save response</Button><Button variant="secondary" onClick={() => setAppealTarget('')}>Cancel</Button></div></section></div>}
  </div>
}
