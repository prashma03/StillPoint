import { describe, expect, it } from 'vitest'
import { applyProtectionShield, SHIELD_BOUND } from './shield'

function solid(width: number, height: number, value: number) {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let index = 0; index < data.length; index += 4) {
    data[index] = data[index + 1] = data[index + 2] = value
    data[index + 3] = 255
  }
  return { data, width, height }
}

describe('protection shield', () => {
  it('changes pixel values within the stated bound and leaves the size unchanged', () => {
    const source = solid(32, 24, 140)
    const before = source.data.slice()
    const shield = applyProtectionShield(source)
    expect(source.data).toEqual(before)
    expect(shield.width).toBe(32)
    expect(shield.height).toBe(24)
    expect(shield.maxAbs).toBeGreaterThan(0)
    expect(shield.maxAbs).toBeLessThanOrEqual(SHIELD_BOUND)
    expect(shield.meanAbs).toBeGreaterThan(0)
    expect(shield.changedFraction).toBeGreaterThan(0.9)
    expect(shield.psnr).toBeGreaterThan(30)
    expect(shield.data).not.toEqual(before)
    expect(shield.method).toMatch(/not a logo/i)
  })

  it('moves edge pixels farther than a flat field, still inside the bound', () => {
    const image = solid(40, 40, 20)
    for (let y = 0; y < 40; y += 1) for (let x = 20; x < 40; x += 1) {
      const offset = (y * 40 + x) * 4
      image.data[offset] = image.data[offset + 1] = image.data[offset + 2] = 220
    }
    const shield = applyProtectionShield(image)
    const flatDelta = Math.abs(shield.data[4] - image.data[4])
    const edgeOffset = (20 * 40 + 20) * 4
    const edgeDelta = Math.abs(shield.data[edgeOffset] - image.data[edgeOffset])
    expect(edgeDelta).toBeGreaterThan(flatDelta)
    expect(edgeDelta).toBeLessThanOrEqual(SHIELD_BOUND)
  })

  it('refuses an image that is too small to process', () => {
    expect(() => applyProtectionShield(solid(1, 1, 10))).toThrow(/too small/)
  })
})
