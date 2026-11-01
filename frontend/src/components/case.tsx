import { createContext, useContext, useState, type ReactNode } from 'react'
import { clearCaseRaw, loadCaseRaw, saveCaseRaw, sessionMemory } from '../lib/storage'
import type { CaseRecord } from '../lib/types'

type CaseApi = {
  record: CaseRecord | null
  setRecord: (record: CaseRecord | null) => void
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
  function setRecord(next: CaseRecord | null) {
    setState(next)
    const memory = sessionMemory()
    if (!memory) return
    if (next) saveCaseRaw(memory, next)
    else clearCaseRaw(memory)
  }
  return <CaseContext.Provider value={{ record, setRecord }}>{children}</CaseContext.Provider>
}

export function useCaseRecord() {
  const value = useContext(CaseContext)
  if (!value) throw new Error('Case context is missing')
  return value
}
