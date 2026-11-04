import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision'
import { personMaskFromConfidence } from './personMaskPixels'

/** Keep MediaPipe's optional telemetry and all other egress off the image worker. */
function restrictWorkerNetworkToSameOrigin() {
  const fetchLocal = self.fetch.bind(self)
  self.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = typeof input === 'string' || input instanceof URL ? input.toString() : input.url
    if (new URL(requestUrl, self.location.href).origin !== self.location.origin) {
      return Promise.reject(new TypeError('External network access is disabled in local masking.'))
    }
    return fetchLocal(input, init)
  }
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async = true, username?: string | null, password?: string | null) {
    if (new URL(String(url), self.location.href).origin !== self.location.origin) throw new DOMException('External network access is disabled in local masking.', 'NetworkError')
    return Reflect.apply(open, this, [method, String(url), async, username, password])
  }
  if (self.navigator.sendBeacon) {
    const sendBeacon = self.navigator.sendBeacon.bind(self.navigator)
    self.navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => new URL(String(url), self.location.href).origin === self.location.origin && sendBeacon(url, data)
  }
}

self.onmessage = async (event: MessageEvent<{ bitmap: ImageBitmap; assets: string }>) => {
  const { bitmap, assets } = event.data
  let segmenter: ImageSegmenter | null = null
  let stage = 'runtime loading'
  try {
    restrictWorkerNetworkToSameOrigin()
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
