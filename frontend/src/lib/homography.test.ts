import { describe, expect, it } from 'vitest'
import { applyHomography, verifyHomography, type PlanePoint } from './homography'

function shift(points: PlanePoint[], dx: number, dy: number): PlanePoint[] {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }))
}

describe('homography verification', () => {
  const square: PlanePoint[] = [
    { x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.2, y: 0.8 }, { x: 0.8, y: 0.8 }, { x: 0.5, y: 0.5 }, { x: 0.35, y: 0.62 },
  ]

  it('accepts a translated copy and reports the reprojection error in pixels', () => {
    const fit = verifyHomography(square, shift(square, 0.08, -0.04), 640, 480)
    expect(fit.matrix).not.toBeNull()
    expect(fit.verified).toBe(square.length)
    expect(fit.rejected).toBe(0)
    expect(fit.meanVerifiedErrorPx).toBeLessThan(1.5)
    const projected = applyHomography(fit.matrix!, square[0])
    expect(projected).not.toBeNull()
    expect(projected!.x).toBeCloseTo(square[0].x + 0.08, 2)
    expect(projected!.y).toBeCloseTo(square[0].y - 0.04, 2)
  })

  it('rejects a pair that does not follow the same transform', () => {
    const source = [...square, { x: 0.12, y: 0.9 }]
    const target = [...shift(square, 0.05, 0.02), { x: 0.9, y: 0.1 }]
    const fit = verifyHomography(source, target, 640, 640)
    expect(fit.statuses.at(-1)).toBe('rejected')
    expect(fit.verified).toBe(square.length)
    expect(fit.rejected).toBe(1)
  })

  it('does not invent a model when fewer than four pairs are available', () => {
    const fit = verifyHomography(square.slice(0, 3), shift(square.slice(0, 3), 0.1, 0), 640, 480)
    expect(fit.matrix).toBeNull()
    expect(fit.statuses).toEqual(['candidate', 'candidate', 'candidate'])
    expect(fit.verified).toBe(0)
    expect(fit.meanVerifiedErrorPx).toBeNull()
  })
})
