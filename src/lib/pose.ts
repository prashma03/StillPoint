export function smoothstep(edge0: number, edge1: number, x: number): number {
  const span = edge1 - edge0
  if (span === 0) return x >= edge1 ? 1 : 0
  const t = Math.min(1, Math.max(0, (x - edge0) / span))
  return t * t * (3 - 2 * t)
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export type Pose = {
  cameraZ: number
  cameraY: number
  wire: number
  ghost: number
  lines: number
  converge: number
  green: number
  roomOpacity: number
}

export function scenePose(input: {
  story: number
  slider: number
  alignU: number
  hold: boolean
}): Pose {
  const story = Math.min(1, Math.max(0, input.story))
  const slider = Math.min(1, Math.max(0, input.slider))
  const wire = smoothstep(0.18, 0.46, story)
  const ghost = smoothstep(0.5, 0.66, story)
  const dual = smoothstep(0.48, 0.66, story)
  const base: Pose = {
    cameraZ: lerp(lerp(6.55, 3.7, smoothstep(0.1, 0.4, story)), 7.2, dual),
    cameraY: lerp(1.95, 1.4, smoothstep(0.1, 0.4, story)),
    wire,
    ghost,
    lines: ghost,
    converge: story < 0.5 ? 0 : 1 - slider,
    green: story >= 0.5 && slider < 0.08 ? 1 : 0,
    roomOpacity: story < 0.78 ? 1 : Math.max(0, 1 - (story - 0.78) / 0.16),
  }

  if (input.alignU < 0 && !input.hold) return base
  const u = input.hold ? 1 : Math.min(1, Math.max(0, input.alignU))
  return {
    cameraZ: lerp(base.cameraZ, 3.45, smoothstep(0, 0.24, u)),
    cameraY: lerp(base.cameraY, 1.22, smoothstep(0, 0.24, u)),
    wire: lerp(base.wire, Math.max(base.wire, 0.4), smoothstep(0.08, 0.3, u)),
    ghost: lerp(base.ghost, 1, smoothstep(0.16, 0.36, u)),
    lines: lerp(base.lines, 1, smoothstep(0.4, 0.68, u)),
    converge: lerp(base.converge, 1, smoothstep(0.6, 0.9, u)),
    green: lerp(base.green, 1, smoothstep(0.84, 1, u)),
    roomOpacity: lerp(base.roomOpacity, 1, u),
  }
}
