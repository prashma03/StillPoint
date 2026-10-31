# Stillpoint

Stillpoint links a regenerated derivative back to its source photo by checking if the background aligns from the exact same camera position — not just the same room.

## What is real vs mocked

Real:

- `backend/align.py` center-distance comparison with usable / aligned / agreement scoring.
- `eval/killtest.py` harness that runs graph1 vs graph2 and graph1 vs graph3.
- Sample scene graphs in `sample_data/` and the Scene Graph prompt in `prompts/`.

Mocked (not built yet):

- SAM 3.1 person removal, live Muse Wonder scene-graph calls, and Muse Image attack tests.
- No frontend, no database, no stored faces, no face recognition.

## Backend Kill Test - Round 1
Stillpoint compares background scene graphs by alignment, not color or exact pixels.
- Likely derivative: 80% or more points align in place
- No link found: 40% or less align
- Cannot determine: everything else

Run the test:
python eval/killtest.py

What is real vs mocked:
- Real: alignment math in backend/align.py, sample scene graphs, decision rules
- Mocked / To be built: SAM 3.1 masking, Muse Wonder live scene graph extraction, Muse Image attack generation, frontend, proof renderer
