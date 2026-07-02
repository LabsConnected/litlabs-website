# AI Studio & Performance Optimization
> Make AI Studio delightful, fast, and reliable: optimize AI routing, provider failover, UX for model selection, and top performance metrics for litlabs.net.

| | |
|---|---|
| **Author** | Jace (Front-end) |
| **Owner / stakeholders** | Product: PO; Engineering: Frontend + Backend; Design: Lumi |
| **Status** | Draft |
| **Version** | v0.1 |
| **Target release** | Q4 2026 |
| **Last updated** | 2026-07-02 |

## Problem
Studio tools on litlabs.net rely on a mix of hardcoded providers, inconsistent client-side toggles, and demo/mock data. This causes unreliable AI behavior (no failover), confusing UX (static ModelBadge, no global provider controls), and performance regressions (heavy bundle sizes, render-blocking scripts, unoptimized images), harming conversion for creators.

## Background & Context
- `src/lib/llm.ts` contains a unified failover chain but many studio tools import `gemini.ts` or hardcode endpoints (`/api/gemini/chat`, Pollinations, MiniMax iframe) bypassing the failover.
- Audit notes show CRT toggle fragmentation, hardcoded wallet/coin values, and `UserSync` depending on Clerk in an environment that may not use it.
- Next.js config and headers include aggressive caching and CSP; however, static asset handling and image formats can be improved.
- Past tasks: OpenClaw and memory indexing are in place; OpenRouter keys exist as fallbacks.

## Opportunity
Unify AI provider routing and controls, make Studio resilient with proper failover, improve observability (per-tool provider health), and bring site performance to Lighthouse targets (Performance >= 90, Accessibility >= 90, Best Practices >= 90, SEO >= 90). Small UX changes (global provider chip, reactive ModelBadge, coin wiring) will increase trust and reduce support friction.

## Proposed Solution
Deliver a staged program:
1. Core: Refactor agent/llm calls to use `src/lib/llm.ts` everywhere; add server-side health endpoint `/api/llm/health` and per-tool provider health check cache.
2. UX: Add global Provider chip in Navbar, reactive ModelBadge in Studio topbar, provider toggle in AgentTool mirroring ChatTool pattern, and wire coin balance to `/api/wallet`.
3. Performance: Run Lighthouse, fix top LCP/CLS/TTFB issues, enable modern image formats (AVIF/WebP), lazy-load non-critical scripts, and optimize font loading.
4. Observability & QA: Add console traces, Visual Debugging loop for layout bugs, and automated Lighthouse (CI) checks.

## Key Features
- Global Provider Chip (Navbar) with quick-switch and persisted preference
- Studio ModelBadge reactive to `llm.ts` provider state and tool-level overrides
- AgentTool provider dropdown + local override saved in localStorage
- Centralized `/api/llm/health` with aggregated provider latencies
- Wallet coin badge reading `/api/wallet`
- Feature-flag gated rollout and telemetry events for provider switches
- Lighthouse CI with baseline report and PR gating

## Goals
- Deliver a Robust AI routing UX across Studio tools
- Improve site Core Web Vitals: LCP < 2.5s, FID/INP < 100ms, CLS < 0.1
- Lighthouse Performance >= 90 and Accessibility/BestPractices/SEO >= 90
- 99.9% uptime for primary provider failover behavior (monitored)

## Non-Goals
- Replacing third-party model providers entirely (we will integrate, not rehost)
- Large design system overhaul (this PRD focuses on targeted UI/UX and perf)

## Success Metrics
- Provider failover coverage: 100% of studio tools use `llm.ts` (tracked via code scan)
- 50% reduction in provider-error rate in 30 days after rollout
- Lighthouse scores >= 90 across categories within two sprints
- Conversion (new project creation) uplift +5% within 30 days

## Target Users
- Creators using Studio tools (Image, Video, Audio, Agents, Flow)
- Internal product engineers and ops monitoring model health

## Personas
- Alex (Creator): cares about fast, reliable image & agent responses; frustrated when providers fail mid-job.
- Sam (Engineer): needs deterministic provider routing and observable health endpoints to debug issues.

## Key User Needs
- Predictable provider behavior and graceful fallback
- Clear UI controls to choose or view provider status
- Fast page load and responsive canvas/tool interactions

## User Journeys
1. Alex opens Studio -> sees provider chip with "Gemini (primary)" -> starts an image generation -> if primary fails, UI shows fallback to OpenRouter with brief toast and continues.
2. Sam toggles provider in Navbar for testing -> telemetry records event, agent requests use `llm.ts` with override, health endpoint indicates provider latency.

## Functional Requirements
- FR-1: All server-side and client LLM calls must route through `src/lib/llm.ts` (unit tests required).
- FR-2: `/api/llm/health` returns JSON with providers, status, avg latency, lastChecked.
- FR-3: Navbar provider chip: shows current provider, allows quick switch, persists to localStorage and fires telemetry event.
- FR-4: AgentTool and ChatTool expose provider dropdown with persistence and per-tool override precedence over global setting.
- FR-5: ModelBadge reflects active provider and toggles if provider changes.
- FR-6: Wallet badge reads `/api/wallet` on mount and refreshes every 60s.

## Non-Functional Requirements
- NFR-1: LCP < 2.5s on 75th percentile mobile (3G Fast) within rollout phase.
- NFR-2: API `/api/llm/health` must respond < 300ms under normal conditions.
- NFR-3: All network requests must use fetch with keepalive where appropriate and retry/backoff on 5xx.
- NFR-4: UI updates must be accessible (WCAG AA) and keyboard navigable.
- NFR-5: New features must include unit and integration tests; PRs must pass Lighthouse score checks (baseline pass >= 85 before merge).

## User Stories
- As a Creator, I want to see which provider is active so I can understand where my requests go.
- As an Engineer, I want a single LLM client code path so I can maintain and instrument failover logic centrally.

## Acceptance Criteria
- Given Studio tool code uses direct provider endpoints (e.g. `/api/gemini/chat`), When PR converts it to `llm.ts` call, Then unit tests show the route and health tests pass.
- Given the Navbar provider chip is toggled, When a user switches provider, Then the choice persists and all subsequent tool requests obey the override.
- Given Lighthouse CI runs on PR, When the baseline fails (<85), Then CI blocks merge and provides report.

## Architecture Overview
- Client: light wrapper to call `/api/llm` server routes or use `llm.ts` client that chooses server proxy.
- Server: unified `api/llm/*` endpoints that call provider SDKs (Gemini/OpenRouter/DeepSeek) with retry + circuit-breaker.
- Observability: Redis/memory cache for provider health, Prometheus/Grafana for latencies and request rates.

## Tech Stack
- Frontend: Next.js 14, React 18, TypeScript, Tailwind CSS
- Backend: Next.js API routes (Edge functions where low latency needed), Node 22, Redis cache
- Testing: Vitest/Jest, Playwright for e2e, Lighthouse for perf
- CI: GitHub Actions with Lighthouse CI and the PRD file saved in repo

## Data Model
- ProviderHealth: { providerId, status: up|down, avgLatencyMs, errorsLastHour, lastChecked }
- UserPreferences: { providerGlobal, providerOverrides: { toolId: providerId } }

## APIs & Integrations
- GET /api/llm/health
- POST /api/llm/chat (proxy)
- GET /api/wallet
- Telemetry: /api/telemetry/event
- Optional: /api/media/generate catalog integration

## Dependencies
- OPENROUTER_API_KEY, GEMINI credentials, FAL/Minimax keys where applicable
- Redis for health cache (or in-process LRU as fallback)
- Lighthouse CI runner

## Technical Constraints
- Keep CSP intact; any external script additions must be CSP-reviewed.
- Avoid synchronous blocking work on server that delays TTFB > 500ms.

## In Scope
- Code refactor to route through llm.ts, Navbar chip, AgentTool provider dropdown, ModelBadge reactivity, wallet wiring, Lighthouse audits, CI integrations.

## Out of Scope
- Replacing providers, full design system rewrite, mobile native apps.

## Edge Cases & Error Handling
- Primary provider rate-limits: fallback to next provider with user-visible toast and continued job processing.
- Partial failures: if embeddings fail, return cached fallback response and mark ProviderHealth degraded.
- No network: show offline toast and queue job locally for retry (best-effort).

## Milestones
1. M1 (1 week) — Refactor agents + llm.ts usage, basic health endpoint
2. M2 (2 weeks) — Navbar chip, AgentTool provider dropdown, ModelBadge reactivity
3. M3 (3 weeks) — Lighthouse fixes, CI integration, telemetry

## Assumptions
- Provider credentials available as env vars
- Redis or similar cache available in production

## Risks & Open Questions
- Provider quota limits and cost spikes; need budget guardrails.
- Do we want global provider enforcement (admin-only) or user-level control?

## Solution Screens


