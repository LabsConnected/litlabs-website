# LiTT vNext — Current Security Architecture Audit

**Audit date:** 2026-08-13
**Base branch:** `feat/litt-os-kernel-phase1`
**Base SHA:** `799a4126e62147226afc281de681909ddc64709f`
**Auditor:** Devin (read-only audit, no code changes)

---

## Repository Truth

```
Branch:     feat/litt-os-kernel-phase1
HEAD:       799a4126
Worktrees:  5 (main + connectors + security + studio + terminal)
Stashes:    31
Dirty:      0 modified, 3 untracked (docs + memory — pre-existing, not part of audit)
```

Untracked files (preserved, not part of this audit):
- `docs/antigravity-e2e-verification.md`
- `docs/architecture/ULTRA-VISION-AUDIT-2026-08-12.md`
- `memory/`

---

## Classification Legend

| Label | Meaning |
|-------|---------|
| EXISTS | Implemented, working, and active |
| PARTIAL | Types/contracts defined but implementation incomplete or scattered |
| MISSING | Not present in the codebase |
| DUPLICATE | Multiple implementations of the same concept |
| UNSAFE | Security risk that must be addressed |
| DO NOT REWRITE | Working code that must be preserved and extended, not replaced |

---

## 1. Kernel / Agent Core

### 1.1 `packages/litt-agent-core/` — Canonical Node/TS Core

**Status: EXISTS — DO NOT REWRITE**

| Component | File | Status |
|-----------|------|--------|
| ShellExecutor | `src/shell.ts` | EXISTS — `NodeShellExecutor`, execFile, Windows .CMD resolution, timeout/output limits |
| ToolRegistry | `src/tools.ts` | EXISTS — 12 tools (status, diff, log, branch, list_files, read_file, search, inspect_package, check, test, build, run) |
| CommandRouter | `src/router.ts` | EXISTS — deterministic routing, RuntimeStore integration for command tracking |
| ProjectTools | `src/project.ts` | EXISTS — git ops, file ops, runCommand/runScript/runTypecheck/runTest/runBuild, isSafePath |
| RuntimeStore | `src/state.ts` | EXISTS — heartbeat lifecycle, active command, last result, toJSON, setState, setEmitter |
| Types | `src/types.ts` | EXISTS — ShellResult, ToolResult, ToolDefinition, ModelProvider, ApprovalProvider, AuthProvider, MemoryAdapter, HeartbeatStatus, ActiveCommand, LastResult |
| Compat | `src/compat.ts` | PARTIAL — askLiTTCode/handleLiTTCodeCommand preserved for cli/ callers |

**Security interfaces defined but NOT implemented:**
- `AuthProvider` — MISSING implementation
- `ApprovalProvider` — MISSING implementation
- `MemoryAdapter` — MISSING implementation
- `ModelProvider` — MISSING implementation (only deprecated compat.ts uses raw API key)

**UNSAFE:**
- `compat.ts` reads `OPENROUTER_API_KEY` directly from env and passes to Authorization header without validation, rotation, or broker intermediation

**Path safety:**
- `isSafePath()` blocks .env, node_modules, .git, .ssh, .aws, credentials, secrets (11 regex patterns)
- PARTIAL: No Unicode normalization, no Windows drive letter validation, no symlink chain check beyond realpath

---

### 1.2 `src/lib/litt-kernel/` — Intent Router / Control Decision

**Status: EXISTS — DO NOT REWRITE**

| Component | File | Status |
|-----------|------|--------|
| Kernel | `kernel.ts` | EXISTS — `routeKernel()` classifies intent, resolves context, checks capabilities, classifies risk |
| Types | `types.ts` | EXISTS — LiTTControlDecision, LiTTMode (8 modes), CapabilityState, CapabilityRecord, ActionRisk, ExecutionBudget, KernelContext, KernelEvent |
| IntentRouter | `intent-router.ts` | EXISTS — classifies message into mode/domains/requirements |
| ModeRouter | `mode-router.ts` | EXISTS — maps modes to default skills/tools/budgets/specialists |
| ContextResolver | `context-resolver.ts` | EXISTS — resolves context sources |
| Principles | `principles.ts` | EXISTS — risk classification, approval logic, capability verification |
| EventBus | `event-bus.ts` | EXISTS — decision.created, approval.required, action.blocked, capability.changed |
| PromptComposer | `prompt-composer.ts` | EXISTS — builds system prompt from decision |
| CapabilityRegistry | `capability-registry.ts` | EXISTS — 20 default capabilities, in-memory |
| Schemas | `schemas.ts` | EXISTS — validation schemas |
| Tests | `kernel.test.ts` | EXISTS |

**DUPLICATE:**
- `litt-kernel` is separate from `packages/litt-agent-core` — two "kernel" concepts exist
- `litt-kernel/CapabilityState` vs `agent-core` has no capability concept
- `litt-kernel/ActionRisk` vs `litt-intelligence/ToolRisk` — overlapping risk types

**MISSING:**
- No integration between `litt-kernel` and `agent-core` — they are separate systems
- Kernel does not call agent-core's CommandRouter or ToolRegistry

---

### 1.3 `src/lib/litt-runtime/` — Runtime Execution Layer

**Status: EXISTS — DO NOT REWRITE**

| Component | File | Status |
|-----------|------|--------|
| Runtime | `runtime.ts` | EXISTS — runLiTT(), runLiTTForVoice() |
| ProviderRouter | `provider-router.ts` | EXISTS — model/provider selection |
| PromptBuilder | `prompt-builder.ts` | EXISTS — builds prompts |
| RequestContext | `request-context.ts` | EXISTS — canonical runtime context |
| ExecutionEngine | `execution-engine.ts` | EXISTS — execution orchestration |
| ToolPlanner | `tool-planner.ts` | EXISTS — tool planning |
| ResponseStream | `response-stream.ts` | EXISTS — streaming responses |
| ResultVerifier | `result-verifier.ts` | EXISTS — result verification |
| AuditService | `audit-service.ts` | EXISTS — audit logging |
| Tests | `litt-runtime.test.ts`, `litt-routing.test.ts` | EXISTS |

---

## 2. CLI

### 2.1 `packages/litt-cli/` — Node CLI

**Status: EXISTS — DO NOT REWRITE**

| Command | Uses agent-core | Status |
|---------|-----------------|--------|
| `status` | YES — CommandRouter.status() | EXISTS |
| `diff` | YES — CommandRouter.diff() | EXISTS |
| `check` | YES — CommandRouter.check() | EXISTS |
| `test` | YES — CommandRouter.test() | EXISTS |
| `build` | YES — CommandRouter.build() | EXISTS |
| `doctor` | NO — local health check | EXISTS |
| `inspect` | NO — local repo inspection | EXISTS |
| `ask` | NO — local heuristic only | PARTIAL — should use ModelProvider |
| `explain` | NO — pipe analysis | EXISTS |
| `version` | NO | EXISTS |

**MISSING:**
- No permission mode enforcement (PLAN/ACT/AUTO)
- No approval workflow
- No audit logging
- No authentication

---

### 2.2 `cli/` — Ink/React CLI

**Status: PARTIAL — uses deprecated compat module**

- Imports `askLiTTCode` from `@litt/agent-core` (compat.ts)
- Does NOT use CommandRouter, ToolRegistry, RuntimeState, or ShellExecutor
- **DO NOT REWRITE** — preserve until migration path is proven

---

## 3. PowerShell Adapter

**Status: EXISTS — DO NOT REWRITE**

**Chain proven:**
```
litt (profile function)
  → $HOME\LiTT\LiTT-Code.ps1 (97-line thin adapter)
    → node packages/litt-cli/dist/index.js
      → @litt/agent-core CommandRouter → ToolRegistry → ShellExecutor
```

**CLI resolution (no hardcoded paths):**
1. `LITT_CLI_PATH` env var
2. `LITT_BRAIN_REPO` + `packages/litt-cli/dist/index.js`
3. `$HOME\LiTT\litt-cli-path.txt` config file
4. Walk up from cwd

**DUPLICATE:**
- `C:\Users\litbi\LiTT\LiTT-Code.ps1` is identical to `packages/litt-cli/scripts/litt-adapter.ps1`
- Installer copies from source — this is intentional, not a bug

**MISSING:**
- No permission mode enforcement
- No approval workflow
- No audit logging

---

## 4. Terminal Server

### 4.1 `terminal-server/server.ts` — Main Server (1220 lines)

**Status: EXISTS — DO NOT REWRITE**

| Component | Status |
|-----------|--------|
| PTY runtime | EXISTS — node-pty, Docker + host modes |
| Workspace execution | EXISTS — `/internal/workspace/prepare`, `/internal/workspace/:id/exec` |
| Workspace ownership | EXISTS — `ws.userId !== userId` checks on all endpoints |
| Token issuance | EXISTS — `requireTerminalAuth` middleware, JWT-like tokens |
| Command execution | EXISTS — execFile with command blocking |
| Command blocking | EXISTS — `isBlockedCommand()` from security.ts |
| Preview management | EXISTS — start/status/stop/restart/logs endpoints |
| Process lifecycle | EXISTS — graceful shutdown, kills PTY sessions |
| Preview proxy | EXISTS — token-protected proxy |
| RuntimeStore integration | EXISTS — `initRuntime(io)`, `/internal/runtime` endpoint |
| Rate limiting | EXISTS — 60 inputs/10s per socket |
| Exec timeout | EXISTS — 120s |
| Max buffer | EXISTS — 2MB |

### 4.2 `terminal-server/runtime.ts` — Canonical RuntimeStore Bridge

**Status: EXISTS — DO NOT REWRITE**

- Singleton `RuntimeStore` from `@litt/agent-core`
- Socket.IO integration: `runtime:snapshot` on connect, `runtime:event` + `runtime:state` on mutation
- Heartbeat probe: pings `/health/live` every 15s, max 3 failures
- Public API: `getRuntimeStore()`, `getRuntimeState()`, `runtimeCommandStart/End()`, `runtimeSetProject/GitChanges/Online/Model/Phase()`

### 4.3 `terminal-server/security.ts` — Security Controls

**Status: PARTIAL**

| Component | Status |
|-----------|--------|
| Command blocking | PARTIAL — 25 regex patterns, blocklist only, no allowlist |
| Audit logging | PARTIAL — in-memory only (10k entries max), lost on restart |
| Secret redaction | PARTIAL — covers sk-*, OPENROUTER, CLERK, AUTH, SUPERMEMORY, DATABASE_URL; MISSING Stripe, R2, LiveKit, Vapi, Cloudflare, n8n keys |
| Environment sanitization | PARTIAL — limited character whitelist |

**UNSAFE:**
- Audit log in-memory only — no persistence, no forensic trail after restart
- Secret redaction incomplete — new provider keys may leak
- Command blocklist bypassable with encoding/aliases

### 4.4 `terminal-server/auth.ts` — Authentication

**Status: EXISTS — DO NOT REWRITE**

- HMAC-SHA256 signing
- Timing-safe comparison
- Token expiration check
- Audience validation
- Issued-at validation
- Minimum secret length check (32 chars)
- PARTIAL: Custom JWT-like format (not standard JWT)

### 4.5 `terminal-server/docker-manager.ts` — Container Management

**Status: EXISTS — DO NOT REWRITE**

- Docker session creation with resource limits (1 CPU, 1GB memory, 100 PIDs)
- Read-only root filesystem
- Network isolation (littree-terminal network)
- Workspace volume mount
- Secret redaction on output
- Cleanup on exit

**MISSING:**
- No seccomp profile
- No user namespace isolation

### 4.6 Other terminal-server files

| File | Status |
|------|--------|
| `litt-code.ts` | EXISTS — legacy brain (Ollama + OpenRouter), DO NOT REWRITE until migration proven |
| `livekit-agent.ts` | EXISTS — voice agent, DO NOT REWRITE |
| `mobile-commands.ts` | EXISTS — 4 mobile commands, safe |
| `jarvis-ai.ts` | EXISTS — legacy shim |

---

## 5. Workspace Security

**Status: EXISTS — robust, DO NOT REWRITE**

| Control | Location | Status |
|---------|----------|--------|
| Workspace ownership | `server.ts` (all endpoints), `WorkspaceManager.ts` | EXISTS — consistent userId checks |
| Path traversal prevention | `WorkspaceSecurity.ts` | EXISTS — normalize, absolute rejection, `..` rejection, relative check, symlink resolution, MAX_PATH_LENGTH |
| Workspace root enforcement | `server.ts`, `WorkspaceManager.ts` | EXISTS — `WORKSPACE_ROOT` env var |
| Command blocking | `security.ts` | PARTIAL — blocklist only |
| Execution limits | `server.ts`, `WorkspaceSecurity.ts` | EXISTS — 2MB read, 1MB write, 120s timeout, rate limiting |
| Terminal authentication | `auth.ts`, `server.ts` | EXISTS — dual-layer (service + user) |

**DUPLICATE:**
- Path safety in `agent-core/project.ts:isSafePath` vs `terminal-server/WorkspaceSecurity.ts:resolveWorkspacePath` — different implementations, different patterns

---

## 6. Permission / Execution Mode System

### 6.1 `src/lib/litt-intelligence/permission-engine.ts`

**Status: EXISTS — DO NOT REWRITE**

- `ExecutionMode` = "plan" | "act" | "auto"
- `PermissionEngine.check()` — evaluates tool against mode
- PLAN: read-only only
- ACT: mutations require approval
- AUTO: auto-approve safe tools, sensitive actions always require approval
- `AUTO_APPROVE_SAFE` set: 15 tools (reads, git status, builds, standard workspace mutations)
- `SENSITIVE_ACTIONS` set: 6 tools (git.push, git.force_push, git.reset_hard, git.rebase, files.delete, deploy.production)

**MISSING:**
- NOT integrated with `agent-core` — exists only in `src/lib/litt-intelligence/`
- NOT enforced in CLI or PowerShell
- No headless policy (ASK → deny when no human present)
- No environment-aware policy (local/dev/preview/production)
- No network policy integration
- No sandbox requirement check
- No credential capability check

### 6.2 `src/lib/litt-intelligence/approval-system.ts`

**Status: EXISTS — DO NOT REWRITE**

- `ApprovalManager` class with in-memory request storage
- `ApprovalRequest` interface (id, planId, userId, projectId, goal, steps, risk, status)
- `NEVER_ALLOWED_ACTIONS` set: 7 actions (terminal.execute, secrets.read, secrets.return, security.disable, cross_user.access, mcp.install_arbitrary, api.unrestricted)
- Approval timeout: 5 minutes
- Lifecycle: pending → approved/denied/expired

**MISSING:**
- NOT integrated with `agent-core`'s `ApprovalProvider` interface
- In-memory only — no persistence
- No scope binding (once/run/session/project)
- No normalized input hash — unrelated "yeah" could be mistaken for approval
- No headless mode

### 6.3 `src/lib/litt-intelligence/types.ts` — ToolPermissionLevel

**Status: EXISTS**

- 7 levels: read, draft, workspace-write, external-write, production, financial, destructive
- `APPROVAL_REQUIRED_LEVELS` set
- `requiresApproval()` function

**DUPLICATE:**
- `litt-intelligence/ToolPermissionLevel` vs `litt-kernel/ActionRisk` vs `agent-core` has no permission level — three different risk/permission taxonomies

### 6.4 `src/lib/litt-intelligence/agent-profiles.ts`

**Status: EXISTS — DO NOT REWRITE**

- 4 profiles: standard, builder, research, spark
- `AgentProfile` with allowedToolLevels, allowedToolIds, blockedToolIds, canRequestApproval, canUseTerminal, canDeploy, canModifyProduction
- `isToolAllowed()` function

---

## 7. Tool Registries

### CRITICAL: 5 separate tool registries exist

| Registry | Location | Tools | Active | Status |
|----------|----------|-------|--------|--------|
| Core (canonical) | `packages/litt-agent-core/src/tools.ts` | 12 | YES (CLI) | EXISTS — new canonical |
| Project Tools | `src/lib/project-tools/registry.ts` | ~30 | YES (Vapi + Voice) | EXISTS — DO NOT REWRITE |
| LITT Intelligence | `src/lib/litt-intelligence/tool-registry.ts` | ~20+ | YES (agent-loop-v2) | EXISTS — DO NOT REWRITE |
| Vapi Definitions | `src/lib/vapi-tool-definitions.ts` | ~20 | YES (schemas only) | EXISTS — DO NOT REWRITE |
| Business Operations | `src/lib/business-operations/tool-registry.ts` | 19 | YES | EXISTS — DO NOT REWRITE |

**DUPLICATE — CRITICAL:**
- File operations: 3 different APIs (agent-core: listFiles/readFile, project-tools: read_file/edit_file, litt-intelligence: files.list/files.read/files.write)
- Git operations: 2 different APIs (agent-core: gitStatus/gitDiff, project-tools: git_status/create_branch/commit_changes)
- Web/search: 2 different APIs (litt-intelligence: web.search, project-tools: web_search)
- Approval policies: 3 different systems (litt-intelligence: approvalPolicy, project-tools: metadata.mutating, agent-core: readOnly flag)
- Permission systems: 3 different systems (litt-intelligence: requiredPermissions, business-ops: requiredPermissions, agent-core: none)
- Risk levels: 3 different systems (litt-intelligence: risk field, business-ops: risk field, agent-core: none)

**DO NOT REWRITE:** All 5 registries are active and serving real users. Consolidation must be gradual:
```
new core contract → adapter → move one caller → verify → move next → deprecate → prove zero → remove
```

---

## 8. Capability System

### 8.1 `src/lib/litt-kernel/types.ts` — Capability Types

**Status: EXISTS**

- `CapabilityState`: 8 states (ready, offline, connecting, limited, requires_approval, degraded, unavailable, unknown)
- `CapabilityRecord`: id, category, state, verifiedAt, expiresAt, permissions, dependencies, costClass, latencyClass

### 8.2 `src/lib/litt/capability/capability-registry.ts`

**Status: EXISTS — DO NOT REWRITE**

- In-memory registry with 20 default capabilities
- `getCapabilityRegistry()` singleton
- Methods: getRecord, getAllRecords, setState, isAvailable, getSystemState

**UNSAFE:**
- In-memory only — lost on restart
- No persistence
- No active health probes
- No expiration handling
- No dependency graph enforcement
- No audit trail for state changes

### 8.3 `src/app/studio/hooks/useConnectionSummary.ts`

**Status: EXISTS — DO NOT REWRITE**

- Aggregates from `/api/capabilities`, `/api/capabilities/project-terminal`, `/api/voice/health`, `/api/llm/health`
- 20+ capability fields

### 8.4 `src/lib/connections/state.ts`

**Status: EXISTS**

- In-memory Map for connection states

**DUPLICATE:**
- Connection state tracked in both `CapabilityRegistry` and `connections/state.ts`

**MISSING for vNext CapabilityHealth:**
- No lifecycle/auth/health/policy/quota decomposition (single mixed enum instead)
- No active probes with TTL
- No circuit breakers
- No stale state handling
- No `capability.health.changed` event

---

## 9. Credential Systems

### 9.1 Credential Inventory

| Credential | Origin | Storage | Long-lived | Enters workspace | Enters model context | Has TTL | Has scope | Revocable |
|------------|--------|---------|------------|------------------|---------------------|---------|-----------|-----------|
| Terminal auth (`TERMINAL_AUTH_SECRET`) | env | env | YES | NO (derived tokens) | NO | YES (5min tokens) | YES (workspace/project) | YES |
| Internal service key | env | env | YES | NO | NO | NO | NO | YES |
| GitHub App (`GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY`) | env | env | YES (key) | NO | NO | YES (installation tokens ~1hr) | YES (installation) | YES |
| Supabase anon key | env | env + browser | YES | NO | NO | NO | YES (RLS) | YES |
| Supabase service role | env | env | YES | NO | NO | NO | NO (bypasses RLS) | YES |
| Stripe (`STRIPE_SECRET_KEY`) | env | env | YES | NO | NO | NO | NO (global) | YES |
| Terminal secrets (user) | user input | encrypted in Supabase | YES | YES (env vars in sandbox) | NO | NO | YES (user/project) | YES |
| Model provider keys (OpenRouter, Gemini, etc.) | env | env | YES | NO | NO | NO | NO (global) | YES |
| LiveKit (`LIVEKIT_API_KEY/SECRET`) | env | env | YES | NO | NO | YES (room tokens) | YES (room) | YES |
| Vapi (`LITTLABS_VAPI_TOOL_TOKEN`) | env | env | YES | NO | NO | NO | YES (owner) | YES |
| n8n (`LITT_N8N_BRIDGE_SECRET`) | env | env | YES | NO | NO | NO (5min replay window) | NO | YES |
| Cloudflare (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_API_TOKEN`) | env | env | YES | NO | NO | NO | NO | YES |
| Vercel (`VERCEL_TOKEN`) | env | env | YES | NO | NO | NO | YES (project) | YES |
| Integration credentials (OAuth) | OAuth flow | encrypted in Supabase | YES | NO | NO | YES (expires_at) | YES (connection) | YES |
| BYOK (`userApiKey`) | user input | **MISSING** | N/A | N/A | N/A | N/A | N/A | N/A |

### 9.2 `src/lib/terminal-v1/secret-broker.ts` — Encrypted Secret Storage

**Status: EXISTS — DO NOT REWRITE**

- AES-256-GCM encryption
- `TERMINAL_SECRET_KEY` (min 32 chars)
- Stored in `terminal_secrets` table in Supabase
- User-scoped and project-scoped
- RLS: users can only access their own secrets
- Types: generic, github_token, aws_key, api_key, database_url

**UNSAFE:**
- Decrypted values injected as environment variables into sandbox — increases attack surface
- No credential rotation automation
- No credential usage audit log

### 9.3 `supabase/migrations/*_integration_platform.sql` — Integration Credentials

**Status: EXISTS**

- `integration_credentials` table — encrypted storage for installation tokens, refresh tokens
- `user_connection_credentials` table — encrypted credentials for OAuth connections
- service_role only access (RLS denies all user access)

### 9.4 BYOK (Bring Your Own Key)

**Status: PARTIAL — UNSAFE**

- `userApiKey` option exists in `src/lib/llm.ts`
- `byokProvider` field for "openai" or "anthropic"
- **MISSING:** No storage mechanism, no UI, no implementation
- **UNSAFE:** Option exists but is never used — creates confusion about whether BYOK is supported

### 9.5 Missing Credential Architecture

**MISSING:**
- No `CredentialBroker` interface or implementation
- No `CredentialLease` concept (short-lived, revocable, scoped)
- No `CapabilityGrant` concept (signed grant binding capabilities to a run)
- No workload identity federation
- No OAuth 2.1 + PKCE flow for user-connected accounts (integration credentials exist but no PKCE)
- No credential masking/proxy substitution
- No centralized secret scanning before persistence
- No credential versioning

---

## 10. Model Provider System

### 10.1 `src/lib/llm.ts` — Unified LLM Client

**Status: EXISTS — DO NOT REWRITE**

- Single unified client for all providers
- Provider chain with failover: Gemini → Groq → OpenRouter
- Circuit breaker with 15-minute cooldown on failed models
- Categories: auto, free, fast, code, creative, vision, byok
- Cost tracking via `logLLMCall()` and `recordLLMCall()`

### 10.2 `src/lib/litt-runtime/provider-router.ts`

**Status: EXISTS — DO NOT REWRITE**

- Centralizes model/provider selection
- Maps user requests to LLMOptions
- Validates model categories

### 10.3 `src/lib/litt-intelligence/llm-tool-calling.ts`

**Status: EXISTS — DO NOT REWRITE**

- Native function calling with tool schemas
- Failover chain for tool-calling models
- Logs failed attempts with Braintrust

### 10.4 `src/lib/connectors/provider-registry.ts`

**Status: EXISTS — DO NOT REWRITE**

- Registry of integration providers
- Env var definitions per provider

**DUPLICATE:**
- Model selection logic scattered across `llm.ts`, `provider-router.ts`, and `studio-models.ts`

**MISSING:**
- No `ModelProvider` implementation in `agent-core` (interface only)
- No cost pre-authorization (users could exceed budget mid-call)
- No provider quota management
- No model capability detection

---

## 11. Memory / Conversation / Mission Systems

### 11.1 Mission System

**Status: EXISTS — DO NOT REWRITE**

- `src/lib/missions/mission-repository.ts` — Mission, MissionRun, MissionStep, MissionApproval, ValidationResult, Checkpoint
- Supabase-backed persistence
- Status: draft, ready, running, paused, completed, failed, cancelled
- `src/lib/missions/workspace-checkpoint.ts` — git checkpoints in workspace

### 11.2 Artifacts

**Status: EXISTS**

- `src/app/api/litt/artifacts/route.ts` — retrieval from `mission_artifacts` table
- Types: file, image, video, audio, music

### 11.3 Canvas System

**Status: EXISTS — DO NOT REWRITE**

- `supabase/migrations/*_canvas_system.sql` — canvases, canvas_blocks, canvas_revisions
- Versioned mutation log for undo/redo
- RLS: service role only

### 11.4 User Facts (Memory)

**Status: EXISTS**

- `supabase/migrations/*_user_facts_provenance.sql` — user_facts table
- Provenance tracking: user_explicit, profile, device, connector, conversation
- Confidence scores (0.0-1.0)
- Confirmed flag

**UNSAFE:**
- No memory encryption — user_facts stored in plain text
- No memory retention policy
- No memory export

### 11.5 Agent Memory

**Status: EXISTS**

- `memory_namespace` column on `user_agents` table
- Isolated memory per agent instance

### 11.6 Conversation Tracking

**Status: PARTIAL — DUPLICATE**

- Conversation IDs tracked in multiple tables: voice_sessions, browser_sessions, agent_runs
- **MISSING:** No unified conversation table

---

## 12. Audit / Observability

### 12.1 LLM Logging

**Status: EXISTS — DO NOT REWRITE**

- `src/lib/evals/braintrust.ts` — logs to Braintrust (prompt, output, provider, model, latency)
- `src/lib/metrics.ts` — Prometheus metrics (LLM calls, latency, tokens, failover)
- **SAFE:** No secrets logged, fails silently if not configured

### 12.2 Terminal Audit

**Status: PARTIAL — UNSAFE**

- `terminal-server/security.ts` — in-memory audit log (10k entries max)
- **UNSAFE:** Lost on restart, no persistence, no forensic trail

### 12.3 File Audit

**Status: EXISTS**

- `src/lib/file-audit.ts` — logs file operations

### 12.4 Connection Audit

**Status: EXISTS**

- `src/lib/connections/audit.ts` — logs connection events

**MISSING:**
- No unified audit log — scattered across in-memory, Supabase, and external services
- No audit log immutability (WORM storage)
- No real-time audit alerts
- No correlation IDs across systems

---

## 13. Sensory / Realtime Fabric

**Status: MISSING**

- No `SensoryEvent` type or normalization
- No trust classification (system/verified_provider/user/external_untrusted)
- No sensitivity classification (public/internal/private/secret)
- No attention router (event → schema → trust → sensitivity → secret filter → dedup → relevance → context budget → Kernel)
- No backpressure for high-volume streams
- Browser/MCP/tool content is not classified as untrusted data

**PARTIAL:**
- Terminal output streams via Socket.IO
- Browser console/network via browser-tool-handlers
- Voice transcript via livekit-agent
- But none are normalized or trust-classified

---

## 14. Execution Capsule

**Status: MISSING**

- No `ExecutionCapsule` type
- No `EnvironmentBlueprint` concept
- No `ResourceBudget` enforcement (Docker has limits but not as a typed contract)
- No `NetworkPolicy` (Docker has network isolation but no egress controls)
- No capsule lifecycle (provisioning → ready → running → destroyed)
- No automatic teardown

**PARTIAL:**
- Docker manager provides isolation but is not typed as a capsule
- Terminal exec has timeout and buffer limits but not as a resource budget
- Workspace has path safety but not as a filesystem scope contract

---

## 15. MCP Security

**Status: PARTIAL**

- `src/lib/litt-intelligence/mcp-adapter.ts` — EXISTS, MCP adapter
- `src/lib/litt-intelligence/openapi-adapter.ts` — EXISTS, OpenAPI adapter

**MISSING:**
- No OAuth 2.1 + PKCE for remote MCP
- No Protected Resource Metadata discovery
- No audience validation
- No local STDIO containment (MCP servers run in privileged process)
- No MCP tool permission enforcement through permission engine
- No MCP health checks
- No MCP tool inventory declaration

---

## 16. Plugin / Skill / Agent Ecosystem

**Status: MISSING**

- No `LiTTPluginManifest` type
- No plugin integrity verification
- No plugin publisher identity
- No plugin permission declaration
- No plugin sandbox enforcement
- No plugin revocation

**PARTIAL:**
- Skills exist in `litt-kernel/types.ts` (SkillDefinition)
- Agent profiles exist in `litt-intelligence/agent-profiles.ts`
- But no plugin packaging, signing, or marketplace

---

## 17. Multi-Agent / Automation

**Status: MISSING**

- No `ActorIdentity` per subagent
- No `CapabilityGrant` per subagent
- No worktree-based write isolation
- No file lease / stale-write check
- No fresh capsule per automation run

**PARTIAL:**
- Mission system has MissionRun with steps
- But no isolation between concurrent runs

---

## 18. Emergency Control Plane

**Status: PARTIAL**

- Terminal server can kill PTY sessions
- Docker manager can remove containers
- **MISSING:** No unified emergency controls (cancel run, revoke lease, disable tool, disable plugin, block actor)

---

## Summary Matrix

| Component | EXISTS | PARTIAL | MISSING | DUPLICATE | UNSAFE | DO NOT REWRITE |
|-----------|--------|---------|---------|-----------|--------|----------------|
| agent-core (shell/tools/router/state) | ✓ | | | | compat.ts API key | ✓ |
| litt-kernel (intent/control) | ✓ | | | 2 kernel concepts | | ✓ |
| litt-runtime (execution) | ✓ | | | | | ✓ |
| litt-cli (commands) | ✓ | ask command | | | | ✓ |
| cli/ (Ink) | | ✓ | | | | ✓ |
| PowerShell adapter | ✓ | | | | | ✓ |
| terminal-server | ✓ | | | | | ✓ |
| Workspace security | ✓ | | | path safety ×2 | | ✓ |
| Permission engine | ✓ | | | 3 risk taxonomies | | ✓ |
| Approval system | ✓ | | | 2 approval interfaces | in-memory | ✓ |
| Tool registries | ✓ | | | 5 registries | | ✓ |
| Capability system | ✓ | | | 2 state stores | in-memory | ✓ |
| Credential broker | | | ✓ | | | |
| Credential lease | | | ✓ | | | |
| Capability grant | | | ✓ | | | |
| Model provider (agent-core) | | | ✓ | | | |
| Model provider (web) | ✓ | | | 3 selection logic | | ✓ |
| Memory/conversation | ✓ | | | conversation IDs ×3 | no encryption | ✓ |
| Mission system | ✓ | | | | | ✓ |
| Canvas system | ✓ | | | | | ✓ |
| Audit logging | ✓ | | | scattered | in-memory terminal | ✓ |
| Sensory fabric | | | ✓ | | | |
| Execution capsule | | | ✓ | | | |
| Network policy | | | ✓ | | | |
| Resource budget | | | ✓ | | | |
| MCP security | | ✓ | | | | |
| Plugin ecosystem | | | ✓ | | | |
| Multi-agent isolation | | | ✓ | | | |
| Emergency control plane | | ✓ | | | | |
| Secret scanning | | | ✓ | | | |
| BYOK | | ✓ | | | unused option | |

---

## Critical Findings

### 1. Tool registry fragmentation (CRITICAL)
5 separate tool registries with overlapping functionality and inconsistent security controls. Consolidation must be gradual — all are active.

### 2. Permission engine not integrated (HIGH)
PLAN/ACT/AUTO exists in `litt-intelligence` but is NOT enforced in `agent-core`, CLI, or PowerShell.

### 3. No credential broker (HIGH)
No `CredentialLease`, no `CapabilityGrant`, no short-lived credential architecture. All credentials are long-lived env vars or encrypted-at-rest but without lease lifecycle.

### 4. No execution capsule (HIGH)
No typed isolation contract. Docker manager provides isolation but is not typed as a capsule with lifecycle, resource budget, or network policy.

### 5. No sensory fabric (MEDIUM)
No event normalization, trust classification, or attention router. Browser/MCP content is not classified as untrusted.

### 6. In-memory audit log (MEDIUM)
Terminal audit lost on restart. No persistent forensic trail.

### 7. In-memory capability state (MEDIUM)
All capability state lost on restart. No active probes, no TTL, no dependency graph.

### 8. Incomplete secret redaction (MEDIUM)
Missing patterns for Stripe, R2, LiveKit, Vapi, Cloudflare, n8n keys.

### 9. Two kernel concepts (LOW)
`litt-kernel` (intent router) and `agent-core` (execution) are separate. They should eventually converge but both are DO NOT REWRITE.

### 10. No headless policy (LOW)
Permission engine has no `interaction: "interactive" | "headless"` concept. ASK in headless mode should become DENY.

---

## Migration Principles

1. **DO NOT REWRITE** any system marked EXISTS — extend and adapt
2. Consolidation order: `new core contract → adapter → move one caller → verify → move next → deprecate → prove zero → remove`
3. Never mass-delete "legacy" paths before proving caller count is zero
4. Preserve compatibility adapters where necessary
5. All 5 tool registries are active — do not break any
6. Both kernel concepts are active — do not break either
7. Terminal server is production — do not break workspace security
8. All credential systems are active — do not break any auth flow

---

## Next Steps

Phase 0 audit is complete. No code changes were made.

**Phase 1** should start with canonical security types (ActorIdentity, ExecutionMode, ActionRisk, PolicyDecision, CapabilityGrant, CredentialLease, ExecutionCapsule, EnvironmentBlueprint, NetworkPolicy, ResourceBudget, SensoryEvent, CapabilityHealth, ApprovalRecord, RunIdentity, ToolExecution) — extending existing types where possible, not duplicating them.

**STOP. Awaiting review before Phase 1.**
