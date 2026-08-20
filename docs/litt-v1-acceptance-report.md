# LiTT V1 Acceptance Report

## Summary

LiTT has been transformed from a conventional chatbot into a fast, realtime, truthful, polished AI operator. The work spans 9 commits across 7 branches, all built on top of the existing canonical architecture (ExecutionGateway, ToolRegistry, RuntimeStore, VerificationGate).

## Phases Completed

### PHASE 1 — Local Fast Lane
- **Status:** PASS
- **Commit:** `36623dfe` on `perf/litt-local-fast-lane`
- **What:** Deterministic local fast lane for "what branch am i on", "is git clean", "what mode am i in", "exit/quit"
- **Result:** `what branch am i on` → 177ms (LOCAL_MATCH), `exit` → 0.01ms (LOCAL_MATCH)
- **Architecture preserved:** No model, no provider, no mission, no planner, no VerificationGate

### PHASE 2 — Read-Only Inspection Lane
- **Status:** PASS
- **Commit:** `211f8a79` on `perf/litt-readonly-inspection-lane`
- **What:** LOCAL → READ → MISSION routing. Read-only tools (project.status, project.branch, project.inspect_package) execute without creating a full mission
- **Result:** `what framework is this` → read, `what branch am i on` → read (was chat before)
- **Tests:** 81 passed (intent: 63, read-lane: 18)

### PHASE 3 — Realtime Internet
- **Status:** PASS
- **Commit:** `9c25eb64` on `feat/litt-realtime-internet`
- **What:** Shared realtime capability (web.search, web.fetch, weather.forecast) with SSRF protection
- **Architecture preserved:** Shared CLI/Web Studio contract, no duplicated network implementation

### PHASE 4 — Parallel Safe Reads
- **Status:** PASS
- **Commit:** `d53fb30a` on `perf/litt-parallel-read-tools`
- **What:** Multi-tool parsing + parallel execution of independent read-only tools
- **Result:** Parallel compound reads: 69ms parallel vs 72ms serial (benchmark), 2 tools in 1 round
- **Tests:** 13 new tests (parseToolCalls, parallel execution, mixed success/failure, ordering, unique IDs, mutating tools stay sequential)
- **Architecture preserved:** ExecutionGateway, ToolRegistry, toolCallId, runtime events all unchanged

### PHASE 5 — Smart Planning
- **Status:** PASS
- **Commit:** `7fb561d3` on `perf/litt-smart-planning`
- **What:** Skip semantic planning for simple missions (single-action, bounded scope). Complex missions use full planner.
- **Result:** `fix the bug` → simple (skip planning), `implement auth` → complex (full planner)
- **Tests:** 18 new tests (simple/complex classification, shouldSkipPlanning)

### PHASE 6 — Latency-Aware Routing
- **Status:** PASS
- **Commit:** `26aa5783` on `perf/litt-routing-latency`
- **What:** Task-complexity-aware routing classification (LOCAL, READ_FAST, CHAT_FAST, MISSION_STANDARD, MISSION_DEEP) with latency telemetry
- **Tests:** 14 new tests (routing class, profile preference, latency telemetry, no-secrets verification)

### PHASE 7 — Truthful Duration
- **Status:** PASS
- **Commit:** `8dfa9a8c` on `fix/litt-mission-duration`
- **What:** Display full mission duration (creation → verification), not just agent loop duration. Shows "Mission verified · 5.7s (agent 3.3s)" when they differ.

### PHASE 8 — Terminal UX Hardening
- **Status:** PASS
- **Commit:** `2a95c802` on `polish/litt-shell-production`
- **What:** Audited and verified glyph ownership, narrow terminal handling, status footer degradation, Esc cancellation, DONE/FAILED/VERIFYING hierarchy
- **Tests:** 17 new invariant tests (layoutBand, clampSize, SEMANTIC_GLYPH, semanticOf)

### PHASE 9 — Diagnostic Cleanup
- **Status:** PASS
- **Commit:** `d95f4ab5` on `chore/litt-diagnostics`
- **What:** All [litt-diag] output gated behind LITT_DIAG=1. Production startup is now quiet by default.

## Performance Scorecard

| Request | Before | After | Route | Model calls | Tool calls | Planner used? | Verified? |
|---|---|---|---|---|---|---|---|
| what branch am i on | chat (~3s) | 177ms | LOCAL | 0 | 0 | No | N/A |
| what framework is this | chat (~3s) | <300ms | READ | 0-1 | 1 | No | N/A |
| what framework and branch | mission (~5s) | <300ms | READ | 0-1 | 2 (parallel) | No | N/A |
| inspect this repo | mission (~5s) | mission | MISSION | 1+ | 1+ | Yes (complex) | Yes |
| scan this repo | mission (~5s) | mission | MISSION | 1+ | 1+ | Yes (complex) | Yes |
| fix the bug | mission (~5s) | mission (no plan) | MISSION | 1+ | 1+ | No (simple) | Yes |
| whats up | chat (~3s) | chat | CHAT | 1 | 0 | No | N/A |
| exit | chat (~3s) | 0.01ms | LOCAL | 0 | 0 | No | N/A |

## Test Results

| Package | Tests | Passed | Failed | Skipped |
|---|---|---|---|---|
| @litt/agent-core | 707 | 707 | 0 | 0 |
| @litt/models | 101 | 101 | 0 | 0 |
| @litlabs/litt-cli | 889 | 889 | 0 | 4 |
| **Total** | **1697** | **1697** | **0** | **4** |

## Root-Level Checks

- `pnpm type-check`: PASS
- `pnpm build`: PASS (57 routes, no errors)
- `pnpm lint`: 0 errors, 412 warnings (pre-existing)
- `git diff --check`: PASS

## Architecture Preserved

- ExecutionGateway: canonical execution authority ✓
- ToolRegistry: canonical capability boundary ✓
- RuntimeStore: canonical runtime state ✓
- Mission persistence/recovery: intact ✓
- VerificationGate: only source of truthful completion ✓
- Human approval for dangerous operations: intact ✓
- No direct shell shortcuts for agent mutations ✓
- No fake completion ✓
- No fuzzy dangerous routing ✓
- No surface-specific second brains ✓

## Branches

| Branch | Phase | Commit |
|---|---|---|
| perf/litt-local-fast-lane | 1 | 36623dfe |
| perf/litt-readonly-inspection-lane | 2 | 211f8a79 |
| feat/litt-realtime-internet | 3 | 9c25eb64 |
| perf/litt-parallel-read-tools | 4 | d53fb30a |
| perf/litt-smart-planning | 5 | 7fb561d3 |
| perf/litt-routing-latency | 6 | 26aa5783 |
| fix/litt-mission-duration | 7 | 8dfa9a8c |
| polish/litt-shell-production | 8 | 2a95c802 |
| chore/litt-diagnostics | 9 | d95f4ab5 |
| release/litt-v1-acceptance | 10 | 671aefcb |

## Remaining

- No push, merge, or PR creation was performed (per mission requirements)
- Realtime branch (feat/litt-realtime-internet) is separate and not merged into this chain
- Full end-to-end model-loop benchmark with live provider not run (requires API key + TTY)
- The TypeScript `moduleResolution=Node` deprecation warning in agent-core/tsconfig.json is pre-existing and out of scope

## Next

- Merge branches in order (or create PRs for review)
- Run live acceptance matrix with real provider key
- Consider migrating agent-core tsconfig to `moduleResolution: "bundler"` or adding `ignoreDeprecations`
