/* Bounding-box-only composition detector. No mesh, embeddings, or landmark model. */
importScripts('./jsfeat-min.js', './frontalface.js')
self.onmessage = ({ data: { data, width, height } }) => {
  try {
    if (!(data instanceof Uint8ClampedArray) || width * height * 4 !== data.length || width > 384 || height > 384) throw new Error('Invalid bounded image')
    const gray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t)
    jsfeat.imgproc.grayscale(data, width, height, gray)
    jsfeat.imgproc.equalize_histogram(gray, gray)
    const length = (width + 1) * (height + 1)
    const sum = new Int32Array(length), square = new Float64Array(length), tilted = new Int32Array(length)
    jsfeat.imgproc.compute_integral_image(gray, sum, square, tilted)
    const boxes = jsfeat.haar.group_rectangles(jsfeat.haar.detect_multi_scale(sum, square, tilted, null, width, height, self.frontalface, 1.2, 1), 3)
    self.postMessage({ boxes: boxes.slice(0, 16).map(box => ({ x: Math.max(0, box.x / width), y: Math.max(0, box.y / height), w: Math.min(1, box.width / width), h: Math.min(1, box.height / height) })) })
  } catch { self.postMessage({ error: 'Local composition detection unavailable. Choose a method manually.' }) }
}
