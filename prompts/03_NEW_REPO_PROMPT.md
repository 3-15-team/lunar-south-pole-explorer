# NEW-REPO RESUME PROMPT — paste into a fresh Claude Code session started in `lunar-south-pole-explorer/`

(Use this one instead of `02_RESUME_PROMPT.md` for the first session in the split repository. Later
sessions can go back to `02_RESUME_PROMPT.md`.)

---

You are continuing an in-progress hackathon project — **Lunar South Pole Site Explorer** (NASA Space Apps
2026, challenge "CLPS Lunar Mission Browser"). Talk to me in Russian; code, docs and commit messages in
English. The previous session built everything inside `3-15-team/explorer/sandbox/dima/` and then split
that folder into **this** standalone repository with history (`git subtree split`, ADR-019). This
directory is now the project root; the old copy in `../explorer/sandbox/dima` is frozen — do not edit it.

## Where things stand (details in docs/STATE.md)

- P0–P3 are done and `make verify` was green: Vite/Preact/TS web app (WebGL2 map engine, sky plot,
  scenarios with "what if it slips", calendar, Three.js panorama, warm-up), Python `libs/lunarcore`,
  data pipeline, FastAPI compute service, Docker Compose on port **8642**.
- Validation: ephemeris vs JPL Horizons ≤ 0.012″ (Sun) / 0.115″ (Earth); visibility vs Mazarico maps
  r = 0.977 / 0.972. Demo story with real numbers in `docs/DEMO.md`.
- Product descriptions (EN/RU, full and simple) in `docs/product/`.
- Pitch: **Sun 2026-11-15 18:00 Asia/Yerevan**; feature freeze **14:30 Yerevan** (10:30 UTC).

## Do exactly this, in order

1. Run `date`; `git status`; `git log --oneline -12`. Repo has branch `main` and **no remote** — do not
   add or push one unless I give you the URL.
2. Read `docs/STATE.md` completely, then `docs/DECISIONS.md`, the last ~30 lines of `docs/LOG.md`, and
   `docs/KICKOFF_PROMPT.md` (the original rules: handoff protocol, cut list, quality gates still apply).
3. Bootstrap the environment — data, `.venv` and `node_modules` are not in git:
   - check free disk (`df -h .`); then copy the already built data instead of re-downloading (PGDA is
     slow): `cp -R ../explorer/sandbox/dima/data/{raw,web,work} data/` (≈ 4 GB). If disk is tight, copy
     only `data/web` (≈ 1.1 GB; enough for the app and `make up`; server horizon maps live in `data/work`).
   - `make setup`, then `make doctor`.
   - An old compose stack (project `lunar-explorer`) may still run from the old path: `make down` here,
     then `make up` → http://localhost:8642. Ports 8080/8088/8090/5001 belong to another local stack of
     mine — never touch it.
4. Run `make verify`; record the result in STATE.md ("Last make verify").
5. Add to STATE.md and LOG.md: "session #2, account N, started at <UTC>, first session in the split repo,
   resumed from <commit>". Commit (`chore: bootstrap split repo`).
6. Recompute hours until freeze; continue from **NEXT ACTION** in STATE.md (official challenge text →
   `docs/CHALLENGE.md`, demo video support, submission page, polish per the cut list). Write-ahead rule,
   small frequent local commits, STATE.md after every task.
7. Reply to me in Russian in ≤ 6 lines: where we are, what is red, what you will do first. Then work.

If STATE.md and the code disagree, trust the code and `make verify`, fix STATE.md, note it in LOG.md.
