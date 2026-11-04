import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { clearCaseRaw, loadCaseRaw, saveCaseRaw, sessionMemory } from '../lib/storage'
import type { CaseRecord } from '../lib/types'
import type { FaceGeometryEvidence } from '../lib/facialGeometry'

type CaseApi = {
  record: CaseRecord | null
  setRecord: (record: CaseRecord | null) => void
  faceEvidence: FaceGeometryEvidence | null
  setFaceEvidence: (evidence: FaceGeometryEvidence | null) => void
}

const CaseContext = createContext<CaseApi | null>(null)

function readSession(): CaseRecord | null {
  const memory = sessionMemory()
  if (!memory) return null
  const raw = loadCaseRaw(memory)
  if (!raw || typeof raw !== 'object') return null
  const record = raw as CaseRecord
  if (!record.result || typeof record.result.verdict !== 'string') return null
  if (!record.presentation || !record.sourceGraph || !record.suspectGraph) return null
  return record
}

export function CaseProvider({ children }: { children: ReactNode }) {
  const [record, setState] = useState<CaseRecord | null>(readSession)
  const [faceEvidence, setFaceState] = useState<FaceGeometryEvidence | null>(null)
  const active = useRef(true)
  useEffect(() => { active.current = true; return () => { active.current = false } }, [])
  function setRecord(next: CaseRecord | null) {
    if (!active.current) return // A previous identity's pending comparison cannot write into the new session.
    setState(next)
    if (!next) setFaceState(null)
    const memory = sessionMemory()
    if (!memory) return
    if (next) saveCaseRaw(memory, next)
    else clearCaseRaw(memory)
  }
  function setFaceEvidence(next: FaceGeometryEvidence | null) {
    if (active.current) setFaceState(next)
  }
  return <CaseContext.Provider value={{ record, setRecord, faceEvidence, setFaceEvidence }}>{children}</CaseContext.Provider>
}

export function useCaseRecord() {
  const value = useContext(CaseContext)
  if (!value) throw new Error('Case context is missing')
  return value
}
