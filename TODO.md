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

## Production Runtime (BLOCKED)

The terminal server requires Docker for workspace isolation. Railway does not provide
a Docker daemon inside containers. The terminal is **not production-ready** until one
of these is configured:

- Dedicated VM with Docker installed and `littree-terminal:latest` image built
- Sandbox provider integration (e.g. E2B, Fly Machines) replacing Docker-based isolation

The Dockerfile (`terminal-server/Dockerfile`) currently has `TERMINAL_USE_DOCKER=false`
and `TERMINAL_WORKSPACE_ROOT=/tmp/...` — both must be changed for production.
