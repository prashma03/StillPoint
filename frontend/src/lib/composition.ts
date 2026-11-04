import type { PhotoInput } from './checkSession'
import type { Mask } from './types'
import { decodeToPixels } from './redact'
import { measureFeatureAvailability } from './photoCompare'

export type AnalysisMethod = 'background' | 'facial' | 'inconclusive'
export type MethodChoice = 'automatic' | 'background' | 'facial'
export type CompositionClass = 'headshots' | 'environment' | 'mixed' | 'insufficient'
export type PhotoComposition = { faces: number; largestFaceArea: number; corners: number; occupiedCells: number }
export type Composition = { kind: CompositionClass; recommended: AnalysisMethod; source: PhotoComposition; suspect: PhotoComposition }
export const methodLabel = (method: AnalysisMethod) => method === 'facial' ? 'Facial Landmark Geometry' : method === 'background' ? 'Background Geometry' : 'Inconclusive'
export const compositionLabel: Record<CompositionClass, string> = { headshots: 'Close-up headshots', environment: 'Environmental detail', mixed: 'Faces and background', insufficient: 'Limited usable features' }

/** UI routing heuristics, not calibrated confidence or a forensic conclusion. */
export function classifyComposition(source: PhotoComposition, suspect: PhotoComposition): Composition {
  const rich = (p: PhotoComposition) => p.corners >= 12 && p.occupiedCells >= 5
  const close = (p: PhotoComposition) => p.faces === 1 && p.largestFaceArea >= .18 && (p.largestFaceArea >= .36 || !rich(p))
  const kind: CompositionClass = close(source) && close(suspect) ? 'headshots'
    : rich(source) && rich(suspect) ? (source.faces || suspect.faces ? 'mixed' : 'environment') : 'insufficient'
  return { kind, recommended: kind === 'headshots' ? 'facial' : kind === 'insufficient' ? 'inconclusive' : 'background', source, suspect }
}

async function faceBounds(data: Uint8ClampedArray, width: number, height: number, signal: AbortSignal): Promise<Mask[]> {
  signal.throwIfAborted()
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL(`${import.meta.env.BASE_URL}models/composition/detector.worker.js`, location.origin))
    const dispose = () => { clearTimeout(timer); signal.removeEventListener('abort', cancel); worker.terminate() }
    const cancel = () => { dispose(); reject(new DOMException('Composition scan cancelled.', 'AbortError')) }
    const timer = setTimeout(() => { dispose(); reject(new Error('Composition scan timed out. Select a method manually.')) }, 15000)
    signal.addEventListener('abort', cancel, { once: true })
    worker.onerror = event => { event.preventDefault(); dispose(); reject(new Error('Composition detection could not load. Select a method manually.')) }
    worker.onmessage = (event: MessageEvent<{ boxes?: Mask[]; error?: string }>) => {
      dispose()
      const boxes = event.data.boxes
      if (event.data.error || !Array.isArray(boxes) || boxes.some(box => ![box.x, box.y, box.w, box.h].every(Number.isFinite) || box.w <= 0 || box.h <= 0)) reject(new Error(event.data.error || 'Invalid composition output.'))
      else resolve(boxes)
    }
    const copy = new Uint8ClampedArray(data)
    try { worker.postMessage({ data: copy, width, height }, [copy.buffer]) } catch (error) { dispose(); reject(error) }
  })
}

export async function inspectComposition(original: PhotoInput, suspicious: PhotoInput, signal: AbortSignal): Promise<Composition> {
  const summaries: PhotoComposition[] = []
  for (const photo of [original, suspicious]) {
    if (!photo.file) throw new Error('Upload both original image files for composition inspection. Saved maps can still use background comparison.')
    const pixels = await decodeToPixels(photo.file, 384)
    signal.throwIfAborted()
    const boxes = await faceBounds(pixels.data, pixels.width, pixels.height, signal)
    signal.throwIfAborted()
    const measurements = measureFeatureAvailability(pixels, [...photo.masks, ...boxes.map(box => ({ x: Math.max(0, box.x - .03), y: Math.max(0, box.y - .03), w: box.w + .06, h: box.h + .06 }))], photo.pixelMask)
    summaries.push({ faces: boxes.length, largestFaceArea: boxes.reduce((max, box) => Math.max(max, Math.min(box.w, 1 - box.x) * Math.min(box.h, 1 - box.y)), 0), ...measurements })
  }
  return classifyComposition(summaries[0], summaries[1])
}
