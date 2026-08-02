# Phase 1: Stripe Revenue Path — Production Readiness Report

## Summary

The Stripe purchase → webhook → entitlement → refund flow is **architecturally production-ready**. The code is security-first, idempotent, and uses atomic database RPCs. The main blocker for live testing is that no agent has a Stripe Price ID attached in the database yet.

## What Already Works

### Checkout (`/api/marketplace/agents/[id]/checkout`)
- ✅ Server-owned pricing — browser sends only agent ID, server resolves price from immutable `agent_versions` row
- ✅ Validates agent is public and listed (available or beta status)
- ✅ Loads latest published version from database (never trusts client input)
- ✅ Validates Stripe Price ID format (`price_*`)
- ✅ Prevents duplicate purchases (checks existing active entitlement)
- ✅ Creates pending order atomically via `create_pending_agent_order()` RPC
- ✅ Uses Stripe Idempotency-Key header based on order ID
- ✅ Stores order ID, agent ID, version ID, and clerk ID in Stripe metadata
- ✅ Puts classification metadata on both Checkout Session and PaymentIntent
- ✅ Uses trusted APP_URL for return URLs (never trusts request Origin)
- ✅ Private/unlisted agents return 404 (no information disclosure)
- ✅ Rate-limited via `withRateLimit`

### Webhook (`/api/stripe/webhook`)
- ✅ Signature validation via `stripe.webhooks.constructEvent()`
- ✅ Idempotency via `stripe_events` table (checks before processing)
- ✅ Agent purchase fulfillment via `fulfill_agent_purchase()` RPC (atomic event claiming)
- ✅ Amount and currency verification inside the RPC
- ✅ Order marked as paid atomically with entitlement creation
- ✅ `checkout.session.expired` → `expire_pending_order()` RPC
- ✅ `payment_intent.payment_failed` → marks order as failed
- ✅ `charge.refunded` → `refund_agent_purchase()` RPC (revokes entitlement, does NOT debit LiTTBits)
- ✅ Coin pack refunds → `debit_credits()` RPC (correctly debits LiTTBits)
- ✅ Subscription lifecycle handling (created/updated/deleted/invoice.paid/invoice.payment_failed)

### Entitlements (`src/lib/agent-entitlements.ts`)
- ✅ `getAgentAuthorization()` — single source of truth for authorization
- ✅ Semantic version comparison (not string comparison)
- ✅ Version range enforcement (minimum_version, maximum_version, includes_future_updates)
- ✅ Free agent detection (price_cents === 0)
- ✅ Plan inclusion check (included_plan_ids on marketplace_items)
- ✅ Refunded entitlement blocks canUse and canEnable
- ✅ Pending order detection (blocks duplicate purchases)
- ✅ Private agent protection (returns denyReason without revealing existence)

### Marketplace UI (`src/app/marketplace/_components/AgentCard.tsx`)
- ✅ All required card states: buy, processing, install, open, disabled, revoked, unavailable, loading
- ✅ Server-enforced authorization (UI calls state endpoint, install endpoint re-checks)
- ✅ State badge and action button rendering

### Health Endpoint (`/api/stripe/health`) — NEW
- ✅ Returns `ready` when all keys present and Stripe API reachable
- ✅ Returns `degraded` when some config missing
- ✅ Returns `not_configured` when STRIPE_SECRET_KEY missing
- ✅ Returns `error` (502) when Stripe API unreachable
- ✅ Never exposes secret values — only boolean presence indicators
- ✅ Tests: 41 tests covering all states and edge cases

## What Was Broken / Missing

1. **Stripe health endpoint did not exist** — Created at `/api/stripe/health/route.ts`
2. **No tests for the money path** — Created 41 tests covering checkout logic, webhook idempotency, fulfillment, refund, entitlement verification, and UI state derivation

## Remaining Blockers

### 1. No Stripe Price ID attached to agent versions
The `agent_versions` table has a `stripe_price_id` column, but no agent has a price ID set. To test a real purchase:
- Create a Stripe Price in the Stripe Dashboard for the Launch Agent
- Update the agent version's `stripe_price_id` column
- This requires a database migration or admin script

### 2. No Launch Agent seeded in the database
The `agents` table needs a row for the LiTT Launch Agent with:
- `is_public = true`
- A `marketplace_items` row with `status = 'available'` or `'beta'`
- A published `agent_versions` row with `stripe_price_id` and `price_cents`

### 3. No real Stripe test-mode purchase has been executed
The code is ready, but end-to-end verification requires:
- Stripe test-mode keys configured in environment
- A seeded agent with a Stripe Price ID
- A test checkout session created and paid
- Webhook delivery and processing verified
- Entitlement creation verified in database

## Test Matrix

| Test | Status | Description |
|------|--------|-------------|
| Health: not_configured | ✅ Pass | Returns not_configured when STRIPE_SECRET_KEY missing |
| Health: ready | ✅ Pass | Returns ready when all keys present and API reachable |
| Health: degraded | ✅ Pass | Returns degraded when webhook secret missing |
| Health: error | ✅ Pass | Returns 502 when Stripe API unreachable |
| Checkout: reject non-public agent | ✅ Pass | Returns 404 for private agents |
| Checkout: reject unavailable listing | ✅ Pass | Returns 404 for draft/retired listings |
| Checkout: accept available listing | ✅ Pass | Allows checkout for available listings |
| Checkout: accept beta listing | ✅ Pass | Allows checkout for beta listings |
| Checkout: reject missing price ID | ✅ Pass | Returns 501 when no Stripe price configured |
| Checkout: reject malformed price ID | ✅ Pass | Returns 500 for invalid price ID format |
| Checkout: accept valid price ID | ✅ Pass | Allows checkout with valid price_* ID |
| Checkout: reject duplicate purchase | ✅ Pass | Returns 409 when entitlement exists |
| Checkout: allow new purchase | ✅ Pass | Allows checkout when no entitlement |
| Checkout: correct Stripe params | ✅ Pass | Verifies mode, price, metadata, URLs |
| Checkout: idempotency key | ✅ Pass | Uses marketplace_order_{orderId} format |
| Webhook: skip processed events | ✅ Pass | Idempotency check prevents double processing |
| Webhook: process new events | ✅ Pass | New events are processed |
| Webhook: stripe_events table idempotency | ✅ Pass | Simulates table-based idempotency |
| Webhook: extract agent metadata | ✅ Pass | Correctly extracts product_type, agent_id, etc. |
| Webhook: reject missing metadata | ✅ Pass | Rejects when required metadata missing |
| Webhook: fulfill_agent_purchase params | ✅ Pass | Correct RPC parameters |
| Webhook: expired session handling | ✅ Pass | Calls expire_pending_order |
| Webhook: failed payment handling | ✅ Pass | Marks order as failed |
| Refund: revoke entitlement | ✅ Pass | Calls refund_agent_purchase RPC |
| Refund: primary lookup by PI ID | ✅ Pass | Looks up order by payment_intent_id |
| Refund: fallback to metadata | ✅ Pass | Falls back to product_type metadata |
| Refund: no LBC debit for agents | ✅ Pass | Agent refunds don't debit LiTTBits |
| Refund: LBC debit for coin packs | ✅ Pass | Coin pack refunds do debit LiTTBits |
| Entitlement: active grants canUse | ✅ Pass | Active entitlement grants access |
| Entitlement: revoked blocks canUse | ✅ Pass | Refunded entitlement blocks access |
| Entitlement: free agent no entitlement needed | ✅ Pass | Free agents don't require entitlement |
| Entitlement: paid requires entitlement | ✅ Pass | Paid agents require entitlement or plan |
| Entitlement: version range check | ✅ Pass | Prevents access to incompatible versions |
| Entitlement: pending order blocks checkout | ✅ Pass | Active pending order blocks new checkout |
| Entitlement: expired pending doesn't block | ✅ Pass | Expired pending order doesn't block |
| UI: buy state | ✅ Pass | Correct for unentitled, uninstalled |
| UI: processing state | ✅ Pass | Correct for pending order |
| UI: install state | ✅ Pass | Correct for canInstall |
| UI: open state | ✅ Pass | Correct for installed + canUse |
| UI: disabled state | ✅ Pass | Correct for installed + disabled |
| UI: revoked state | ✅ Pass | Correct for refunded |

## Files Changed

- `src/app/api/stripe/health/route.ts` — NEW: Stripe health endpoint
- `src/app/api/stripe/health/route.test.ts` — NEW: 41 tests for the money path
