/* Bounding-box-only composition detector. No mesh, embeddings, or landmark model. */
self.window = self // JSFeat's browser UMD export expects a window global.
self.onmessage = ({ data: { data, width, height } }) => {
  try {
    if (!(data instanceof Uint8ClampedArray) || width * height * 4 !== data.length || width > 384 || height > 384) throw new Error('Invalid bounded image')
    const pixels = new Uint8Array(width * height)
    let total = 0, squared = 0
    for (let index = 0; index < width * height; index++) {
      const value = Math.round(.299 * data[index * 4] + .587 * data[index * 4 + 1] + .114 * data[index * 4 + 2])
      pixels[index] = value; total += value; squared += value ** 2
    }
    if (squared / (width * height) - (total / (width * height)) ** 2 < 4) { self.postMessage({ boxes: [] }); return }
    importScripts('./jsfeat-min.js', './frontalface.js')
    const gray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t)
    gray.data.set(pixels)
    jsfeat.imgproc.equalize_histogram(gray, gray)
    const detect = input => {
      const length = (width + 1) * (height + 1)
      const sum = new Int32Array(length), square = new Float64Array(length), tilted = new Int32Array(length)
      jsfeat.imgproc.compute_integral_image(input, sum, square, tilted)
      const candidates = jsfeat.haar.detect_multi_scale(sum, square, tilted, null, width, height, jsfeat.haar.frontalface, 1.2, 1)
      if (candidates.length > 1000) throw new Error('Too many ambiguous detection windows')
      return jsfeat.haar.group_rectangles(candidates, 3)
    }
    const boxes = detect(gray)
    self.postMessage({ boxes: boxes.slice(0, 16).map(box => ({ x: Math.max(0, box.x / width), y: Math.max(0, box.y / height), w: Math.min(1, box.width / width), h: Math.min(1, box.height / height) })) })
  } catch { self.postMessage({ error: 'Local composition detection unavailable. Choose a method manually.' }) }
}
