# LiTT Capability Map — Registry Consolidation & Platform Health

**Version:** 1.0.0  
**Date:** 2026-08-13  
**Status:** DIAGNOSTIC — this is the map of what exists, what's dead, and what becomes authoritative.

---

## 1. The Problem: Why LiTLabs Has Multiple Registries

### The Answer

LiTLabs has **13 registry-like systems** because the codebase grew organically across at least 4 major development phases, each of which created its own tool/capability abstraction without consolidating the previous one:

| Phase | What was built | Registry created | Still used? |
|-------|---------------|-----------------|-------------|
| Phase 1: Studio MVP | Dashboard widgets, agent personas | `dashboard/widget-registry.ts`, `agent-registry.ts`, `studio/agent-registry.ts` | widget: DEAD, agent: ACTIVE |
| Phase 2: Vapi voice tools | Project tools for voice | `project-tools/registry.ts` | ACTIVE (voice + API) |
| Phase 3: LiTT Intelligence | Agent loop with tool calling | `litt-intelligence/tool-registry.ts` | ACTIVE (browser/agent loop) |
| Phase 4: Connectors & MCP | External integrations, MCP | `connectors/provider-registry.ts`, `litt-intelligence/mcp-adapter.ts`, `litt-kernel/capability-registry.ts`, `litt/capability/capability-registry.ts`, `capability-registry.ts` | MIXED (some active, some dead) |

**No single registry knows about all the others.** That's why LiTT can't answer "what can I do?" — it doesn't have a complete self-model.

---

## 2. Complete Registry Inventory

### ACTIVE Registries (wired into runtime, have importers)

| # | File | Lines | Importers | Purpose | Status |
|---|------|-------|-----------|---------|--------|
| 1 | `src/lib/project-tools/registry.ts` | 1194 | 5 | Vapi/voice project tools (23 handlers: files, git, checks, browser, deploy) | **ACTIVE** — voice + API dispatch |
| 2 | `src/lib/litt-intelligence/tool-registry.ts` | 1625 | 2 | Agent loop v2 tool registry (intelligence tools: research, browser, weather) | **ACTIVE** — agent loop dispatch |
| 3 | `src/lib/agent-registry.ts` | 693 | 11 | Agent personas/marketplace (LiTT, Spark, Nova, Forge, Echo) | **ACTIVE** — agent resolution |
| 4 | `src/lib/studio/agent-registry.ts` | 116 | 5 | Studio agent resolution (builtin agents) | **ACTIVE** — prompt builder |
| 5 | `src/lib/connectors/provider-registry.ts` | 668 | 4 | External connector providers (permissions, context engine) | **ACTIVE** — permission gate |
| 6 | `src/lib/capability-registry.ts` | 95 | 3 | Marketplace capability metadata | **ACTIVE** — marketplace/mission forge |
| 7 | `src/lib/litt-intelligence/source-registry.ts` | 282 | 1 | Web intelligence source registry | **ACTIVE** — web intelligence API |
| 8 | `src/lib/litt/capability/capability-registry.ts` | 99 | 1 | LiTT live capability registry | **ACTIVE** — conversation context |

### DEAD/STUB Registries (zero or near-zero importers)

| # | File | Lines | Importers | Purpose | Status |
|---|------|-------|-----------|---------|--------|
| 9 | `src/lib/litt-intelligence/mcp-adapter.ts` | 221 | 0 | MCP protocol adapter | **DEAD** — never wired |
| 10 | `src/lib/litt-kernel/capability-registry.ts` | 190 | 0 | Kernel capability registry | **DEAD** — never wired |
| 11 | `src/lib/business-operations/tool-registry.ts` | 602 | 0 | Business operations tools | **DEAD** — never wired |
| 12 | `src/lib/plugin-registry.ts` | 90 | 0 | Plugin registry | **DEAD** — never wired |
| 13 | `src/lib/dashboard/widget-registry.ts` | 382 | 0 | Dashboard widgets | **DEAD** — never wired |

### Provider/Adapter Files (not registries, but related)

| File | Lines | Purpose | Status |
|------|-------|---------|--------|
| `src/lib/ai/providers.ts` | 62 | LLM provider config | ACTIVE |
| `src/lib/litt-runtime/provider-router.ts` | 55 | LLM model routing | ACTIVE |
| `src/lib/visual-builds/providers.ts` | 303 | Visual build providers | ACTIVE |
| `src/lib/growth/provider-registry.ts` | 47 | Growth tracking providers | ACTIVE |
| `src/lib/terminal-v1/sandbox-provider.ts` | 48 | Terminal sandbox abstraction | ACTIVE |
| `src/lib/terminal-v1/providers/docker-provider.ts` | 396 | Docker sandbox provider | ACTIVE |
| `src/lib/terminal-v1/providers/disabled-provider.ts` | 74 | Disabled sandbox fallback | ACTIVE |
| `src/lib/litt-intelligence/browserbase-provider.ts` | 200 | Browserbase web automation | ACTIVE |
| `src/lib/litt-intelligence/research-providers.ts` | 434 | Research source providers | ACTIVE |
| `src/lib/litt-intelligence/web-search-provider.ts` | 95 | Web search provider | ACTIVE |
| `src/lib/litt-intelligence/weather-provider.ts` | 333 | Weather provider | ACTIVE |
| `src/lib/litt-intelligence/openapi-adapter.ts` | 194 | OpenAPI spec adapter | ACTIVE |

---

## 3. Which Registry Becomes Authoritative?

### The Answer

**None of the existing registries.** They all have different interfaces, different purposes, and different dispatch patterns. The answer is to build **one unified Capability Registry** that absorbs the active ones and deletes the dead ones.

### Target Architecture

```
                 LiTT KERNEL
                      │
           Unified Capability Registry
                      │
       ┌──────────────┼──────────────┐
       │              │              │
    Native         Connectors       MCP
     Tools            APIs         Servers
       │              │              │
 Terminal          GitHub          Anything
 Files             Stripe          compatible
 Canvas            Slack
 Browser
```

### What Gets Consolidated

| Current Registry | Action | Merged Into |
|-----------------|--------|-------------|
| `project-tools/registry.ts` | **MIGRATE** — 23 tool handlers become native capability actions | Unified Capability Registry |
| `litt-intelligence/tool-registry.ts` | **MIGRATE** — intelligence tools become capability actions | Unified Capability Registry |
| `agent-registry.ts` | **KEEP** — agent personas are not capabilities, they're identity | Stays separate (identity layer) |
| `studio/agent-registry.ts` | **MERGE into agent-registry.ts** — duplicate of agent personas | agent-registry.ts |
| `connectors/provider-registry.ts` | **MIGRATE** — connectors become capability providers | Unified Capability Registry |
| `capability-registry.ts` | **MIGRATE** — marketplace capabilities become capability metadata | Unified Capability Registry |
| `litt/capability/capability-registry.ts` | **MIGRATE** — live capabilities become capability state | Unified Capability Registry |
| `litt-intelligence/source-registry.ts` | **MIGRATE** — research sources become capability providers | Unified Capability Registry |
| `litt-intelligence/mcp-adapter.ts` | **REVIVE** — wire as MCP adapter into Unified Capability Registry | Unified Capability Registry (MCP adapter) |
| `litt-kernel/capability-registry.ts` | **DELETE** — dead, never wired | — |
| `business-operations/tool-registry.ts` | **DELETE** — dead, never wired | — |
| `plugin-registry.ts` | **DELETE** — dead, never wired | — |
| `dashboard/widget-registry.ts` | **DELETE** — dead, never wired | — |

---

## 4. Unified Capability Registry — Type Contract

```typescript
// src/lib/capabilities/types.ts

export type CapabilityState =
  | "discovered"
  | "installed"
  | "configured"
  | "authenticated"
  | "healthy"
  | "callable_by_litt"
  | "tested"
  | "production_verified";

export type CapabilityCategory =
  | "code"          // files, search, edit, diff, patch
  | "git"           // branch, status, commit, push, PR, review
  | "terminal"      // commands, processes, shell, logs
  | "testing"       // unit, integration, E2E, visual
  | "browser"       // navigate, inspect, click, type, screenshot
  | "packages"      // pnpm/npm inspection, install
  | "database"      // SQL, migrations, schema
  | "storage"       // upload, download, assets
  | "auth"          // users, sessions, roles
  | "payments"      // products, prices, subscriptions
  | "deploy"        // previews, production, rollback
  | "infrastructure"// services, health, environment
  | "observability" // logs, traces, metrics
  | "automation"    // webhooks, workflows, jobs
  | "apis"          // HTTP/REST/GraphQL
  | "ai"            // LLMs, embeddings, vision
  | "creation"      // image, video, music, audio, design
  | "research"      // web, browser, search
  | "memory"        // project, context, user knowledge
  | "communication" // email, chat, calendar
  | "plugins"       // native connector + MCP
  | "secrets"       // scoped credential references
  | "approvals";    // allow/ask/deny

export type ApprovalLevel = "allow" | "ask" | "deny";

export interface Capability {
  /** Unique id, e.g. "github.prs" */
  id: string;
  /** Human-readable name */
  name: string;
  /** Category */
  category: CapabilityCategory;
  /** Provider implementation */
  provider: string;
  /** Provider version */
  version: string;
  /** Operations this capability supports */
  operations: string[];
  /** Required scopes/permissions */
  requiredScopes: string[];
  /** Credential reference (env var name, never the value) */
  credentialRef: string | null;
  /** Health check function */
  healthCheck: (() => Promise<HealthResult>) | null;
  /** Execute an operation */
  execute: (operation: string, args: unknown, ctx: CapabilityContext) => Promise<CapabilityResult>;
  /** Timeout in ms */
  timeout: number;
  /** Retry policy */
  retryPolicy: { maxRetries: number; backoffMs: number };
  /** Rate limits */
  rateLimits: { maxPerMinute: number } | null;
  /** Approval level for this capability */
  approvalLevel: ApprovalLevel;
  /** Whether to audit log all calls */
  auditLogging: boolean;
  /** Fallback provider if this one fails */
  fallbackProvider: string | null;
  /** Test suite path */
  testSuite: string | null;
  /** Current state */
  state: CapabilityState;
}

export interface HealthResult {
  healthy: boolean;
  message: string;
  latencyMs?: number;
  checkedAt: number;
}

export interface CapabilityResult {
  success: boolean;
  data: unknown;
  errorCode?: string;
  message?: string;
  evidence?: string;
  durationMs: number;
  provider: string;
  requestId: string;
}

export interface CapabilityContext {
  userId: string;
  projectId: string | null;
  permissions: PermissionSet;
  emitEvent: (event: CapabilityEvent) => void;
}

export interface CapabilityEvent {
  capabilityId: string;
  operation: string;
  phase: "start" | "success" | "error" | "approval_required";
  summary: string;
  ts: number;
}
```

---

## 5. Complete Integration Inventory

### ACTIVE Integrations (24 verified)

| # | Service | Category | File | Health Check | Tests | LiTT Access | Prod |
|---|---------|----------|------|:---:|:---:|:---:|:---:|
| 1 | Clerk | auth | `src/lib/auth.ts` | ✅ | ✅ | ✅ | ✅ |
| 2 | Supabase | database | `src/lib/supabase-admin.ts` | ✅ | ✅ | ✅ | ✅ |
| 3 | Cloudflare R2 | storage | `src/lib/r2.ts` | ✅ | ❌ | ✅ | ✅ |
| 4 | Cloudflare Turnstile | auth | `src/lib/turnstile.ts` | ❌ | ❌ | partial | ✅ |
| 5 | GitHub | git | `src/lib/github-app.ts`, `github-pat.ts` | ✅ | ✅ | ✅ | ✅ |
| 6 | Vercel | deploy | `src/lib/deployments.ts` | ✅ | ❌ | ✅ | ✅ |
| 7 | Railway | infrastructure | `src/lib/integrations/status.ts` | ✅ | ❌ | ✅ | ✅ |
| 8 | Gemini | ai | `src/lib/gemini.ts`, `src/lib/llm.ts` | ✅ | ✅ | ✅ | ✅ |
| 9 | OpenRouter | ai | `src/lib/ai/providers.ts`, `src/lib/llm.ts` | ✅ | ✅ | ✅ | ✅ |
| 10 | Groq | ai | `src/lib/llm.ts` | ✅ | ✅ | ✅ | ✅ |
| 11 | OpenAI (BYOK) | ai | `src/lib/llm.ts` | ❌ | ❌ | ✅ | ✅ |
| 12 | Anthropic (BYOK) | ai | `src/lib/llm.ts` | ❌ | ❌ | ✅ | ✅ |
| 13 | ElevenLabs | creation | `src/lib/music/providers/elevenlabs.ts` | ❌ | ✅ | ✅ | ✅ |
| 14 | Mureka | creation | `src/lib/music/providers/mureka.ts` | ❌ | ❌ | ✅ | ✅ |
| 15 | Alibaba Cloud | creation | `src/lib/alibaba-video.ts` | ❌ | ❌ | ✅ | ✅ |
| 16 | FAL.ai | creation | `src/lib/media.ts` | ❌ | ❌ | ✅ | ✅ |
| 17 | Hugging Face | creation | `src/lib/media.ts` | ❌ | ❌ | ✅ | ✅ |
| 18 | Together.ai | creation | `src/lib/media.ts` | ❌ | ❌ | ✅ | ✅ |
| 19 | Recraft | creation | `src/lib/media.ts` | ❌ | ❌ | ✅ | ✅ |
| 20 | Browserbase | browser | `src/lib/litt-intelligence/browserbase-provider.ts` | ❌ | ❌ | ✅ | ✅ |
| 21 | n8n | automation | `src/lib/n8n-webhook.ts` | ❌ | ❌ | ✅ | ✅ |
| 22 | Vapi | communication | `src/lib/vapi-tools.ts` | ❌ | ❌ | ✅ | ✅ |
| 23 | LiveKit | communication | `src/lib/litt/live/LiveKitAudioTransport.ts` | ❌ | ❌ | ✅ | ✅ |
| 24 | Stripe | payments | `src/lib/integrations/status.ts` | ✅ | ✅ | ✅ | ✅ |
| 25 | Discord | communication | `src/lib/discord.ts` | ❌ | ❌ | ✅ | ✅ |
| 26 | Home Assistant | infrastructure | `src/lib/ha-api.ts` | ✅ | ❌ | ✅ | ✅ |
| 27 | Supermemory | memory | `src/lib/studio/memory-service.ts` | ❌ | ✅ | ✅ | ✅ |
| 28 | Braintrust | observability | `src/lib/evals/braintrust.ts` | ❌ | ❌ | ✅ | ✅ |
| 29 | Sentry | observability | `@sentry/nextjs` | ❌ | ❌ | ✅ | ✅ |

### STUB/DEAD Integrations (not implemented)

| # | Service | Env Vars Present | Implementation | Status |
|---|---------|-----------------|----------------|--------|
| 30 | Minimax | `MINIMAX_API_KEY` | `src/lib/studio-models.ts` | STUB |
| 31 | Inworld | `INWORLD_API_KEY` | `voice-server/.env` only | STUB |
| 32 | Resend | `RESEND_API_KEY` | None | STUB |
| 33 | Spotify | `SPOTIFY_CLIENT_ID` | None | STUB |
| 34 | Meta/Facebook | `META_APP_ID` | None | STUB |
| 35 | GitLab | `GITLAB_WEBHOOK_SECRET` | Minimal webhook route | PARTIAL |

### MCP Configuration
- `.vscode/mcp.json` — Console Ninja MCP server configured (dev tool, not LiTT integration)
- `src/lib/litt-intelligence/mcp-adapter.ts` — MCP adapter exists (221 lines) but is **DEAD** (zero importers)

---

## 6. Platform Health Dashboard Target

```
LiTT PLATFORM HEALTH

Core capabilities       26 / 26 HEALTHY
Developer tools         18 / 18 HEALTHY
Providers               11 / 13 HEALTHY
MCP servers              0 / 1 HEALTHY     ← mcp-adapter is dead
Connected apps           9 / 12 CONNECTED  ← 3 stubs
Production verified     24 / 29
Warnings                  4
Failures                  2

[Run Full Capability Audit]
```

### Per-Capability View

| Capability | Provider | LiTT | Health | Prod | Notes |
|------------|----------|:----:|:------:|:----:|-------|
| Git / PR | GitHub | ✅ | ✅ | ✅ | `github-app.ts` + project-tools git handlers |
| Files | LiTT native | ✅ | ✅ | ✅ | `project-tools/registry.ts` |
| Terminal | Terminal Server | ✅ | ✅ | 🟡 | Railway-hosted, health check exists |
| Browser | Browserbase | 🟡 | 🟡 | ❌ | Job-based, not live CDP streaming yet |
| Database | Supabase | ✅ | ✅ | ✅ | `supabase-admin.ts` |
| Auth | Clerk | ✅ | ✅ | ✅ | `auth.ts` |
| Payments | Stripe | ✅ | ✅ | 🟡 | Health check exists, webhook wired |
| Automation | n8n | ✅ | ✅ | 🟡 | Webhook bridge, no health check |
| Voice | Vapi | ✅ | ✅ | 🟡 | Custom LLM bridge, no health check |
| Deploy Web | Vercel | ✅ | ✅ | ✅ | `deployments.ts` |
| Deploy Worker | Railway | ✅ | ✅ | 🟡 | Terminal server hosting |
| Observability | Sentry | ✅ | ✅ | 🟡 | Error tracking, no custom health |
| MCP | LiTT MCP adapter | ❌ | ❌ | ❌ | **DEAD — adapter exists but never wired** |
| Image | FAL/Together/HF | 🟡 | — | — | No health checks on any provider |
| Video | Alibaba/HF | 🟡 | — | — | No health checks |
| Music | ElevenLabs/Mureka | 🟡 | — | — | No health checks |
| Memory | Supermemory | ✅ | ❌ | ✅ | No health check |
| Storage | R2 | ✅ | ✅ | ✅ | `r2.ts` |
| Research | Browserbase | ✅ | ❌ | ✅ | No health check |
| Notifications | Discord | ✅ | ❌ | ✅ | No health check |
| Smart Home | Home Assistant | ✅ | ✅ | ✅ | `ha-api.ts` |
| Evaluation | Braintrust | ✅ | ❌ | ✅ | No health check |
| Turnstile | Cloudflare | partial | ❌ | ✅ | Form protection only |

---

## 7. Consolidation Plan

### Phase 0: Delete Dead Registries (immediate, no risk)

Delete these files (zero importers, never wired):
- `src/lib/litt-kernel/capability-registry.ts` (190 lines, 0 importers)
- `src/lib/business-operations/tool-registry.ts` (602 lines, 0 importers)
- `src/lib/plugin-registry.ts` (90 lines, 0 importers)
- `src/lib/dashboard/widget-registry.ts` (382 lines, 0 importers)

**Total dead code removed: 1,264 lines**

### Phase 1: Build Unified Capability Registry

Create:
```
src/lib/capabilities/
├── types.ts              # Capability, CapabilityState, CapabilityResult
├── registry.ts           # Unified registry — single source of truth
├── health.ts             # Health check runner
├── permissions.ts        # Approval levels, permission checks
├── audit.ts              # Audit logging for all capability calls
└── adapters/
    ├── native.ts         # Wraps project-tools handlers as capabilities
    ├── intelligence.ts   # Wraps litt-intelligence tools as capabilities
    ├── connectors.ts     # Wraps connector providers as capabilities
    ├── mcp.ts            # Revives mcp-adapter as MCP capability adapter
    └── marketplace.ts    # Wraps marketplace capabilities
```

### Phase 2: Migrate Active Registries

1. Wrap `project-tools/registry.ts` handlers as native capabilities
2. Wrap `litt-intelligence/tool-registry.ts` handlers as intelligence capabilities
3. Wrap `connectors/provider-registry.ts` as connector capabilities
4. Wire `mcp-adapter.ts` as MCP adapter (revive from dead)
5. Merge `capability-registry.ts` + `litt/capability/capability-registry.ts` into unified registry
6. Merge `studio/agent-registry.ts` into `agent-registry.ts` (identity, not capabilities)

### Phase 3: Add Health Checks to All Providers

Every capability gets a `healthCheck()` function. Currently only 8 of 29 integrations have health checks.

### Phase 4: Build Platform Health UI

```
Settings
└── Developer Platform
    ├── Capabilities      ← unified registry view
    ├── Integrations      ← per-provider detail
    ├── MCP               ← MCP server management
    ├── Models            ← LLM provider config
    ├── Infrastructure    ← service health
    ├── Health            ← live health dashboard
    └── Permissions       ← granular allow/ask/deny
```

### Phase 5: Wire LiTT Runtime to Unified Registry

Replace direct imports in:
- `src/lib/litt-runtime/runtime.ts` → use unified registry
- `src/lib/voice/voice-runtime.ts` → use unified registry
- `src/lib/litt-intelligence/agent-loop-v2.ts` → use unified registry
- `src/app/api/vapi/tools/route.ts` → use unified registry
- `src/app/api/litt/tools/execute/route.ts` → use unified registry

---

## 8. Every Tool Invocation Must Return Structured Results

```typescript
interface CapabilityResult {
  success: boolean;       // did it work?
  data: unknown;          // the result
  errorCode?: string;     // machine-readable error code
  message?: string;       // human-readable message
  evidence?: string;      // proof (screenshot, diff, log excerpt)
  durationMs: number;     // how long it took
  provider: string;       // which provider was used
  requestId: string;      // for tracing
}
```

No more `throw new Error("failed")`. Every capability returns a structured result. LiTT can recover instead of hallucinating that something worked.

---

## 9. Stability Requirements for Every Adapter

Every adapter must declare:

```typescript
{
  id: string,
  name: string,
  category: CapabilityCategory,
  provider: string,
  version: string,
  capabilities: string[],
  requiredScopes: string[],
  credentialRef: string | null,    // env var NAME only, never value
  healthCheck: () => Promise<HealthResult>,
  execute: (op, args, ctx) => Promise<CapabilityResult>,
  timeout: number,
  retryPolicy: { maxRetries, backoffMs },
  rateLimits: { maxPerMinute } | null,
  approvalLevel: ApprovalLevel,
  auditLogging: boolean,
  fallbackProvider: string | null,
  testSuite: string | null,
  productionVerified: boolean,
}
```

---

## 10. What "Done" Looks Like

You open one page and see:

```
LiTT PLATFORM HEALTH

Core capabilities       26 / 26 HEALTHY
Developer tools         18 / 18 HEALTHY
Providers               11 / 13 HEALTHY
MCP servers              7 / 8 HEALTHY
Connected apps           9 / 12 CONNECTED
Production verified     52 / 58
Warnings                  4
Failures                  2

[Run Full Capability Audit]
```

Click a provider:

```
GitHub
CONNECTED

✓ Search repository
✓ Read files
✓ Branch
✓ Commit
✓ Push
✓ Pull requests
✓ Issues
✓ Review
✓ LiTT access
✓ Tests
✓ Production verified
```

**That's how you stop wondering what you have. LiTT inventories itself and tells you exactly what's missing or broken.**
