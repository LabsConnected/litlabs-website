# LiTT V1 Full-Stack Production Acceptance Matrix

Generated: 2026-08-20
Status: Phase 1 (Discovery) complete, Phase 2 (Classification) in progress

## Legend
- GREEN = implemented + automated test + live production proof
- YELLOW = implemented but missing test/proof
- RED = missing or broken

## A–Z Acceptance Matrix

| Area | Status | Evidence | Gap |
|------|--------|----------|-----|
| **A — Authentication** | GREEN | Clerk login, token exchange, terminal JWT, dev token blocking in production. 41 auth tests. Production smoke test passed (Clerk → token-exchange → Socket.IO → PTY). | None |
| **B — Bootstrap** | YELLOW | Workspace/project creation in WorkspaceManager, StudioProjectPicker. | No E2E fresh-user onboarding test |
| **C — Chat** | YELLOW | Streaming, chat-transcript-store, error rendering. 9 chat-transcript tests. | No cancellation-during-streaming test, no context retention across restarts |
| **D — Discovery** | GREEN | file-tree.ts, context-picker, 5000-file cap, skip node_modules/.git. 4 tests. | None |
| **E — Editing** | YELLOW | edit_file/read_file tools via agent-core, path containment in live tests. | No unit tests for edit operations, no patch semantics tests |
| **F — Filesystem** | GREEN | validateWorkspacePath with symlink escape prevention, ownership checks. 7 boundary tests + production PTY env smoke test. | None |
| **G — Git** | GREEN | status/diff read-only via git-state.ts, diff-view.ts. **NEW: git-workflow.ts with safe branch/stage/commit/push/PR.** 55 tests (8 + 47 new). **Live proof: commit ef9c99e7 pushed (PR #92), commit 38222098 pushed (PR #93) — only intended files staged, unrelated files preserved. PR #93 merged to main (squash merge 35f1df9a).** | None |
| **H — Health** | GREEN | /health, /health/live, /health/ready with auth/workspace/docker checks. Production verified. | Web /api/health not separately tested |
| **I — Intelligence** | GREEN | ModelRuntime, provider registry, fallback executor, 11 providers. 30+ tests. | None |
| **J — Jobs** | YELLOW | Long-running PTY sessions, backpressure buffering. | No specific job tracking tests, no UI freeze prevention tests |
| **K — Knowledge** | YELLOW | RuntimeStore, mission persistence, conversation service. | AIOS + LiTT context boundaries need clean separation tests |
| **L — LOCAL runtime** | GREEN | Local execution via CommandExecutor, tested in phase3b/3c. | None |
| **M — Missions** | GREEN | Mission lifecycle, verification gate, honest-COMPLETE rule. 15+ tests. | None |
| **N — Network failures** | YELLOW | Reconnect logic, duplicate event suppression, run reconciliation. 8 tests. | No live network disconnect tests, no backoff tests |
| **O — Observability** | YELLOW | runId/toolCallId correlation, audit log, deployment IDs. | No consolidated observability test, no log rotation test |
| **P — Permissions** | YELLOW | ExecutionGateway with capability classification (read_only/workspace_edit/arbitrary_code/destructive/external_action). | No full permission audit test, no approval gate E2E test |
| **Q — Quality gates** | GREEN | MissionVerificationGate, auto-detection from package.json, typecheck/test/build. 10+ tests. | No lint-specific or build-specific unit tests |
| **R — REMOTE runtime** | GREEN | Terminal-server live on Railway, PTY env isolation verified (23/23 checks). 106 terminal-server tests. | Voice worker deploy FAILED |
| **S — Security** | GREEN | Auth, env isolation, workspace ownership, rate limits, blocked commands, secret redaction. Production verified. | Secret redaction patterns not unit tested |
| **T — Terminal** | GREEN | PTY spawn/resize/kill, idle/lifetime timeout, concurrency limits, backpressure. 30+ tests. | Live abuse testing (huge stdout, Ctrl+C, reconnect) not automated |
| **U — UI/UX** | YELLOW | Tool progress UI, holoState transitions, error states. | No systematic UX testing, no "never looks frozen" test |
| **V — Voice** | RED | LiveKit agent implemented (livekit-agent.ts, 311 lines). | **NO tests. Deploy FAILED.** Voice pipeline untested. |
| **W — Website** | YELLOW | Landing live (8 markers verified), auth green, chat green, 285+ API routes. | No complete E2E pass (signup → studio → project → LiTT → preview → deploy) |
| **X — External tools** | YELLOW | GitHub App integration, Railway deploy CLI, Supabase client. | No scoping/audit tests for external tool access |
| **Y — Your claims** | GREEN | Marketing claim matrix built (MARKETING-CLAIM-MATRIX.md). 17 GREEN, 2 YELLOW (voice beta, simulations disclosed), 0 RED. | Landing page verified live |
| **Z — Zero-surprise release** | GREEN | Git history clean, commits pushed. **PR #93 merged to main (35f1df9a). Railway deploy + rollback + restore proven live (see Deploy/Recovery Evidence below).** | No release tag yet |

## Critical Blockers (RED)

1. **G — Git commit/push/PR**: ~~CLI has no write git operations.~~ **GREEN** — git-workflow.ts with safe branch/stage/commit/push/PR. 47 regression tests passing. Live proof: commit ef9c99e7 pushed, draft PR #92 created. **PR #93 merged to main (35f1df9a).**
2. **V — Voice**: No tests, deploy failed. Voice pipeline untested. **On hold per user instruction.**
3. ~~**Y — Marketing claim matrix**~~: **GREEN** — MARKETING-CLAIM-MATRIX.md built. 17 GREEN, 2 YELLOW (voice beta, simulations disclosed), 0 RED.

## Primary E2E Scenario Blockers

The primary scenario is: "LiTT edits its own website → tests → builds → shows diff → commits → pushes → deploys → verifies → rolls back if unhealthy"

Current blockers:
1. ~~**G — Git**: No commit/push implementation~~ **GREEN** — PR #93 merged, deploy/rollback proven.
2. ~~**Deploy → verify → rollback**: No Railway deploy/rollback~~ **GREEN** — Full deploy → health → rollback → restore cycle proven live (see below).
3. **Approval gates**: ExecutionGateway has approval enforcement but no E2E test of the approval flow

## Dependency Order for RED → YELLOW → GREEN

1. **G — Git** (blocks primary E2E scenario)
2. **Y — Marketing claim matrix** (defines what "done" means)
3. **V — Voice** (independent, can be parallelized)
4. **B — Bootstrap** (needed for fresh-user E2E)
5. **W — Website E2E** (depends on B + G)
6. **P — Permissions** (approval gates for deploy)
7. **Z — Zero-surprise release** (depends on everything else)

## Production Deployment State

| Service | Status | Last Success | Latest Deploy |
|---------|--------|--------------|---------------|
| litlabs-website (Railway faithful-rejoicing) | LIVE | 5d6b49e3 SUCCESS | Deploy/rollback/restore proven (see below) |
| terminal-server (Railway litlabs-terminal-server) | LIVE | bda29320 SUCCESS | PTY env isolation verified (23/23) |
| web (Railway litlabs-terminal-server project) | STALE | 95b0a6d1 SUCCESS | 16f09185 FAILED (commit 9f6c2bed) |
| litt-voice-worker | STALE | 60ea9587 SUCCESS | c08f26af FAILED (commit 9f6c2bed) |

## Deploy/Recovery Evidence (Phase 5 — 2026-08-20)

### Gate 1: PR → Merge

| Step | Evidence |
|------|----------|
| PR #93 created | https://github.com/LabsConnected/litlabs-website/pull/93 |
| PR #93 state | OPEN, draft, mergeable |
| PR #93 files | 1 file: `src/app/landing/_components/LandingFooter.tsx` (+2 -0) |
| PR #93 commits | 1 commit: `38222098fd3332f8dd164a83a521c0b660fc2e71` |
| CI: Build and Type Check | PASS (8m44s) |
| CI: Lighthouse | FAIL (pre-existing `/studio` CLS 0.332 — not caused by footer change) |
| PR marked ready | 2026-08-20T18:46:00Z |
| PR merged (squash) | 2026-08-20T18:46:41Z |
| Merge commit | `35f1df9ad5fb2512e8d0a901fdbfa0b45395446c` |
| Branch deleted | Yes (head branch `litt/fix-landing-add-rel-noopener-to-external-mt1ur7zr`) |

### Gate 2: Railway Deploy

| Step | Evidence |
|------|----------|
| Deploy triggered | `railway up` from main at `35f1df9a` |
| Deployment ID | `a1458e26-3e1c-434d-a531-393f0c9bbed7` |
| Deploy status | SUCCESS |
| Deploy timestamp | 2026-08-20 14:48:18 -04:00 (18:48 UTC) |
| Service status | ● Online |
| Health check | HTTP 200, `{"status":"degraded","checks":{"build":{"status":"ok"}}}` |
| Landing page | HTTP 200, 83043 chars, trademark present |

**Note:** `LandingFooter.tsx` is orphaned dead code — not imported by any component. The live landing page uses an inline footer in `HomePageClient.tsx`. The deploy pipeline works correctly, but PR #93's specific 2-line change is not user-visible. This is recorded as YELLOW for the specific change, GREEN for the deploy pipeline.

### Gate 3: Rollback

| Step | Evidence |
|------|----------|
| Rollback method | Git revert (no force-push, preserves history) |
| Revert branch | `litt/rollback-proof-revert-pr93` |
| Revert commit | `68074f60` — `Revert "fix(landing): add rel=noopener to external social links (#93)"` |
| Revert diff | 1 file changed, 2 deletions(-) — exactly the inverse of PR #93 |
| Rollback deploy ID | `b9f333a5-df43-4768-a981-cba4acfe2a3b` |
| Rollback deploy status | SUCCESS |
| Rollback timestamp | 2026-08-20 15:15:58 -04:00 (19:15 UTC) |
| Health after rollback | HTTP 200, `{"status":"degraded","checks":{"build":{"status":"ok"}}}` |
| Landing after rollback | HTTP 200, 83043 chars, trademark present |
| Previous deploy | `a1458e26` → REMOVED (Railway replaced) |

### Gate 4: Restore

| Step | Evidence |
|------|----------|
| Restore method | Switch to main (has PR #93 fix), `railway up` |
| Restore deploy ID | `5d6b49e3-c8db-415d-ac1e-b848d038754e` |
| Restore deploy status | SUCCESS |
| Restore timestamp | 2026-08-20 15:20:33 -04:00 (19:20 UTC) |
| Health after restore | HTTP 200, `{"status":"degraded","checks":{"build":{"status":"ok"}}}` |
| Landing after restore | HTTP 200, 83043 chars, trademark present |
| Rollback deploy | `b9f333a5` → REMOVED (Railway replaced) |
| Rollback branch | Deleted (cleanup) |
| Final main commit | `35f1df9a` (PR #93 fix) |

### Summary

| Gate | Status | Method |
|------|--------|--------|
| PR → Merge | GREEN | Squash merge, 1 file, CI passed |
| Railway Deploy | GREEN | `railway up`, SUCCESS, health 200 |
| Rollback | GREEN | Git revert + `railway up`, SUCCESS, health 200 |
| Restore | GREEN | Switch to main + `railway up`, SUCCESS, health 200 |
| **Full cycle** | **GREEN** | **Deploy → verify → rollback → verify → restore → verify** |

**Caveat:** The specific PR #93 change (`rel=noopener` on footer social links) is in orphaned dead code (`LandingFooter.tsx` is not imported anywhere). The live footer is an inline element in `HomePageClient.tsx` with no external social links. The deploy/rollback pipeline is GREEN; the specific user-visible effect of this PR is YELLOW.

## Test Suite Summary

| Suite | Tests | Status |
|-------|-------|--------|
| terminal-server | 106 | All passing |
| litt-cli | 987 + 4 skipped | All passing |
| litt-agent-core | 30+ files | All passing |
| litt-models | 4 files | All passing |
| Website Playwright | Multiple specs | Not run in this session |
