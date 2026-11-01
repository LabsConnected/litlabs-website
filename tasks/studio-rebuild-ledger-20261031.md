# Studio Rebuild — Task Ledger (rebuild/studio-canonical-20261031)

Coordinator: Devin · Baseline: `58c8ac31` · Impl checkpoint: `e2317beb` · Production: HOLD

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
| 1.1 | Full-screen design proposal for Larry | verified | `design/proposals/studio-shell-proposal-20261031.html`; shot `proposal-studio-shell-v1-1440.png`; **approved 2026-10-31** |
| 1.2 | Implement approved shell in real Studio | verified (browser) | Committed `e2317beb` + follow-up `pending`. Vitest 69/69 + 65/65 targeted green; eslint clean; **prod build ✅ 190/190** (first build). Browser-verified on worktree servers: project toolbar w/ truthful save label, Design/Code/Preview seg, Export enabled w/ runtime-ready gate, Publish disabled w/ reason (account), Terminal chip error→connecting, Layout menu all commands, 380px chat + pinned composer, inspector closed, terminal bottom drawer w/ honest "PTY connection failed / terminal not available yet" + Retry, LiTEmptyState (1 heading/1 sentence/3 starters/idle state/collapsible recents). |
| 1.3 | Chat-route recovery (Panda lane) | in progress (Panda) | Panda commits landing on `fix/studio-mission-20261030` in canonical (5f2d90de, 97a10e4d, c2ba0e13); worktree file `generate/route.ts` fix sits uncommitted for Panda |
| 1.4 | Panda handoff acknowledgment | verified | Panda actively committing to canonical + its fix observed in worktree = handoff received and lanes operating |
| 1.5 | Export gate correction | verified | Export archives workspace via terminal file service (no PTY needed) → gate = projectId + runtimeReady; verified enabled in browser |
| 1.6 | App-CSP narrow additions | committed pending | `cdn.jsdelivr.net` (Monaco + Tailwind browser CDN) → script-src/script-src-elem/style-src/style-src-elem/font-src; `fonts.googleapis.com`→style-src(+elem); `fonts.gstatic.com`→font-src. Mirrors approved preview-CSP domains. Unblocks Monaco editor + in-app blob preview styling. |

## Content simplification

| # | Task | Status | Evidence |
|---|---|---|---|
| C1 | Onboarding: 1 heading · 1 sentence · 3 starters | verified (unit) | `LiTEmptyState.tsx` — chips 5→3; 18/18 tests pass |
| C2 | Recent conversations collapsible | verified (unit) | `LiTEmptyState.tsx` — toggle + section, default collapsed |
| C3 | Remove repeated logos/model labels/project names/Ready badges | verified (unit) | Header "LiTT Studio" tile+wordmark removed; ambient "Ready" pill now transient-only; preview toolbar project name removed (kept when maximized); canonical mark in chat header kept (test-asserted, approved asset) |
| C4 | "Operating"-when-idle → accurate state | verified (unit) | `LiTEmptyState.tsx` → "LiTT · Idle" (presence state is literally `idle`) |
| C5 | Truthful save label (no hardcoding) | verified (unit) | `lib/save-events.ts` — labels derive only from real write/dirty/failed events, scoped by projectId; CodeWorkspace instrumented; `onFilesSaved` → notifyStudioSaved |
| C6 | Lint hygiene | verified | CommandStudio: ref-during-render → `terminalDrawerMounted` state; handleLayoutCommand moved below deps; memoization deps fixed; StudioPreviewPanel unused menu state removed. eslint exit 0 on all touched files |

## Known defects observed at baseline (queue)

| # | Item | Status | Evidence |
|---|---|---|---|
| D1 | Preview `script.js` CSP-blocked on `127.0.0.1` (`script-src` allows `localhost:*` only) | **fixed — verified committed** | `route.ts` ×5 + `next.config.ts` preview block — `http://127.0.0.1:*` alongside `localhost:*` |
| D7 | Monaco editor blocked by app CSP (`script-src-elem` lacked jsdelivr) → code editor stuck "Loading…" | **fixed — reload-verify pending** | app CSP additions (row 1.6). Pre-existing baseline defect; surfaced during Code-surface check |
| D8 | In-app blob preview blocked fonts.googleapis + tailwind CDN | **fixed — reload-verify pending** | same CSP row 1.6; blob inherits app CSP |
| D9 | `next dev` Turbopack panic `0xc0000142` (PostCSS worker spawn, Windows) | **env-blocked** | transient env flake — blocked second dev session + second prod build attempt; first prod build already passed |
| D2 | `/api/owner/test-mode` 403 | **expected auth — accurate UI confirmed** | Route is owner-only (`isOwnerClerkId`); `OwnerTestModeIndicator` already self-hides on non-owner (`if (!state?.isOwner) return null`). 403 = correct; no visible error to fix |
| D3 | `/api/terminal/token` 403 | **expected auth — accurate UI confirmed** | Route returns `TERMINAL_DISABLED` 403 when `terminalRuntime` flag off + not terminal-owner. `terminalHealthOf` maps to "Terminal unavailable" — the toolbar Terminal chip renders that truthful state |
| D4 | "Element selection unavailable" permanent strip | **fixed — verify pending** | `StudioPreviewPanel.tsx` — strip removed; message moved to selection button tooltip + amber state |
| D5 | Startup optimization lane | partial → "activation and live acceptance pending" | per directive; verify on next authorized restart |
| D6 | Duplicated chrome (taskbar row + dock-controls row + rail) | **fixed — verify pending** | WorktabBar → inside chat column; dock-controls → Layout menu; rail → removed (surfaces via seg + Layout menu) |

## Verification gates before "complete" claim

chat · preview · editing · save/reload · UI export — all required, none yet verified end-to-end.
Environment note: this worktree's `node_modules` was incomplete (partial store) — full `pnpm install` re-run 2026-10-31 to restore tsc/eslint/vitest.

## Live verification — second Devin session (verify-only, 2026-10-31 ~23:00-23:20)

Tested tree: `e2317beb` + uncommitted edits (`next.config.ts`, `CommandStudioHeader.tsx`, `generate/route.ts` — the gen-lane→mission audit fix was authored by the earlier Devin audit session, not Panda; still uncommitted). Stack: owner"s Next dev on :3101, terminal override :4101. Canonical :3001/:4001 untouched. Auth: headless Chromium + Clerk cookie session (non-owner test user).

| Flow stage | Result | Evidence |
|---|---|---|
| auth → /studio | PASS | stayed authenticated; `studio-header` mounted |
| project create / open | PASS | POST 201; VERIFY-TEMP-20261031 `cf9a783f` + earlier `f8de04fd` |
| generate | PASS | POST 200 `litt-coder:8k`; `index.html`+`styles.css` on workspace disk |
| preview render | PASS | iframe rendered generated content (Ember Roast) |
| files route contract | PASS | POST read 200 → write 200 → re-read persisted (marker verified on disk line 33); `GET ?path=.` 200 |
| mobile 390×844 | PASS (renders) | segmented controls correctly absent (desktop-gated `md:flex`) |
| shell chrome (seg/layout menu/export/terminal chip) | BLOCKED | running dev server serves stale/mixed module graph — renders `studio-brand` testid absent from src; `surface-switch`, `layout-menu-trigger`, export controls not served. Needs owner-side dev-server restart (no-restart constraint on this lane). Served UI inconsistent across loads. |
| UI edit → save | BLOCKED | Code surface control absent or detached-on-click in served UI; route contract verified server-side instead |
| UI export | BLOCKED | control unreachable in served UI; disabled state observed appears truthful (terminal token 403 = expected owner-gating per D3) |
| surface persistence | BLOCKED | depends on surface-switch |

Corrections/notes:
- Earlier-flagged `GET files?path=index.html` 500 = caller-misuse of the list-only contract (POST `action:"read"` is the file-read path). Polish item: upstream ENOTDIR could map to 400/404 instead of 500.
- Expected auth noise confirmed: `/api/owner/test-mode` 403 (D2), `/api/terminal/token` 403 (D3).
- New defect candidates for owner: (a) stale dev module graph (restart required); (b) preview iframe blank on direct `?project=` load in one run despite "Preview ready" (flaky — earlier run rendered); (c) FileTree did not list `index.html` in one load while API listing showed it.
- Evidence: `%TEMP%\studio-verify\*.png`, `results*.json`, scripts `studio-verify*.mjs`. Test projects left in place for owner retest.
- No source edits, commits, or server restarts by this session. Production HOLD intact.
