# ADR: Terminal V1 Sandbox Provider Selection

**Status:** Proposed
**Date:** 2026-08-02
**Branch:** `feat/terminal-v1-sandbox-provider`

## Context

PR 1 established the `SandboxProvider` interface. PR 2 must select and implement
a concrete provider for Terminal V1 alpha (owner-only).

## Evaluation criteria

| Criterion | Weight |
|---|---|
| Terminal streaming (PTY) support | Critical |
| Persistent volume or snapshot support | Critical |
| Startup time | High |
| Bash support | Critical |
| PowerShell Core support | High |
| Custom image support | High |
| Port preview support | High |
| Network policy support | Medium |
| Resource limits (CPU, RAM, processes, disk) | Critical |
| Per-hour cost | High |
| Storage cost | Medium |
| API maturity | High |
| TypeScript SDK quality | Medium |
| Sandbox termination guarantees | High |
| Regional availability | Medium |

## Providers evaluated

### 1. Docker (self-managed containers)

| Criterion | Rating |
|---|---|
| Terminal streaming | ✅ via `docker exec -it` or `docker attach` |
| Persistent volumes | ✅ Docker named volumes or bind mounts |
| Startup time | ~2-5s (container start) |
| Bash | ✅ Native |
| PowerShell Core | ✅ Install `pwsh` in image |
| Custom image | ✅ Full control |
| Port preview | ✅ Port mapping + proxy |
| Network policy | ⚠️ Docker networks (limited isolation) |
| Resource limits | ✅ `--cpus`, `--memory`, `--pids-limit` |
| Cost | $0 software + hosting cost |
| TypeScript SDK | `dockerode` package (mature) |
| Termination | ✅ `docker rm -f` |

**Pros:** Already partially implemented. Full control over image. Low cost.
**Cons:** Requires Docker daemon on the gateway host. Isolation is weaker than
VM-based solutions. Docker-in-Docker on Railway is problematic.

### 2. E2B (managed cloud sandboxes)

| Criterion | Rating |
|---|---|
| Terminal streaming | ✅ WebSocket-based PTY |
| Persistent volumes | ⚠️ Filesystem snapshots (not live volumes) |
| Startup time | ~1-2s (firecracker microVM) |
| Bash | ✅ Native |
| PowerShell Core | ⚠️ Custom image required |
| Custom image | ✅ Custom Dockerfile support |
| Port preview | ✅ Built-in port forwarding |
| Network policy | ✅ Per-sandbox network isolation |
| Resource limits | ✅ CPU, RAM configurable |
| Cost | ~$0.05-0.10/hour per sandbox |
| TypeScript SDK | ✅ First-class TypeScript SDK |
| Termination | ✅ Automatic timeout + manual kill |

**Pros:** Firecracker microVM isolation. Managed service. Fast startup. Good SDK.
**Cons:** Third-party dependency. Limited PowerShell support. Cost per hour.

### 3. Fly.io Machines

| Criterion | Rating |
|---|---|
| Terminal streaming | ⚠️ Via WebSocket proxy (custom) |
| Persistent volumes | ✅ Fly volumes |
| Startup time | ~1-3s (firecracker) |
| Bash | ✅ Native |
| PowerShell Core | ⚠️ Custom image |
| Custom image | ✅ Dockerfile |
| Port preview | ⚠️ Custom proxy needed |
| Network policy | ✅ Per-machine isolation |
| Resource limits | ✅ CPU, RAM |
| Cost | ~$0.02-0.05/hour |
| TypeScript SDK | ⚠️ REST API (no official TS SDK) |
| Termination | ✅ API stop/start |

**Pros:** Firecracker isolation. Lower cost. Persistent volumes.
**Cons:** No official TypeScript SDK. Terminal streaming requires custom proxy.
Port preview requires custom implementation.

### 4. Kubernetes pods (self-managed)

| Criterion | Rating |
|---|---|
| Terminal streaming | ✅ via `kubectl exec` or WebSocket |
| Persistent volumes | ✅ PVCs |
| Startup time | ~5-15s (pod scheduling) |
| Bash | ✅ Native |
| PowerShell Core | ✅ Custom image |
| Custom image | ✅ Full control |
| Port preview | ✅ Ingress + service |
| Network policy | ✅ NetworkPolicy resources |
| Resource limits | ✅ requests/limits |
| Cost | K8s cluster cost + per-pod |
| TypeScript SDK | ✅ `@kubernetes/client-node` |
| Termination | ✅ Pod deletion |

**Pros:** Strong isolation. Mature ecosystem. Full control.
**Cons:** High operational overhead. Slower startup. Requires K8s cluster.

## Decision

**For Terminal V1 Alpha: Docker-based provider**

Rationale:
1. Already partially implemented in `terminal-server/docker-manager.ts`
2. Owner-only alpha doesn't need maximum isolation (single trusted user)
3. Zero additional service cost
4. Full control over image and configuration
5. Can run on Railway with Docker support or locally

**For Terminal V1 Public Release: Re-evaluate E2B**

When moving to private beta with selected users:
1. Re-evaluate E2B for Firecracker-grade isolation
2. The `SandboxProvider` interface makes this swap transparent
3. E2B's managed service reduces operational burden

## Implementation plan

1. Build `DockerSandboxProvider` implementing `SandboxProvider`
2. Fix all issues from existing `docker-manager.ts`:
   - No `...process.env` — use `buildSandboxEnv()` allowlist
   - Don't delete workspace on container exit
   - Support both Bash and PowerShell Core
   - Add terminal resize via `docker exec`
   - Add idle timeout and max session limits
3. Build sandbox base image with: bash, pwsh, git, curl, node, npm, pnpm, python, pip, gh
4. Wire into provider factory when `TERMINAL_PROVIDER=managed-sandbox`

## Security implications

- Docker containers provide process-level isolation (not VM-level)
- Network namespace isolation via Docker networks
- Resource limits enforced via Docker cgroups
- Environment variables restricted to allowlist
- No gateway secrets in container environment
- For public release: must upgrade to VM-level isolation (E2B/Fly.io)
