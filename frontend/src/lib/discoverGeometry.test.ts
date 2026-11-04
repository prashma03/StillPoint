import { describe, expect, it } from 'vitest'
import { analyzeDiscoverImage, discoveryReport, imageToWorld } from './discoverGeometry'

function image(width: number, height: number, paint: (x: number, y: number) => number) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const value = paint(x, y)
    const index = (y * width + x) * 4
    data[index] = data[index + 1] = data[index + 2] = value
    data[index + 3] = 255
  }
  return { data, width, height }
}

describe('discovery geometry', () => {
  it('reads a floor line and separated walls as an approximate layout', () => {
    const source = image(160, 120, (x, y) => {
      if (y < 82 && x > 18 && x < 142) return 190
      return 28
    })
    const layout = analyzeDiscoverImage(source)
    expect(layout.mode).toBe('approximate-layout')
    expect(layout.floorY).toBeGreaterThan(0.55)
    expect(layout.corners.length).toBeGreaterThan(0)
    expect(layout.regions).toBeGreaterThan(0)
    expect(layout.segments.some(segment => segment.role === 'floor')).toBe(true)
    expect(layout.lines.some(line => line.illustrative)).toBe(true)
    expect(layout.note).toMatch(/not a verified 3D reconstruction/)
  })

  it('keeps a flat image as a feature map and does not invent a room', () => {
    const layout = analyzeDiscoverImage(image(80, 64, () => 120))
    expect(layout.mode).toBe('feature-map')
    expect(layout.floorY).toBeNull()
    expect(layout.segments).toHaveLength(0)
    expect(layout.lines.some(line => line.illustrative)).toBe(false)
    expect(layout.note).toMatch(/no room was invented/)
  })

  it('places a feature on the image plane instead of scattering it by strength', () => {
    const layout = analyzeDiscoverImage(image(80, 64, () => 30))
    const placed = imageToWorld(0.25, 0.75, layout)
    expect(placed.z).toBeCloseTo(0.07)
    expect(placed.x).toBeLessThan(0)
    expect(placed.y).toBeLessThan(0)
  })

  it('writes measured counts and labels illustrative depth without a safety claim', () => {
    const layout = analyzeDiscoverImage(image(160, 120, (x, y) => (y < 82 && x > 18 && x < 142 ? 190 : 28)))
    const report = discoveryReport('room.png', layout)
    expect(report).toContain('room.png')
    expect(report).toContain(`Corners: ${layout.corners.length}`)
    expect(report).toContain(`High-contrast regions: ${layout.regions}`)
    expect(report).toMatch(/illustrative/i)
    expect(report).not.toMatch(/completely safe|protected from AI|verified authentic/i)
    expect(report).toContain('not shared')
  })
})
