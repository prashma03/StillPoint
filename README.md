# Stillpoint

Stillpoint compares background scene graphs to see whether two layouts share a camera viewpoint. It does not identify a face, store a face, or decide that someone did something wrong.

Background alignment alone cannot establish the identity of the depicted person, consent, or wrongdoing. A background match alone cannot trigger automatic punishment or removal.

## What is real

- `backend/align.py` compares named background objects by center distance.
- A shared object is aligned when its center moves fewer than 25 units on a 0–1000 scale.
- With at least 4 shared objects, 80% or more aligned is `Likely derivative`. 40% or less is `No link found`. Every other result is `Cannot determine`.
- Person-named objects (`person`, `face`, `body`, `hair`, `skin`, `clothes`, `head`) are dropped before scoring.
- `eval/killtest.py` and `eval/test_align.py` exercise the sample graphs.
- The web app ports that same function and checks the sample numbers in `frontend`.
- Optional local API: `python -m backend.server` on `127.0.0.1:8787`. It accepts scene graphs only and refuses image fields. The app does not call it unless Settings turns that on.

## What is not built

- Extracting a scene graph from a photograph.
- Person segmentation, room scan, image-attack generation, perceptual hashing, and sealed identity verification.
- Any upload of photographs. The interface can hold an original photo in memory long enough to draw a mask, then discards it. Saved records are scene graphs, mask rectangles, and file hashes.

Sample graphs in `sample_data/` are synthetic. The homepage room is an illustration, not an analysis.

## Run the checks

```text
python eval/test_align.py
python eval/killtest.py
```

```text
cd frontend
npm install
npm test
npm run dev
```

The app is at `http://127.0.0.1:5173`.
