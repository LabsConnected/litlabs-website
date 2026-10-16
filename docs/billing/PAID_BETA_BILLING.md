# Paid beta billing

This note is the contract for the Stripe reliability work. It does not change
the LiTTBit economy. Generation retail stays at 1 LiTTBit per retail cent
(`CENTS_PER_BIT = 1` in `src/lib/generation/cost-engine.ts`). Plan allowances
stay Starter 1,500 one-time, Creator 7,500 per cycle, Pro 18,000 per cycle.

## Subscription entitlement

`src/lib/billing/subscription-entitlement.ts` is the only status policy.

| Status | Paid features, media caps, provider spend, wallet "has a plan" | New Checkout |
| --- | --- | --- |
| active | entitled | blocked |
| trialing | entitled | blocked |
| past_due | not entitled | blocked |
| unpaid, paused, incomplete, refunded, disputed | not entitled | blocked |
| canceled, incomplete_expired | not entitled | allowed |

`past_due` keeps the subscription row and the existing wallet balance. It does
not unlock paid features or plan media caps, and it does not rescale credits.
`trialing` uses the plan on the row.

## Webhook claims

`claim_stripe_event`, `finalize_stripe_event`, and `release_stripe_event`
(`20261015240000`) carry a claim token. Takeover of a stale `processing` row
updates that token under `FOR UPDATE`. Finalize and release match the token.
A second stale retry cannot delete the winner's row.

A subscription event whose id is not the stored protected subscription is
finalized as `superseded_subscription` and acknowledged with HTTP 200. A
conflict that cannot be recorded still returns HTTP 500.

## Disputes and subscription refunds

`charge.refunded` on a subscription invoice reads the invoice, then the
subscription metadata, when the charge itself has no `plan_id`. The handler
sets the subscription to `refunded` and debits the prorated monthly grant.
Founder refunds revoke access and do not debit LiTTBits.

`charge.dispute.created` and `charge.dispute.funds_withdrawn` set a matched
subscription to `disputed` (not entitled, checkout blocked).
`charge.dispute.closed` with status `won` or `warning_closed`, and
`charge.dispute.funds_reinstated`, restore `active` only from `disputed`.
Dispute events do not grant or debit LiTTBits. Each one inserts
`billing_alerts` and logs `[stripe][alert]` for the log drain.
`charge.dispute.updated` and a lost dispute are alert-only; a lost dispute's
credits move on `charge.refunded`.

## Stripe API version and events

The webhook constructs the Stripe SDK with API version `2025-08-27.basil`
(`src/app/api/stripe/webhook/route.ts`). That pin is for outgoing API calls
from this process. A read-only test-mode check found staging and preview
webhook endpoints on `2026-02-25.clover`. This repository does not change
Stripe endpoint settings or the SDK pin.

Price ids come from environment variables, not from lookup keys:

- Creator Beta: `STRIPE_PRICE_CREATOR_BETA` (`src/config/plans.ts`)
- Pro Builder Beta: `STRIPE_PRICE_PRO_BUILDER_BETA`
- Founder is not sold (`enabled: false`, no `stripePriceIdEnv`)

Test mode has duplicate active plan prices and no lookup keys. Leave that
until an owner chooses which price id each env var should hold. Do not create
prices from this change.

### Required webhook events

Subscribe every paid-beta endpoint, including litlabs.net test, to:

1. `checkout.session.completed`
2. `checkout.session.expired`
3. `payment_intent.payment_failed`
4. `payment_intent.succeeded`
5. `customer.subscription.created`
6. `customer.subscription.updated`
7. `customer.subscription.deleted`
8. `invoice.paid`
9. `invoice.payment_failed`
10. `charge.refunded`
11. `charge.dispute.created`
12. `charge.dispute.updated`
13. `charge.dispute.closed`
14. `charge.dispute.funds_withdrawn`
15. `charge.dispute.funds_reinstated`

`invoice.payment_succeeded` is not handled. The litlabs.net test endpoint was
observed subscribed to that event and missing `invoice.paid`,
`invoice.payment_failed`, `checkout.session.expired`, `charge.refunded`, and
`payment_intent.*`. Staging and preview test endpoints were observed on the
original ten handled events. Add the five dispute events there too. This
change does not call Stripe to edit endpoints.

## Migration order

Apply before the application code that calls the new functions. Do not apply
these from automation against a hosted database. Preflight is
`scripts/billing-migration-precheck.sql` (read-only).

1. `20261014000000_subscriptions_stripe_subscription_id_unique.sql`
2. `20261015000000_subscriptions_cancel_at_period_end.sql`
3. `20261015120000_media_cap_holds.sql`
4. `20261015140000_subscriptions_last_stripe_event_created.sql`
5. `20261015160000_checkout_reservations.sql`
6. `20261015170000_billing_subscription_conflicts.sql`
7. `20261015180000_media_cap_hold_expiry.sql`
8. `20261015200000_apply_subscription_event.sql`
9. `20261015210000_checkout_session_lease.sql`
10. `20261015220000_schedule_media_cap_sweep.sql`
11. `20261015230000_checkout_block_protected_subscription.sql`
12. `20261015240000_stripe_event_claim_token.sql`

The nine `20261015*` files through `20261015220000` are unchanged. 11 and 12
are additive.

### Rollback

Reverse order, after the application code that calls the dropped objects is
reverted. Do not drop `current_period_end` (it predates step 2).

12. Drop `release_stripe_event`, `finalize_stripe_event`, `claim_stripe_event`; drop `stripe_events.claim_token`; drop `billing_alerts`.
11. Restore `begin_checkout_reservation` from `20261015210000_checkout_session_lease.sql`.
10. Unschedule `sweep-expired-media-cap-holds` when `pg_cron` is installed.
9. Drop `release_checkout_reservation` and `restore_open_checkout_reservation`; restore `begin_checkout_reservation` from `20261015160000`.
8. Drop `apply_subscription_event` and index `subscriptions_one_protected_per_user`.
7. Drop `sweep_expired_media_cap_holds` and `settle_media_cap_hold`; drop `media_cap_holds.settled_at`; restore `claim_media_cap_slot` from `20261015120000`.
6. Drop `billing_subscription_conflicts`.
5. Drop checkout reservation functions and `checkout_reservations`.
4. Drop `subscriptions.last_stripe_event_created`.
3. Drop media-cap functions and `media_cap_holds`.
2. Drop `subscriptions.cancel_at_period_end` only.
1. Drop index `subscriptions_stripe_subscription_id_uidx`.

Steps 5 and 9 both own `begin_checkout_reservation`. Roll back 11 first, then
9, then 5, or the earlier function body is dropped while a later one still
replaces it.
