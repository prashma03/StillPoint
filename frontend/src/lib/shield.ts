/** Experimental local image perturbation. It is not adversarially optimized or validated against a generative model. */

export type ShieldPixels = { data: Uint8ClampedArray; width: number; height: number }

export type ShieldOutput = {
  data: Uint8ClampedArray
  width: number
  height: number
  meanAbs: number
  maxAbs: number
  changedFraction: number
  psnr: number
  bound: number
  method: string
}

export const SHIELD_BASE = 3
export const SHIELD_EDGE = 8
export const SHIELD_BOUND = SHIELD_BASE + SHIELD_EDGE

const METHOD = 'Experimental deterministic edge-weighted high-frequency pixel perturbation, not an adversarially optimized defense. Each color sample moves by at most 11 levels. Flat areas move by 3; stronger edges move more, up to the bound. The pattern is not a logo, text, or translucent cover. Effectiveness has not been tested against image-editing models.'

function pattern(x: number, y: number) {
  return (((x * 17) ^ (y * 31)) & 1) === (((x >> 1) ^ (y >> 1)) & 1) ? 1 : -1
}

function clamp(value: number) {
  return value < 0 ? 0 : value > 255 ? 255 : value
}

export function applyProtectionShield(image: ShieldPixels): ShieldOutput {
  const { width, height, data } = image
  if (width < 2 || height < 2 || data.length < width * height * 4) {
    throw new Error('The photograph is too small to protect.')
  }
  const luma = new Float32Array(width * height)
  for (let index = 0; index < luma.length; index += 1) {
    const offset = index * 4
    luma[index] = data[offset] * 0.299 + data[offset + 1] * 0.587 + data[offset + 2] * 0.114
  }
  const out = new Uint8ClampedArray(data)
  let absSum = 0
  let maxAbs = 0
  let changed = 0
  let samples = 0
  let squareSum = 0
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x
      let magnitude = 0
      if (x > 0 && y > 0 && x < width - 1 && y < height - 1) {
        const gx = luma[index + width + 1] + 2 * luma[index + 1] + luma[index - width + 1]
          - luma[index + width - 1] - 2 * luma[index - 1] - luma[index - width - 1]
        const gy = luma[index - width - 1] + 2 * luma[index - width] + luma[index - width + 1]
          - luma[index + width - 1] - 2 * luma[index + width] - luma[index + width + 1]
        magnitude = Math.hypot(gx, gy)
      }
      const amp = SHIELD_BASE + SHIELD_EDGE * Math.min(1, magnitude / 128)
      const offset = index * 4
      for (let channel = 0; channel < 3; channel += 1) {
        const delta = Math.round(pattern(x + channel, y + channel * 2) * amp)
        const next = clamp(data[offset + channel] + delta)
        const difference = Math.abs(next - data[offset + channel])
        out[offset + channel] = next
        absSum += difference
        squareSum += difference * difference
        samples += 1
        if (difference > maxAbs) maxAbs = difference
        if (difference > 0) changed += 1
      }
    }
  }
  const mse = squareSum / samples
  return {
    data: out,
    width,
    height,
    meanAbs: absSum / samples,
    maxAbs,
    changedFraction: changed / samples,
    psnr: mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse),
    bound: SHIELD_BOUND,
    method: METHOD,
  }
}
