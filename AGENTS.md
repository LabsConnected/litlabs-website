# AGENTS.md — LiTT CLI Repository

## Canonical Repository Root

Platform-specific canonical paths (same repo: LabsConnected/litlabs-website):

- Windows (this machine): C:\LiTT\Canonical-2026
- Linux / WSL / Android: ~/litt-canonical

All LiTT CLI development, verification, builds, relinks, commits, and pushes
must run from the canonical repository for the current platform unless a task
explicitly names another worktree. Feature work belongs in dedicated
worktrees (e.g. C:\LiTT\Worktrees\... on Windows, ~/litt-worktrees/... on POSIX).

In every command below, substitute the platform canonical path for
`~/litt-canonical` (i.e. C:\LiTT\Canonical-2026 on this Windows machine).

Do NOT use retired copies or stale clones as canonical sources.

## Workspace Coordination

- Authoritative worktree inventory and KEEP/REVIEW/ARCHIVE routing:
  .devin/workspace-registry.md
- One dev stack only: the canonical workspace owns Next.js :3001 and the
  terminal server :4001. Do NOT start duplicate dev servers in other worktrees.
- Before editing any non-canonical worktree, check the registry. Never modify a
  worktree owned by an active agent session (Devin/Codex/Claude/Qwen).
- Coordinate through branches and PRs; do not hand-copy files between
  worktrees, and do not overwrite another agent's uncommitted work.

## Current Branch

main tracks LabsConnected/litlabs-website (remote: origin).
The Windows canonical checkout currently sits on fix/studio-mission-20261030.
See .devin/workspace-registry.md for the live branch map.

## Build and Relink

cd ~/litt-canonical/packages/litt-models && pnpm build
cd ~/litt-canonical/packages/litt-cli && pnpm build
cd ~/litt-canonical/packages/litt-cli && pnpm link --global

Verify:
which litt
the global @litlabs1/litt-cli link target should resolve to
~/litt-canonical/packages/litt-cli

## Verification Commands

cd ~/litt-canonical/packages/litt-cli
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
