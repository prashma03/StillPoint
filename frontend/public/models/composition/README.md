# Local composition inspection

JSFeat Haar frontal-face bounding-box detection, from the official MIT-licensed repository, pinned to commit `4c7b336bbeeb26e6cd4cdf3c7d414abe273846f3`:
https://github.com/inspirit/jsfeat/tree/4c7b336bbeeb26e6cd4cdf3c7d414abe273846f3

`jsfeat-min.js` SHA256: `974327515d68c91258efd3befa03622c41bbed8e3172771994604325799977a1`
`frontalface.js` SHA256: `a5500c515fb51b18c8118b2ede1f9dbf47bfd1f0be34c34b08492b1c477d7dee`
MIT license retained in LICENSE.txt and upstream attribution preserved in the cascade.

Only bounding rectangles are computed. Unlike a MediaPipe FaceDetector (which emits six facial keypoints), this detector does not generate facial landmarks, meshes, identity embeddings, or recognition templates. It runs in a disposable classic worker on images bounded to 256px. No CDN, telemetry, fetch, or external API. Only count, largest face area, and Harris corner distribution outside face bounds/masks reach the UI. Bounds are discarded. No detector data is written to persistent storage.

The frontal-face detector can miss profiles, small faces, occlusion, or poorly lit images and can produce false positives. A missing detection is not evidence that no person is present. Distributed corners are only a proxy for potential environmental detail, not semantic recognition. Thresholds in composition.ts are engineering choices, not calibrated confidence or accuracy scores. Classification routes the UI only; actual comparison remains separate and requires review/consent. Failure exposes manual selection and never launches facial landmark processing.
