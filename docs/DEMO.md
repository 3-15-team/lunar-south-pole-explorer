# DEMO — 3-minute pitch script: "The mission slips by 10 days. What changes?"

Numbers below were produced by the app's own core (`apps/web/scripts/demo-scan.ts`, 2 m mast,
14-day missions, Nov 2026 – May 2027). Re-run the scan if the catalogue points change.

| site | mean 14-day sunlight | worst 10-day slip found |
|---|---|---|
| Connecting ridge (site01) | 85% | start 2027-04-28: **89% → 24%**, longest night **5 h → 108 h** |
| Peak near Shackleton (site07) | 80% | start 2027-05-04: 98% → 28%, night 0 h → 122 h |
| de Gerlache rim (site11) | 78% | start 2027-03-25: 97% → 26%, night 6 h → 246 h |
| Malapert massif (site23) | 61% | start 2027-02-19: 80% → 9%, night 61 h → 301 h |

Demo link (local stack): `http://localhost:8088/#s=site01&t=2027-04-28T00:00Z&i=2027-04-28T00:00Z~2027-05-12T00:00Z&c=site01@2027-04-28T00:00Z~2027-05-12T00:00Z;site07@2027-04-28T00:00Z~2027-05-12T00:00Z`

## Script (≈ 3 min)

| t | on screen | say |
|---|---|---|
| 0:00 | Warm-up fly-in (let it run ~6 s) | "At the lunar south pole the Sun never climbs more than 1.5°. Mountains 50 km away decide when a lander sees the Sun — and the Earth." |
| 0:15 | Map, layer *Terrain (live light)*, press **Play** (1 d/s) | "This is real LOLA terrain, lit by the real Sun from JPL ephemerides. Watch the shadows sweep around the pole once per lunar day." |
| 0:35 | Select **Connecting ridge**; point at the sky plot | "Our plan: a 14-day mission on the Shackleton–de Gerlache ridge from April 28, 2027. The grey silhouette is the actual horizon, ray-traced 300 km out. Yellow is the Sun's path, blue is the Earth wobbling with libration." |
| 0:55 | Metric tiles + Sun close-up | "89% sunlight, the longest night is 5 hours, and the Earth is in view for direct-to-Earth comms most of the time. Notice: a vertical solar panel gets ~40× more than a flat one — the Sun skims the horizon." |
| 1:15 | Scenario cards (two pinned) → drag **What if it slips?** to +10 d | "Now the launch slips by ten days. Same site — sunlight drops to 24%, and the lander faces a 4½-day night. That's a battery and survival problem, not a footnote." |
| 1:40 | Timeline strips + heat calendar | "The calendar shows which start dates keep you in the light, site by site, for the next two months." |
| 2:00 | Layer *Illumination %* → *Suitability* (preset *Short lander*, footprint 50 m) → *Find best spots* | "Planners can scan the whole region: every term of the score is explained — slope limit, sunlight, longest night, Earth contact — and each candidate shows how robust its ranking is." |
| 2:25 | **Stand here** → panorama, play time | "And anyone can stand there: the Sun disc grazes the ridge, partially clipped; the Earth hangs low with its correct phase; shadows are computed from the terrain, not painted." |
| 2:45 | Back to map, Explorer ↔ Planner toggle | "One tool for mission planners and for the public — all from open NASA data, validated against JPL Horizons." |
| 3:00 | end | |

## Before recording

- `make up` (offline-capable) or `make dev`; Chrome, 1600×960 or larger; hide bookmarks bar.
- Pre-load the demo link once (tiles cached), then reload and record.
- English subtitles: keep the "say" column as the subtitle text (see `docs/SUBMISSION.md`).
