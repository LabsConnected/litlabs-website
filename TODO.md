# Terminal Pipeline — Known Follow-Ups

## Stale Provisioning Lock Recovery (TODO)

`claimProvisioningLock()` in `src/lib/projects/project-repository.ts` transitions
`workspace_status` from `not_prepared`/`failed` to `provisioning`. If the request
crashes after claiming the lock (serverless timeout, OOM, network failure), the row
stays `provisioning` forever — no new claim can proceed because `claimProvisioningLock`
only matches `not_prepared`/`failed`.

**Required recovery logic:**
- Detect `workspace_status = 'provisioning'` where `updated_at` is older than a safe
  timeout (e.g. 5 minutes)
- Atomically transition stale `provisioning` -> `failed` with
  `workspace_error = 'Provisioning timed out'`
- Allow a new `claimProvisioningLock` to succeed on the now-`failed` row
- Preserve the previous `workspace_error` for diagnostics if it exists
- Implement as `recoverStaleProvisioning(projectId, userId, maxAgeMs)` called at the
  top of the prepare route before `claimProvisioningLock`

## Production Runtime (BLOCKED)

The terminal server requires Docker for workspace isolation. Railway does not provide
a Docker daemon inside containers. The terminal is **not production-ready** until one
of these is configured:

- Dedicated VM with Docker installed and `littree-terminal:latest` image built
- Sandbox provider integration (e.g. E2B, Fly Machines) replacing Docker-based isolation

The Dockerfile (`terminal-server/Dockerfile`) currently has `TERMINAL_USE_DOCKER=false`
and `TERMINAL_WORKSPACE_ROOT=/tmp/...` — both must be changed for production.
