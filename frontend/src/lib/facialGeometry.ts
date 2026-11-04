export type FaceLandmark = { name: string; x: number; y: number; z: number }
export type FaceGeometryEvidence = {
  source: FaceLandmark[]
  suspect: FaceLandmark[]
  sourceLandmarkCount: number
  suspectLandmarkCount: number
  alignedLandmarks: number
  alignmentThreshold: number
  meanResidual: number | null
  maxResidual: number | null
  limitations: string
}

/** Runs only on an explicitly consented, already redacted local image. */
export async function runFaceLandmarks(file: Blob, signal: AbortSignal): Promise<FaceLandmark[]> {
  signal.throwIfAborted()
  if (typeof Worker === 'undefined' || typeof createImageBitmap !== 'function') throw new Error('Local facial geometry is unavailable in this browser. No external service was contacted.')
  const bitmap = await createImageBitmap(file)
  if (signal.aborted) { bitmap.close(); signal.throwIfAborted() }
  return new Promise((resolve, reject) => {
    let worker: Worker
    try { worker = new Worker(new URL('./localFaceLandmarks.worker.ts', import.meta.url), { type: 'module' }) }
    catch { bitmap.close(); reject(new Error('Could not start the local facial geometry worker. No external service was contacted.')); return }
    const dispose = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate() }
    const cancel = () => { dispose(); reject(new DOMException('Facial geometry cancelled.', 'AbortError')) }
    const timer = setTimeout(() => { dispose(); reject(new Error('Local facial geometry timed out. No image was sent externally.')) }, 45_000)
    signal.addEventListener('abort', cancel, { once: true })
    worker.onerror = event => { event.preventDefault(); dispose(); reject(new Error(`Local facial model could not load. ${event.message || 'Reload and try again.'} No image was sent externally.`)) }
    worker.onmessage = (event: MessageEvent<{ landmarks?: FaceLandmark[]; error?: string; stage?: string; diagnostic?: string }>) => {
      dispose()
      if (event.data.error) reject(new Error(`${event.data.error} (${event.data.stage ?? 'local analysis'}). No image was sent externally.`))
      else if (!Array.isArray(event.data.landmarks) || event.data.landmarks.length < 4 || event.data.landmarks.some(point => ![point.x, point.y, point.z].every(Number.isFinite))) reject(new Error('The local face model returned incomplete landmarks.'))
      else resolve(event.data.landmarks)
    }
    try { worker.postMessage({ bitmap, assets: new URL(`${import.meta.env.BASE_URL}models/person`, window.location.origin).href, model: new URL(`${import.meta.env.BASE_URL}models/face/face_landmarker.task`, window.location.origin).href }, [bitmap]) }
    catch { bitmap.close(); dispose(); reject(new Error('Could not transfer pixels to the local face worker.')) }
  })
}

type Vec3 = [number, number, number]
function subtract(a: Vec3, b: Vec3): Vec3 { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function dot(a: Vec3, b: Vec3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2] }
function cross(a: Vec3, b: Vec3): Vec3 { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] }
function unit(a: Vec3): Vec3 { const size = Math.hypot(...a); return size < 1e-8 ? [0, 0, 0] : [a[0] / size, a[1] / size, a[2] / size] }
function distance(a: Vec3, b: Vec3) { return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) }

/** Re-expresses selected 3D landmarks in an eye/chin-aligned frame and eye-spacing units. */
function normalizeFace(points: FaceLandmark[]): Vec3[] {
  const byName = new Map(points.map(point => [point.name, point]))
  const get = (name: string): Vec3 => { const p = byName.get(name); if (!p) throw new Error('Eye or chin landmarks were not available for normalization.'); return [p.x, p.y, p.z] }
  const leftEye = unit(subtract(get('Left outer eye'), get('Left inner eye')))
  const rightEye = unit(subtract(get('Right outer eye'), get('Right inner eye')))
  const leftCenter = get('Left inner eye').map((v, i) => (v + get('Left outer eye')[i]) / 2) as Vec3
  const rightCenter = get('Right inner eye').map((v, i) => (v + get('Right outer eye')[i]) / 2) as Vec3
  const eyeMid: Vec3 = [(leftCenter[0] + rightCenter[0]) / 2, (leftCenter[1] + rightCenter[1]) / 2, (leftCenter[2] + rightCenter[2]) / 2]
  const eyeAxis = unit(subtract(rightCenter, leftCenter))
  const chinVector = subtract(get('Chin'), eyeMid)
  const vertical = unit([chinVector[0] - dot(chinVector, eyeAxis) * eyeAxis[0], chinVector[1] - dot(chinVector, eyeAxis) * eyeAxis[1], chinVector[2] - dot(chinVector, eyeAxis) * eyeAxis[2]])
  const depth = unit(cross(eyeAxis, vertical))
  const scale = distance(leftCenter, rightCenter)
  if (scale < 1e-5 || Math.hypot(...leftEye) < .5 || Math.hypot(...rightEye) < .5) throw new Error('Face landmarks are too incomplete for geometric normalization.')
  return points.map(point => {
    const delta = subtract([point.x, point.y, point.z], eyeMid)
    return [dot(delta, eyeAxis) / scale, dot(delta, vertical) / scale, dot(delta, depth) / scale]
  })
}

/** Returns descriptive geometric measurements, never an identity or similarity score. */
export function compareFaceLandmarks(source: FaceLandmark[], suspect: FaceLandmark[], threshold = .12): FaceGeometryEvidence {
  if (source.length !== suspect.length || source.length < 4) throw new Error('Both images need the same minimum set of facial reference landmarks.')
  if (source.some((point, index) => point.name !== suspect[index]?.name)) throw new Error('Facial reference landmarks do not correspond.')
  const a = normalizeFace(source), b = normalizeFace(suspect)
  const residuals = a.map((point, index) => distance(point, b[index]))
  return {
    source: source.map(point => ({ ...point })), suspect: suspect.map(point => ({ ...point })),
    sourceLandmarkCount: source.length, suspectLandmarkCount: suspect.length,
    alignedLandmarks: residuals.filter(residual => residual <= threshold).length,
    alignmentThreshold: threshold,
    meanResidual: residuals.reduce((sum, residual) => sum + residual, 0) / residuals.length,
    maxResidual: Math.max(...residuals),
    limitations: 'Face points were normalized to eye/chin axes and inter-eye spacing using the model’s estimated 3D coordinates. This may reduce crop, scale, roll, and some pose variation, but yaw, expression, lighting, occlusion, and model error still affect results. Face geometry is not identity verification and does not show that images derive from the same source.',
  }
}
