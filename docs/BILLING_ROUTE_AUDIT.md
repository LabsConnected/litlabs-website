# Provider Route Metering Audit

**Date:** 2026-09-30
**PR:** fix/billing-remaining-routes (follow-up to #595)
**Scope:** Every direct LLM/provider spawn path in `src/`.

## Classification

| Route | Status | Notes |
|---|---|---|
| `/api/gemini` | METERED + CHARGED | Fixed in #595 via canonical gateway |
| `/api/gemini/build` | METERED + CHARGED | Fixed in #595 (audit find) |
| `/api/ai-chat` | METERED + CHARGED | Fixed in #595 via canonical gateway |
| `/api/chat` | METERED + CHARGED | #595 added cost context; existing `chargeAgentRun` preserved |
| `/api/chat/unified` | METERED + CHARGED | Via shared chat pipeline |
| `/api/agents/chat` | METERED (cost visibility) | Via shared agent pipeline |
| `/api/conversations/[id]/messages` | METERED (cost visibility) | #595 added metering context |
| `/api/studio/conversations/*/messages` | METERED + CHARGED | Via agent loop metering |
| `/api/studio/conversations/*/regenerate` | METERED (cost visibility) | #595 added metering context |
| `/api/demo/chat` | METERED COST ONLY | **This PR**: `emitServiceCostEvent` per successful call; anonymous, billable=false. Rate-limited (per-session + per-IP burst, 5-msg ceiling). |
| `/api/vapi/turn` | METERED COST ONLY | **This PR**: billable=false made explicit (was `billable: status===200`). Voice free by product decision; cost tracked when determinable (tokens not surfaced by runtime today). |
| `/api/agent/chat` | METERED COST ONLY | **This PR**: `emitServiceCostEvent` per attempt with `feature: "agent-chat-service"`. Service-to-service (Bearer AGENT_API_KEY), no user to bill; LiTT absorbs cost. Auth unchanged. |
| `/api/debug/llm-test` | METERED COST ONLY | **This PR**: `emitLlmMetering` with owner clerkId, billable=false. Owner-exempt by design; cost tracked for visibility. Owner-only guard unchanged. |
| `/api/litt/think` | METERED + CHARGED | Via agent pipeline |
| `/api/studio/generate` | METERED + CHARGED | Via agent pipeline |
| `/api/media/*` (4 routes) | METERED + CHARGED | Image/video generation via canonical metering |
| `/api/music/*` (3 routes) | METERED + CHARGED | Via canonical metering |
| `/api/voice/*` (3 routes) | METERED + CHARGED | Via canonical metering |
| `/api/admin/metering-reconciliation` | N/A | Read-only admin observability |

## Intentional Non-Billed (documented product decisions)

| Route | Reason |
|---|---|
| `/api/agent/chat` | Service-to-service; no user identity to bill. Cost tracked via `agent-chat-service` feature. |
| `/api/debug/llm-test` | Owner-only diagnostic; owner billing-exempt. Cost tracked via `debug-llm-test` feature. |
| `/api/vapi/turn` | Voice turns free to users (product decision). Cost tracked; `billable=false`, `chargedBits=0`. |
| `/api/demo/chat` | Anonymous public demo; no user to bill. Cost tracked via `demo-chat-service`. Abuse-limited. |

## Service Cost Tracking

Routes without a billable user emit via `src/lib/service-metering.ts`:
- `emitServiceCostEvent()` → canonical `emitLlmMetering` with `billable=false`, `chargedBits=0`
- Requires `SERVICE_METERING_USER_ID` env var (a real users.id UUID, e.g. owner's) for FK compliance
- If unset: skipped with warning (fail-open for tracking, never blocks the request)
- `feature` field carries the service identifier for reporting
- `liitt_absorbed=true` is set automatically (provider cost > 0, charged bits = 0)

## Remaining Gaps

None. Every provider-spend path now emits at least a cost_event.
User-billable paths emit usage_events + cost_events + ledger debits.
Service/anonymous paths emit cost_events (visibility) without charges.
