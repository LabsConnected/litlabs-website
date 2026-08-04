# Premium Agents Integration Test Plan

> This document describes the real integration tests that must be run
> against an isolated Supabase database (local or preview) to verify the
> full Stripe ΓåÆ webhook ΓåÆ Postgres ΓåÆ entitlement lifecycle.
>
> The unit tests in `tests/premium-agents.unit.test.ts` mock Supabase,
> Stripe, auth, and RPC results. They verify route-level security
> properties but are NOT end-to-end verification.
>
> **These integration tests require:**
> - A dedicated Supabase project (not production)
> - The migration `20260728140000_premium_agents_v1.sql` applied
> - Stripe test mode (test API keys, test webhook endpoint)
> - A test Clerk user with a known `clerk_id`
>
> ## Test Scenarios
>
> 1. **Checkout creates pending order**
>    - POST to checkout route with valid agent ID
>    - Verify `marketplace_orders` has a row with status `pending`
>    - Verify `stripe_checkout_session_id` is set after Stripe response
>
> 2. **Completed Stripe checkout creates one paid order**
>    - Send `checkout.session.completed` webhook fixture
>    - Verify `marketplace_orders.status` = `paid`
>    - Verify `marketplace_order_items` has exactly one row
>    - Verify `agent_entitlements` has exactly one row with status `active`
>
> 3. **Duplicate webhook creates no duplicate order item**
>    - Send the same `checkout.session.completed` event twice
>    - Verify `marketplace_order_items` still has exactly one row
>    - Verify `stripe_events` has exactly one row
>
> 4. **Duplicate webhook creates no duplicate entitlement**
>    - Send the same event twice
>    - Verify `agent_entitlements` still has exactly one row
>
> 5. **Wrong amount fails fulfillment**
>    - Send webhook with `amount_total` that doesn't match `price_cents`
>    - Verify the RPC raises an exception
>    - Verify the webhook returns HTTP 500 (Stripe will retry)
>    - Verify no entitlement was created
>
> 6. **Wrong currency fails fulfillment**
>    - Send webhook with `currency` = `eur` when version is `usd`
>    - Verify the RPC raises an exception
>    - Verify the webhook returns HTTP 500
>
> 7. **Unknown user returns webhook 500**
>    - Send webhook with a `clerk_id` that doesn't exist in `users`
>    - Verify the RPC raises `user_not_found`
>    - Verify the webhook returns HTTP 500
>
> 8. **Agent refund does not debit LBC**
>    - Send `charge.refunded` with `product_type=agent` metadata
>    - Verify `marketplace_orders.status` = `refunded`
>    - Verify `agent_entitlements.status` = `refunded`
>    - Verify `credit_ledger` has NO new debit entry for this user
>
> 9. **Refund revokes entitlement**
>    - After refund, verify the entitlement status is `refunded`
>    - Verify `revoked_reason` = `charge.refunded`
>    - Verify `revoked_at` is set
>
> 10. **Duplicate refund remains idempotent**
>     - Send the same `charge.refunded` event twice
>     - Verify `stripe_events` has exactly one row
>     - Verify the second webhook returns 200 with `already_processed`
>
> 11. **Suspended version cannot be purchased**
>     - Set an agent_version status to `suspended`
>     - POST to checkout route
>     - Verify 404 response (no published version found)
>
> 12. **Published version cannot be mutated**
>     - Attempt to UPDATE `system_prompt` on a published version
>     - Verify the trigger raises an exception
>     - Attempt to DELETE a published version
>     - Verify the trigger raises an exception
>
> 13. **Invalid Checkout redirect URL is rejected**
>     - Mock Stripe returning a URL that doesn't start with
>       `https://checkout.stripe.com/`
>     - Verify the checkout route returns 502
>
> 14. **Partial refund behavior is explicit**
>     - Send `charge.refunded` with `amount_refunded < amount`
>     - Document the current behavior: the order is marked `refunded`
>       (not `partially_refunded`) ΓÇö this is a known limitation
>     - Future work: detect partial refunds and set `partially_refunded`
>
> 15. **Concurrent duplicate webhook deliveries remain safe**
>     - Send two `checkout.session.completed` events with the same
>       `event.id` simultaneously
>     - Verify only one order item and one entitlement are created
>     - Verify `stripe_events` has exactly one row (atomic INSERT wins)
>
> ## Running Integration Tests
>
> These tests cannot run in the Vitest jsdom environment. They require:
>
> ```bash
> # 1. Start local Supabase
> supabase start
>
> # 2. Apply the migration
> supabase db reset
>
> # 3. Run integration tests (future: tests/premium-agents.integration.test.ts)
> # These will use the real Supabase instance and Stripe test mode
> ```
>
> Until the integration test harness is built, these scenarios serve as
> the manual verification checklist for code review and staging deployment.
