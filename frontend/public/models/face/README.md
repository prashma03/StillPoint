# Face Landmarker model

This Stillpoint feature uses the MediaPipe Face Landmarker task model (`face_landmarker.task`).

- Download source: https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
- SHA-256: `64184E229B263107BC2B804C6625DB1341FF2BB731874B0BCC2FE6544E0BC9FF`
- Runtime: `@mediapipe/tasks-vision` 1.2.2; WebAssembly runtime assets are reused from `../person/wasm`.
- License: Apache License 2.0, see [LICENSE.txt](./LICENSE.txt).
- Official documentation: https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js

The local worker is started only after explicit user consent. It accepts same-origin asset requests only, processes redacted images, keeps selected landmark coordinates in volatile page memory, and is terminated after each image. It does not persist face templates or raw landmarks.
