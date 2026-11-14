# KICKOFF PROMPT — Lunar South Pole Site Explorer (NASA Space Apps 2026)

> Paste everything below this line into a fresh Claude Code session (Opus 5.5, max effort) started in an EMPTY git repo directory.
> Before pasting, put the challenge text into `docs/CHALLENGE.md` (or paste it right after this prompt).

---

## 0. Who you are, who I am, how we talk

You are the lead engineer on a 2-day hackathon project. I am a computer-vision engineer (3D, VR, Gaussian splatting background) leading a team of 3. I read Russian best: **talk to me in Russian; write all code, comments, docs, commit messages and UI text in English** (the submission must be in English).

I will often be away from the keyboard. Questions that block you are allowed only in Section 11, once, batched. Everything else: decide, record the decision in `docs/DECISIONS.md`, move on.

## 1. Hard constraints you must plan around

- **Event**: NASA Space Apps Challenge, Sat 14 – Sun 15 Nov 2026. Challenge: "CLPS Lunar Mission Browser" (full text in `docs/CHALLENGE.md` — read it first, completely).
- **Deadlines**: the team **pitches at 18:00 Asia/Yerevan (UTC+4)** — I believe Sunday 15 Nov (I will confirm in the first message). The official submission closes Sun 15 Nov 23:59 local time, but plan backward from the pitch: **feature freeze 3.5 h before the pitch (Sun ≈14:30), demo video/slides finished 1.5 h before, submission page filled ≥1 h before**. Run `date` at the start of every session and write "hours left until freeze" into `docs/STATE.md`. The pitch must also work if the venue network fails: the local `docker compose up` build is the primary demo, the hosted one is the backup.
- **Submission needs** (per Space Apps guides): a Project Demo (a video must have English subtitles, or English slides); every link publicly reachable without login; a References field listing **all** external resources, including open-source code and open data; no copyrighted music/images. NASA distributes submissions under Apache-2.0 unless another OSI license is given → **license the repo Apache-2.0**. Keep `docs/REFERENCES.md` up to date as you go (every dataset, library, model, with URL and license).
- **Judging criteria** (2024 guide; verify against the 2026 guide if I paste it): Influence, Creativity, Validity (scientifically sound), Relevance (answers the challenge, complete, usable and user-friendly), Presentation. → A correct, finished, understandable core beats unfinished wow features.
- **You can be cut off at any moment** by an account usage limit. I rotate between 3 Claude accounts. Section 9 is a mandatory protocol, not a suggestion.

## 2. Product vision (my words, condensed)

A web app for comparing lunar south-pole landing/base sites and dates. Three modes:

1. **Warm-up** — a short cinematic: black sky (stars optional), the Moon, camera flies in, scale grows, then it smoothly hands off to the map mode.
2. **Main map mode** — Google-Maps-like (pan, zoom, tiles) but of the lunar south pole only (do not extend beyond the challenge's region of interest), built from the most accurate 3D data available. Textures have **no baked shadows**; illumination is computed by us from Sun and Earth positions. Controls: time slider, time-interval selector (from/to date-time), layer switcher: texture, instantaneous shadows, **illumination integral over the interval**, Earth-visibility, slope, suitability heatmap. A suitability model scores locations for a landing site/base given a **square footprint of side 5–100 m** (user-set), illumination (the pole is Sun-starved, so this matters most), slope/relief (prefer plains/plateaus) and, if feasible, Earth visibility.
3. **Interactive panorama** — drop a "pegman" on the map → first-person view rendered from 3D data (Sun and Earth discs, horizon, shadows), optional WASD movement, optionally VR.

Optional, only if time remains: generative models to synthesize realistic regolith/rock texture (grey, slope-aware) pre-baked or at render time.

**UX is the key quality criterion.** The first 5 seconds must communicate value; one screen should answer "is this site/date viable, and what changes if the date slips?".

## 3. What the challenge actually asks (non-negotiable core)

Re-read `docs/CHALLENGE.md`; the core is: pick site(s) (catalog + custom coordinates) and date/time → show Sun and Earth relative to the **real terrain horizon** → time to sunset/Earthset → power & comms metrics (solar elevation, sunlight duration, Earth visibility windows) → **compare several scenarios side by side** and explore how a date/site change alters feasibility → timelines/animation over a lunar day → usable by planners AND the public. Everything in Section 2 is in service of this. If something in Section 2 conflicts with the core, the core wins.

## 4. Verified corrections to the vision (do not re-litigate; record in ADRs)

1. **No Web Mercator.** Tiles must be **polar stereographic** (what LOLA products and NASA Trek's South Pole services use). Use a map library that supports custom projections (e.g. OpenLayers) or a custom WebGL map. Moon is a sphere, R = 1737.4 km.
2. **Horizon needs terrain beyond the map window.** Shadows at the pole can come from >100 km away. The visible area may be small, but horizon/illumination computation must use DEM out to at least ~150 km from the evaluated point (the LOLA 80°S–90°S products cover ~300 km radius — use them).
3. **Data tiers** (verify every URL, size and license before downloading; start with the smallest set):
   - T0 — LOLA south-pole DEM 80°S–90°S, 20/40/80 m/px GeoTIFF (Barker, PGDA https://pgda.gsfc.nasa.gov/products/90 — the 20 m file is ~2.6 GB, 40 m ~685 MB; develop on 80/40 m). Also slope maps, hillshade, error maps, and a PSR shapefile (>1 km²).
   - T1 — LOLA 5 m/px DEM for 87°S–90°S (MIT Imbrium https://imbrium.mit.edu/).
   - T2 — LOLA 5 m/px site DEMs (PGDA https://pgda.gsfc.nasa.gov/products/78: Site01, 04, 07, 11, LM1–LM8, Site20v2; each a small ~16×16 km region, MOON_ME frame of DE421, with slope, count and total-error rasters). Use for the panorama and footprint-level scoring near catalogued sites.
   - Reference-only layers for validation and fast overview: Mazarico et al. average illumination + Earth visibility maps (PGDA https://pgda.gsfc.nasa.gov/products/69). **Our computed results must be ours; these are the sanity check**, not the product.
   - NASA SVS pole illumination animations (https://svs.gsfc.nasa.gov/4930/) are a visual check for the shadow layer.
   - Moon Trek WMTS (https://trek.nasa.gov/tiles/apidoc/trekAPI.html?body=moon) for base imagery if useful. The South Pole layer names/CORS were NOT verified — check GetCapabilities in the first hour; if unusable, bake our own tiles.
4. **"Texture without shadows"**: real polar imagery (LROC WAC/NAC) contains shadows. LOLA 1064 nm normal albedo is shadow-independent (zero phase) but published polar resolution is coarse (~2 km/px) → use only as a low-frequency tint. Plan: **L0** neutral grey albedo + optional LOLA tint; **L1** procedural micro-detail in the shader driven by slope/roughness (rocks, regolith grain; free, infinite resolution, deterministic); **L2 (only if time and an API key exist)** generative-model patches for hero sites, baked offline, clearly labelled "synthetic". Anything synthetic must be labelled as such in the UI and in the submission. L1 is the default and must look good before L2 is touched.
5. **3D Gaussian splatting: skip.** There is no multi-view photography of polar terrain to train on; splatting synthetic renders adds cost and no scientific value. WASD walking happens on the DEM-derived heightfield mesh. (Revisit only as a documented stretch idea.)
6. **No ground-truth labels exist for "good landing site"**, so a trained regression/NN would be unfalsifiable. Build a **transparent multi-criteria score** (physics-based features, hard constraints + weighted soft utilities, presets for "short lander mission" vs "long-term base"). "Confidence" = **robustness**: (a) data quality (LDEM error/count maps), (b) rank stability under Monte-Carlo perturbation of weights and DEM height errors. Optional ML is allowed only as a *fast surrogate* of the physics score, labelled as such. Validate honestly: published high-priority sites (e.g. the Shackleton–de Gerlache connecting ridge, Nobile rim) should land in a high percentile; report the result, including failures.
7. **Modes ≠ containers.** Warm-up/map/panorama share state (site, time, interval); splitting them into containers adds hops and CORS with no scaling benefit. Baseline: one monorepo, one frontend with three **lazy-loaded modules**. Containers only where there is a real runtime boundary (see Section 6). If you disagree, write an ADR with reasons and spend ≤10 minutes on it.
8. **Catalog scope.** The challenge examples include Apollo and other-country sites, which lie far outside the polar region (Apollo is equatorial). Polar region (80°S–90°S) is the hero. Catalog may include a few far sites only if a coarse global DEM is cheap to add; otherwise mark them "outside coverage". Custom coordinates must work anywhere inside coverage.

## 5. Physics & data spec (decisions already made)

- **Frame**: compute directions in the lunar **MOON_ME** (mean Earth/rotation axis) frame, matching the PGDA rasters (DE421 MOON_ME). MOON_PA vs MOON_ME differ by ≲1 km on the surface; document it. Heights are relative to the 1737.4 km sphere.
- **Ephemerides**: precompute offline with SPICE (spiceypy): a planetary SPK (DE440/441), the lunar binary PCK + lunar frame kernel from NAIF. Output compact tables of Sun and Earth position (and velocity if used for Hermite interpolation) in MOON_ME, **2026-01-01 → 2036-12-31** at ≤30-minute steps, binary (float32) — a few MB. The browser/Python rotates into the local East-North-Up frame of any site by trigonometry. **Validate** against JPL Horizons API (user-defined topocentric site on body 301, airless azimuth/elevation; read https://ssd-api.jpl.nasa.gov/doc/horizons.html) at ≥5 sites × ≥5 epochs; record the max error in `docs/VALIDATION.md`. Never call Horizons from the browser at runtime.
- **No atmosphere**: no refraction. Horizon = terrain profile + curvature of the sphere. Observer height is a parameter (default 2 m; allow 0–10 m; mast height materially changes illumination).
- **Disks, not points**: Sun angular radius and Earth angular radius computed from actual distances each timestep. Visibility is the visible **fraction of the disk** above the horizon mask (the Sun barely clears the horizon at the pole, so partial occlusion is the norm).
- **Metrics** (define precisely in `docs/METRICS.md`, test them): Sun visible fraction f(t); illumination % over [t0,t1]; sunlit hours; longest continuous dark interval; number/time of next sunrise/sunset ("time remaining"); Earth visibility fraction and DTE windows (default: DTE available when ≥50% of the Earth disk is visible; configurable); solar elevation stats; relative power proxy for vertical vs horizontal arrays (horizontal arrays are nearly useless at the pole — make that visible, it is educational).
- **Libration**: falls out automatically from MOON_ME ephemerides — expose it in the UI ("why Earth wobbles around the horizon").
- **Uncertainty**: where error rasters exist, show horizon-elevation uncertainty (band on the sky plot).

## 6. Architecture baseline (adjust via ADR, keep it simple)

```
/apps/web         Vite + TypeScript SPA. Lazy modules: warmup/, map/, pano/. Shared state store + URL-encoded state (shareable scenarios).
/services/compute FastAPI (+ numpy/numba). Heavy region-scale jobs: suitability heatmap, interval integrals for bbox. Stateless, content-addressed cache. CPU-only (assume NO server GPU).
/services/texgen  OPTIONAL (compose profile "ai"): texture synthesis worker. Disabled by default.
/pipeline         Offline jobs (profile "data"): download → verify checksums → COG/tiles/heightmaps/hillshade/slope → ephemeris tables → pre-baked default heatmaps. `make data`.
/infra            docker-compose.yml, Dockerfiles, deploy scripts.
/docs             STATE.md, DECISIONS.md, LOG.md, ARCHITECTURE.md, DATA.md, METRICS.md, VALIDATION.md, REFERENCES.md, SUBMISSION.md, CHALLENGE.md
```
- **Graceful degradation is a design rule**: the demo must work with static hosting only. Per-site horizon, Sun/Earth tracks, instant shadows and metrics are computed **client-side** (WebGL2/WebGPU + WASM/workers). The `compute` service accelerates region-scale heatmaps; for the default presets, heatmaps are **pre-baked** and served statically, so the app still works if the service is down.
- **Spike early (by hour ~3)**: benchmark the illumination-integral approach on a laptop iGPU/CPU — (a) per-pixel horizon maps precomputed in the pipeline and reused for any time, (b) on-demand ray-march in a shader for the viewport, (c) service-side. Target: viewport interval-integral in ≤3 s, progressive refinement allowed; interactive shadows at 60 fps. Pick by measurement and record it in an ADR.
- **Footprint scoring**: compute features inside an L×L m square (L ∈ [5,100]) with summed-area tables / box filters (slope percentile, local relief, roughness, mean illumination, longest dark gap, Earth visibility, optional distance to PSR). Hard constraints (default max slope 10°, configurable) + weighted utilities; two presets.
- **Static assets** (tiles, tables, heightmaps) → object storage with public read + CORS; versioned, with `data/manifest.json` (URL, sha256, size, license, producing job).
- **Deploy** (don't block on it, but be deployed by ~hour 20): see Section 8.

## 7. UX requirements

- One main screen: left = site list + pinned **scenario cards** (compare up to 4); centre = map; right = **sky plot** (azimuth/elevation with the terrain horizon silhouette, Sun and Earth tracks, playhead) + metric tiles; bottom = timeline with a playhead and an interval selector (two handles), lunar-day ticks. Any change recomputes everything immediately.
- "What if it slips?" control: shift date by ±N days/weeks and show metric deltas per scenario; a date×site heat calendar.
- **Time remaining to sunset / Earthset** is always visible (HUD in panorama; tile in map mode).
- Educational layer: "Moon vs Earth" comparison (Sun never rises above a few degrees at the pole; a 2 m object casts a ~75 m shadow at 1.5° elevation), plain-language tooltips, Planner/Explorer toggle that changes information density.
- Warm-up ≤10 s, **skippable instantly**, honours `prefers-reduced-motion`, and hides tile prefetch (it is a loading screen in disguise). Procedural star field (avoid licence risk).
- Pegman → panorama transition is animated; panorama has the same time controls; WASD clamps to terrain + eye height within the DEM-covered radius; VR via WebXR is the **last** stretch item.
- Colour-blind-safe palettes, keyboard operation, readable on a laptop projector, usable on mobile at least in read-only map mode. If a frontend-design skill exists in this environment, use it.
- Label data provenance and synthetic content in the UI.

## 8. Delivery plan (time-boxed, vertical slices; main must always build and be deployable)

| Phase | Target | Done means |
|---|---|---|
| P0 (≈1.5 h) | Bootstrap | Section 11 questions asked; env probed; repo, license, Makefile, STATE/DECISIONS/LOG created; background data download started; Trek polar layers + CORS checked |
| P1 (≈4 h) | Walking skeleton | Polar-stereographic map of the pole from our own tiles (hillshade/neutral base), site catalog + custom coords, ephemeris table validated vs Horizons, deployed |
| P2 (≈6 h) | **Challenge core** | Per-site horizon, sky plot, instant shadows + time slider, interval illumination + Earth visibility, metric tiles, time-to-sunset/Earthset, 2–4 scenario comparison + "what if it slips" |
| P3 (≈6 h) | Wow layer 1 | Suitability heatmap + footprint slider + robustness; panorama (3D, Sun/Earth discs, shadows, WASD); warm-up cinematic |
| P4 (≈5 h) | Finish | L1 procedural texture polish, UX pass, validation doc, README, demo video + English subtitles, SUBMISSION.md, REFERENCES.md, final deploy |

The hour figures above are relative sizes, not a schedule: at P0, compute the real budget (wall-clock until freeze minus ~7 h sleep for me, not for you) and scale the phases proportionally; write the result into STATE.md. Build the demo around one story ("the mission slips by 10 days — what changes?") and write the 3-minute script in `docs/DEMO.md` early, so features serve the pitch.

**Cut list if behind (cut in this order):** VR → generative texture L2 → pano WASD polish → robustness Monte-Carlo → warm-up polish → date×site heat calendar. **Never cut**: validation vs Horizons, metrics correctness, scenario comparison, the demo video, References.

Cloud: GCP and Azure credits come from the Space Apps Global Offers (amounts unverified). Baseline = **Google Cloud Run** (containers, scale-to-zero) + a public GCS bucket for static assets + Firebase Hosting or Cloud Run for the web app; Azure equivalent = Container Apps + Blob + Static Web Apps. Ask me which account is ready (Section 11). Never run anything that could incur spend without a budget alert; never commit secrets; I will run any `login` command myself. The `docker compose up` path must always work locally for the demo video, and static fallback hosting (Firebase/GitHub Pages) is the safety net. **No cloud has been chosen yet**: until I say otherwise, assume none — develop and demo from local `docker compose`, and treat cloud deployment as a P4 task.

## 9. HANDOFF PROTOCOL — mandatory (usage limits can end this session mid-task)

State lives **in the repo, not in your context**. A different account will continue from a cold start.

1. **Single source of truth: `docs/STATE.md`** — always current, ≤200 lines. Sections: header (UTC time, hours until freeze, session #, account label if I tell you), *Phase & task IDs* (checkbox list T-001…, status: todo/doing/done/blocked), *NEXT ACTION* (the exact next command or file to open), *Environment facts* (ports, paths, how to run, where data lives — never secrets), *Open questions*, *Known issues*, *Last `make verify` result*.
2. **Write-ahead rule**: before any task that may take >10 minutes, set it to `doing` in STATE.md with a one-paragraph plan and files you will touch, commit, then start. When finished, mark `done`, update NEXT ACTION, commit.
3. **Small, frequent, pushed commits**: at least after every task and at least every ~20 minutes of work. `wip:` commits are fine. Commit locally always. All my accounts run on the same Mac in the same directory, so the working tree survives an account switch; a remote is a backup and the place where teammates sync. I will give you the remote URL later — once it exists, push after every commit; until then local commits are enough. Tag stable points `cp-NNN`.
4. **Large data never goes into git.** `data/` is gitignored; `data/manifest.json` (URL, sha256, size, license) makes everything reproducible; processed artifacts are uploaded to the object store and listed in the manifest so another session runs `make data-pull` instead of recomputing for hours. Long jobs must be **idempotent and resumable** (skip finished outputs).
5. **`make doctor`** checks tools, versions, data presence/checksums, ports. **`make verify`** = lint + type-check + unit tests + build + smoke test of key endpoints. A session ends (or hands off) only when `make verify` is green or STATE.md says exactly what is red and why.
6. **`docs/DECISIONS.md`** (ADR-lite: id, decision, why, alternatives, date). Do not reopen a decided item unless it blocks.
7. **`docs/LOG.md`**: append-only, one line per significant event (including "limit warning seen").
8. If you see any usage-limit warning, or you are about to start a long operation: **immediately** update STATE.md, commit and push, then continue.
9. **Limit economy**: keep tool output small (`head`, `wc`, summaries; never print rasters), no giant file reads, avoid redundant re-reads, use at most 2 parallel subagents and only for independent chunks (e.g. pipeline vs frontend). Think hard about physics and geometry correctness and test them; do not burn budget on endless design debate.
10. Local `claude --resume` may restore a transcript on the same machine but must not be relied on; STATE.md is the contract.

## 10. Quality gates

- Unit tests for geometry: ENU rotation, horizon ray-march with curvature on synthetic terrain (flat, ramp, single peak), disk-fraction occlusion, interval metrics (including intervals crossing a sunset), footprint statistics.
- Ephemeris validation vs Horizons (Section 5). Plausibility check of average illumination/Earth visibility vs the Mazarico maps at catalogued sites; shadow layer vs SVS frames. Report numbers, including mismatches, in `docs/VALIDATION.md`.
- Performance budget recorded in STATE.md (tile load, interaction fps, integral time).
- Manual UX walkthrough of the 3-minute demo script before freeze (`docs/DEMO.md`: scripted storyline — "mission slips by 10 days: what changes?").

## 11. Already answered, and what is still open

Answered (log these in DECISIONS.md, do not ask again):
- **Runs on my Mac** (local Claude Code + Docker), so large NASA downloads work. Check free disk space (need ≥25 GB) and Docker/Node/Python versions in P0.
- **Timezone** Asia/Yerevan; **pitch 18:00 Yerevan time**.
- **Cloud: none chosen yet** (see Section 8). **No image-generation API key** → texture L1 only; L2 is out unless I say otherwise.
- **Git remote: later.** Commit locally now.

Still open — ask me ONCE, in one short batched message at the start (AskUserQuestion if available); if no answer within ~10 minutes, use the defaults and log them:
1. **Which day is the 18:00 pitch?** Default: Sunday 15 Nov. (If it is today, say so immediately in Russian and propose a drastically reduced scope: core metrics + comparison + a minimal map, nothing else.)
2. **Existing teammate work.** One of my teammates has already pushed experimental panorama code to a repo I will name later. Do not wait for it: build the panorama module against a clear interface (inputs: site ENU frame, heightfield tiles at several LODs, `sunEarthDirections(t)` function, time/interval state, observer height; outputs: canvas + events for time-to-sunset). When I give the URL, clone it to a sibling directory, review quality and licence, and decide by ADR whether to import it into `apps/web/src/pano` (adapting it to our state store and DEM data) or to keep ours and borrow ideas.
3. Paste the 2026 **Judging & Awards** criteria if they differ from Section 1 (optional).

If you notice gaps I did not think of — in the physics, the data, the plan or the UX — say so right away in one short Russian message with your proposed default, and continue.

## 12. Start now

1. Read `docs/CHALLENGE.md`. 2. Run `date`, probe the environment (OS, Docker, Node, Python, GPU, disk, network access to pgda.gsfc.nasa.gov / naif.jpl.nasa.gov / trek.nasa.gov / ssd.jpl.nasa.gov). 3. Ask the open questions from Section 11. 4. Create the repo skeleton and the `docs/` files — **save this entire prompt verbatim as `docs/KICKOFF_PROMPT.md`** so every later session (and account) can re-read the rules — commit, push. 5. Start the data downloads in the background (smallest set first) and begin P1. Report to me in Russian in ≤8 lines after P0, then after each phase.
