# Sandbox verification — Phase 0 canary contract

This directory implements Phase 0 of `workspace/litlabs-studio-merge/SANDBOX-PLAN.md`:
the **verification contract** that defines, as executable code, what
"verified sandbox" means for repo-backed Studio workspaces. It changes
no product behavior — the provider wired by default is
`DisabledSandboxProvider`, the canary against it can never pass, and
the isolation policy (`../isolation-policy.ts`) is untouched and still
fails closed.

## Why this exists

The isolation policy refuses all host execution in production-like
environments, and its own comments prescribe the only acceptable way
that ever changes: the policy will be updated to check for *verified
sandbox isolation*, programmatically, in code — never via an
environment variable, because "a configuration claim is not proof of
isolation." This module produces that proof. The Phase 4 policy update
(seam S1 in the plan) may consult exactly one signal:
`SandboxVerificationService.isVerified()`, which is true only while a
fresh, fully green canary report exists.

## The contract

A sandbox backend is a `SandboxProvider` (`provider.ts` — the
terminal-side mirror of `src/lib/terminal-v1/sandbox-provider.ts`;
the two must stay shape-compatible). The canary (`canary.ts`) depends
only on the `CanaryProvider` subset — `health / create / get /
execute / destroy` — so any full provider satisfies it structurally.

`runSandboxCanary(provider, options)` boots two real sandboxes as two
different tenants and runs these probes, in order. **Every check must
pass; the canary fails closed** (any error, timeout, or missing
verdict is a failed check):

| Check | What it proves |
|---|---|
| `provider-health` | The provider reports itself healthy. |
| `exec-round-trip` | A random marker written via `execute` inside sandbox A reads back byte-for-byte — exec genuinely works. |
| `host-isolation` | The marker file does **not** exist on the terminal host's filesystem, and the sandbox cannot read a sentinel file planted on the host — exec provably did not run on the host and host files are invisible inside. |
| `tenant-isolation` | Sandbox B (different user/project) can read neither A's marker file nor A's per-tenant environment variable. |
| `filesystem-confinement` | A file A writes to an absolute path outside the workspace is invisible on the host and in sandbox B. |
| `network-egress` | From inside the sandbox, the cloud metadata endpoint (default `http://169.254.169.254/latest/meta-data/`, configurable) is unreachable — any HTTP response at all fails the check — and so is the terminal service itself when a beacon URL is configured. |
| `resource-limits` | The instance echoes the requested CPU/memory limits **and** enforces the memory limit: an allocation of 1.6× the limit cannot complete. In-sandbox visible CPU/RAM is recorded as evidence but does not gate (cgroup-enforced providers legitimately report host totals through `os.*`). |
| `cleanup` | Both canary sandboxes destroy cleanly and are gone via `get()` afterwards — no leaked sandboxes. |

Probe commands assume the sandbox template ships `sh`, `node`, and
coreutils (true of `../sandbox.Dockerfile`). They are ordinary
commands a real provider receives verbatim; the `EGRESS_PROBE` /
`LIMITS_PROBE` / `MEMORY_HOG` comment tokens exist so test doubles can
recognise the probes.

## The signal

`SandboxVerificationService` (`verification.ts`) owns the latest
report for one provider:

- `start()` — boot hook: runs a canary without blocking startup.
- `runNow()` — on-demand run; concurrent calls share one in-flight run.
- `getSignal()` / `isVerified()` — state is `never-run`, `failed`,
  `stale` (green but older than the freshness window, default
  5 minutes), or `verified`. Only `verified` makes `isVerified()`
  true. There is no env var, flag, or setter that can force it.

Phase 0 deliberately did **not** wire `start()` into `server.ts`.
Phase 1 does (see below): `server.ts` builds the sandbox stack via
`createSandboxExecStack()` and calls `verification.start()` at boot
only when a real provider is configured, so the default deployment's
behavior is still unchanged.

## Running the canary

Against the providers registered in Phase 0 (from the repo root):

```sh
# Always fails — this is today's production truth, and the proof the
# harness ships unverified:
pnpm exec tsx terminal-server/sandbox/run-canary.ts --provider disabled

# Always passes — the compliant reference fake, proving the harness
# itself works end to end with no vendor account:
pnpm exec tsx terminal-server/sandbox/run-canary.ts --provider fake
```

Exit code is 0 only when every check passes; the JSON report is
printed either way.

### Running it against a real provider (Phase 1 and later)

The E2B provider is registered in `run-canary.ts` and constructed by
the same config factory the server uses. It activates only with
`SANDBOX_PROVIDER=e2b` and `E2B_API_KEY` in the environment:

```sh
SANDBOX_PROVIDER=e2b E2B_API_KEY=<key> \
  pnpm exec tsx terminal-server/sandbox/run-canary.ts \
  --provider e2b --beacon http://localhost:4001
```

Passing the terminal service's own internal base URL as the beacon
makes the egress check also prove "sandbox cannot reach the terminal
service". Only a green report from the **real** provider counts
toward the plan's proof gate (§4, step 6). The fakes in `testing/`
validate integrations against the contract's expectations in CI;
they are not evidence of isolation.

## Phase 1 — E2B provider + gated workspace.exec

Phase 1 (branch `agent/studio-sandbox-phase1`) adds:

- `e2b-provider.ts` — `E2bSandboxProvider`, the full contract on the
  official `e2b` SDK (v2) through a narrow injectable client adapter
  (`E2bClient`) so CI tests the provider logic against a fake client.
  `stop()` maps to E2B pause (disk preserved); `connectTerminal`
  refuses explicitly — Phase 1 routes exec only.
- `env.ts` — the terminal-side mirror of the web env allowlist
  (`buildSandboxEnv` / `assertNoPlatformSecrets`, seam S7) plus
  `composeSandboxEnv`. Sandbox env is built ONLY here; platform
  secrets — including `E2B_API_KEY` itself — are refused before any
  SDK call. Identity variables always win over caller-supplied env.
- `config.ts` — the factory. E2B is constructed only when
  `SANDBOX_PROVIDER=e2b` AND `E2B_API_KEY` are both set; anything
  else yields `DisabledSandboxProvider` (Phase 0 behavior).
- `exec-router.ts` — `SandboxExecGate` + `SandboxExecRouter`. The
  ONE routed surface is `workspace.exec`
  (`POST /internal/workspace/:workspaceId/exec` in `../server.ts`),
  and it routes only when ALL hold: real provider configured,
  routing-enabled process (Phase 1: staging via
  `RAILWAY_ENVIRONMENT_NAME=staging` or `SANDBOX_STAGING=true`;
  Phase 2: production only with the explicit
  `SANDBOX_PRODUCTION_ENABLED=true` switch), requester on the
  terminal owner allowlist, and
  `SandboxVerificationService.isVerified()` true right now.
  Otherwise the endpoint falls through to its pre-Phase-1 path,
  byte-identical. Bindings are per (userId, projectId, workspaceId);
  routed executions are audit-logged with those identities. The gate
  can be consulted without executing via
  `GET /internal/sandbox/availability?userId=<clerkId>` in
  `../server.ts` (service-auth; booleans + provider name only).
  Exec requests may carry per-command PROJECT env (`env` in the
  request body): providers guard it by VALUE against the terminal's
  own platform secrets (`env.ts` `guardPerCommandProjectEnv`), so a
  project's own keys are accepted while platform values never cross.

Configuration reference:

| Variable | Meaning |
|---|---|
| `SANDBOX_PROVIDER` | `e2b` opts in; anything else = disabled. |
| `E2B_API_KEY` | E2B API key. Read only by `config.ts`; never logged, never placed in a sandbox. |
| `E2B_TEMPLATE_ID` | Template to boot. Default `litt-sandbox-v1`: build & publish from `../sandbox.Dockerfile` (`e2b template build`) before the staging canary. Set to `base` only for a smoke run. |
| `SANDBOX_STAGING` | `true` marks a non-Railway staging rig. Railway staging is detected via `RAILWAY_ENVIRONMENT_NAME=staging`. |
| `SANDBOX_PRODUCTION_ENABLED` | Phase 2: `true` on the PRODUCTION service explicitly enables routing there (with provider + owner + fresh canary). Set it LAST in the production cutover — configuring the provider alone never opens production routing. |
| `TERMINAL_OWNER_CLERK_IDS` | Existing owner allowlist; the gate reuses it. |

Template sizing note: the current E2B SDK sets vCPU/memory at
template build time, not per-create. The provider records requested
limits on each instance (the canary echoes them from `get()` and
proves memory enforcement empirically). Build the `litt-sandbox-v1`
template to cover the limits callers request — the code defaults in
`provider.ts` (`DEFAULT_SANDBOX_LIMITS`: 1 vCPU / 1 GiB) and the
canary's smaller profile — or the enforcement probe and real
workloads will disagree with the echo.

## Tests

`terminal-server/__tests__/sandbox-canary.test.ts` and
`sandbox-verification.test.ts` cover: the compliant fake going fully
green; each failure-class fake (shared filesystem, host exec, open
egress, ignored limits, unhealthy) failing exactly the checks it
should; the disabled provider never verifying; signal staleness,
absent-report, and concurrent-run dedupe semantics.
