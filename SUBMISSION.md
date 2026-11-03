# Stillpoint — Proof without seeing.

## Elevator pitch

Stillpoint investigates whether a suspected edited photo shares the same
original viewpoint and background geometry as a registered photo — by
comparing room layouts, never faces — and says *cannot determine* whenever
the evidence is thin.

## Problem and solution

Non-consensual edited imagery spreads faster than victims can respond, and
existing remedies ask victims to expose private photos to analysts,
platforms, or black-box detectors. Stillpoint inverts that: people stay
masked from the first step, only background geometry is compared, and every
verdict ships with its measurements and written limitations. The engine is
evidence-gated — zero or thin overlap can never produce an accusation.

## Technical architecture

- **Frontend** (React + Vite + Three.js): Protect (mask by hand or
  detection suggestion the user reviews and confirms; manual points,
  on-device edge-density proposals the user labels, or experimental AI
  mapping), Check (sealed suspect graph flow, or suspect photo mapped
  in-page with Blind Mode off plus a viewing acknowledgment and a
  confirmed mask), Results (verdict + residuals + shift pattern + why
  explanation), Proof (redacted export). Scene graphs, masks, and hashes
  persist in `localStorage`; image bytes are refused storage.
- **On-device engine** (TypeScript, 1:1 port of the Python engine):
  normalized-name matching, 25-unit alignment threshold, ≥4 shared objects
  required for any decisive verdict, informational shift diagnostics.
- **Local backend** (stdlib-only Python, `127.0.0.1:8787`): scene-graph
  comparison, model-status reporting, and consent-gated, key-gated
  `/api/analyze` (scene graphs) and `/api/segment` (person rectangles
  only; pixel masks discarded) endpoints (JPEG/PNG/WebP, 8 MB cap,
  memory-only bytes).
- **Validation**: a strict gate fails closed on malformed, duplicate,
  out-of-range, or person-named data; the comparison engine is a lenient
  backstop that never crashes.

## Meta technology usage (verified status)

- Meta Model API client implemented against the official documentation:
  `muse-wonder-1.0` scene-graph extraction (Responses API, `text.format`
  JSON schema) and `sam-3.1` person segmentation (Responses API,
  documented grammar parsed for boxes; mask payloads discarded).
- Endpoint reachability verified credential-free (`GET /v1/models` → 401
  `invalid_api_key`: live, authentication required; independently
  reproduced).
- No authenticated model call has been made — no API key was available —
  so live inference is honestly reported as unverified. Request shapes
  (single `/responses` path), parsers, validators, consent gating, and
  all error paths are tested with fixtures, and the app falls back to
  manual mapping with explicit "not configured" states instead of mock
  data.

## What makes the approach distinctive

- Privacy is structural, not a promise: masking precedes analysis,
  suspect photos stay sealed under Blind Mode, keys never reach the
  browser, and every remote step needs explicit per-photo consent.
- The verdict system prefers uncertainty over error: thin evidence yields
  `Cannot determine`, diagnostics never override thresholds, and every
  limitation is printed on the report itself.
- Cross-language parity: the Python and TypeScript engines assert the
  same pinned fixtures (verdicts, counts, residuals, shifts).

## Limitations and responsible-use safeguards

- Masking (drawn or detection-suggested, always human-confirmed) is not
  anonymization; backgrounds may still identify. Stated in-app.
- No identity, consent, abuse, or legal conclusions from background
  matching — stated in-app, in reports, and in documentation.
- No room scan, sealed identity verification, or reviewer delivery in
  this build.
- Synthetic geometry evaluation only (0 false positives, 0 false
  negatives, 3 inconclusive by design); real-image error rates are
  unmeasured (blocked on model access) and unclaimed.

## Repository

`https://github.com/prashma03/StillPoint`

## Demo instructions

```text
cd frontend
npm install
npm run dev      # open http://localhost:5173
```

Optional local backend: `python -m backend.server` (AI assist and person
detection activate only with `MODEL_API_KEY` configured). Follow
`DEMO_SCRIPT.md` for the 2–3 minute walkthrough.
