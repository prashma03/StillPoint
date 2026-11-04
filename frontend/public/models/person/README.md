# Bundled on-device person segmentation

Runtime: @mediapipe/tasks-vision 1.2.2 (pinned to match the copied module-WASM files).
Source: node_modules/@mediapipe/tasks-vision/wasm/vision_wasm_module_internal.{js,wasm}

Model: Google's MediaPipe SelfieSegmenter, float16.
Downloaded from:
https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite
SHA-256: 191ac9529ae506ee0beefa6b2c945a172dab9d07d1e802a290a4e4038226658b
Size: 249537 bytes.
Embedded labels.txt: selfie (one foreground-confidence channel).

The worker uses that channel with a 0.35 foreground threshold. This is an
engineering choice, not a measured detection accuracy or verification score.
All runtime/model downloads at inference time are from the app's own origin.
No CDN, Google service, external model endpoint, or image upload is involved.

Limitations: portrait-oriented model; small, distant, occluded, thin, or multiple
people may be missed. It produces one foreground mask, not person instance IDs.
Every person must be reviewed and missed areas covered manually. No anonymity
or complete coverage is guaranteed. Unsupported browsers fall back to manual
masking and never silently use external AI.

References:
https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js
https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf
Runtime source and Apache-2.0 license:
https://github.com/google-ai-edge/mediapipe
See LICENSE.txt. Keep upstream copyright notices in the WASM loader.
