# Stillpoint verification and privacy audit

Audit date: 2026-11-03

This audit follows the current frontend and backend code. It is an implementation review, not an independent security assessment or a claim of measured accuracy.

## What verification currently does

Stillpoint does **not** extract and match local image features between two uploaded photographs. The real comparison input is a pair of scene graphs. A scene graph contains user-visible object names and normalized bounding boxes on a 0–1000 coordinate scale.

The image-to-graph workflow has two distinct proposal paths:

1. The browser can decode a photograph, convert it to grayscale, calculate Sobel edge magnitude, and rank detailed grid regions (`frontend/src/lib/analysis.ts`, `frontend/src/lib/detect.ts`). These are unnamed candidate regions, not recognized objects and not cross-image correspondences. A person mask must be confirmed before this path runs. The user still has to label/place background points.
2. Optional AI-assisted mapping sends a redacted image to the local backend only after explicit consent for that photo. The backend validates and re-encodes it, then sends it to the configured external Responses API for a named scene graph (`frontend/src/lib/ai.ts`, `backend/server.py`, `backend/meta_client.py`). Model-generated points are suggestions that the user must review. The provider's retention and training behavior is outside this repository's control.

The actual verdict is deterministic geometry (`frontend/src/lib/align.ts`, `backend/align.py`): trim and lowercase object names, intersect exact names, compare each named bounding-box center, and count a point aligned when Euclidean displacement is under 25 units. At least four shared names are required. At least 80% aligned yields “Likely derivative”; 40% or less yields “No link found”; otherwise the result is “Cannot determine”. Person-name exclusions and invalid/duplicate coordinates are counted. Median translation and spread are informational only; they do not affect the verdict. This is not RANSAC, homography estimation, local descriptor matching, or camera-motion compensation.

Consequences and limits:

- Common object names and similar placements can produce a false match between unrelated rooms. The implementation has no calibrated false-positive rate.
- A real shared room photographed from another viewpoint can fail the fixed center threshold. Crop, rotation, perspective, lighting, and editing robustness have not been measured; lighting is not compared by the named-center rule.
- Object names may come from the user or an AI model. They are not independently verified identities for physical objects.
- “No link found” means the rule did not find enough aligned named points. It does not establish that the images are unrelated.
- A graph comparison is real computation over supplied graph data, but it is not direct image correspondence evidence. Built-in sample graphs and the Proof point-cloud animation are demonstrations, not inference.
- The displayed agreement percentage is the fraction of shared named points under the geometric threshold. It is not confidence, probability, or calibrated reliability.

## Image and evidence handling observed in code

- Normal verification compares scene graphs in the browser. Image bytes are hashed in the browser; the comparison endpoint explicitly rejects image fields.
- Browser scene graphs, drafts, claims/appeals, and review notes use tab session storage (settings use local storage). Storage guards reject image data URLs and scene sanitization removes common image fields. Hashes and metadata can still be sensitive; browser storage is accessible to scripts running on the origin and to the local browser profile. There is no account-level access control or secure server ledger.
- Image files and decoded pixels are held by browser memory/object URLs during the workflow. The code revokes object URLs on cleanup in relevant components, but JavaScript cannot guarantee secure memory erasure and the app does not audit browser/OS caches.
- The local Python backend binds to loopback, holds request image bytes in memory, and does not intentionally write them to files or request-body logs. Request logging includes the path. No database, upload directory, or retention job was found in the inspected backend.
- With explicit AI mapping consent, the redacted image leaves the device through the local backend to the configured third-party model provider. This is the material exception to local-only image processing. Provider retention is not verifiable here.
- Person segmentation also requires explicit consent and sends the image to the configured provider. The backend returns coarse rectangles and discards segmentation mask payloads.
- The Guide endpoint accepts text messages and a page label; it does not accept image fields. The browser sends a bounded conversation history (up to 20 messages). Do not put sensitive details in chat.
- No telemetry or error-monitoring integration was found in the inspected frontend/backend files. This is a repository observation, not proof about the user's hosting environment or browser extensions.

## Trust and reporting

Guest comparison cannot itself submit a punitive action. The Trust workflow is local session demo state, with no identity provider, reviewer inbox, or enforcement connection. Conflicts pause the demo workflow; appeal/counter-notice text is local session data. These controls are not authenticated or tamper resistant. Do not use this build for persistent or consequential claimant records.

Proof exports a local text summary without photographs and labels sample graphs. The report includes the actual graph-rule measurements and limitations. Its “Computed on this device” footer describes the comparison step; when AI-assisted mapping was used, scene-graph proposals were generated by an external model. That distinction should remain explicit in any external use of the report.

## Evaluation status

The repository contains unit and parity tests for graph validation, the deterministic alignment rule, masks, image decoding/proposal behavior, storage guards, and report wording. Those tests establish implementation behavior on fixtures; they do not establish real-image accuracy. The committed sample scenes are illustrative graphs, not a consented image-pair benchmark. No 30–50-pair image benchmark, labeled ground truth, calibrated precision/recall, or measured processing-time study was found. No performance numbers are claimed in this audit.

Before reporting image-level accuracy, build a consented or synthetic **image** dataset with documented ground truth and split it by room/source to avoid leakage. Include unrelated but similarly furnished rooms, insufficient-detail images, crops, view changes, lighting, edits, and adversarial cases. Report abstentions and uncertainty separately. Do not treat a graph-only synthetic test as image verification evaluation.

## Recommended priority before HackMeta

1. Label the current product honestly as user-reviewed scene-graph comparison; never call Sobel proposals cross-image feature matches.
2. Obtain consented, non-sensitive ground-truth image pairs and evaluate the current workflow before changing thresholds.
3. If image-derived correspondences are required, prototype a local feature pipeline (for example, ORB descriptors with ratio filtering and RANSAC geometric verification) behind a separate result type. Validate on the benchmark before exposing decisive wording; abstain on weak/ambiguous evidence.
4. Correct report wording to disclose external AI mapping provenance when applicable, and include method/software version and actionable preservation guidance.
5. Keep Trust records demo-only until authentication, authorization, retention, and tamper-resistance are designed and reviewed.

## Reproduction

From `frontend/`, run `npm test` for the Vitest suite and `npm run build` for TypeScript plus Vite production build. From the repository root, `python backend/test_chat.py` runs the mocked text-only Guide endpoint tests. There are no dedicated backend tests for `align.py`, image endpoint retention, or HTTP security behavior. Run the configured Python backend with `python -m backend.server` from the repository root when exercising opt-in model endpoints; external model calls require a configured key and should only use images with appropriate consent.
