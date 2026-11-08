# LiTT Mission Controller — Architecture & Reuse Audit

Status: design baseline for Stage 1. Owner: Larry. Last updated: 2026-11-06.

## 1. What the Mission Controller is (and is not)

A durable orchestration service that turns high-level missions ("get LiTT
ready for paid beta") into a queue of agent-executed work orders, driving
existing tools — gh CLI, CI, `litt repair`, staging deploy, Playwright —
rather than a new agent framework. Agents already exist (Devin sessions,
subagents, CI jobs). The missing layer is **durable coordination**: what is
being done, by whom, in which worktree, against which acceptance criteria,
and what happens on failure.

## 2. Reuse audit — assets that already exist

| Existing asset | Role in controller |
|---|---|
| `litt repair` pipeline (`packages/litt-cli/src/commands/repair*.ts`, `src/lib/repair/`) | The DEBUGGER role, already production-hardened: reproduce → regression-red → diagnose → approve → patch → validate → rollback, durable `.litt/repairs/<runId>/` state, snapshots, job-schema command policy, secret redaction, exit codes 0–5. Wrap it; do not rebuild. |
| `.devin/workspace-registry.md` | Worktree ownership/coordination — the controller's resource allocator reads/writes this to prevent two agents on one tree. |
| `provider-registry.ts` (CLI + web) | Provider health states (READY/NO KEY/RATE LIMITED/DOWN/UNVERIFIED) → the controller's provider-monitor input. |
| `paused-run-store.ts` + approval gates | Pattern for durable run state + explicit approval semantics; mission approvals reuse the same truthfulness rules. |
| `staging-deploy.yml` (on main, #808) | Staging deploy adapter — dispatch-only, hardcoded staging target, SHA-verifying health check. |
| `staging-clerk-auth.yml` | Post-deploy auth validation — the controller's staging smoke gate. |
| `railway-scope-diagnostic.yml` (#809) | Read-only credential probing → escalates to owner-action requests (never retries invalid creds). |
| gh CLI + branch protection | PR/CI adapter: create branches, open PRs, poll `gh pr checks`, read run logs. No bypass. |
| Playwright MCP + preview probes | QA role for browser acceptance (image probe pattern in `tests/preview-image-load-probe.test.ts`). |
| `terminal-server` exec/transport | Remote/local execution lane for agents needing workspace shells. |
| Agent-loop v2 + tool ledgers | In-product agent already exists; controller missions can delegate Studio-side work to it. |
| Subagents (`run_subagent` profiles) | BUILDER/QA worker pool inside a Devin session. |

## 3. Gap analysis — what must be built

1. **Durable mission queue** — `.litt/missions/<missionId>/` (JSON, atomic
   temp+rename, mirroring the repair-report pattern). Fields: id, title,
   priority, status, deps, assigned role, worktree/branch, checkpoints[],
   acceptance[], retries, budgetMs/costClass, log[].
2. **Controller loop** — `litt mission start|resume|status` in litt-cli.
   DETECT (gh issues/PRs/CI failures + explicit mission files) → PLAN
   (architect role → work orders) → ASSIGN (worktree + agent adapter) →
   BUILD/TEST (subagent or repair job) → REVIEW (CI + security scan) →
   STAGE (staging-deploy dispatch) → VERIFY (smoke + acceptance) → REPORT.
   Bounded retries (default 2), then escalate with evidence.
3. **Agent adapters** — thin shims over: `run_subagent` (builder/qa),
   `litt repair start --job` (debugger), `gh workflow run` (devops),
   Playwright probes (acceptance). Each adapter writes evidence artifacts
   into the mission dir.
4. **Budget + concurrency guards** — one deploy in flight per environment
   (workflow `concurrency:` already enforces on GitHub side); mission-level
   lockfile prevents duplicate jobs; provider costClass gates paid calls.
5. **Owner gate** — `requires_owner_approval` flag per step type
   (production deploy, credentials, paid APIs, merges to main). The
   controller parks (like repair exit 3) instead of asking repeatedly.
6. **Mission Control view** — Stage 1: `litt mission status` CLI report.
   Stage 3: web dashboard (existing Studio shell, read-only at first).

## 4. Stage 1 scope (this week)

- `litt mission` command family: `create/start/resume/status/list`.
- Mission store + schema (`src/lib/missions/`).
- Adapters: gh-pr, ci-watch, repair-wrap, staging-dispatch.
- First real mission = the paid-beta checklist (token validation,
  staging deploy at release SHA, Cloudflare acceptance ×10, Stripe
  test-mode, customer E2E, GO/NO-GO report) encoded as a mission file
  with checkpoints — the acceptance criterion "results persist across
  controller restart" is proven by killing/resuming mid-run.

## 5. Non-goals

- No second agent framework, no autonomous production deploys, no
  credential rotation, no unbounded retries, no paid-provider spend
  beyond explicit per-mission budgets.

## 6. Hard safety rails (already enforced by repo rules)

- `main` protected; merges require checks + owner approval.
- Staging-only deploy targets are hardcoded in workflows.
- Credential failures → owner-action requests, never retried.
- Approval semantics inherit agent-runtime truthfulness rules.
