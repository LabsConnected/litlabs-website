# Stripe Catalog Wiring

> Verified Stripe catalog state and required wiring actions.
> Do NOT commit live Price IDs to source control.

## Verified Stripe Products (as of 2026-11-12)

The three canonical plan prices below are the only active plan prices in
Stripe (account: Litreelabstudio, live mode), per the owner's rewiring
authorization on 2026-11-12 (issue #419). Do NOT create new Stripe products
or prices for these — use exactly these IDs.

### Plan Products

| Plan | Stripe Price | Mode | Env Variable |
|---|---|---|---|
| Creator Lite Beta | $9.99/month | recurring | `STRIPE_PRICE_CREATOR_LITE` |
| Creator Beta | $19.99/month | recurring | `STRIPE_PRICE_CREATOR_BETA` |
| Pro Builder Beta | $39.99/month | recurring | `STRIPE_PRICE_PRO_BUILDER_BETA` |

Creator Lite Beta was already its product's default price. Creator Beta and
Pro Builder Beta were each set as their product's default price on
2026-11-12 — Pro Builder Beta's $39.99 price is a **new** Price object
(Stripe does not allow mutating an existing Price's amount), created and set
as default that day.

### Retired in Stripe (active=false)

These no longer accept new purchases. Do NOT reference them in code,
pricing, checkout, SEO, or documentation, and do NOT cancel existing
customers on them automatically:

- **Founding Member — $149.00 one-time.** The Founding Member product is
  also deactivated. The owner confirmed on 2026-11-12 this tier was never
  supposed to exist. `STRIPE_PRICE_FOUNDER` has been **removed entirely**
  from the Railway production environment (not just blanked). The
  `PLANS.founder` definition stays in `src/config/plans.ts` only because it
  is load-bearing for people who already hold founder-plan entitlements —
  it has no `stripePriceIdEnv`, so nothing can resolve a new checkout
  against it.
- Old $39.00/mo Pro, old $15.00/mo Creator, duplicate $9.99 / $19.99 / $39.00
  prices on the retired membership products, and the $5.00/mo Starter.
- The $19/mo and $7/mo prices from the original issue #419 report were
  already archived before this rewiring and remain archived.

### Legacy Membership Products (archived)

These are legacy offers and no longer accept new purchases:

- LiTTree-LabStudios Basic Membership — $9.99/month
- LiTTree-LabStudios Elite Membership — $39/month
- LiTTree-LabStudios Starter Membership — $5/month
- LiTTree-LabStudios Pro Membership — $19.99/month

### Premium Marketplace Agents

Separate one-time products, not subscription plans — left active on purpose
and untouched by this rewiring:

| Agent | Stripe Price | DB Price | Status |
|---|---|---|---|
| LiTT Coder Pro | $29.00 | $29.00 (2,900 cents) | Matches |
| LiTT Social | $15.00 | $15.00 (1,500 cents) | Matches |
| LiTT Growth | $20.00 | $19.00 (1,900 cents) | **MISMATCH — separate, unresolved issue** |

Also left active on purpose: the $5 one-time LiTTBits pack.

### LiTT Growth Price Mismatch — Critical, NOT fixed by this rewiring

The Stripe LiTT Growth product has a $20 Price, but the database published
agent version is 1,900 cents ($19). The marketplace purchase architecture
verifies Stripe's paid amount against the immutable version price, so this
discrepancy will reject fulfillment. This is tracked separately from issue
#419's plan-catalog rewiring and must not be folded into it.

**Required owner-side Stripe action:**

1. Open the existing LiTT Growth product in Stripe.
2. Create a new $19 one-time Price under that same product.
3. Make the $19 Price the intended/default price.
4. Archive the incorrect $20 Price.
5. Attach the new $19 `price_...` ID to `litt-growth` in Supabase.

Stripe does not allow changing an existing Price amount. You must create a
new Price, switch the integration to its ID, then deactivate the old Price.

## Required Railway Environment Variables

This app deploys on **Railway**, not Vercel — set these on the
`@litlabs/litt-shell` service's **production** environment:

```env
STRIPE_PRICE_CREATOR_LITE=price_...
STRIPE_PRICE_CREATOR_BETA=price_...
STRIPE_PRICE_PRO_BUILDER_BETA=price_...
```

`STRIPE_PRICE_FOUNDER` must NOT be set — it has been removed entirely as of
2026-11-12.

**Important:**
- Use Price IDs (`price_...`), NOT Product IDs (`prod_...`).
- Test mode and live mode use different Price IDs.
- Never mix test Price IDs with a live secret key or vice versa.
- Do NOT commit actual live Price IDs to source control.

## Where checkout sessions are actually created

A prior pass of this doc (and issue #419) noted no literal
`checkout.sessions.create` call exists in `src/`. That's because the real
checkout path, `src/app/api/billing/checkout/route.ts`, calls the Stripe
REST API directly via `fetch("https://api.stripe.com/v1/checkout/sessions", ...)`
rather than the SDK method of that name. This is the **only** in-app path
that creates a plan checkout session:

1. It resolves the Stripe Price ID from the plan's `stripePriceIdEnv`
   (`getStripePriceId()` in `src/config/plans.ts`), never a hardcoded ID.
2. Before creating a session, it fetches the live Stripe Price object and
   verifies its `unit_amount`/interval actually matches
   `plan.monthlyPriceCents` — if the env var points at a stale or
   misconfigured price, checkout fails closed with a 502 rather than
   billing the wrong amount. This is why `src/config/plans.ts` and
   `src/config/plan-entitlements.ts` must stay numerically in sync with
   whatever price the env var actually points at.
3. The Founding Member path is additionally blocked by the `founderCheckout`
   feature flag (disabled) and by `plan.enabled === false`.

No hardcoded Stripe Payment Link URLs were found for plan checkout in
`src/`. (`src/config/service-offers.ts` references Payment Link env vars for
an unrelated one-off agency-services product line — not a plan or a
marketplace agent — and was not touched by this rewiring.) The n8n workflow
`n8n/workflows/05-stripe-entitlement.json` listens for signed Stripe webhook
events but contains no hardcoded price or plan IDs, so it required no
change here.

## Required Supabase Agent Price Attachments

Attach the premium agent Price IDs using the environment-specific SQL script
or a controlled admin process. Do NOT commit live IDs inside a migration.

```text
litt-growth     → new $19 price_... (after owner creates it — separate fix)
litt-social     → $15 price_...
litt-coder-pro  → $29 price_...
```

## Stripe Tax Configuration

### Current State

- Products use tax category: "General — Electronically Supplied Services"
- Checkout routes set `automatic_tax[enabled]` based on `STRIPE_AUTOMATIC_TAX_ENABLED`
- The flag defaults to `false` — tax is NOT currently calculated

### Before Enabling Automatic Tax

1. Configure Stripe Tax business details
2. Add actual tax registrations
3. Confirm product tax codes (SaaS may be more accurate than general electronic services)
4. Choose inclusive or exclusive tax behavior
5. Configure address-collection behavior
6. Test customer addresses in multiple jurisdictions
7. Set `STRIPE_AUTOMATIC_TAX_ENABLED=true` on Railway

### Tax Code Review

The current "General — Electronically Supplied Services" category is a
reasonable fallback for internet-delivered digital services. However, Stripe
offers more specific SaaS and PaaS classifications. Because LiTTree serves
both individuals and businesses, confirm the classification with a qualified
tax professional before treating it as final.

## Founder Checkout — permanently retired, not a re-enablement candidate

Unlike the rest of this doc, this section is historical only. The Founding
Member tier was never supposed to exist (owner-confirmed 2026-11-12) and is
not expected to be re-offered. If that ever changes, treat it as a new
product decision requiring fresh owner sign-off, not a flag flip — the gates
below described what a re-enablement would have needed:

1. `STRIPE_PRICE_FOUNDER` configured with a verified live Price ID
2. Test-mode checkout successfully charges the advertised amount
3. The webhook creates permanent Founder access (no subscription, no expiration)
4. No recurring LiTTBit grant is created
5. No six-month expiration is written
6. Duplicate checkout cannot create duplicate Founder access
7. Refund handling revokes the entitlement (status: "refunded")
8. `PLANS.founder.enabled` is set to `true` in `src/config/plans.ts`

## Premium Agent Purchase Enablement Gates

The `individualAgentPurchases` and `marketplaceAgentInstall` flags must remain
disabled until ALL of the following pass:

1. All three Price IDs are attached to `agent_versions` in Supabase
2. Amount verification passes (Stripe paid amount === DB version price)
3. Checkout metadata passes (agent_id, agent_version_id, marketplace_order_id)
4. Webhook fulfillment creates entitlement + private user-agent instance
5. Duplicate purchase prevention passes
6. Refund revocation passes
7. Studio opens the purchased private instance correctly
8. Agent memory remains isolated by instance namespace

## Required Payment Tests (Stripe Test Mode)

### Creator Lite Beta
- Checkout charges $9.99/month
- Subscription row becomes active
- `invoice.paid` grants the configured monthly LiTTBits
- Replaying the webhook does not grant twice

### Creator Beta
- Checkout charges $19.99/month
- Subscription row becomes active
- `invoice.paid` grants exactly 7,500 LiTTBits
- Replaying the webhook does not grant twice
- Cancellation removes future plan access at the correct time
- Failed payment marks access past due

### Pro Builder Beta
- Checkout charges $39.99/month
- Exactly 18,000 LiTTBits granted on successful billing
- Pro entitlement and 25-project limit apply
- Terminal entitlement does not claim connected unless a real PTY session exists

### Premium Agents
- Paid amount equals `agent_versions.price_cents`
- Stripe Price ID exists
- Fulfillment creates entitlement and private user-agent instance
- Duplicate ownership is blocked
- Refund revokes the entitlement
- Failed and expired sessions create no entitlement
- Agent memory remains isolated by instance namespace

## Production Verification (post-deploy)

Not yet performed as of this rewiring (PR open, not merged/deployed). Once
merged and live, verification requires:

1. `/api/health` on production resolves to the merged commit.
2. A real Stripe checkout session for at least one canonical plan price ID
   completes successfully end-to-end (session created, payment captured in
   test or live mode as appropriate, webhook grants the entitlement).
3. No code path can still resolve a checkout against an archived price ID.
