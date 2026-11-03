# Stillpoint demo script (2–3 minutes)

All steps use the actual working application. Timings assume the app and
sample graphs load normally.

## Setup (before the audience arrives)

```text
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173` in a browser. Optional: run
`python -m backend.server` in a second terminal for the local backend
(AI mapping and person detection activate only with `MODEL_API_KEY`).

## 0:00–0:30 — The problem

> "Edited photos spread fast. Victims need a way to ask — *did this come
> from my photo?* — without handing their private images to strangers.
> Stillpoint answers with geometry, not faces. Proof without seeing."

Scroll the home page once: illustration, geometry, alignment slider
(edited derivative vs. new photograph), evidence diagram. Point out the
sample numbers are real engine output on bundled graphs.

## 0:30–1:15 — Protect a photo

1. Go to **Protect**. Choose any benign room photo on the device.
2. Mask the person: with the backend and a model key, tap **Suggest person
   mask**, review the dashed outline, use it — then confirm the mask.
   Without a key, drag the black rectangle over the person by hand and
   confirm. A suggestion is never auto-confirmed.
3. Note the honest labels: without a model key, AI-assisted mapping shows
   "not configured". Tap **Find background regions**: on-device proposals
   appear — label two with real names (`bed`, `poster`), discard the rest,
   then click two more corners by hand (`door`, `rug`).
4. Continue through the coverage step and save. Emphasize: *the photograph
   was never stored — only names, positions, the mask rectangle, and a
   file hash.*

## 1:15–2:00 — Check a suspect

1. Go to **Check**. Pick the saved scene as the source.
2. Open **Sample derivative** (bundled synthetic graphs, labeled as such):
   verdict **Likely derivative**, 4 of 4 aligned.
3. Open **Sample moved camera**: verdict **No link found** — same room,
   moved camera, and the engine refuses to accuse.
4. Show the shift pattern line: uniform for the derivative, scattered for
   the moved camera. Note it never overrides the verdict.
5. Mention: a real suspect photo can be mapped here too — Blind Mode off,
   viewing acknowledged, person masked and confirmed — or kept sealed with
   a scene graph file instead.

## 2:00–2:30 — Proof

1. Open the redacted proof: correspondence diagram, per-object residuals,
   file-hash comparison, mapping provenance.
2. Export the report. Read one limitation aloud: *"A background match alone
   cannot trigger automatic punishment or removal."*
3. Close: "Stillpoint would rather say *cannot determine* than overstate a
   connection — and every failure mode says so out loud."
