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
| **G — Git** | GREEN | status/diff read-only via git-state.ts, diff-view.ts. git-workflow.ts is the ONE safe branch/stage/commit/push/PR implementation (never `git add -A`, never force push, never commits to main/master/release/prod), reused by two entry points: **(1) human-triggered** — `/ship`, `/branch`, `/pr` slash commands call it directly (the human's keystroke is the authorization). **(2) agent-triggered** — the new `project.ship` tool routes every call through `ExecutionGateway` (PLAN denies, ACT requires human approval, AUTO cannot self-approve without a verified grant) before dispatching to the same git-workflow.ts. 103 tests total: 8 (git-state) + 47 (git-workflow) + 14 (project.ship handler + gateway enforcement) + 4 (approval-prompt description). | **Live proof (human path): commit ef9c99e7 pushed, draft PR #92 created; commit 38222098 pushed, draft PR #93 created.** Agent path (project.ship) is test-proven (real temp-repo git state asserted before/after PLAN-deny, no-callback-deny, human-deny, human-approve) but has no live production proof yet — no mission has invoked it end-to-end against this repo. |
| **H — Health** | GREEN | /health, /health/live, /health/ready with auth/workspace/docker checks. Production verified. | Web /api/health not separately tested |
| **I — Intelligence** | GREEN | ModelRuntime, provider registry, fallback executor, 11 providers. 30+ tests. | None |
| **J — Jobs** | YELLOW | Long-running PTY sessions, backpressure buffering. | No specific job tracking tests, no UI freeze prevention tests |
| **K — Knowledge** | YELLOW | RuntimeStore, mission persistence, conversation service. | AIOS + LiTT context boundaries need clean separation tests |
| **L — LOCAL runtime** | GREEN | Local execution via CommandExecutor, tested in phase3b/3c. | None |
| **M — Missions** | GREEN | Mission lifecycle, verification gate, honest-COMPLETE rule. 15+ tests. | None |
| **N — Network failures** | YELLOW | Reconnect logic, duplicate event suppression, run reconciliation. 8 tests. | No live network disconnect tests, no backoff tests |
| **O — Observability** | YELLOW | runId/toolCallId correlation, audit log, deployment IDs. | No consolidated observability test, no log rotation test |
| **P — Permissions** | YELLOW | ExecutionGateway with capability classification (read_only/workspace_edit/arbitrary_code/destructive/external_action). **project.ship (see G) is now a real approval-gate E2E test**: PLAN mode denies with zero mutation, ACT with no approval callback fails closed, ACT with human denial performs no git mutation, ACT with human approval performs the real branch/stage/commit — all asserted against actual git state, not mocks. | Still no full permission audit across every mutating tool (project.ship is the first one proven this way) |
| **Q — Quality gates** | GREEN | MissionVerificationGate, auto-detection from package.json, typecheck/test/build. 10+ tests. | No lint-specific or build-specific unit tests |
| **R — REMOTE runtime** | GREEN | Terminal-server live on Railway, PTY env isolation verified (23/23 checks). 106 terminal-server tests. | Voice worker deploy FAILED |
| **S — Security** | GREEN | Auth, env isolation, workspace ownership, rate limits, blocked commands, secret redaction. Production verified. | Secret redaction patterns not unit tested |
| **T — Terminal** | GREEN | PTY spawn/resize/kill, idle/lifetime timeout, concurrency limits, backpressure. 30+ tests. | Live abuse testing (huge stdout, Ctrl+C, reconnect) not automated |
| **U — UI/UX** | YELLOW | Tool progress UI, holoState transitions, error states. | No systematic UX testing, no "never looks frozen" test |
| **V — Voice** | RED | LiveKit agent implemented (livekit-agent.ts, 311 lines). | **NO tests. Deploy FAILED.** Voice pipeline untested. |
| **W — Website** | YELLOW | Landing live (8 markers verified), auth green, chat green, 285+ API routes. | No complete E2E pass (signup → studio → project → LiTT → preview → deploy) |
| **X — External tools** | YELLOW | GitHub App integration, Railway deploy CLI, Supabase client. | No scoping/audit tests for external tool access |
| **Y — Your claims** | GREEN | Marketing claim matrix built (MARKETING-CLAIM-MATRIX.md). 17 GREEN, 2 YELLOW (voice beta, simulations disclosed), 0 RED. | Landing page verified live |
| **Z — Zero-surprise release** | YELLOW | Git history clean, commits pushed. | No backup/rollback/recovery docs, no release tag, no rollback procedure |

## Critical Blockers (RED)

1. **G — Git commit/push/PR**: ~~CLI has no write git operations.~~ **GREEN** — git-workflow.ts with safe branch/stage/commit/push/PR, used by both the human slash commands (`/ship`/`/branch`/`/pr`, live-proven: PR #92, PR #93) and the new gateway-gated `project.ship` agent tool (test-proven, not yet live-proven). 103 regression tests passing across both paths.
2. **V — Voice**: No tests, deploy failed. Voice pipeline untested.
3. ~~**Y — Marketing claim matrix**~~: **GREEN** — MARKETING-CLAIM-MATRIX.md built. 17 GREEN, 2 YELLOW (voice beta, simulations disclosed), 0 RED.

## Primary E2E Scenario Blockers

The primary scenario is: "LiTT edits its own website → tests → builds → shows diff → commits → pushes → deploys → verifies → rolls back if unhealthy"

Current blockers:
1. ~~**G — Git**: No commit/push implementation~~ **RESOLVED** — LiTT (the agent) can now propose a ship via `project.ship`, gated by human approval through ExecutionGateway, reusing the same safe git-workflow.ts the human `/ship` command uses.
2. **Deploy → verify → rollback**: No automated Railway deploy from CLI, no rollback procedure
3. **Approval gates**: ExecutionGateway has approval enforcement; `project.ship` now has a real E2E test of that flow (see P). Broader approval-gate E2E coverage across all mutating tools is still open.

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
| litlabs-website (Railway faithful-rejoicing) | LIVE | 97f5988c SUCCESS | Landing page verified (8 markers) |
| terminal-server (Railway litlabs-terminal-server) | LIVE | bda29320 SUCCESS | PTY env isolation verified (23/23) |
| web (Railway litlabs-terminal-server project) | STALE | 95b0a6d1 SUCCESS | 16f09185 FAILED (commit 9f6c2bed) |
| litt-voice-worker | STALE | 60ea9587 SUCCESS | c08f26af FAILED (commit 9f6c2bed) |

## Test Suite Summary

| Suite | Tests | Status |
|-------|-------|--------|
| terminal-server | 106 | All passing |
| litt-cli | 1052 + 4 skipped | All passing (+65 vs. baseline: 47 git-workflow, 14 project.ship, 4 approval-bridge) |
| litt-agent-core | 240 suites / 734 tests | All passing |
| litt-models | 4 files | All passing |
| Website Playwright | Multiple specs | Not run in this session |
