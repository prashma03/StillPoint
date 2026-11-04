import { describe, expect, it } from 'vitest'
import { createMemoryStore } from './storage'
import { createTrustStore, emptyTrustState, type TrustEvidence } from './trust'

const hash = 'ab'.repeat(32)
const evidence: TrustEvidence[] = [
  { kind: 'source-possession', status: 'submitted-unverified' },
  { kind: 'scene-access', status: 'unavailable' },
  { kind: 'identity', status: 'unavailable' },
  { kind: 'consent', status: 'self-declared' },
]

function setup() {
  const memory = createMemoryStore()
  let clock = 1_800_000_000_000
  let sequence = 0
  const store = createTrustStore(memory, { now: () => clock, id: () => `id-${++sequence}` })
  return { store, tick: (ms: number) => { clock += ms }, memory }
}

describe('Trust Stack integrity safeguards', () => {
  it('freezes both registrations on a duplicate source and flags activity without accusing either claimant', () => {
    const { store } = setup()
    const first = store.submit('alice', hash, evidence)
    const second = store.submit('bob', hash, evidence)
    expect(store.getForOwner('alice', first)).toMatchObject({ outcome: 'Conflicting Claims', state: 'conflict-frozen', conflictsWith: [second] })
    expect(store.getForOwner('bob', second)).toMatchObject({ outcome: 'Conflicting Claims', state: 'conflict-frozen', conflictsWith: [first], suspiciousFlags: ['same-source-registered-by-another-claimant'] })
    expect(store.auditForOwner('alice', first).map((item) => item.event)).toContain('conflict-detected')
  })

  it('rejects invalid hashes, repeated registrations, and excessive claim attempts', () => {
    const { store, tick } = setup()
    expect(() => store.submit('alice', 'no-hash', evidence)).toThrow(/valid source file hash/)
    store.submit('alice', hash, evidence)
    expect(() => store.submit('alice', hash, evidence)).toThrow(/already registered/)
    for (let i = 0; i < 4; i += 1) {
      tick(1)
      store.submit('alice', (i + 1).toString(16).padStart(2, '0').repeat(32), evidence)
    }
    tick(1)
    expect(() => store.submit('alice', 'ff'.repeat(32), evidence)).toThrow(/rate limit/)
    expect(store.listForOwner('alice')).toHaveLength(5)
  })

  it('keeps claim detail, audit, and appeals inaccessible to a different claimant', () => {
    const { store } = setup()
    const id = store.submit('alice', hash, evidence)
    expect(store.getForOwner('bob', id)).toBeNull()
    expect(store.auditForOwner('bob', id)).toEqual([])
    expect(store.listForOwner('bob')).toEqual([])
    expect(() => store.submitAppeal('bob', id, 'counter-notice', 'I dispute this claim.')).toThrow(/not found/)
    expect(store.reviewerSummary('bob')).toEqual([])
  })

  it('stores an appeal as a state event without exposing it in claim summaries', () => {
    const { store } = setup()
    const id = store.submit('alice', hash, evidence)
    store.submitAppeal('alice', id, 'counter-notice', 'I dispute this source registration.')
    expect(store.getForOwner('alice', id)?.state).toBe('appeal-pending')
    expect(store.auditForOwner('alice', id).at(-1)?.event).toBe('counter-notice-submitted')
    expect(JSON.stringify(store.reviewerSummary('alice'))).not.toContain('dispute this source')
    expect(() => store.submitAppeal('alice', id, 'appeal', 'data:image/jpeg;base64,AAAA')).toThrow()
  })

  it('allows a related respondent to counter-notice while keeping the response private', () => {
    const { store } = setup()
    const aliceClaim = store.submit('alice', hash, evidence)
    const bobClaim = store.submit('bob', hash, evidence)
    store.submitAppeal('bob', aliceClaim, 'counter-notice', 'I did not submit this source claim.')
    expect(store.responsesForOwner('bob')).toHaveLength(1)
    expect(store.responsesForOwner('alice')).toEqual([])
    expect(store.getForOwner('bob', bobClaim)?.state).toBe('conflict-frozen')
    expect(JSON.stringify(store.auditForOwner('alice', aliceClaim))).not.toContain('did not submit')
  })

  it('requires two distinct assigned reviewer approvals and never closes or enforces a claim automatically', () => {
    const { store } = setup()
    store.submit('alice', hash, evidence)
    const id = store.submit('bob', hash, evidence)
    expect(store.attest('reviewer-a', id, 'approve')).toBe(false)
    expect(() => store.attest('reviewer-a', id, 'approve')).toThrow(/already submitted/)
    expect(store.attest('reviewer-b', id, 'approve')).toBe(true)
    expect(store.getForOwner('bob', id)?.state).toBe('conflict-frozen')
    expect(store.getForOwner('bob', id)?.outcome).toBe('Conflicting Claims')
    expect(() => store.attest('not-assigned', id, 'approve')).toThrow(/not assigned/)
  })

  it('uses no image payloads and preserves a safely empty state', () => {
    expect(emptyTrustState()).toEqual({ claims: [], audits: [], appeals: [], attempts: [] })
    const { store, memory } = setup()
    store.submit('alice', hash, evidence)
    const raw = memory.getItem('stillpoint.trust.v1') ?? ''
    expect(raw).not.toMatch(/data:image|data:video/i)
    expect(raw).not.toContain('identity document')
  })
})

