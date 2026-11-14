# RESUME PROMPT — paste into a fresh Claude Code session on the next account

(Replace N with the account number. Run it in the SAME repo directory if you are on the same machine; otherwise `git clone <remote>` first, then `git checkout main && git pull`.)

---

You are continuing an in-progress project (Lunar South Pole Site Explorer, NASA Space Apps 2026) after the previous session was cut off by a usage limit. This is account **N**. Talk to me in Russian; code, docs and commits in English.

Do exactly this, in order, without redoing finished work:

1. Run `date`; run `git status`, `git log --oneline -15`, and `git pull` if a remote exists. If there are uncommitted changes from the previous session, inspect them, finish or revert them deliberately, and commit with a `wip:` message.
2. Read `docs/STATE.md` completely, then `docs/DECISIONS.md` and the last ~40 lines of `docs/LOG.md`. The original kickoff prompt's rules (especially the handoff protocol, the cut list and the deadline: pitch at 18:00 Yerevan time, feature freeze 3.5 h before it — exact times are in STATE.md) still apply — re-read `docs/KICKOFF_PROMPT.md` (the saved original prompt) in full; if it is missing, ask me to paste `01_KICKOFF_PROMPT.md`.
3. Run `make doctor` then `make verify`. Fix environment drift first (missing data → `make data-pull`, not recompute). Record the result in STATE.md.
4. Recompute hours left until freeze and compare with the plan phase. If behind, apply the cut list in the stated order and log it as an ADR.
5. Continue from **NEXT ACTION** in STATE.md. Apply the write-ahead rule (mark `doing`, commit, then work), commit and push every ~20 minutes, update STATE.md after every task.
6. Add an entry to STATE.md and LOG.md: "session #, account N, started at <UTC>, resumed from <commit>".
7. Reply to me in Russian in ≤6 lines: where we are, what is red, what you will do first. Then work.

If STATE.md and the code disagree, trust the code and `make verify`, fix STATE.md, and note it in LOG.md.
