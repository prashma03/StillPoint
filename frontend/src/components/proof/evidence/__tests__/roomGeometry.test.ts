import { describe, expect, it } from 'vitest'
import { buildSimPairs, makeRoom } from '../roomGeometry'

describe('simulated Proof room geometry', () => {
  it('builds two structured room point clouds with recognizable architectural and furniture features', () => {
    const original = makeRoom(false)
    const compared = makeRoom(true)
    expect(original.count).toBeGreaterThan(3000)
    expect(compared.count).toBeGreaterThan(3000)
    expect([...new Set(original.categories)]).toEqual(expect.arrayContaining([
      'structure', 'floor', 'window', 'door', 'bed', 'desk', 'chair', 'shelf', 'poster', 'rug', 'lamp',
    ]))
    expect(original.wireframe.length).toBeGreaterThan(600)
    expect(original.wireframe.length % 6).toBe(0)
  })

  it('pairs landmarks by semantic feature key even when feature arrays have different order', () => {
    const original = makeRoom(false)
    const compared = makeRoom(true)
    compared.features.reverse()
    const pairs = buildSimPairs(original, compared)
    const rightByKey = new Map(compared.features.map((feature) => [feature.key, feature]))
    expect(pairs.length).toBeGreaterThan(500)
    expect(pairs.every((pair) => rightByKey.get(pair.key)?.index === pair.rightIndex)).toBe(true)
    expect(pairs.some((pair) => pair.strong && pair.category === 'window')).toBe(true)
    expect(pairs.some((pair) => pair.strong && pair.category === 'bed')).toBe(true)
    expect(pairs[0]).not.toHaveProperty('confidence')
  })
})
