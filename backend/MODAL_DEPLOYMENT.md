# Optional Modal geometric verification

The local Check result remains authoritative. Modal is an optional supplemental analysis that only receives the two browser-generated downscaled JPEG data URLs after the user selects the separate remote-verification checkbox. `redactImage` paints confirmed rectangle and person-pixel masks opaque and re-encodes the images, which removes EXIF metadata. Unmasked pixels can still reveal sensitive details.

The Modal function decodes image bytes in memory, computes ORB features, mutual ratio-tested descriptor matches, and a deterministic RANSAC homography, then returns actual normalized feature coordinates, inlier/outlier labels, reprojection errors, counts, alignment metrics, and uncertainty reasons. It does not persist images or derived coordinates. The response reserves a `muse_wonder` scene-graph extension with `not_configured` status; no Muse Wonder scene analysis is claimed. A failed/unconfigured Modal request leaves the completed local case unchanged and records a fallback note.

## Deploy and configure

1. Install Python 3.11+ and the Modal CLI (`pip install modal`), authenticate with `modal setup`, and deploy from the repository root:

   ```powershell
   modal deploy -m backend.modal_app
   ```

2. Create a Modal proxy token in the same Modal workspace:

   ```powershell
   modal workspace proxy-tokens create --name stillpoint-geometry
   ```

   Store the returned ID and one-time secret as the combined `wk-...ws-...` value. Do not use an API token (`ak-...as-...`). The endpoint requires Modal proxy authentication.

3. Put the deployed HTTPS function URL and combined proxy token in the ignored root `.env` file:

   ```text
   MODAL_VERIFY_URL=https://<deployed-function-url>
   MODAL_PROXY_TOKEN=wk-<id>.ws-<secret>
   ```

4. Restart `python -m backend.server`. The local `/api/status` response exposes only whether the endpoint is configured and its public origin, never the token. The Check UI enables the optional checkbox only when the local backend confirms configuration.

5. Make an explicit opt-in Check with appropriately privacy-reviewed image copies. Confirm the Modal result and fallback behavior in the UI and exported report. Until a deployed endpoint answers a real request successfully, this integration is implementation-ready but not verified as a live Modal service.

Modal proxy authentication scheme and deployment commands: [Modal proxy-token documentation](https://modal.com/docs/guide/webhook-proxy-auth) and [Modal deploy CLI reference](https://modal.com/docs/cli/latest/deploy).
