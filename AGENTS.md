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

## Self-Repair (`litt repair`)

The autonomous repair command turns a declared incident into a verified patch
under strict safety rails. Entry: `src/commands/repair.ts` (start/resume),
`src/commands/repair-apply.ts` (approve, patch, validate, rollback), and the
helpers in `src/lib/repair/`.

### Pipeline

reproduce -> regression-red -> diagnose -> approve -> patch ->
focused checks -> regression green -> full checks -> independent
re-reproduction -> unrelated-change scan -> report

Each stage persists `.litt/repairs/<runId>/report.json` atomically
(temp + rename). Before the first write to the workspace the run also persists
`snapshots.json` (prior bytes of every patch target) and `manifest.json`
(workspace fingerprint) beside the report, so a killed run is recoverable.

### Usage

    litt repair start  --job <job.json> [--yes]
    litt repair resume --run <runId> --job <job.json> [--yes]

Exit codes:

| Code | Meaning |
|------|---------|
| 0 | complete: reproduced, regression red first, all checks green, no unrelated changes |
| 1 | blocked or cancelled (could not reproduce, bad proposal, declined) |
| 2 | usage/config error, or resume with a job that differs from the original |
| 3 | parked: awaiting approval, or provider blocked (billing, offline, no model) |
| 4 | failed validation; changes rolled back (the report says if restore was incomplete) |
| 5 | patch applied and verified but UNPROVEN: regression was already green, or files changed outside the approved patch |

A run is only COMPLETE when the original failure reproduced, the regression
command failed before the patch and passes after, every required check passes,
the original failure no longer reproduces, and nothing outside the approved
patch changed. Anything less is `partially-verified` (exit 5) or `failed`.

### Job files and the incident dataset

The job schema is `src/lib/repair/contracts.ts#repairJobSchema`: reproduction
command + expected failure signature, a regression command, `editablePaths`,
`checks`, and a `modelPolicy`. Commands are argv-only.

The incident evaluation dataset is
`src/__tests__/fixtures/repair-incidents/cases.json` (CLI-scope cases that run
the real pipeline with only the model call stubbed) and
`integration-incidents.json` (studio/infra incidents that need a live stack and
are NOT executed by the CLI harness, e.g. the backup watchdog). The CLI cases are
synthetic reductions of real incident classes: Ollama cold-start timeout,
incorrect model selection, Tailscale/LAN fallback, PowerShell process overhead,
CLI tool argv failure, approval/resume interruption, stalled-process
cancellation, and non-atomic file persistence, plus pipeline behaviors
(rollback, blocked, parked/resume, out-of-scope and protected paths).

Run the eval whenever repair prompts (`diagnose.ts`), command execution, or
model routing change; CI does this on Linux, Windows and macOS
(`.github/workflows/litt-cli-repair-eval.yml`):

    pnpm exec vitest run repair

### Safety rules (enforced by code and covered by `repair-hardening.test.ts`)

- Approval gate: nothing is applied without `--yes` or an interactive `y`.
  The prompt shows the text to be removed and inserted (redacted, control
  characters neutralized), not only byte counts. Without a TTY and without
  `--yes` the run parks at `partially-verified`.
- Command policy: only the exact job-declared commands can run, spawned
  directly. The job schema rejects shell interpreters (`sh`, `bash`, `cmd`,
  `powershell`, `pwsh`, `wsl`), destructive tools (`rm`, `del`, `rmdir`,
  `format`, `sudo`, `taskkill`), deploy tools (`vercel`, `railway`, ...),
  `git push/remote/credential`, `publish`/`deploy`, and cmd.exe metacharacters
  in arguments of `.cmd`-shim commands (`pnpm`, `npm`, `yarn`, `npx`).
- Trust model: the allowlist limits what is launched, NOT what a launched test
  or build does. Code in `editablePaths` that a check executes runs with your
  privileges once you approve the patch. Keep `editablePaths` to source and
  test files; do not include build scripts, package manifests or CI config.
- Path rules: patches limited to `editablePaths`. Rejected at any depth:
  `..`, absolute paths, `.git`, `.env`/`.env.*`, `credentials`, `backups`,
  `.litt/repairs`, alternate data streams (`file:stream`), Windows device names
  and trailing dot/space segments. Symlink targets and parents that resolve
  outside the workspace are refused.
- Rollback: every authorized patch target is snapshotted and persisted before
  apply. A failed check, a still-reproducing failure, an unexpected error, or
  Ctrl+C restores the prior bytes (created files are removed). The report only
  says "workspace restored" after a restore succeeded; if it could not, it says
  `RESTORE INCOMPLETE` or `NO ROLLBACK POSSIBLE` with the paths.
- No retry loop: one proposal per run. A resume re-runs at most one diagnosis.
  Every command has a timeout (max 10 minutes) and an output cap.
- Resume integrity: a resume must present the same job (SHA-256 digest) the
  run started with, so a changed job cannot widen scope mid-run.
- Evidence is redacted with `secret-redaction` before it leaves the process.
  That redactor covers Stripe/Supabase/Railway/Bearer/`*_KEY=` forms only; it
  does not recognize OpenAI-style `sk-`, GitHub `ghp_`, or JWT tokens.
- Model policy: defaults to local `ollama:litt-coder:8k`. Cloud models need a
  configured key and an explicit `modelPolicy`; `offline` forbids non-Ollama
  models. Provider failures (billing, no daemon) block the run (exit 3) and are
  never reported as a failed repair. The user's pinned chat model is never changed.

### Recovery

- Parked run: `litt repair resume --run <runId> --job <job.json> --yes`.
- Interrupted or crashed after patching: `resume` reloads `snapshots.json`
  and re-runs validation; a failing check restores the files. If the report
  says `NO ROLLBACK POSSIBLE`, restore the listed files with git.
- Exit 5: inspect `unrelatedChanges` and `remainingRisks` in the report. Unrelated
  files are reported, never deleted or reverted automatically.
- Manual inspection: `.litt/repairs/<runId>/report.json` holds the stage,
  command evidence (exit codes, redacted output) and remaining risks.

### Verified platforms

- Windows 11 (PowerShell): repair tests, full CLI suite, live Ollama test.
- Linux (Ubuntu on WSL2, native ext4): see the final report for the recorded run.
- macOS: CI matrix only; not run locally.
- Termux/Android: NOT tested. No device was available. The dataset uses only
  `node <script>` commands and forward-slash relative paths, but this is unproven.

### Live model test

    LITT_RUN_LIVE_OLLAMA=1 pnpm exec vitest run src/__tests__/live-ollama-repair.test.ts

Uses the real Ollama daemon and `litt-coder:8k` (override with
`LITT_LIVE_OLLAMA_MODEL`). With no daemon or model the tests are skipped and
print `LIVE OLLAMA BLOCKED: <reason>`; a skipped live test is never a pass.

