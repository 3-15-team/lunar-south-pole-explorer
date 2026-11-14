# SUBMISSION — Space Apps project page draft (English)

**Project name:** Lunar South Pole Site Explorer
**Challenge:** CLPS Lunar Mission Browser (NASA Space Apps 2026)
**Licence:** Apache-2.0

## High-level summary (≤ 150 words)

At the lunar south pole the Sun never rises more than ~1.5°, so a ridge 50 km away decides
whether a lander has power and whether it can see the Earth. Our web app lets mission planners
and the public pick any south-polar site and date and see the Sun and Earth against the real
LOLA terrain horizon: time to sunset and Earthset, sunlight and direct-to-Earth percentages,
longest night, solar-panel output, and a side-by-side comparison of up to four scenarios —
including "what if the launch slips by N days". A live-lit polar map, a sky plot, a heat
calendar and a first-person panorama all share one state. Everything is computed from open
NASA data (LOLA DEMs, JPL ephemerides) in the browser, validated against JPL Horizons, and
every suitability score is transparent.

## Links (must be public without login)

- Repository: TODO (public URL)
- Demo video (≤ 3 min, English subtitles): TODO
- Live demo (optional; local `make up` is the primary demo): TODO

## Project details

- What it does / how it works: see README "How it works".
- Benefits: date-slip risk is visible in one screen; planners get transparent metrics; the
  public sees why polar landing is hard (grazing Sun, vertical panels, libration).
- Tools: TypeScript, Preact, OpenLayers, three.js, WebGL2, Python, SpiceyPy, NumPy/Numba,
  rasterio, FastAPI, Docker.
- Creativity: GPU horizon ray-tracing per pixel for illumination integrals; finite-disk
  (partial Sun) physics everywhere; libration made visible.

## Use of AI

Code and documentation were developed with an AI coding assistant (Claude) under the team's
direction; all physics was checked by tests and against JPL Horizons. No AI-generated images,
video, voice or music are used. Procedural textures are labelled synthetic.

## Space agency data

NASA LRO LOLA products (PGDA products 78, 90, 69 — the last one for validation only),
NASA/JPL NAIF SPICE kernels, JPL Horizons (validation). Full list: `docs/REFERENCES.md`.

## Checklist before submitting

- [ ] video uploaded with English subtitles (script: `docs/DEMO.md`)
- [ ] repository public, README quick start works from a clean clone (`make setup data-min dev`)
- [ ] References field = `docs/REFERENCES.md`
- [ ] VALIDATION numbers copied into the description
