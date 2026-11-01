# Studio Rebuild — Task Ledger (rebuild/studio-canonical-20261031)

Coordinator: Devin · Baseline: `58c8ac31` · Production: HOLD

Statuses: **verified** (evidence attached) / partial / blocked / pending

## Phase 0 — Integration & baseline

| # | Task | Status | Evidence |
|---|---|---|---|
| 0.1 | Single integration branch + pushed to origin | verified | `rebuild/studio-canonical-20261031`, baseline `58c8ac31` |
| 0.2 | Consolidate canonical uncommitted work (no loss) | verified | 117 files snapshot-committed; canonical tree untouched |
| 0.3 | PR #763 cyber-tree brand integrated | verified | 4 cherry-picks `9fc18ba8`–`46ffe1da` |
| 0.4 | Brand test regressions fixed | verified | `dd4fadfa`; LiTTPresence/LiTTPanel tests pass (32/32 targeted) |
| 0.5 | Baseline signed-in Studio captured | verified | `baseline-studio-signed-in-1440.png`, `-390.png` |
| 0.6 | Ownership handoff doc | verified | `.devin/studio-rebuild-coordination.md` |

## Phase 1 — Shell redesign (this deliverable)

| # | Task | Status | Evidence |
|---|---|---|---|
| 1.1 | Full-screen design proposal for Larry | **pending approval** | `design/proposals/studio-shell-proposal-20261031.html`; shot `proposal-studio-shell-v1-1440.png` |
| 1.2 | Implement approved shell in real Studio | pending | — |
| 1.3 | Chat-route recovery (Panda lane) | pending | snapshot includes in-flight optimistic-conversation work; owner assigned |

## Known defects observed at baseline (queue)

| # | Item | Status | Evidence |
|---|---|---|---|
| D1 | Preview `script.js` CSP-blocked on `127.0.0.1` (`script-src` allows `localhost:*` only) | pending | console error, baseline capture |
| D2 | `/api/owner/test-mode` 403, `/api/terminal/token` 403 | pending | console errors — likely env/auth, investigate |
| D3 | "Element selection unavailable" permanent strip | pending | spec: move to disabled-state tooltip (mocked in proposal) |
| D4 | Duplicated headers / model labels / Ready badges / "Operating"-when-idle | pending | baseline screenshots; proposal addresses |
| D5 | Startup optimization lane | partial → "activation and live acceptance pending" | per directive; verify on next authorized restart |

## Verification gates before "complete" claim

chat · preview · editing · save/reload · UI export — all required, none yet verified end-to-end.
