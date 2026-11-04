// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { MemoryRouter } from 'react-router-dom'
import { CaseProvider } from '../../components/case'
import { Check } from '../Check'
import { clearCheckSession, emptyCheck, emptyPhoto, saveCheckSession } from '../../lib/checkSession'
import { classifyComposition } from '../../lib/composition'
import { inspectComposition } from '../../lib/composition'
import { runFaceLandmarks } from '../../lib/facialGeometry'

vi.mock('../../lib/composition', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/composition')>(), inspectComposition: vi.fn() }))
vi.mock('../../lib/facialGeometry', async importOriginal => ({ ...await importOriginal<typeof import('../../lib/facialGeometry')>(), runFaceLandmarks: vi.fn() }))
vi.mock('../../lib/ai', () => ({ getAIStatus: () => Promise.resolve({ configured: false }) }))
const headshot = { faces: 1, largestFaceArea: .5, corners: 2, occupiedCells: 1 }
beforeEach(() => {
  vi.mocked(inspectComposition).mockResolvedValue(classifyComposition(headshot, headshot))
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:test') })
  Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() })
  const photo = { ...emptyPhoto(), file: new File(['sample'], 'sample.png', { type: 'image/png' }), confirmed: true }
  saveCheckSession({ ...emptyCheck(), original: photo, suspicious: { ...photo }, step: 4, reviewed: true })
})
afterEach(() => { cleanup(); clearCheckSession(); sessionStorage.clear(); vi.restoreAllMocks(); vi.clearAllMocks() })
const mount = () => render(<MemoryRouter><CaseProvider><Check /></CaseProvider></MemoryRouter>)
describe('unified adaptive Check', () => {
  it('recommends a headshot method without starting landmarks and requires fresh consent', async () => {
    mount()
    await waitFor(() => expect(screen.getByText(/Close-up headshots/)).toBeTruthy())
    const consent = screen.getByRole('checkbox', { name: /I explicitly consent/ }) as HTMLInputElement
    expect(consent.checked).toBe(false)
    expect((screen.getByRole('button', { name: 'Analyze Images' }) as HTMLButtonElement).disabled).toBe(true)
    expect(runFaceLandmarks).not.toHaveBeenCalled()
    fireEvent.click(consent)
    expect((screen.getByRole('button', { name: 'Analyze Images' }) as HTMLButtonElement).disabled).toBe(false)
    fireEvent.change(screen.getByLabelText('Choose method'), { target: { value: 'background' } })
    expect(screen.queryByRole('checkbox', { name: /I explicitly consent/ })).toBeNull()
    fireEvent.change(screen.getByLabelText('Choose method'), { target: { value: 'facial' } })
    expect((screen.getByRole('checkbox', { name: /I explicitly consent/ }) as HTMLInputElement).checked).toBe(false)
    expect(runFaceLandmarks).not.toHaveBeenCalled()
    expect(screen.getAllByRole('heading', { name: 'Analysis Method' })).toHaveLength(1)
  })
  it('keeps manual background selection usable when local inspection fails', async () => {
    vi.mocked(inspectComposition).mockRejectedValue(new Error('Detector unavailable'))
    mount()
    await waitFor(() => expect(screen.getByText(/Detector unavailable/)).toBeTruthy())
    fireEvent.change(screen.getByLabelText('Choose method'), { target: { value: 'background' } })
    expect(screen.queryByRole('checkbox', { name: /I explicitly consent/ })).toBeNull()
    expect(runFaceLandmarks).not.toHaveBeenCalled()
  })
  it('cancels inspection and ignores a stale recommendation', async () => {
    let finish!: (value: ReturnType<typeof classifyComposition>) => void
    vi.mocked(inspectComposition).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    mount()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel inspection' }))
    expect(vi.mocked(inspectComposition).mock.calls.at(-1)?.[2].aborted).toBe(true)
    finish(classifyComposition(headshot, headshot))
    await waitFor(() => expect(screen.getByText(/Composition inspection cancelled/)).toBeTruthy())
    expect(screen.queryByRole('checkbox', { name: /I explicitly consent/ })).toBeNull()
    expect(runFaceLandmarks).not.toHaveBeenCalled()
  })
})
