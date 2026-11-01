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
| 1.1 | Full-screen design proposal for Larry | verified | `design/proposals/studio-shell-proposal-20261031.html`; shot `proposal-studio-shell-v1-1440.png`; **approved 2026-10-31** |
| 1.2 | Implement approved shell in real Studio | partial | Shell v1 wired: compact project toolbar (picker · truthful save label · Design/Code/Preview seg · transient-only status pill · Export/Publish · Terminal chip · Layout menu · overflow), 380px resizable chat (default, 280–560 clamp, persisted), worktabs moved into chat column, rail removed (secondary surfaces → Layout menu), inspector closed-by-default + on-demand, terminal bottom drawer (closed, mounted once, session-preserving), dock-controls row folded into Layout menu. Files: `CommandStudioHeader.tsx`, `shell/StudioShell.tsx`, `CommandStudio.tsx`, `lib/save-events.ts` (new). Browser verification pending install. |
| 1.3 | Chat-route recovery (Panda lane) | pending | snapshot includes in-flight optimistic-conversation work; owner assigned; no overlap — all edits stayed in Devin lane |

## Content simplification

| # | Task | Status | Evidence |
|---|---|---|---|
| C1 | Onboarding: 1 heading · 1 sentence · 3 starters | partial | `LiTEmptyState.tsx` — chips 5→3; collapsible recents added |
| C2 | Recent conversations collapsible | partial | `LiTEmptyState.tsx` — toggle + section, default collapsed |
| C3 | Remove repeated logos/model labels/project names/Ready badges | partial | Header "LiTT Studio" tile+wordmark removed; ambient "Ready" pill now transient-only; preview toolbar project name removed (kept when maximized); canonical mark in chat header kept (test-asserted, approved asset) |
| C4 | "Operating"-when-idle → accurate state | partial | `LiTEmptyState.tsx` → "LiTT · Idle" (presence state is literally `idle`) |
| C5 | Truthful save label (no hardcoding) | partial | `lib/save-events.ts` — labels derive only from real write/dirty/failed events, scoped by projectId; CodeWorkspace instrumented; `onFilesSaved` → notifyStudioSaved |

## Known defects observed at baseline (queue)

| # | Item | Status | Evidence |
|---|---|---|---|
| D1 | Preview `script.js` CSP-blocked on `127.0.0.1` (`script-src` allows `localhost:*` only) | **fixed — verify pending** | `src/app/api/preview/[projectId]/[[...path]]/route.ts` + `next.config.ts` — `http://127.0.0.1:*` added alongside `localhost:*` in all 5 directives (narrow loopback allowlist; config wins in prod, both updated to stay in sync) |
| D2 | `/api/owner/test-mode` 403 | **expected auth — accurate UI confirmed** | Route is owner-only (`isOwnerClerkId`); `OwnerTestModeIndicator` already self-hides on non-owner (`if (!state?.isOwner) return null`). 403 = correct; no visible error to fix |
| D3 | `/api/terminal/token` 403 | **expected auth — accurate UI confirmed** | Route returns `TERMINAL_DISABLED` 403 when `terminalRuntime` flag off + not terminal-owner. `terminalHealthOf` maps to "Terminal unavailable" — the toolbar Terminal chip renders that truthful state |
| D4 | "Element selection unavailable" permanent strip | **fixed — verify pending** | `StudioPreviewPanel.tsx` — strip removed; message moved to selection button tooltip + amber state |
| D5 | Startup optimization lane | partial → "activation and live acceptance pending" | per directive; verify on next authorized restart |
| D6 | Duplicated chrome (taskbar row + dock-controls row + rail) | **fixed — verify pending** | WorktabBar → inside chat column; dock-controls → Layout menu; rail → removed (surfaces via seg + Layout menu) |

## Verification gates before "complete" claim

chat · preview · editing · save/reload · UI export — all required, none yet verified end-to-end.
Environment note: this worktree's `node_modules` was incomplete (partial store) — full `pnpm install` re-run 2026-10-31 to restore tsc/eslint/vitest.
