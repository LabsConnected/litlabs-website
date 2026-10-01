# Provider Route Metering Audit

**Date:** 2026-09-30
**PR:** #599 `fix/billing-remaining-routes` (follow-up to #595)
**Scope:** Direct LLM/provider spawn paths in `src/`. Independent re-audit after #595+#599.

## Canonical gateway

User-billable LLM text calls go through `meteredLlmCall` / `meteredGenerateJSON`:

1. `preflightBillingAuth` (owner exemption / spend ceiling) **before** provider spend
2. `getCreditBalances` for non-exempt users **before** provider spend (fail closed)
3. `generateText` with metering context → **N** `cost_events` / attempt `usage_events`
4. `chargeLlmUsage({ meteringBillableKey })` → **one** billable `usage_event` + at most one wallet debit

## Classification

| Route | Status | Notes |
|---|---|---|
| `/api/gemini` | METERED + CHARGED + GATED | #595 `meteredLlmCall` |
| `/api/gemini/build` | METERED + CHARGED + GATED | #595 `assertSpendAuthorized` + `chargeLlmUsage` |
| `/api/ai-chat` | METERED + CHARGED + GATED | #595 `meteredLlmCall` |
| `/api/ai/chat` | METERED + CHARGED + GATED | **This PR**: was `runAI` (OpenRouter bypass). Now canonical gateway. |
| `/api/chat` | METERED + CHARGED | `chargeAgentRun` before `generateText`; metering context on the call |
| `/api/chat/unified` | METERED + CHARGED | Shared pipeline + `chargeLlmUsage` with billable key |
| `/api/agents/chat` fallback | METERED + CHARGED + GATED | **This PR**: `meteredLlmCall` |
| `/api/conversations/[id]/messages` | METERED + CHARGED + GATED | **This PR**: `meteredLlmCall` |
| `/api/studio/conversations/*/messages` | METERED + CHARGED + GATED | Reserve-before-model in agent loop |
| `/api/studio/conversations/*/regenerate` | METERED + CHARGED + GATED | **This PR**: `meteredLlmCall` |
| `/api/canvas/ai` | METERED + CHARGED + GATED | **This PR**: `meteredGenerateJSON` |
| `/api/canvas/html-ai` | METERED + CHARGED + GATED | **This PR**: `meteredGenerateJSON` |
| `/api/music/producer` | METERED + CHARGED + GATED | **This PR**: `meteredGenerateJSON` |
| `/api/music/enhance-prompt` | METERED + CHARGED + GATED | **This PR**: `meteredGenerateJSON` |
| `/api/litt/think` | METERED + CHARGED + GATED | **This PR**: was `runAI` bypass. Now canonical gateway. |
| `/api/missions/*/run` | METERED + CHARGED + GATED | **This PR**: gate on route + `meteredLlmCall` in executor |
| `/api/media/analyze-image` | METERED + GATED (uncharged) | **This PR**: balance gate before Gemini. `chargedBits=0` by product (vision helper). |
| `/api/media/analyze-video` | METERED + GATED (uncharged) | Same as analyze-image |
| `/api/media/suggest-video-ideas` | METERED + GATED (uncharged) | Same as analyze-image |
| `/api/media/generate-*` | METERED + CHARGED + GATED | Wallet debit before/around provider |
| `/api/studio/video` | METERED + CHARGED + GATED | Balance check before fal.ai |
| `/api/studio/generate` | METERED | Image path; existing metering |
| `/api/demo/chat` | METERED COST ONLY | Anonymous; `emitServiceCostEvent`; rate-limited |
| `/api/vapi/turn` | METERED COST ONLY | Voice free by product decision |
| `/api/agent/chat` | METERED COST ONLY | Service-to-service; no user to bill |
| `/api/debug/llm-test` | METERED COST ONLY | Owner-only diagnostic |
| `/api/admin/metering-reconciliation` | N/A | Read-only |

## Intentional non-billed

| Route | Reason |
|---|---|
| `/api/agent/chat` | Service-to-service. Cost tracked via `agent-chat-service`. |
| `/api/debug/llm-test` | Owner-only diagnostic. |
| `/api/vapi/turn` | Voice turns free to users. |
| `/api/demo/chat` | Anonymous public demo. Abuse-limited. |
| `/api/media/analyze-*` and `suggest-video-ideas` | Product: no LiTTBits debit today, but **zero-balance users cannot trigger Gemini**. |

## Remaining gaps (not user-billable wallet paths, still provider cost)

| Path | Notes |
|---|---|
| `src/lib/litt-runtime/execution-engine.ts` `generateWithImages` | Direct `@google/generative-ai` multimodal call. Text/stream path uses `llm.ts` (ALS metering if caller set `runWithMeteringContext`). |
| `src/lib/agents.ts` `generateText` | Legacy orchestrator helpers. Live `/api/chat` charges via `chargeAgentRun` first. |
| `src/lib/voice/ghl-payload-builder.ts` | Used from `/api/vapi/events`; no user wallet. |
| `/api/chat/unified` | Charges after the provider call on some branches; not a zero-balance free ride if `chargeAgentRun` already ran, but not the same pre-flight as `assertSpendAuthorized`. |

## Proofs in unit tests (`src/lib/metered-llm-call.test.ts`)

- Unfunded user → provider **never** called, 402
- Spend ceiling → provider **never** called, 403
- Wallet lookup failure → fail closed, provider **never** called
- Funded user → metering context present
- Charge reuses `meteringBillableKey` (retries = N cost events, one billable usage_event)
- Post-call debit race → 402, no free text
- Owner-exempt skips balance gate but still meters
- `meteredGenerateJSON` uses the same gate
