# Docker Sandbox Migration Plan — Terminal Server Hardening

## Status: Architecture plan only — not yet implemented

## Current state

The LiTT terminal server runs on Railway at:
`https://litlabs-terminal-server-production-0be1.up.railway.app`

It executes workspace commands (`git`, `npm`, `rg`, file reads/writes) for
Vapi tool calls routed through `/api/vapi/tools`. Authentication uses:
- `TERMINAL_INTERNAL_SERVICE_KEY` for internal exec endpoints
- `createTerminalToken()` for workspace-scoped JWTs

The terminal server works, is authenticated, and has path-safety filtering.
However, it runs on a shared Railway container — voice-triggered commands
execute in the same process/ filesystem as all other workspaces.

## Why migrate

1. **Blast radius**: A malicious or buggy command (`rm -rf`, `npm install`
   with a postinstall script, a fork bomb) can affect the shared container.
2. **Resource isolation**: One heavy `npm run build` can starve other
   concurrent workspace operations.
3. **Trust boundary**: The voice agent can trigger arbitrary shell commands.
   Even with path-safety filtering, the shell surface is broad. A Docker
   sandbox limits the blast radius to a disposable container.

## Target architecture

```
Vapi → /api/vapi/tools (Next.js) → Terminal Server (orchestrator)
                                        │
                                        ├── spawn Docker container per workspace
                                        │   ├── mount workspace volume (read-write)
                                        │   ├── CPU/memory limits
                                        │   ├── no network egress (except package registries)
                                        │   ├── timeout: 300s (matches Vapi maxDuration)
                                        │   └── auto-destroy on completion or timeout
                                        │
                                        └── return stdout/stderr/exitCode
```

## Migration phases

### Phase 1: Container-per-command (minimal change)

- Keep the existing terminal server API surface (`/internal/workspace/:id/exec`).
- Replace the internal exec implementation: instead of running `child_process.exec`
  directly, spawn a Docker container that runs the command.
- Each container:
  - Mounts the workspace directory as a volume.
  - Runs the command with a timeout.
  - Is destroyed after the command completes.
  - Has CPU (2 cores) and memory (1GB) limits.
- Network: containers have no outbound network by default. Package manager
  commands (`npm install`, `pnpm install`) are run in a separate "build"
  container with registry egress allowlisted.

**Effort**: Medium. The API surface doesn't change — only the exec backend.

### Phase 2: Persistent workspace containers

- Instead of one container per command, keep a long-running container per
  workspace that stays alive for the session.
- The terminal server sends commands to the container via `docker exec`.
- Containers are stopped after 30 minutes of inactivity.
- This is faster (no container startup per command) but requires container
  lifecycle management.

**Effort**: Larger. Needs container pool management, health checks, cleanup.

### Phase 3: Network policies + registry proxy

- Use Docker network policies to restrict egress.
- Allow only: npm registry, GitHub (for git push/pull), Vercel (for deploy).
- Block everything else.
- Consider a package registry proxy (Verdaccio, Artifactory) for caching
  and supply-chain control.

**Effort**: Large. Requires network policy configuration and testing.

## What does NOT change

- The `/api/vapi/tools` route in Next.js — same API, same auth, same audit.
- The `runWorkspaceCommand()` helper in the route — same interface.
- The `createTerminalToken()` auth flow — same JWT structure.
- The Vapi assistant configuration — same tool definitions.
- The path-safety filtering in `vapi-tools.ts` — stays as a first line of defense.

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Container startup latency adds delay to voice calls | Phase 2 persistent containers; pre-warm pool |
| Docker not available on Railway | Migrate terminal server to a Docker-capable host (Fly.io, AWS ECS, self-hosted) |
| Workspace volume corruption | Use overlay filesystems; snapshot before destructive commands |
| Cost of container orchestration | Start with Phase 1 (cheapest); only move to Phase 2 if latency is a problem |

## Decision needed

Before implementation:
1. Where will the Docker host run? (Fly.io, AWS ECS, self-hosted VPS)
2. Is Phase 1 sufficient, or do we need Phase 2 from the start?
3. What's the max concurrent container budget? (affects cost)
