# P0 Audit — Final Report

> Audit and planning only. No production code modified. No deployments. No migrations.

## TOP 10 P0 BLOCKERS

| # | Blocker | Impact | System |
|---|---|---|---|
| 1 | **Two LiTT runtime entry points** (`litt-intelligence/agent-loop-v2.ts` vs `litt-runtime/execution-engine.ts`) | Text and phone use different execution logic. Voice continuity impossible until unified. | Canonical LiTT |
| 2 | **Quick Build flow not started** | No onboarding, no describe screen, no plan, no build progress. First-user journey blocked at step 3. | First User Journey |
| 3 | **No activity card UI** | Progress events stream via SSE but render as generic tool activity. LiTT feels dead during builds. | Activity Streaming |
| 4 | **No verification receipts** | LiTT can claim success without evidence. Trust layer not started. | Truth Layer |
| 5 | **No rollback** | No rollback API, no rollback UI. Users can't undo agent actions. | Recovery |
| 6 | **BYOK unreachable** | LLM client supports BYOK params but no UI, no storage, no encryption. Users can't use their own keys. | Account |
| 7 | **Text ↔ Voice continuity untested** | No test exists. Two voice abstractions (Inworld vs OpenAI Realtime). Unknown if they share conversation. | Voice |
| 8 | **Canvas not connected to agent loop** | Canvas is standalone visual editor. LiTT can't read/manipulate canvas programmatically. | Canvas |
| 9 | **V1 fallback has no permission enforcement** | PLAN/ACT/AUTO only enforced in V2. V1 path allows any operation. | Security |
| 10 | **No durable run system** | Long AI operations tied to HTTP request. Browser refresh or timeout kills the run. | Reliability |

## TOP 5 BLOCKERS TO FIRST USER

| # | Blocker | Why it blocks first users |
|---|---|---|
| 1 | No Quick Build flow | Users can't go from signup → website without manual project creation |
| 2 | No activity card | Users see blank/loading during builds → think it's broken |
| 3 | Preview reliability unverified | Users may hit preview failures with no clear error |
| 4 | No onboarding | Users land in Studio with no guidance |
| 5 | No verification receipts | Users don't trust LiTT's output |

## TOP 5 BLOCKERS TO FIRST PAYING USER

| # | Blocker | Why it blocks payment |
|---|---|---|
| 1 | BYOK not functional | Users who want their own keys can't use them |
| 2 | No publish flow from Studio | Users can't get a live URL without manual deployment |
| 3 | No rollback | Users fear agent actions are irreversible |
| 4 | No deployment approval gate | Users fear LiTT might deploy without permission |
| 5 | No observability | Can't trace what went wrong when users report issues |

## TOP 5 ARCHITECTURAL DUPLICATIONS

| # | Duplication | Current state | Fix |
|---|---|---|---|
| 1 | **Two LiTT runtimes** | `litt-intelligence/agent-loop-v2.ts` (Studio text) vs `litt-runtime/execution-engine.ts` (Vapi phone) | Unify into one canonical runtime. Both text and voice call the same execution engine. |
| 2 | **Two voice abstractions** | `VoiceSessionContext` (Inworld, 1121 lines) vs `ConversationContext.voiceProvider` (OpenAI Realtime, unclear if active) | Remove dead abstraction. Keep Inworld as the active voice system. |
| 3 | **Runtime context built twice** | `buildStudioContext` + `buildCanonicalRuntimeContext` both query project state | Merge into one canonical context builder. |
| 4 | **Image generation outside chat** | Separate `/api/studio/generate` route, not connected to conversation or agent loop | Wire as agent tool, return `ImagePart` in message. |
| 5 | **Canvas outside agent loop** | Canvas has own API (`/api/canvases/`), not in tool registry | Add canvas tools to registry. Let agent read/manipulate canvas. |

## TOP 5 THINGS WE MUST NOT BUILD YET

| # | Feature | Why it waits |
|---|---|---|
| 1 | Game Studio / Arcade | P0 must prove first. Games combine everything — too complex before foundation is canonical. |
| 2 | Browser Operator (Playwright) | P1. Workspace Operator must be solid first. |
| 3 | VS Code / Windsurf extension | P2. Web Studio must be production-ready first. |
| 4 | Complex learning curriculum | P1. Quick Build and first-user journey first. |
| 5 | Community / gamification / themes | P2. No community exists yet. Build product first. |

## SHORTEST PATH TO PRIVATE BETA

```
Week 1-2: Foundation
  ├── Unify LiTT runtime (litt-intelligence + litt-runtime → one engine)
  ├── Remove dead voice abstraction (ConversationContext.voiceProvider)
  ├── Verify V2 agent loop works in production
  └── Verify text → voice → text continuity

Week 2-3: Activity + Trust
  ├── Build activity card UI (streaming events → live timeline)
  ├── Build verification receipt component
  ├── Wire build-fix results into receipts
  └── Add checkpoint UI in transcript

Week 3-4: Quick Build
  ├── Build onboarding route (/onboarding)
  ├── Build Quick Build route (/build)
  ├── Build describe → plan → build → preview flow
  ├── Build activity card into Quick Build progress screen
  └── Verify time-to-preview < 5 minutes

Week 4-5: Recovery + Account
  ├── Build rollback API + UI
  ├── Build BYOK settings UI + encrypted storage
  ├── Surface provider health in UI
  └── Build publish flow from Studio

Week 5-6: Hardening
  ├── Error states (no "something went wrong" — actionable errors)
  ├── Reconnection (SSE, terminal, voice, preview)
  ├── Durable runs (runId, server-side continuation, browser reconnect)
  ├── Security audit (auth, ownership, RLS, terminal restrictions)
  └── Observability (error tracking, run tracing, provider health)

Week 6: First User Journey E2E
  ├── Complete all 12 steps end-to-end
  ├── Test with 5 internal users
  ├── Fix critical bugs
  └── PRIVATE BETA GATE CHECK
```

**6 weeks to private beta if scope stays frozen.**

## Spec library — final inventory (24 docs)

### Product vision (17 specs — FROZEN)

| Spec | Status |
|---|---|
| `LITT_PRODUCT_VISION.md` | ✅ Frozen |
| `LITT_CORE_ARCHITECTURE.md` | ✅ Frozen |
| `UNIVERSAL_ARTIFACTS.md` | ✅ Frozen |
| `QUICK_BUILD.md` | ✅ Frozen |
| `TRUTH_LAYER.md` | ✅ Frozen |
| `LEARNING_SYSTEM.md` | ✅ Frozen |
| `MISSIONS.md` | ✅ Frozen |
| `TUTORIAL_SANDBOX.md` | ✅ Frozen |
| `LITT_ACTIVITY_STATES.md` | ✅ Frozen |
| `LITT_OPERATOR.md` | ✅ Frozen |
| `AGENT_MANAGEMENT.md` | ✅ Frozen |
| `GAME_STUDIO_ARCADE.md` | ✅ Frozen |
| `LITT_BRIDGE_EXTENSION.md` | ✅ Frozen |
| `PROJECT_PORTABILITY.md` | ✅ Frozen |
| `DESIGN_SYSTEM.md` | ✅ Frozen |
| `PROVIDER_BYOK.md` | ✅ Frozen |
| `PRODUCT_ROADMAP.md` | ✅ Frozen |

### Operational docs (7 docs — LIVING)

| Doc | Status |
|---|---|
| `P0_CURRENT_STATE.md` | ✅ Written — update as systems are verified |
| `CANONICAL_RUNTIME_MAP.md` | ✅ Written — update when runtime is unified |
| `FIRST_USER_JOURNEY.md` | ✅ Written — update as steps are completed |
| `ACCEPTANCE_TEST_MATRIX.md` | ✅ Written — update as tests are run |
| `RELEASE_GATES.md` | ✅ Written — update as gates are passed |
| `PRODUCT_CONTROL_TOWER.md` | ✅ Written — update weekly as canonical progress doc |
| `FIRST_100_USERS.md` | ✅ Written — execute after private beta gate passes |

## Standing order

> **Audit → fix → verify → polish → document.**
>
> Work down the existing system dependency-by-dependency.
>
> No more designing features. No more specs.
>
> Make what exists: complete → connected → consistent → verified → fast → secure → polished.
