# Stillpoint illustration language

Original code-drawn SVGs; no stock art, remote assets, image models, or extra runtime dependency.

`StillpointIllustration` accepts `scene`, `animated` (default true), and `className`. Scenes: `trust`, `privacy`, `limits`, `report`, `discover`, `check`, `protect`, `proof`. All scenes use the same hand-shaped paper, photographic landscape, ink outline, and restrained palette. `PreferenceIllustration` supplies small `privacy`, `consent`, `appearance`, and `account` drawings. `ShieldCompanion` is an SVG group for composing new introductory scenes; its `pose` is `welcome`, `curious`, or `quiet`.

Trust is the first integrated page. Other scene variants are reusable assets, not changes to those workflows. Usage:

```tsx
<StillpointIllustration scene="trust" />
<StillpointIllustration scene="proof" animated={false} />
<PreferenceIllustration kind="consent" />
```

Keep characters in introductory, explanatory, non-sensitive surfaces. Never put them beside uploaded images, abuse disclosures, claims, evidence outcomes, or verification statuses. No illustration represents a completed search, a verified correspondence, safety, consent, or guaranteed protection. Evidence/report scenes have no faces or approval marks. A protective outline is conceptual, not an efficacy claim. Do not use the mint palette to override actual candidate/verification status colors.

Illustrations are decorative (`aria-hidden`, no focus stops) and need accompanying real text. They contain no IDs, so repeated instances are safe. Motion is CSS-only, finite (one greeting, two gentle breathing/blinking cycles), and entirely disabled by `prefers-reduced-motion`. Card hover movement is also disabled in reduced-motion mode. Illustration dimensions do not change during motion; no action waits for it. No random paths, visual filters, or gradients are required.
