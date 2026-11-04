import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import { personMaskFromConfidence } from './personMaskPixels'

self.onmessage = async (event: MessageEvent<{ bitmap: ImageBitmap; assets: string }>) => {
  const { bitmap, assets } = event.data
  let segmenter: ImageSegmenter | null = null
  let stage = 'runtime loading'
  try {
    const vision = await FilesetResolver.forVisionTasks(`${assets}/wasm`, true)
    stage = 'model loading'
    segmenter = await ImageSegmenter.createFromOptions(vision, {
      baseOptions: { modelAssetPath: `${assets}/selfie_segmenter.tflite`, delegate: 'CPU' },
      runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true,
      canvas: new OffscreenCanvas(bitmap.width, bitmap.height),
    })
    const labels = segmenter.getLabels().map(label => label.toLowerCase())
    stage = 'model labels'
    if (labels.length !== 1 || labels[0] !== 'selfie') throw new Error('Unsupported model labels')
    stage = 'inference'
    const result = segmenter.segment(bitmap)
    try {
      const mask = result.confidenceMasks?.[0]
      if (!mask) throw new Error('No foreground confidence mask')
      const { data } = personMaskFromConfidence(mask.width, mask.height, mask.getAsFloat32Array())
      self.postMessage({ width: mask.width, height: mask.height, data }, { transfer: [data.buffer] })
    } finally { result.close() }
  } catch (error) {
    self.postMessage({ error: `On-device masking could not run (${stage}). Use manual masking, or explicitly choose the external service.`, diagnostic: error instanceof Error ? error.message.slice(0, 400) : 'Local runtime error' })
  } finally { bitmap.close(); segmenter?.close() }
}
