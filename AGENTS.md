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
The Windows canonical checkout sits on `main` as of 2026-11-27 (previously
`fix/studio-mission-20261030`, since merged/moved past — update this line
again if it drifts, rather than trusting it blind).
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

## Execution Integrity Program (R1-R8) — status (verified 2026-11-27)

PR #1140 ("P0 execution integrity R1-R8") merged into `main`. Its own body
frames R1-R8 as implementing a founder-approved program; there is no separate
"Execution Integrity Contract" document — treat PR #1140's description as the
closest thing to one. Status, verified directly against code and tests, not
just the merge/PR text:

- R1 (checkpoint-failure recording + resume refusal), R2 (bounded model-switch
  escape on resume), R4 (provider-transition reasons persisted), R5 (one
  stable logical run ID across pauses/resumes), R6 (destructive-action safety:
  delete-streak cap, structured approval cards) — merged, not independently
  re-verified beyond what #1140's own 2,691/2,691 test claim covers.
- R3 (referenced-asset existence gate) and R8 (publishing integrity: a deploy
  only counts on a ready, URL-verified record; duplicate publishes replay) —
  merged and directly verified: `run-settlement.ts`, `agent-loop-v2.ts`
  `readDeploymentOutcome`/`duplicateDeploymentReplay`, and
  `__tests__/publishing-integrity.test.ts`.
- R7 (content/instruction-leakage guard) — merged; see `instruction-leakage.ts`
  and `__tests__/instruction-leakage.test.ts`.
- **Milestone-aware settlement** (a build-only run settling "completed"
  without ever checking a publish-scoped run actually deployed) — this was a
  real gap, flagged by a 2026-11-26 coordination note and independently
  rediscovered by a 2026-11-27 architecture audit before the audit caught that
  it had already been fixed. Fixed in commit `dd08ad449` ("Reconcile R1-R8
  with main + Devin coordination fixes (a)(b)(c)"), landed inside #1140 before
  it merged. `run-settlement.ts`'s `deploymentRequired`/`deploymentVerified`
  fields gate settlement at both call sites in `agent-loop-v2.ts`. Test
  coverage for failure/cancellation/success existed from the fix itself;
  explicit timeout and fail-then-retry-succeeds tests were added 2026-11-27
  (`agent-loop-v2.deploy.test.ts`, "II. milestone-aware settlement: timeout
  and retry").
- **Same-tool-different-args breaker bypass** (the `image.stock` x4 class) —
  fixed in the same `dd08ad449` commit, item (b), `513c11ed`. See
  `agent-loop-v2.same-tool-streak.test.ts`.
- **Internal-message provenance** (loop-injected nudges indistinguishable
  from real user text) — fixed in the same `dd08ad449` commit, item (c),
  `878c559a`. `LLMMessage.origin: "internal"` set at all 15 loop injection
  sites. See `agent-loop-v2.internal-provenance.test.ts`. PR #1139's actual
  nudge content was explicitly NOT adopted by this fix and remains on hold —
  only the provenance marker mechanism landed.
- **Billing settlement** (stale-settlement false positive, unverified
  release-on-insert-failure) — fixed on `main`, not just an unmerged branch.
  `src/lib/agent-billing.ts` now guards release-on-insert-failure against a
  prior row's actual status and cross-checks `settled_amount + released_amount`
  against reserved credits before trusting a settlement read-back. Commits
  `1b3c828df` (ACC-01) and `907966c2e` (ACC-04).

Before citing any R1-R8 item as "open" or "unverified," re-check the code
directly — this list has already been wrong once (the audit's own first pass
flagged three already-fixed items as open) because a prior reconciliation
commit landed inside the same PR as the headline work.

## Known Architectural Debt (not a release blocker, tracked here so it isn't re-discovered as a surprise)

Studio's primary agent loop (`src/lib/litt-intelligence/agent-loop-v2.ts`,
~6700 lines) is an independent implementation with zero imports from
`@litt/agent-core` — it does not run on the CLI's shared execution core.
`@litt/agent-core` + `@litt/models` are genuinely shared between the CLI and
the PC-bridge path (`src/app/api/bridge/cli/route.ts`), so "shared execution
intelligence" is real for that path but not for Studio's main chat/build loop.
Permission enforcement is likewise fully duplicated: Studio's
`capability-registry.ts`/`capability-shared.ts` vs the CLI's
`capability-gate.ts`/`approval-policy.ts` share no risk model. Every future
integrity fix in this area (billing, verification, permissions, settlement)
has to be built and verified twice as a result — which is exactly the kind of
split where a fix lands on one side and not the other. Deferred by design per
the 2026-11-27 audit (Larry: Development GO, Integration/Acceptance/Production
HOLD) — not something to fix opportunistically inside an unrelated task.

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
  That redactor covers Stripe/Supabase/Railway/Bearer/`*_KEY=` forms, plus
  (verified 2026-11-27 against `packages/litt-cli/src/lib/secret-redaction.ts`)
  OpenAI-style `sk-...` and the full GitHub token family (`ghp_`/`gho_`/`ghu_`/
  `ghs_`/`github_pat_`). JWT-specific redaction was not confirmed either way —
  treat as unverified, not as covered, until checked directly.
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

