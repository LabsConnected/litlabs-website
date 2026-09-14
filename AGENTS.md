# AGENTS.md — LiTT Repository

Canonical repository: `~/litt-canonical` on branch `main`, remote `origin` = `LabsConnected/litlabs-website`.

## Repository & Branch Workflow

- Treat `~/litt-canonical` as the canonical repository; it should normally remain on `main`.
- Feature work belongs in `~/litt-worktrees/...` or another dedicated worktree.
- Never leave canonical `main` in the middle of a merge, rebase, or cherry-pick.
- If canonical is dirty or mid-operation, diagnose it before starting new work.
- Do not copy files manually between worktrees when Git can perform the operation safely.
- Do not merge partially validated work into `main`; do not force-push `main`; do not reset canonical `main` to a feature branch.
- Delete temporary worktrees/branches only after the work is safely merged or intentionally abandoned.

## Validation

- Validate the smallest affected scope first: targeted Vitest/test files, package-scoped `tsc`/`lint`. Run heavy validation sequentially.
- Never claim a change is fully validated unless the relevant CI/full-validation gate passed; report skipped validation clearly.
- Do not hide warnings, failed tests, build errors, or incomplete checks; do not weaken tests merely to make CI pass.
- Per-package verification: `pnpm exec tsc --noEmit`, `pnpm exec vitest run`, `pnpm build` (run inside the affected package directory).

## Code Changes & Working Style

- Inspect first, edit second; diagnose before patching; prefer evidence over assumptions.
- Read the relevant implementation before editing; understand the existing architecture before introducing a new abstraction.
- Make the smallest correct change; avoid unrelated refactors during bug fixes; preserve existing behavior unless the task requires changing it.
- Do not duplicate existing utilities, components, hooks, routes, or abstractions; follow existing repository conventions.
- Update tests when behavior changes; fix root causes instead of masking symptoms; no silent fallbacks that hide failures.
- Do not leave temporary debug code, logs, commented-out code, or dead files behind.
- When something fails, capture the exact command, exit code, and relevant error.
- Keep changes focused and reviewable; summarize what changed, what was validated, what remains unvalidated, and any risks.

## LiTT Product Behavior

- Prefer truthful UI state over optimistic/fake success states.
- Never report preview, deploy, agent, terminal, model, billing, or build success until the backend confirms it.
- Recover server-side state after client disconnects whenever possible.
- A browser disconnect must not automatically cancel server-side work; intentional user Stop/Cancel actions must cancel the run.
- Finished server-side runs should be recoverable after reload/reconnect.
- Preview should start automatically when appropriate rather than requiring unnecessary manual user actions.
- User-visible errors must explain what failed and provide a meaningful recovery path.
- Do not expose raw internal exceptions unnecessarily to end users.

## Agent Runtime, Cancellation & Recovery

- Server-side agent work should survive ordinary client disconnects.
- Client disconnect and explicit cancellation are different events; cancellation must be explicit and truthful.
- Do not claim an agent completed if execution failed or was interrupted.
- Persist enough state to recover active/completed runs where architecture supports it.
- Avoid spawning unnecessary background processes on Android; clean up child processes after failed or cancelled tasks.

## Preview & Runtime

- Treat preview startup as a first-class workflow.
- If preview is not started and the user expects a preview, start it automatically where safe.
- Differentiate `not_started`, `starting`, `ready`, `unreachable`, and `failed`; do not label `not_started` as `offline` or `failed`.
- Retry transient startup failures conservatively; avoid duplicate preview-start requests.
- Surface useful retry/details controls when preview genuinely fails.

## Security, Auth & Tenant Isolation

- Validate authentication and authorization on server-side privileged operations.
- Never trust client-provided user IDs, project IDs, tenant IDs, file paths, or permissions without server verification.
- Prevent tenant/project crossover; validate and normalize filesystem paths; prevent path traversal.
- Treat terminal/shell input as untrusted; avoid shell interpolation where structured process execution can be used; validate tool inputs before execution.
- Verify webhook signatures; protect expensive endpoints from abuse.
- Do not weaken RLS, authentication, authorization, or billing controls just to fix a test or unblock development.
- Inspect dependencies and generated changes before accepting security-sensitive modifications.

## Database, RLS & Migrations

- Preserve tenant isolation; confirm authorization/RLS implications for new tables and endpoints.
- Use migrations for schema changes; never modify production schema manually when a migration should exist.
- Keep migrations reproducible; avoid destructive schema changes unless explicitly required.
- Do not silently swallow database failures.

## Billing & Stripe

- Treat billing state as server-authoritative; never unlock paid functionality based solely on client state.
- Verify Stripe webhook signatures; make webhook processing idempotent.
- Do not expose Stripe secrets client-side; clearly distinguish test-mode and live-mode behavior.
- Never fake successful payment/subscription states.

## APIs

- Validate request payloads; return meaningful HTTP status codes; handle expected failure states explicitly.
- Avoid leaking internal stack traces or secrets; require authorization where appropriate.
- Protect high-cost endpoints from repeated abuse.
- Preserve backward compatibility unless an intentional breaking change is part of the task.

## Mobile UX

- Assume narrow screens and mobile keyboards; preserve usable layout when the virtual keyboard opens.
- Avoid desktop-only interactions for critical workflows; do not require hover for essential actions.
- Test important Studio flows on mobile-sized viewports; keep primary build/chat/preview controls reachable on mobile.

## Performance

- Avoid unnecessary client bundles and unnecessary polling.
- Clean up timers, subscriptions, listeners, and spawned processes.
- Avoid duplicate network requests where single-flight behavior is appropriate.
- Prefer incremental/targeted work over expensive full-repo operations.
- Do not introduce obvious N+1 requests or repeated expensive model/API calls.

## Error Handling

- Never silently ignore important failures; never convert an actual failure into a fake success response.
- Log enough context to diagnose failures without leaking secrets; preserve the original error cause where useful internally.
- Give users clear failure states; distinguish retryable failures from permanent failures.

## CI & Deployment

- Treat GitHub CI as authoritative for full validation; do not merge while required checks are failing.
- Review failed checks before retrying blindly; never bypass required checks merely to ship faster.
- Ensure deploy state corresponds to the intended commit; confirm migrations and environment requirements before production deployment.
- Do not deploy from an unknown, dirty, or partially merged state.

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
