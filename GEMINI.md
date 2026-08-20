# GEMINI.md — Project entry point for Gemini AI

> Machine-readable architecture data lives in `architecture.manifest.json`
> and `dependency-graph.json` at the repo root. Read those first for
> structural context, then the human-readable docs below for intent.

## Quick start (for Gemini)

1. **Read the manifest** — `architecture.manifest.json` has the full stack,
   subsystem map, agent registry analysis, route inventory, component tree,
   and known follow-ups. This is the single machine-readable source of truth.
2. **Read the dependency graph** — `dependency-graph.json` has 137 import
   edges (lib→lib, route→lib, component→lib, component→component) plus
   critical execution paths.
3. **Read product truth** — `docs/PRODUCT_TRUTH.md` for the canonical agent
   model and product vision.
4. **Read LiTT docs** — `docs/litt/` for identity, voice, principles,
   classification, and current architecture.
5. **Read rules** — `.devin/rules/canonical-architecture.md` and
   `.devin/rules/product-vision.md` for architectural guardrails.

## Stack

- Next.js 16 (App Router, Turbopack) + React 19 + Tailwind CSS v4
- pnpm 9.15+ · Node 22+ · TypeScript 5 (strict)
- Clerk auth · Supabase DB · Stripe payments · Cloudflare R2 storage
- AI: OpenRouter, Gemini, Together, Fal, MiniMax, Alibaba
- Deployed on Railway; Docker available for self-hosting

## Commands

```powershell
pnpm dev              # Dev server with Turbopack on :3000
pnpm build            # Production build
pnpm lint             # ESLint (flat config)
pnpm test             # Vitest (jsdom env)
npx tsc --noEmit      # Type-check (strict mode)
```

## Architecture summary

Multi-agent AI app ("LiTTree Lab Studios"). Key subsystems in `src/lib/`:

- **Agent registries** (3 layers — see manifest `agents` section):
  - `agent-registry.ts` — canonical identity, plan gating, prompts, pricing
  - `studio/agent-registry.ts` — chat runtime (memory types, legacy slugs)
  - `litt-intelligence/agent-profiles.ts` — LiTT mode profiles (tool perms)
- `litt-kernel/` — LiTT Kernel orchestrator (intent routing, capability checks)
- `litt-intelligence/` — project scanner, knowledge service, research, tools
- `litt/` — conversation engine, event bus, canvas, voice, live session
- `missions/` — mission execution + repository
- `projects/` — canonical project repository + runtime state
- `studio/` — conversation service, memory service, project resolver
- `canvas/` — artifact-backed structured work surfaces with undo/redo
- `visual-builds/` — visual build orchestrator + QA + asset security
- `llm.ts` — unified LLM client (Gemini primary, Groq speed, OpenRouter fallback)

App routes in `src/app/` — 110 API routes + 56 pages. Main chat entry:
`/api/studio/conversations/[conversationId]/messages` (18 lib imports across
5 subsystems — highest fan-in route).

## Agent model

- **LiTT** (free, Starter) — the AI OS, single engineering/research brain
- **Spark** (free, Starter) — creative companion
- **5 internal specialists** (subscription) — Researcher, Writer, Marketer, Coder, Analyst
- **3 marketplace agents** (subscription) — Nova, Forge, Echo

LiTT has 4 modes: standard, builder, research, spark — each with distinct
tool permissions and memory scope.

## Known follow-ups

- **P1**: Agent registry fragmentation — LiTT system prompt duplicated 3x
  with divergent content. Consolidate or derive from one source.
- **P3 TODO**: Stale provisioning lock recovery in
  `src/lib/projects/project-repository.ts` — see manifest `knownFollowUps`.
- **P3 BLOCKED**: Production Docker runtime — terminal server needs Docker
  for workspace isolation; Railway doesn't provide it. See manifest.

## Key files for orientation

| File | Purpose |
|------|---------|
| `architecture.manifest.json` | Machine-readable architecture (read this first) |
| `dependency-graph.json` | Import edges + critical execution paths |
| `docs/PRODUCT_TRUTH.md` | Canonical agent model + product vision |
| `docs/litt/identity.md` | LiTT identity definition |
| `docs/litt/principles.md` | LiTT principles (truth-over-confidence, verify-before-acting) |
| `docs/litt/current-architecture.md` | Current architecture overview |
| `docs/litt/route-inventory.md` | Route inventory (human-readable) |
| `.devin/rules/canonical-architecture.md` | Architectural guardrails |
| `.devin/rules/product-vision.md` | Product vision rules |
| `src/lib/agent-registry.ts` | Canonical agent registry (source of truth) |
| `src/lib/litt-kernel/index.ts` | LiTT Kernel public API |
| `src/lib/llm.ts` | Unified LLM client |

## Environment

Copy `.env.example` to `.env.local` and fill in secrets. Key groups:
Clerk, Supabase, Stripe, AI providers, AUTH_SECRET. See `docs/` for wiring
details. **Never commit secrets.**
