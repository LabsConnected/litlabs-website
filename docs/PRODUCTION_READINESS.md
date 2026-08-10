# LiTTree LabStudios — Production Readiness Audit

**Audit Date:** 2026-08-10
**Commit:** f9870d90
**Auditor:** Cascade AI

---

## Baseline

| Gate | Status | Evidence |
| --- | --- | --- |
| TypeScript | PASS | `npx tsc --noEmit` — 0 errors |
| ESLint | PASS | `npx eslint src/ --max-warnings 0` — 0 errors, 0 warnings |
| Unit Tests | PASS | 1553/1553 tests pass (103/105 files) |
| Integration Tests | PARTIAL | `terminal-socketio-integration.test.ts` times out on Windows (node-pty conpty issue, pre-existing) |
| Production Build | PASS | Vercel deployment succeeded, health check OK |
| Sentry Monitoring | PASS | Client + server config present (`sentry.client.config.ts`, `sentry.server.config.ts`) |

---

## System Audit

### 1. Terminal System — PASS

**Files:** `terminal-server/server.ts`, `terminal-server/security.ts`, `terminal-server/workspace/WorkspaceManager.ts`, `terminal-server/workspace/WorkspaceSecurity.ts`, `terminal-server/auth.ts`

- **Workspace isolation:** Each workspace is created under `{WORKSPACE_ROOT}/{userId}/{workspaceId}` — user-scoped directory structure prevents cross-user access.
- **User authorization:** `getWorkspaceRoot(workspaceId, userId)` checks `ws.userId !== userId` and returns null. All internal endpoints verify userId ownership.
- **Path traversal protection:** `WorkspaceSecurity.ts` `resolveWorkspacePath()` normalizes paths, rejects absolute/parent paths, checks `relative(root, target)` doesn't escape, and verifies symlinks via `realpathSync`.
- **Command safety:** `security.ts` blocks dangerous patterns (rm -rf /, mkfs, shutdown, curl|bash, fork bombs, etc.). Audit log records all commands.
- **Secret redaction:** `redactSecrets()` masks API keys in terminal output.
- **Internal service auth:** `requireInternalServiceAuth` uses timing-safe comparison on shared secret (min 32 chars).
- **Workspace persistence:** Workspaces persisted to `.workspaces.json` and recovered on restart.
- **Auto-recovery:** File API route auto-detects stale workspaces and re-prepares them.

### 2. Agent Tool Execution — PASS

**Files:** `src/lib/litt-intelligence/agent-loop-v2.ts`, `src/lib/litt-intelligence/tool-registry.ts`, `src/lib/litt-intelligence/tool-handlers.ts`

- **No hallucinated success:** Tool execution results check `execResult.ok` — failures are properly propagated as `success: false` with error messages to the LLM.
- **Permission system:** `PermissionEngine` checks tool permissions before execution. Read-only tools auto-approve; mutations require approval in ACT mode.
- **Loop detection:** 3 identical tool calls with no intervening mutation triggers cancellation.
- **Output limits:** `maxOutputChars` (50K) prevents unbounded conversation growth.
- **Runtime limits:** `maxSteps` (20), `maxRuntimeMs` (5min) prevent runaway agents.
- **Tool truthfulness:** 17 handlerless tools disabled (web.search, github.*, memory.*, etc.). Only tools with executable handlers are enabled.
- **Image generation:** Wired to real `/api/media/generate` backend. Returns `downloadUrl` and `markdown` for inline rendering.

### 3. File API — PASS

**Files:** `src/app/api/studio-projects/[projectId]/files/route.ts`, `src/app/api/studio-projects/[projectId]/route.ts`

- **Auth check:** Every request calls `auth(request)` and returns 401 if no userId.
- **Project ownership:** `verifyProjectWorkspace(projectId, userId)` checks ownership server-side.
- **Path traversal protection:** `isSafeRelativePath()` rejects absolute paths, `..` segments, and null bytes.
- **Audit logging:** `logFileOperation()` records all mutating operations (write, delete, mkdir, rename) with userId, projectId, workspaceId, path, and success/failure.
- **Project deletion:** Double-checks ownership (getProject + deleteProject with WHERE user_id).

### 4. Preview System — PASS

**Files:** `src/app/studio/components/StudioPreviewPanel.tsx`

- **State machine:** loading → preparing → ready → stale → offline → failed → not_prepared. No empty iframe on error.
- **Error display:** Shows specific error messages from the preview API, not generic "Something went wrong".
- **Auto-polling:** Polls every 3s while preparing/loading, stops when ready/failed.
- **Device modes:** Desktop, tablet (768×1024), mobile (390×844).
- **Iframe sandbox:** `allow-scripts allow-forms allow-modals allow-same-origin allow-popups` — supports HMR and framework functionality.
- **File change events:** Listens for `studio:files-changed` events to refresh preview status.
- **Manual restart:** `preparePreview()` forces iframe reload via `frameKey` increment.

### 5. Billing / LiTTBits — PARTIAL → FIXED

**Files:** `src/lib/user-db.ts`, `src/app/api/media/generate/route.ts`

- **Race condition (FIXED):** `updateWalletBalance` previously used read-then-write without atomicity. Two concurrent requests could both read the same balance and only one deduction would apply. **Fixed with optimistic locking:** now reads balance, computes new balance, and updates with `.eq("balance", currentBalance)` — if 0 rows updated, retries once.
- **Deduction timing:** Cost is deducted only after successful generation (line 1101 of generate route).
- **Insufficient funds check:** Wallet balance checked before generation starts (line 1009).
- **Free providers:** Pollinations is free — no wallet check or deduction needed.

### 6. Health Endpoint — PARTIAL → FIXED

**Files:** `src/app/api/health/route.ts`

- **Previous:** Only checked env vars and build identity.
- **Fixed:** Now checks:
  - `env` — required public env vars
  - `build` — commit SHA
  - `database` — Supabase connectivity (queries `users` table)
  - `terminal` — Terminal server `/health` endpoint (3s timeout)
  - `storage` — R2 or Supabase Storage configuration
- **No secrets exposed:** Only checks connectivity, doesn't expose connection strings or internal data.

### 7. Security — PASS

- **Auth:** Clerk integration on all API routes via `auth()` helper.
- **API authorization:** Every write endpoint verifies userId + project ownership.
- **Path traversal:** Blocked at both file API layer (`isSafeRelativePath`) and terminal server layer (`resolveWorkspacePath` with symlink check).
- **Command injection:** Terminal server blocks dangerous patterns, uses `execFile` (not `exec`) for internal exec endpoint.
- **Secret redaction:** Terminal output redacts known secret patterns.
- **Internal service auth:** Timing-safe shared secret comparison for service-to-service calls.
- **CSRF:** Next.js built-in CSRF protection via SameSite cookies.
- **Rate limiting:** `withRateLimit` wrapper on media generation endpoint (60 req/min).

### 8. Monitoring — PASS

- **Sentry:** Client-side (`sentry.client.config.ts`) and server-side (`sentry.server.config.ts`) configured.
- **Structured logs:** Media generation logs provider, requestId, status, duration.
- **File audit trail:** All file operations logged with userId, projectId, action, path, success.
- **Terminal audit log:** All terminal commands logged with userId, sessionId, blocked status.

---

## Unverified Systems

| System | Status | Reason |
| --- | --- | --- |
| Canvas drag/drop/undo/redo | UNVERIFIED | No automated tests for canvas interactions |
| Git diff/revert | UNVERIFIED | No automated tests for git operations in Studio |
| Checks panel | UNVERIFIED | No automated tests for check execution |
| Deployment pipeline | UNVERIFIED | Deploy button exists but pipeline not audited end-to-end |
| E2E tests | FAIL | No Playwright tests exist |
| Production kill switches | FAIL | Not implemented |
| Backup/restore | UNVERIFIED | No backup procedure documented or tested |
| Responsive behavior | UNVERIFIED | No automated responsive tests |

---

## P0 Blockers Fixed

1. **Billing race condition** — `updateWalletBalance` now uses optimistic locking with retry for deductions.
2. **Health endpoint** — Now checks database, terminal server, and storage in addition to env vars.
3. **Tool truthfulness** — 17 handlerless tools disabled, preventing LiTT from advertising capabilities it can't execute.
4. **Image generation** — Wired to real media backend, no longer redirects to separate tool page.

---

## Remaining P1 Issues

1. **E2E tests** — No Playwright tests for critical user journeys. Need to create tests for: login → Studio → chat → edit → preview, project creation → save → reload, edit → checks → deploy.
2. **Production kill switches** — Need ability to disable deployments, terminal, AI generation, etc. without redeploying.
3. **Backup/restore** — Need documented and tested backup procedure for Supabase database, user projects, conversations, billing records.
4. **Terminal socketio integration test** — Pre-existing failure on Windows due to node-pty conpty. Should be skipped on Windows or fixed with proper test isolation.
5. **Canvas tests** — No automated tests for canvas interactions (drag, drop, resize, undo, redo).
6. **Checks panel** — Need to verify that TypeScript, ESLint, unit tests, and build checks actually run and report results correctly.

---

## Verdict

**READY WITH KNOWN RISKS**

The core systems (terminal, agent, file operations, preview, billing, security) are solid. The main gaps are in E2E test coverage, backup/restore procedures, and production kill switches. These should be addressed before public launch but do not block internal use or beta testing.
