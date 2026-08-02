# ADR: Terminal V1 Control Plane and Sandbox Provider Abstraction

**Status:** Accepted
**Date:** 2026-08-02
**Branch:** `feat/terminal-v1-control-plane`

## Context

The existing terminal server (`terminal-server/server.ts`) executes user commands
directly on the host using `node-pty` or `execFile` with `...process.env`. This
means:

1. User shells receive the gateway's full environment (including Clerk secrets,
   Supabase keys, Stripe keys, AI provider keys, and internal service keys).
2. The command blocklist (`security.ts`) is the only barrier between users and
   arbitrary host execution — it is defense-in-depth, not an isolation boundary.
3. Docker mode is required in production, but the Dockerfile disables Docker
   mode, creating a contradiction.
4. Workspaces are tracked in an in-memory `Map` and a `.workspaces.json` file —
   not a durable database.
5. Tokens carry only `userId` (and optionally `workspaceId`/`projectId`) — no
   sandbox binding, no scopes, no token ID.

## Decision

### 1. Provider abstraction

Create a `SandboxProvider` interface that decouples the control plane from any
specific sandbox runtime. The control plane talks to providers through this
interface. Frontend components never reference a specific provider.

**Supported provider values:**
- `disabled` — refuses all operations (default for Prod 1)
- `managed-sandbox` — reserved for PR 2 implementation

### 2. Hardened project-bound tokens

Replace the old token format with a new `TerminalTokenClaims` structure that
requires:
- `sub` (userId)
- `pid` (projectId)
- `wid` (workspaceId)
- `sid` (sandboxId)
- `aud` (audience = "littree-terminal-v1")
- `iat` / `exp` (issued-at / expiration)
- `jti` (unique token ID)
- `scope` (array of allowed operation scopes)

Tokens fail closed. No generic fallback shell tokens are issued.

### 3. Environment allowlist

Only an explicit allowlist of environment variables is passed into sandboxes:
`HOME`, `PATH`, `TERM`, `LANG`, `SHELL`, and `LITTREE_*` identity variables.

Platform secrets are never included. A defense-in-depth check
(`assertNoPlatformSecrets`) verifies no forbidden keys are present.

### 4. Feature flags

```
NEXT_PUBLIC_TERMINAL_ENABLED=false
TERMINAL_ENABLED=false
TERMINAL_PROVIDER=disabled
```

When disabled: no token issuance, no sandbox creation, no Socket.IO connection,
no terminal service calls. Controlled `FEATURE_DISABLED` response.

### 5. Canonical types

Server owns all state types: `SandboxState`, `WorkspaceState`,
`TerminalConnectionState`, `PreviewPortState`, etc. The frontend must not infer
these from timers.

## Consequences

- **Positive:** Clean separation between control plane and provider. No host
  shell execution. No platform secrets in user environments. Tokens are
  project-bound with scopes.
- **Negative:** The `managed-sandbox` provider is not yet implemented (PR 2).
  Until then, all terminal operations are disabled.
- **Risk:** The old terminal server (`terminal-server/`) still exists with its
  unsafe execution paths. It must not be reached by public users while
  `TERMINAL_ENABLED=false`. The Coming Soon patch (already deployed) ensures
  this.

## Security implications

- No `...process.env` in any user execution path
- No host-shell spawn for public users
- Tokens require all four identity bindings (user + project + workspace + sandbox)
- Token verification checks audience, expiration, and optional constraints
- Platform secrets are explicitly forbidden in sandbox environments

## Database changes

None in PR 1. PR 3 will add the `terminal_workspaces` table.

## Environment variables

New:
- `NEXT_PUBLIC_TERMINAL_ENABLED` (default: `false`)
- `TERMINAL_ENABLED` (default: `false`)
- `TERMINAL_PROVIDER` (default: `disabled`)

Existing (unchanged):
- `TERMINAL_AUTH_SECRET` (now used by both old and new token systems)

## Rollback instructions

1. Set `TERMINAL_ENABLED=false` and `TERMINAL_PROVIDER=disabled`
2. The Coming Soon UI remains active
3. No database changes to revert
4. Remove `src/lib/terminal-v1/` directory if needed

## Remaining risks

- The old `terminal-server/` code still exists and has unsafe paths. It is
  unreachable while the Coming Soon patch is active, but should be refactored
  in PR 4.
- The `managed-sandbox` provider is not yet implemented. PR 2 will address this.
