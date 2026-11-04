import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision'

function restrictWorkerNetworkToSameOrigin() {
  const fetchLocal = self.fetch.bind(self)
  self.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' || input instanceof URL ? input.toString() : input.url
    if (new URL(url, self.location.href).origin !== self.location.origin) return Promise.reject(new TypeError('External network is disabled for facial geometry.'))
    return fetchLocal(input, init)
  }
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function(method: string, url: string | URL, async = true, username?: string | null, password?: string | null) {
    if (new URL(String(url), self.location.href).origin !== self.location.origin) throw new DOMException('External network is disabled for facial geometry.', 'NetworkError')
    return Reflect.apply(open, this, [method, String(url), async, username, password])
  }
  if (self.navigator.sendBeacon) {
    const beacon = self.navigator.sendBeacon.bind(self.navigator)
    self.navigator.sendBeacon = (url: string | URL, data?: BodyInit | null) => new URL(String(url), self.location.href).origin === self.location.origin && beacon(url, data)
  }
}

const anchors = [
  ['Forehead', 10], ['Left brow', 107], ['Right brow', 336],
  ['Left outer eye', 33], ['Left inner eye', 133], ['Right inner eye', 362], ['Right outer eye', 263],
  ['Nose bridge', 168], ['Nose tip', 1], ['Left nose edge', 98], ['Right nose edge', 327],
  ['Left cheek', 234], ['Right cheek', 454], ['Mouth left', 61], ['Upper lip', 13], ['Lower lip', 14], ['Mouth right', 291], ['Chin', 152],
] as const

self.onmessage = async (event: MessageEvent<{ bitmap: ImageBitmap; assets: string; model: string }>) => {
  const { bitmap, assets, model } = event.data
  let landmarker: FaceLandmarker | null = null
  let stage = 'runtime loading'
  try {
    restrictWorkerNetworkToSameOrigin()
    const vision = await FilesetResolver.forVisionTasks(`${assets}/wasm`, true)
    stage = 'model loading'
    landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: model, delegate: 'CPU' },
      runningMode: 'IMAGE', numFaces: 1, outputFaceBlendshapes: false, outputFacialTransformationMatrixes: false,
    })
    stage = 'landmark detection'
    const result = landmarker.detect(bitmap)
    const landmarks = result.faceLandmarks[0]
    if (!landmarks) throw new Error('No face was detected in this photograph.')
    const selected = anchors.map(([name, index]) => {
      const point = landmarks[index]
      if (!point) throw new Error('The local model returned an incomplete landmark set.')
      return { name, x: point.x, y: point.y, z: point.z }
    })
    self.postMessage({ landmarks: selected })
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Local facial landmark analysis failed.', stage, diagnostic: error instanceof Error ? error.message.slice(0, 300) : 'Unknown local model error' })
  } finally { bitmap.close(); landmarker?.close() }
}
