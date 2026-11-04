import { describe, expect, it, vi } from 'vitest'
import { compareFaceLandmarks, runFaceLandmarks, type FaceLandmark } from './facialGeometry'
import { makeFaceCase } from './faceCase'
import { emptyCheck } from './checkSession'
import { reportText } from './report'
import { buildEvidencePdf } from './pdfReport'

const points: FaceLandmark[] = [
  { name: 'Left outer eye', x: .2, y: .4, z: 0 }, { name: 'Left inner eye', x: .35, y: .4, z: 0 },
  { name: 'Right inner eye', x: .65, y: .4, z: 0 }, { name: 'Right outer eye', x: .8, y: .4, z: 0 },
  { name: 'Chin', x: .5, y: .85, z: 0 }, { name: 'Nose tip', x: .5, y: .5, z: -.1 },
]
describe('consented facial geometry records', () => {
  it('refuses model initialization before consent', async () => {
    const worker = vi.fn(); vi.stubGlobal('Worker', worker)
    try { await expect(runFaceLandmarks(new Blob(), new AbortController().signal)).rejects.toThrow('Explicit consent'); expect(worker).not.toHaveBeenCalled() }
    finally { vi.unstubAllGlobals() }
  })
  it('measures actual geometry and keeps facial coordinates out of records and reports', async () => {
    const evidence = compareFaceLandmarks(points, points.map(p => ({ ...p, x: p.x * .8 + .1, y: p.y * .8 + .1, z: p.z * .8 })))
    expect(evidence.alignedLandmarks).toBe(points.length)
    expect(evidence.meanResidual).toBeLessThan(1e-10)
    const record = makeFaceCase(emptyCheck(), evidence)
    expect(record.analysisMethod).toBe('facial')
    expect(record.sourceGraph.room_objects).toHaveLength(0)
    expect(JSON.stringify(record)).not.toContain('"x":')
    expect(JSON.stringify(record)).not.toContain('Left outer eye')
    const text = reportText(record)
    expect(text).toContain('No background or identity comparison ran')
    expect(text).not.toContain('Likely derivative')
    expect(text).not.toContain('Left outer eye')
    const pdf = await buildEvidencePdf(record)
    expect(pdf.type).toBe('application/pdf'); expect(pdf.size).toBeGreaterThan(1000)
  })
})
