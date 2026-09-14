# AGENTS.md — LiTT CLI Repository

## Canonical Repository Root

E:\LiTT\Worktrees\main

All LiTT CLI development, verification, builds, relinks, commits, and pushes
must run from this worktree unless a task explicitly names another worktree.

Do NOT use:
- C:\Users\litbi\CascadeProjects\litt-final-integration (retired)
- C:\Users\litbi\CascadeProjects\litt-shell-phase1 (retired)
- C:\Users\litbi\CascadeProjects\litt-shell-tui (retired)
- or other retired C:\ copies as canonical sources.

## Current Branch

main on LabsConnected/litlabs-website

## Build and Relink

cd E:\LiTT\Worktrees\main\packages\litt-models && pnpm build
cd E:\LiTT\Worktrees\main\packages\litt-cli && pnpm build
cd E:\LiTT\Worktrees\main\packages\litt-cli && pnpm link --global

Verify:
where.exe litt
(Get-Item "C:\Users\litbi\AppData\Local\pnpm\global\5\node_modules\@litlabs\litt-cli").Target
should resolve to E:\LiTT\Worktrees\main\packages\litt-cli

## Verification Commands

cd E:\LiTT\Worktrees\main\packages\litt-cli
pnpm exec tsc --noEmit          # typecheck
pnpm exec vitest run            # full test suite
pnpm build                      # build

## Execution Target Architecture (2026-08-29)

LiTT starts LOCAL by default. Two separate concepts:

- executionTarget: local | remote — switchable at runtime via /local and /remote
- localOnly: boolean — emergency/offline lock (set by LITT_LOCAL_ONLY=1)

Default: executionTarget=local, localOnly=false — LOCAL is active, remote available.

Commands:
- /local — switch to LOCAL (always succeeds, no auth needed)
- /local <command> — MACHINE lane execution (local, no remote contact)
- /remote — switch to REMOTE (validates auth + capability first)
- litt --local — launch LOCAL explicitly
- litt --remote — launch REMOTE explicitly (requires auth)

Env vars:
- LITT_LOCAL_ONLY=1 — emergency/offline mode (hard block all model/remote)
- LITT_LOCAL_MODE=1 — legacy compat (same as LITT_LOCAL_ONLY)
- LITT_TARGET_OVERRIDE — set by --local/--remote flags

## Slash-Command Palette (2026-08-29)

- / opens the command palette
- Partial command filters the palette (e.g. /loc filters to /local)
- Space after command token closes the palette; args stay in composer
- Arguments never participate in palette fuzzy matching
- /local where.exe adb submits directly to the machine lane handler

## Do NOT Modify (Stable Systems)

- LOCAL/REMOTE execution routing
- Machine lane semantics and safety
- Capability gate rules
- Auth behavior
- Approval safety
- Railway transport logic
- Provider selection logic
- Destructive command protections

These systems are working and must remain stable.
