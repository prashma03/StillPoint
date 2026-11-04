# Adaptive Check

Check now has one method panel after the upload cards and one result dashboard. It does not combine a facial score with a background verdict. Changing the method clears results, consent, and review state, then returns to privacy review. Uploading/replacing/deleting files clears their composition hints and the previous result. The chosen override and aggregate composition hints live in the existing memory-only Check draft.

## Local composition inspection (no landmarks)

`composition.ts` decodes each photograph at <=256px and runs the bundled JSFeat frontal-face Haar cascade in a disposable same-origin worker. This detector produces bounding rectangles only, no MediaPipe mesh, embedding, identity template, or facial reference coordinates are computed. Bounds are excluded from a Harris-corner distribution estimate, then discarded. The UI receives only face counts, approximate largest face area, corner counts, and occupied cells of a 4x4 grid. No images are sent or persisted by this inspection. The assets' pinned upstream commit, hashes, license, and limitations are documented in `public/models/composition/README.md`.

Routing thresholds are engineering heuristics, not confidence scores or validated scene understanding:

- Distributed detail: >=12 corners in >=5 grid cells in each image.
- Close-up: one face with >=18% bounds area and sparse background, or >=36% bounds area. Both images must qualify for an optional facial recommendation.
- Distributed detail with any detected face: mixed; background first.
- Distributed detail without detected faces: environmental detail; background first.
- Otherwise: insufficient evidence. Background review remains available; missing features do not prove dissimilarity.

Frontal-face detection can miss profiles, occlusion, or difficult lighting and can produce false positives. Textured subjects can be mistaken for useful environmental detail. These limitations are disclosed in the panel, which provides a manual override. Inspection has bounded inputs, timeout and cancellation; failure keeps background-first behavior and permits manual selection. It never launches facial landmark processing as a fallback.

## Explicit facial consent

Recommending/selecting facial geometry shows an unchecked consent control. No MediaPipe landmark model or worker initializes until the user consents and clicks Analyze Images. The service additionally refuses a call without a consent argument. Method/file/privacy edits and cancellation revoke consent. A failed/cancelled run has no completed result. The worker rejects multiple detected faces rather than selecting an identity. It never performs identity lookup or facial recognition.

Existing masks are burned into processing copies, never removed automatically. Facial analysis skips adding an automatic person mask, because that would hide the very evidence the user explicitly authorized for local processing; this is explained in privacy review. Blind Mode remains on independently, and covered faces may yield no usable measurement. Background mode preserves the original automatic masking/feature-review/verification workflow.

`makeFaceCase` records actual aggregate measurements and an explicit `analysisMethod: 'facial'`. Raw selected points stay only in CaseProvider's active memory for visualizations. No facial points are repurposed as background scene objects or sent through the Python background cross-check. The legacy background result slots are empty/indeterminate and are never displayed as a facial verdict. Check, Results, Proof, text exports and PDF exports route by the method tag. Facial PDFs omit raw coordinates and photograph pixels entirely. Closing/deleting the case or ending the session clears its active coordinates.

Geometry similarity cannot establish identity, consent, manipulation, or a common source image. Reports and both result views say so. No facial result upgrades a background outcome.

## Verification

Unit/route coverage: classification branches and sparse pixels; consent before worker initialization; consent reset on overrides; failed/cancelled inspection; aggregate-only records/PDFs; existing masking, Check, report closure and Proof routes.

`e2e/adaptive-check.spec.ts` runs the real local detector and background matcher on generated pixels, and runs the consented real MediaPipe engine on a crop of the repository's non-sensitive synthetic test-room image. It checks the Check-to-Proof handoff, no pre-consent landmark model requests, no image POSTs, and absence of raw coordinates in the stored record. These are functionality/privacy checks, not a face-detector accuracy study.
