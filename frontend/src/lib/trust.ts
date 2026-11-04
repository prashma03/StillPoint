export type EvidenceKind = 'source-possession' | 'scene-access' | 'identity' | 'consent'
export type EvidenceStatus = 'not-provided' | 'self-declared' | 'submitted-unverified' | 'verified-externally' | 'unavailable'
export type ClaimOutcome = 'Supported Match' | 'Insufficient Evidence' | 'Conflicting Claims' | 'Cannot Determine'
export type ClaimState = 'open' | 'conflict-frozen' | 'appeal-pending' | 'human-review-required' | 'closed'
export type TrustEvidence = { kind: EvidenceKind; status: EvidenceStatus }
export type TrustClaim = {
  id: string
  ownerId: string
  sourceHash: string
  createdAt: string
  outcome: ClaimOutcome
  state: ClaimState
  evidence: TrustEvidence[]
  conflictsWith: string[]
  suspiciousFlags: string[]
  assignedReviewerIds: string[]
  attestations: { reviewerId: string; decision: 'approve' | 'decline'; at: string }[]
}
export type TrustAudit = { id: string; claimId: string; at: string; event: string; detail: string }
export type TrustAppeal = { id: string; claimId: string; ownerId: string; kind: 'appeal' | 'counter-notice'; text: string; createdAt: string }
export type TrustState = { claims: TrustClaim[]; audits: TrustAudit[]; appeals: TrustAppeal[]; attempts: { at: number; ownerId: string }[] }

const KEY = 'stillpoint.trust.v1'
export const CLAIM_WINDOW_MS = 60 * 60 * 1000
export const CLAIM_LIMIT = 5

export function emptyTrustState(): TrustState { return { claims: [], audits: [], appeals: [], attempts: [] } }

function validState(value: unknown): TrustState {
  if (!value || typeof value !== 'object') return emptyTrustState()
  const v = value as Partial<TrustState>
  return {
    claims: Array.isArray(v.claims) ? v.claims.filter((x): x is TrustClaim => !!x && typeof x.id === 'string' && typeof x.ownerId === 'string' && typeof x.sourceHash === 'string' && Array.isArray(x.evidence) && Array.isArray(x.conflictsWith) && Array.isArray(x.suspiciousFlags) && Array.isArray(x.assignedReviewerIds) && Array.isArray(x.attestations)) : [],
    audits: Array.isArray(v.audits) ? v.audits.filter((x): x is TrustAudit => !!x && typeof x.id === 'string' && typeof x.claimId === 'string' && typeof x.event === 'string' && typeof x.detail === 'string' && typeof x.at === 'string') : [],
    appeals: Array.isArray(v.appeals) ? v.appeals.filter((x): x is TrustAppeal => !!x && typeof x.id === 'string' && typeof x.claimId === 'string' && typeof x.ownerId === 'string' && typeof x.text === 'string') : [],
    attempts: Array.isArray(v.attempts) ? v.attempts.filter((x) => x && typeof x.ownerId === 'string' && typeof x.at === 'number') : [],
  }
}

export function createTrustStore(memory: { getItem(key: string): string | null; setItem(key: string, value: string): void }, options: { now?: () => number; id?: () => string } = {}) {
  const now = options.now ?? Date.now
  const id = options.id ?? (() => crypto.randomUUID())
  const load = () => {
    try { return validState(JSON.parse(memory.getItem(KEY) ?? 'null')) } catch { return emptyTrustState() }
  }
  const save = (state: TrustState) => memory.setItem(KEY, JSON.stringify(state))
  const audit = (state: TrustState, claimId: string, event: string, detail: string) => ({ ...state, audits: [...state.audits, { id: id(), claimId, at: new Date(now()).toISOString(), event, detail }] })
  return {
    listForOwner(ownerId: string): TrustClaim[] { return load().claims.filter((claim) => claim.ownerId === ownerId) },
    getForOwner(ownerId: string, claimId: string): TrustClaim | null { return load().claims.find((claim) => claim.id === claimId && claim.ownerId === ownerId) ?? null },
    auditForOwner(ownerId: string, claimId: string): TrustAudit[] {
      const state = load()
      if (!state.claims.some((claim) => claim.id === claimId && claim.ownerId === ownerId)) return []
      return state.audits.filter((event) => event.claimId === claimId)
    },
    submit(ownerId: string, sourceHash: string, evidence: TrustEvidence[]) {
      if (!ownerId || !sourceHash || !/^[a-f0-9]{32,128}$/i.test(sourceHash)) throw new Error('A valid source file hash is required.')
      const state = load()
      const recent = state.attempts.filter((attempt) => attempt.ownerId === ownerId && now() - attempt.at < CLAIM_WINDOW_MS)
      if (recent.length >= CLAIM_LIMIT) throw new Error('Claim rate limit reached. Try again later.')
      const sameOwner = state.claims.find((claim) => claim.ownerId === ownerId && claim.sourceHash === sourceHash)
      if (sameOwner) throw new Error('This source is already registered on this device.')
      const conflicts = state.claims.filter((claim) => claim.sourceHash === sourceHash)
      const claim: TrustClaim = { id: id(), ownerId, sourceHash, createdAt: new Date(now()).toISOString(), outcome: conflicts.length ? 'Conflicting Claims' : 'Insufficient Evidence', state: conflicts.length ? 'conflict-frozen' : 'open', evidence, conflictsWith: conflicts.map((item) => item.id), suspiciousFlags: conflicts.length ? ['same-source-registered-by-another-claimant'] : [], assignedReviewerIds: conflicts.length ? ['reviewer-a', 'reviewer-b', 'reviewer-c'] : [], attestations: [] }
      let next: TrustState = { ...state, claims: [...state.claims, claim], attempts: [...recent, { ownerId, at: now() }] }
      next = audit(next, claim.id, 'claim-submitted', 'Claim metadata recorded; no image content stored.')
      if (conflicts.length) {
        next = { ...next, claims: next.claims.map((item) => item.id === claim.id || conflicts.some((old) => old.id === item.id) ? { ...item, outcome: 'Conflicting Claims', state: 'conflict-frozen', conflictsWith: [...new Set([...item.conflictsWith, claim.id, ...conflicts.map((c) => c.id)])] } : item) }
        next = audit(next, claim.id, 'conflict-detected', 'Automated enforcement frozen pending independent human review.')
        for (const old of conflicts) next = audit(next, old.id, 'conflict-detected', 'A conflicting source registration requires review.')
      }
      save(next)
      return claim.id
    },
    submitAppeal(ownerId: string, claimId: string, kind: TrustAppeal['kind'], text: string) {
      const trimmed = text.trim()
      if (trimmed.length < 5 || trimmed.length > 2000) throw new Error('Enter between 5 and 2,000 characters.')
      const state = load()
      const claim = state.claims.find((item) => item.id === claimId && item.ownerId === ownerId)
      if (!claim) throw new Error('Claim not found.')
      const appeal: TrustAppeal = { id: id(), claimId, ownerId, kind, text: trimmed, createdAt: new Date(now()).toISOString() }
      let next = { ...state, appeals: [...state.appeals, appeal], claims: state.claims.map((item) => item.id === claimId ? { ...item, state: item.state === 'conflict-frozen' ? 'conflict-frozen' as const : 'appeal-pending' as const } : item) }
      next = audit(next, claimId, kind === 'appeal' ? 'appeal-submitted' : 'counter-notice-submitted', 'Private response saved on this device; it was not sent.')
      save(next)
      return appeal.id
    },
    attest(reviewerId: string, claimId: string, decision: 'approve' | 'decline') {
      const state = load()
      const claim = state.claims.find((item) => item.id === claimId)
      if (!claim || !claim.assignedReviewerIds.includes(reviewerId)) throw new Error('Reviewer is not assigned to this claim.')
      if (claim.attestations.some((item) => item.reviewerId === reviewerId)) throw new Error('This reviewer has already submitted an attestation.')
      const attestation = { reviewerId, decision, at: new Date(now()).toISOString() }
      let next = { ...state, claims: state.claims.map((item) => item.id === claimId ? { ...item, attestations: [...item.attestations, attestation] } : item) }
      next = audit(next, claimId, 'reviewer-attestation', 'A reviewer recorded a workflow decision; this is not proof that the claim is true.')
      save(next)
      return next.claims.find((item) => item.id === claimId)!.attestations.filter((item) => item.decision === 'approve').length >= 2
    },
    reviewerSummary(ownerId: string) {
      return load().claims.filter((claim) => claim.ownerId === ownerId && (claim.state === 'conflict-frozen' || claim.state === 'human-review-required')).map(({ id: claimId, outcome, state, createdAt, evidence, conflictsWith, attestations }) => ({ claimId, outcome, state, createdAt, evidence: evidence.map(({ kind, status }) => ({ kind, status })), conflictsWith: conflictsWith.length, approvals: attestations.filter((item) => item.decision === 'approve').length, assigned: claim.assignedReviewerIds.length }))
    },
  }
}

let singleton: ReturnType<typeof createTrustStore> | null = null
export function trustStore() {
  if (!singleton) {
    const memory = {
      getItem(key: string) { try { return localStorage.getItem(key) } catch { return null } },
      setItem(key: string, value: string) { try { localStorage.setItem(key, value) } catch { throw new Error('Browser storage is unavailable.') } },
    }
    singleton = createTrustStore(memory)
  }
  return singleton
}

export function localTrustOwnerId() {
  const key = 'stillpoint.trust.owner.v1'
  try {
    let owner = localStorage.getItem(key)
    if (!owner) { owner = crypto.randomUUID(); localStorage.setItem(key, owner) }
    return owner
  } catch { return 'local-device-session' }
}
