# Supabase + Stripe checklist for LiTTBits billing

This is the production handoff checklist for LiTTree-LabStudios. The
`credit_ledger` is the source of truth. `wallets.balance` and `transactions`
remain compatibility tables only and must not be used for new billing logic.

## 1. Apply migrations in order

Confirm these migrations exist in `supabase_migrations.schema_migrations`:

1. `20260711000000_foundation_users_and_installed_agents.sql`
2. `20260714010000_atomic_wallet_adjustments.sql`
3. `20260725000000_credit_ledger_beta_pricing.sql`
4. `20260726193000_unify_litbits_ledger.sql`

Run migrations through the Supabase CLI or your normal deployment pipeline.
Do not paste only fragments of the functions into production.

## 2. Required tables

- `users`: one row per Clerk user; `clerk_id` must be unique.
- `subscriptions`: one row per user; `user_id` must be unique.
- `credit_ledger`: append-only grants and debits.
- `stripe_events`: processed Stripe event IDs.
- `wallets`: legacy compatibility and one-time migration source.
- `transactions`: legacy audit compatibility only.

Recommended constraints:

```sql
create unique index if not exists users_clerk_id_unique
  on public.users(clerk_id);

create unique index if not exists subscriptions_user_id_unique
  on public.subscriptions(user_id);

create unique index if not exists subscriptions_stripe_subscription_id_unique
  on public.subscriptions(stripe_subscription_id)
  where stripe_subscription_id is not null;
```

## 3. Security requirements

- Enable RLS on `credit_ledger` and `stripe_events`.
- Deny direct `anon` and `authenticated` inserts, updates, and deletes.
- Grant `get_user_balances`, `grant_credits`, and `debit_credits` only to
  `service_role`.
- Never expose `SUPABASE_SERVICE_ROLE_KEY` to the browser.
- All balance mutations require server-generated idempotency keys.
- Never update or delete ledger rows to “fix” a balance. Add an adjustment row.

## 4. Required Vercel environment variables

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_CREATOR_BETA
STRIPE_PRICE_PRO_BUILDER_BETA
STRIPE_PRICE_FOUNDER
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY
CLERK_SECRET_KEY
```

Use separate Stripe price IDs and webhook secrets for preview and production.

## 5. Stripe products and prices

Create exactly these server-side price mappings:

| Plan | Stripe mode | Beta price | LiTTBits |
|---|---|---:|---:|
| Starter | no checkout | Free | 500 once at account creation |
| Creator Beta | recurring monthly | $7 | 6,000 per paid period |
| Pro Builder Beta | recurring monthly | $19 | 20,000 per paid period |
| Founding Member | one-time payment | $149 | No recurring allowance |

The Founding Member product grants permanent Creator-level entitlements, but
does not create an impossible monthly Stripe renewal promise.

## 6. Stripe webhook

Production endpoint:

```text
https://litlabs.net/api/stripe/webhook
```

Subscribe to:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`
- `invoice.paid`
- `invoice.payment_failed`
- `charge.refunded`

Monthly credits are granted only from `invoice.paid`. Do not also grant on
`customer.subscription.created`, or the first month will be doubled.

## 7. Balance behavior

Spend order:

1. Monthly plan credits
2. Beta/promotional credits
3. Purchased credits

Rules:

- Monthly grants are valid for the current billing period and reset on the next successful grant. They do not roll over.
- Starter grants do not expire.
- Promotional expiration must be defined explicitly per grant and shown before it is enabled.
- Purchased credits do not expire.
- A failed debit must not create any ledger rows.
- Replaying the same idempotency key must never charge twice.
- Existing `wallets.balance` values migrate once using
  `legacy-wallet:<user_uuid>`.

## 8. Verification queries

Check duplicate Clerk users:

```sql
select clerk_id, count(*)
from public.users
group by clerk_id
having count(*) > 1;
```

Check duplicate subscriptions:

```sql
select user_id, count(*)
from public.subscriptions
group by user_id
having count(*) > 1;
```

Check invalid or negative bucket totals:

```sql
select u.id, u.clerk_id, b.*
from public.users u
cross join lateral public.get_user_balances(u.id) b
where b.monthly < 0
   or b.purchased < 0
   or b.beta_promotional < 0
   or b.total < 0;
```

Check Stripe events that reported errors:

```sql
select *
from public.stripe_events
where result <> 'processed'
order by processed_at desc;
```

Review a user's ledger:

```sql
select
  created_at, direction, amount, category, balance_bucket,
  description, idempotency_key, expires_at
from public.credit_ledger
where user_id = '<USER_UUID>'
order by created_at desc;
```

## 9. Recommended cost catalog

Do not scatter prices through React components. Add one server-owned catalog
and return estimates to the client.

Suggested beta starting points:

| Action | Suggested LiTTBits |
|---|---:|
| Standard chat turn | 1–3 |
| Premium-model chat turn | 5–15 |
| Code generation/change | 5–25 |
| Image generation | 40–120 |
| Audio generation/minute | 30–80 |
| Voice conversation/minute | 15–40 |
| Video generation | 300–1,500 |
| Terminal runtime/minute | 2–5 |
| Deployment | 25–100 |

Provider cost, model, duration, resolution, and output count should determine
the final charge. Roll out in shadow mode first: calculate and log the charge
without debiting, compare it with provider invoices, then enable enforcement.

## 10. Release test matrix

Before enabling paid checkout:

- New Starter user receives 500 exactly once for the current month.
- Refreshing `/api/wallet` does not grant again.
- Creator checkout creates the correct subscription plan.
- First paid invoice grants 6,000 exactly once.
- Pro renewal grants 20,000 exactly once with the correct expiration.
- Replaying a webhook produces no extra credits.
- Spending across monthly, promotional, and purchased buckets is atomic.
- Insufficient balance creates no debit rows.
- Founder checkout grants permanent founder entitlements (no LiTTBit allowance).
- Cancellation retains access until `current_period_end`.
- Failed payment changes status without granting credits.
- The UI total equals `get_user_balances(...).total`.
