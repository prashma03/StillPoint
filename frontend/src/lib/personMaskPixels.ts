import type { PixelMask } from './checkSession'

/** The pinned SelfieSegmenter model has one 'selfie' foreground channel.
 * A conservative 0.35 threshold is an engineering choice, not an accuracy score. */
export function personMaskFromConfidence(width: number, height: number, confidence: Float32Array): PixelMask {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > 4_000_000 || confidence.length !== width * height) throw new Error('Invalid person mask dimensions')
  const data = new Uint8Array(confidence.length)
  for (let i = 0; i < confidence.length; i++) {
    const value = confidence[i]
    if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid person mask confidence')
    data[i] = value >= .35 ? 1 : 0
  }
  return { width, height, data }
}
