# Terminal Pipeline — Known Follow-Ups

## Socket.IO Test Port Collision (RESOLVED)

`terminal-socketio-integration.test.ts` and `terminal-server-smoke.test.ts`
both used port 4099, causing a timeout when run in parallel. Integration test
moved to port 4098. Full suite now passes: 112 files, 1,688 tests, 0 failures.

## Stale Provisioning Lock Recovery (DONE)

`claimProvisioningLock()` in `src/lib/projects/project-repository.ts` transitions
`workspace_status` from `not_prepared`/`failed` to `provisioning`. If the request
crashes after claiming the lock (serverless timeout, OOM, network failure), the row
stays `provisioning` forever — no new claim can proceed because `claimProvisioningLock`
only matches `not_prepared`/`failed`.

**Implemented:**
- `recoverStaleProvisioning(projectId, userId, maxAgeMs)` detects stale `provisioning`
  rows older than 5 minutes and atomically transitions them to `failed`
- Previous `workspace_error` is preserved and appended with ` | Provisioning timed out`
  for diagnostics
- Called at the top of `src/app/api/studio-projects/[projectId]/workspace/prepare/route.ts`
  before `claimProvisioningLock`

## Production Runtime (RESOLVED via E2B — verified 2026-11-16)

The terminal server no longer depends on in-container Docker. Production
runs on Railway project `litlabs-terminal-server` (service
`litlabs-terminal-server`, domain `terminal.litlabs.net`) with the E2B
sandbox provider: `SANDBOX_PROVIDER=e2b`, `E2B_API_KEY`, `E2B_TEMPLATE_ID`,
`SANDBOX_PRODUCTION_ENABLED` are set, and `/health` reports
`sandbox.execution=enabled, state=verified` via a fresh green canary.
Host execution stays fail-closed by design; repo work executes inside E2B
sandboxes (`terminal-server/sandbox/`).

Remaining caveat: a duplicate `terminal-server` service inside the
`litlabs-website` Railway project has no sandbox provider configured
(`sandbox.state=not-configured`) and receives no traffic — the production
web service points at `terminal.litlabs.net`. Candidate for retirement
after owner confirmation.

`TERMINAL_USE_DOCKER` remains a local-dev-only option; the Railway
Dockerfile (`terminal-server/Dockerfile.railway`) does not require a
Docker daemon inside the container.
