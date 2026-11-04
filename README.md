# Stillpoint — Proof without seeing.

Stillpoint helps a person investigate whether a suspected edited photograph
may share the same original photographic viewpoint and background geometry
as a registered benign photograph — without exposing the person in either
image to reviewers or analysts.

Background alignment alone cannot establish the identity of the depicted
person, consent, or wrongdoing. A background match alone cannot trigger
automatic punishment or removal.

## What Stillpoint actually does

1. The user registers an original photograph by mapping its background:
   manual point placement, on-device detail proposals the user labels by
   hand, or experimental AI-assisted mapping when a model key is configured.
2. People are masked before analysis. The mask can be drawn by hand
   (always available) or suggested by automatic person detection
   (`sam-3.1` through the local backend, explicit consent per photo).
   A suggestion is never auto-confirmed: the user previews it, corrects
   missed regions by hand, and confirms. Analysis never runs until the
   mask is confirmed, and proposals come only from outside it.
3. The background map is validated and saved on the user's own device as a
   scene graph. Photographs are never stored.
4. The user compares a suspect scene graph — or a suspect photograph mapped
   in Check with Blind Mode off plus an explicit viewing acknowledgment —
   against the registered reference.
5. The matching engine reports one of three verdicts — `Likely derivative`,
   `No link found`, or `Cannot determine` — with per-object measurements,
   shift diagnostics, and written limitations.
6. The Proof page exports a redacted text report containing measurements
   only. The report is locally generated; it is not independently certified
   or tamper-proof.

## Architecture

```text
Browser (React + Vite, http://localhost:5173)
├── Protect: photo (memory only) -> manual mask or detection-suggested
│            mask (user reviews, corrects, confirms) -> manual points,
│            on-device edge-density proposals (user labels each one),
│            or experimental AI assist -> validated scene graph
├── Check:   suspect graph, or suspect photo mapped in-page (Blind Mode
│            off + viewing acknowledgment + confirmed mask), compared
│            against the registered scene -> on-device comparison
├── Results: verdict + residuals + shift pattern + limitations
├── Proof:   redacted exportable report (no photographs)
└── Storage: localStorage (graphs, masks, hashes) — image bytes refused

Local backend (Python stdlib, http://127.0.0.1:8787) — optional
├── POST /api/compare   scene graphs only; images refused (as before)
├── GET  /api/status    {configured} boolean; never exposes credentials
├── POST /api/analyze   redacted image + consent flag + API key
├── POST /api/segment   image + consent flag + API key -> person rects only
├── POST /api/chat      text-only Guide messages + page label + API key
    └── Meta Model API (https://api.meta.ai/v1) — key-gated
        ├── muse-wonder-1.0 scene-graph extraction (Responses API)
        ├── sam-3.1 person segmentation (Responses API, masks discarded)
        └── chat replies for the Stillpoint Guide (Responses API, text only)
```

Nothing leaves the computer except, with explicit per-photo consent, a
redacted image sent from the local backend to the configured model service.
Without a key the backend answers `503 model_not_configured` and the app
falls back to manual mapping. Failures are explicit errors; the app never
substitutes mock data.

## Installation

Requirements: Node.js 20+, npm, and any Python 3.10+ (backend is stdlib-only).

```text
cd frontend
npm install
npm test        # vitest suite
npm run dev     # app at http://localhost:5173
```

```text
python eval/test_align.py
python eval/test_diagnostics.py
python eval/test_validate.py
python eval/test_pipeline.py
python eval/test_segment.py
python eval/test_robustness.py
python backend/test_chat.py
python eval/parity.py
python eval/smoke.py
python eval/killtest.py
```

Optional local backend (AI-assisted mapping, Guide chat, Python cross-check):

```text
python -m pip install -r backend/requirements.txt  # SAM 3.1 pixel-mask decoder
python -m backend.server   # listens on http://127.0.0.1:8787
```

On Windows you can double-click `start-backend.bat` instead. It checks for
a working Python 3.10+ first: if `python` only opens the Microsoft Store,
install real Python from python.org (check “Add python.exe to PATH”) or
run `winget install Python.Python.3.12`, then start the file again. Copy
`.env.example` to `.env` and add your `MODEL_API_KEY` to enable AI replies.

Run everything at once (Windows): double-click `start-dev.bat`. It starts
the backend (`http://127.0.0.1:8787`) and the frontend (`npm run dev` on
`http://localhost:5173`) in two windows — open the frontend URL in your
browser. The Guide and the AI-assisted panels show whether the backend is
reachable; if they report it is not running, read the backend window for
the error. Close both windows to stop. There is no dev proxy: the
frontend calls the backend URL directly and the backend allowlists local
Vite origins (5173–5175, 4173) via CORS.

## Environment variables

| Variable | Read by | Purpose |
| --- | --- | --- |
| `MODEL_API_KEY` | local backend only | Meta Model API key. Never in frontend code. |
| `META_BASE_URL` | local backend only | Optional endpoint override (default `https://api.meta.ai/v1`). |
| `SCENE_MODEL` | local backend only | Optional scene-model override (default `muse-wonder-1.0`). |
| `SEG_MODEL` | local backend only | Optional segmentation-model override (default `sam-3.1`). |
| `STILLPOINT_PORT` | local backend only | Optional listen port (default `8787`). |

Copy `.env.example` to `.env` (git-ignored) — the backend reads that file
on startup for these four keys only — or export them in the shell that runs
`python -m backend.server`; real environment variables always win over the
file. Without a key, `/api/analyze` and `/api/segment` return `503` and
manual mapping remains the working path.

## Verified Meta integrations

Honest status — what was verified, and how:

- API client implemented against the official Meta Model API documentation:
  base URL `https://api.meta.ai/v1`, Bearer `MODEL_API_KEY` auth, Models
  `muse-wonder-1.0` (scene extraction via Responses API + `text.format`
  JSON schema) and `sam-3.1` (segmentation via Responses API, documented
  special-token grammar parsed for boxes only; mask payloads discarded).
- Endpoint reachability verified without credentials: unauthenticated
  `GET /v1/models` returns `401 {"error":{"code":"invalid_api_key",...}}`,
  proving the endpoint is live and requires authentication. Independently
  reproduced in this environment.
- **No authenticated model call has been made**: no API key was available in
  this environment, so no live inference output has ever been observed.
  Request shapes, parsers, validators, consent gating, and every error path
  are unit- and integration-tested with fixtures; the live wire-up activates
  only when a real key is configured.

## Matching methodology

The comparison engine (`backend/align.py`, ported 1:1 to
`frontend/src/lib/align.ts`) compares named background objects by center
distance on a 0–1000 scale:

- Aligned when centers move fewer than 25 units.
- Both `Likely derivative` (≥80% aligned) and `No link found` (≤40% aligned)
  require at least 4 shared background objects; anything less is
  `Cannot determine`. Zero overlap is never a negative verdict.
- Names are normalized (trimmed, lowercased); person-named objects are
  excluded before scoring; invalid coordinates and duplicates are skipped
  and counted, never scored.
- Shift diagnostics (`median_shift`, `shift_spread`, `uniform_shift`) describe
  how shared objects moved — a uniform shift is consistent with a crop —
  but they are informational only and never change the verdict.
- Relationship fields (`occludes`, `is_above`, `is_below`) are carried as
  unverified observations and never scored.

The engine measures layout agreement only. It does not prove derivation,
identity, or consent.

## Testing results (observed)

| Suite | Result |
| --- | --- |
| `eval/test_align.py` | 18/18 pass |
| `eval/test_diagnostics.py` | 5/5 pass |
| `eval/test_validate.py` | 16/16 pass |
| `eval/test_pipeline.py` (incl. live localhost HTTP) | 16/16 pass |
| `eval/test_segment.py` (segment endpoint, stubbed model, dotenv) | 15/15 pass |
| `eval/smoke.py` (real server boot + HTTP checks) | 6/6 pass |
| `eval/test_robustness.py` (10 synthetic scenarios, measured) | 6/6 pass |
| Vitest (`engine` + `diagnostics` + `pipeline` + `explain` + `parity`) | 64/64 pass |
| Cross-language parity (`eval/parity.py` + `parity.test.ts`, 5 cases) | 5/5 both sides |
| `tsc --noEmit` | 0 errors |
| `vite build` | succeeds |

Synthetic robustness (`eval/test_robustness.py`, geometry fixtures — not
photographs): 0 false positives, 0 false negatives, 3 inconclusive by
design (crop, occlusion, insufficient detail). Real-photo evaluation needs
a model key plus consented, non-sensitive photographs; it has not been run
and no real-image rates are claimed.

## Privacy and security limitations

- The mask can be drawn by hand or suggested by person detection, but a
  suggestion is never auto-confirmed: the user previews it, corrects
  missed regions by hand, and confirms. Missed regions stay visible to
  analysis; the app requires confirmation but cannot verify coverage.
  On-device proposals are classical edge detection, not object
  recognition — they never name objects or people, and their pixels never
  leave the tab.
- Masking is not anonymization: backgrounds and other details may still be
  identifying. The app says so on screen.
- Suspect photographs in Check stay sealed under Blind Mode. With Blind
  Mode off, a suspect photo is shown only after an explicit viewing
  acknowledgment, must be masked and confirmed before mapping, and any
  model analysis needs a second per-photo consent.
- The local backend holds image bytes in memory only, enforces consent,
  validates formats (JPEG/PNG/WebP, 8 MB cap), and logs request paths only.
- Scene graphs, mask rectangles, file hashes, and notes persist in the
  browser until deleted in Settings. There is no server copy.

## Known limitations

- Person detection and AI mapping need the local backend plus a model
  API key; without them, manual masking, manual points, and on-device
  proposals are the working paths. No room scan; no sealed identity
  verification; no reviewer inbox (review notes stay on device).
- AI-assisted mapping requires the local backend plus a model API key;
  only manual mapping and on-device proposals work out of the box.
- The engine matches by object name, so renamed or replaced backgrounds
  cannot link, and that case is not auto-detected.
- Replaced-background and heavy-crop cases are not specially handled.

## Future improvements

- Provision a model key and verify the live extraction and detection
  wire-up end to end on consented, non-sensitive photographs.
- Evaluate on consented real-image pairs and publish measured error rates.
- Explore justified geometric upgrades (e.g. similarity-fit residuals) with
  tests, keeping Python/TypeScript parity.

## Discover: public image search

Discover is available at `/discover` and from each protected scene. It uses
TinEye's **paid public-index API**, not Meta AI, Google, Bing, private
MatchEngine collections, or a keyword-search substitute. The API supports
multipart image upload (`image_upload`) to `https://api.tineye.com/rest/search/`
with server-side `x-api-key` authentication. Its search coverage is TinEye's
indexed public web images, not every public site or authenticated social media.
Official contract: https://github.com/TinEye/pytineye/blob/main/pytineye/api.py

Set `TINEYE_API_KEY` in the repository `.env` or backend environment and restart
the backend. Paid API access and search credits must be provisioned separately.
`GET /api/discover/status` exposes configuration only, never the key. A present
key is not proof of working access. No TinEye key was available during this
implementation; **live search has not been verified**.

Protect deliberately does not retain photographs. Discover asks for the original
again, checks its registered hash locally, requires explicit per-search consent
and a non-sensitive/non-intimate confirmation, then sends the complete unmasked
image to TinEye through the local backend. No public image URL is created.
Only JPEG/PNG/WebP up to 8 MB are accepted. Search has a 30-second provider socket
timeout, 40-second browser timeout, bounded request/response sizes, and the
existing per-client rate limiter (12 requests/minute shared with model calls).
Cancelling aborts the browser request and discards the response. It cannot recall
bytes already submitted or cancel TinEye's own processing; the bounded backend
call may finish after cancellation. The backend writes no images to disk.

Candidate source links and provider relevance are displayed as unverified.
Remote thumbnail display is disabled until permission is established. The
backend never fetches candidate image URLs: this eliminates that SSRF surface
and avoids scraping, robots exceptions, or access-control bypasses. A user can
visit a source, obtain an authorized local copy, and choose **Verify Candidate**
to pass the selected metadata and original reference into Check. The local
file's association with that source is user-supplied, not authenticated.
Check retains Blind Mode, viewing acknowledgment, masking, manual/local mapping,
and separately consented optional AI mapping. No candidate is automatically sent
to an AI service. The existing comparison engine operates on the resulting
background maps; Results links to the genuine comparison in Proof. Cyan
measurements indicate aligned centers; coral indicates centers outside the
threshold; amber denotes unverified discovery candidates. Search relevance never
becomes geometric agreement. Insufficient maps remain inconclusive.

Validation includes a generated non-sensitive PNG through the local HTTP API,
provider upload-contract fixtures, missing credentials, provider errors, empty
results, unsafe URLs, type mismatch, consent, origin and rate-limit checks, plus
frontend cancellation and handoff-to-engine/report tests. Provider responses are
explicit test fixtures, never application discoveries. A live consented-photo
search-to-Proof run still requires paid TinEye credentials and an authorized
sample pair; no such run or real-photo accuracy claim is made.

Run `python -m unittest backend.test_discover backend.test_chat`, the existing
`eval` suites, and `cd frontend && npm test` / `npm run build`.

## Guided Check photo workflow

Check now offers Upload Images, Protect Privacy, Review Features, Analyze,
and Explore Proof. Guests can supply two JPEG/PNG/WebP photographs (20 MB each)
without JSON or a registered original. File bytes must decode successfully.
The previous Check interface is preserved under Advanced Tools, including
scene-graph imports, manual mapping, optional consented model services, and
Python cross-checking. Samples remain explicitly synthetic.

The photo workflow reuses the existing browser decoding, Harris response,
coordinate engine, redaction, session reports, and Proof diagram. Its new
experimental local matcher chooses separated Harris corners, compares
mean-centered normalized 8x8 grayscale patch descriptors, and retains mutual
nearest neighbors only when squared descriptor distance <= 0.18 and the
best/second-best distance ratio < 0.65. These are engineering thresholds,
not calibrated probabilities or forensic validation. At most 24 pairs are
proposed. Inputs are downscaled to at most 640 pixels for feature search.
No model key, network image upload, object classifier, fitted homography,
rotation invariance, or camera reconstruction is required or claimed.

Both images support multiple rectangular privacy covers. Covered pixels are
zeroed before corner/descriptor extraction, and patches crossing covers are
excluded. After editing, all feature regions intersecting any cover are
excluded again before the existing coordinate-distance engine runs. The
original files are never overwritten. Proof uses separate metadata-stripped
JPEG previews with every selected cover painted opaque. Features can be
selected, moved numerically, added by click or keyboard controls, removed,
and undone; resetting suggestions reruns the actual local matcher. User edits
are the inputs to the comparison, not decorative overlays. No-feature cases
produce Cannot determine instead of fabricated points.

Blind Mode starts on independently of previous settings. The suspicious
image is never rendered in the guided workflow without turning Blind Mode
off AND explicitly acknowledging viewing. Local processing works while it
is concealed, but the app explains that concealed masks and feature proposals
cannot be visually confirmed. Proof requires its own viewing choice if the
user has not already acknowledged viewing. Optional person detection is
clearly separated and retains its existing external-provider consent.
It must not be used to submit intimate imagery. No images leave the device
in the local feature workflow. An enabled Python cross-check sends graphs
only to the local backend.

Files and redacted Proof blobs live only in JavaScript memory. Returning from
Proof restores the in-progress Check session. Refresh or closing the tab
clears files; the existing redacted result record can survive refresh in
sessionStorage. Delete images/start over clears draft, media, and result;
Settings also offers deletion of temporary comparison images. Object URLs
are revoked when previews change or unmount. Creating a new result or editing
features invalidates previous result/media associations. There is no account
provider, image server, or shared cross-user image store.

Proof receives actual coordinate residuals and shows temporary redacted
photographs with corresponding point/line overlays when both previews are
available and viewing is authorized. Cyan indicates aligned coordinates;
coral indicates coordinates outside the threshold. The existing scene-map
view and explicitly simulated educational 3D room remain separate.

Validation: generated non-sensitive textured pixel pairs with a harmless
edit exercise real local detection, descriptor matching, the comparison
engine, and report creation. Tests cover mask invariance, exclusion after
edits, flat/empty inputs, unsupported/oversized files, edited geometry,
draft/media deletion, route content, concealed previews, and unavailable
model paths in existing backend tests. These generated fixtures are NOT an
ordinary-photo accuracy study. Interactive browser verification could not
complete because desktop automation app approval timed out. No authenticated
external model request or real-photo accuracy claim is made.

## Entrance and email/password authentication

New visitors now see a full-screen Stillpoint poster and **Enter Stillpoint**.
Nothing plays on load. Enter starts a 6.5-second CSS introduction, or an
app-hosted video if configured. Skip Intro is always available during playback;
video errors/stalls expose Continue. Reduced-motion users get a static, brief
transition (and configured video playback is skipped). No video asset exists in
this repository; the CSS fallback is the shipped introduction, not a fabricated
video. Provide a 5–8 second asset under `frontend/public/media/` and set, for
example, `VITE_INTRO_VIDEO_URL=/media/stillpoint-intro.mp4` to enable the player.
The video is muted, inline, and starts at zero only from the Enter gesture.

Authentication uses the official `@supabase/supabase-js` client and Supabase Auth,
not a new password database in the Python image backend. Supabase handles
server-side credential validation, password hashing, login/refresh tokens,
email confirmation, recovery emails, and rate limiting. The application contains
working calls for signInWithPassword, signUp, resetPasswordForEmail, updateUser,
getUser, automatic refresh, and current-session signOut. Provider errors never
become successful logins. Missing configuration disables account submission
while keeping Continue as Guest available.

Setup:
1. Create/configure a Supabase project with the Email provider enabled.
2. Copy `frontend/.env.example` to `frontend/.env.local` and set
   `VITE_SUPABASE_URL` (HTTPS project URL) and `VITE_SUPABASE_ANON_KEY`
   (public publishable/anon key). Restart Vite. NEVER put a service-role key,
   secret key, SMTP credential, or database password in a VITE variable.
3. Configure the project's Site URL and redirect allowlist for the frontend's
   actual origin, including `/auth/callback**` and `/auth/reset**`. Development
   ports can change, so configure the port actually used. Production must use
   HTTPS and route SPA paths back to index.html.
4. Configure and verify Supabase's email delivery/SMTP for real recipients.
   Confirmation and password-reset delivery are not enabled merely by adding
   a public project key. Provider email restrictions and rate limits still apply.
5. Align Supabase's server-side password policy with the UI's 12-character
   minimum; configure additional provider protections as needed.

PKCE email confirmation/recovery links must be opened in the originating tab,
where the code verifier lives. The SDK exchanges the code; returning sessions
are verified with getUser before the app is displayed. A valid recovery event
is required for the password-reset form. After updating the password, this
implementation signs out that recovered session and asks for a fresh login.
Logout clears local access and asks Supabase to revoke the current session's
refresh credentials; already-issued JWT access tokens have the provider's
normal validity until expiry. Authentication tokens are stored in sessionStorage,
not plaintext passwords or localStorage. This is a browser SDK session, not an
HttpOnly server-cookie implementation. Closing the tab ends local persistence;
returning authenticated sessions within the tab bypass the entrance.

No private photos are sent to Supabase, and no comparison or uploaded photograph
is automatically attached to an account. The project still has no cloud photo
vault. Signing in, signing out, or changing identity clears local comparison
files, Proof media, maps, notes, and Protect drafts; no silent guest-data migration
occurs. The app context is remounted for the new identity and stale comparison
callbacks cannot save into its result context. Intended internal destinations
are preserved and external redirect targets rejected. Guest access stays local
and requires no registration. The existing route scroll manager remains active.

No Supabase configuration or email credentials were present during implementation.
Consequently live signup, email delivery, login, reset, and token revocation
have NOT been authenticated against a real project. Automated DOM tests use
explicit provider fixtures to exercise the integration and UI; they never
create real accounts or send emails. Tests cover no autoplay, user-triggered
playback, skip, completion, errors, reduced motion, login/signup successes and
failures, confirmation-required responses, reset authorization, guest access,
returning sessions, logout, isolation, and navigation through existing pages.
Responsive CSS covers mobile and desktop; physical device visual QA was not run.

Official references:
- https://supabase.com/docs/guides/auth/passwords
- https://supabase.com/docs/reference/javascript/auth-getuser
- https://supabase.com/docs/reference/javascript/auth-signout
- https://supabase.com/docs/guides/auth/rate-limits

Dependency audit currently reports findings in the existing Vitest development
toolchain (Vitest/mocker/tinypool). They require a separate major-version tooling
migration; no forced upgrade was applied as part of authentication.

Files for entrance/authentication: `frontend/src/pages/Entrance.tsx`,
`frontend/src/pages/Auth.tsx`, `frontend/src/components/AuthSession.tsx`,
`frontend/src/lib/auth.ts`, `frontend/src/lib/accountIsolation.ts`,
`frontend/src/App.tsx`, `frontend/src/components/Nav.tsx`,
`frontend/src/components/case.tsx`, `frontend/src/lib/storage.ts`,
`frontend/src/lib/discover.ts`, `frontend/src/styles.css`,
`frontend/.env.example`, `frontend/package.json`, `frontend/package-lock.json`,
`frontend/src/lib/auth.test.ts`,
`frontend/src/pages/__tests__/Entrance.test.tsx`,
`frontend/src/pages/__tests__/AuthJourney.test.tsx`,
`frontend/src/pages/__tests__/AppEntrance.test.tsx`, and this README.

## Reopening starts a fresh image session

On every full frontend load (including refresh or a browser-restored app),
Stillpoint clears protected maps, Protect drafts, previous comparison reports,
private review notes, temporary Check photos, redacted Proof previews, and
Discover handoffs before React renders. This also removes legacy copies from
localStorage, preventing old image-related records from being migrated back.
Authentication, guest access, and display preferences remain separate.
Ordinary in-app page navigation continues to preserve the current comparison.
This startup rule applies to all users for now: account-backed saving must be
implemented explicitly in the future, and is not enabled merely by logging in.
This startup rule supersedes earlier descriptions of drafts/reports surviving
refresh elsewhere in this document.
