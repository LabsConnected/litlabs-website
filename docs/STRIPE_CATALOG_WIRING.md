# Stripe Catalog Wiring

> Verified Stripe catalog state and required wiring actions.
> Do NOT commit live Price IDs to source control.

## Verified Stripe Products (as of 2026-08-04)

The three official plan products already exist in Stripe at the correct prices.
Do NOT create new Stripe products for these.

### Plan Products

| Plan | Stripe Price | Mode | Env Variable |
|---|---|---|---|
| Creator Beta | $7.00/month | recurring | `STRIPE_PRICE_CREATOR_BETA` |
| Pro Builder Beta | $19.00/month | recurring | `STRIPE_PRICE_PRO_BUILDER_BETA` |
| Founding Member | $149.00 one-time | one_time | `STRIPE_PRICE_FOUNDER` |

### Premium Marketplace Agents

| Agent | Stripe Price | DB Price | Status |
|---|---|---|---|
| LiTT Coder Pro | $29.00 | $29.00 (2,900 cents) | Matches |
| LiTT Social | $15.00 | $15.00 (1,500 cents) | Matches |
| LiTT Growth | $20.00 | $19.00 (1,900 cents) | **MISMATCH** |

### LiTT Growth Price Mismatch — Critical

The Stripe LiTT Growth product has a $20 Price, but the database published
agent version is 1,900 cents ($19). The marketplace purchase architecture
verifies Stripe's paid amount against the immutable version price, so this
discrepancy will reject fulfillment.

**Required owner-side Stripe action:**

1. Open the existing LiTT Growth product in Stripe.
2. Create a new $19 one-time Price under that same product.
3. Make the $19 Price the intended/default price.
4. Archive the incorrect $20 Price.
5. Attach the new $19 `price_...` ID to `litt-growth` in Supabase.

Stripe does not allow changing an existing Price amount. You must create a
new Price, switch the integration to its ID, then deactivate the old Price.

### Legacy Membership Products (to archive)

These are legacy offers and should no longer accept new purchases:

- LiTTree-LabStudios Basic Membership — $9.99/month
- LiTTree-LabStudios Elite Membership — $39/month
- LiTTree-LabStudios Starter Membership — $5/month
- LiTTree-LabStudios Pro Membership — $19.99/month

## Required Vercel Environment Variables

Set these in both Production and Preview environments:

```env
STRIPE_PRICE_CREATOR_BETA=price_...
STRIPE_PRICE_PRO_BUILDER_BETA=price_...
STRIPE_PRICE_FOUNDER=price_...
```

**Important:**
- Use Price IDs (`price_...`), NOT Product IDs (`prod_...`).
- Test mode and live mode use different Price IDs.
- Never mix test Price IDs with a live secret key or vice versa.
- Do NOT commit actual live Price IDs to source control.

## Required Supabase Agent Price Attachments

Attach the premium agent Price IDs using the environment-specific SQL script
or a controlled admin process. Do NOT commit live IDs inside a migration.

```text
litt-growth     → new $19 price_... (after owner creates it)
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
7. Set `STRIPE_AUTOMATIC_TAX_ENABLED=true` in Vercel

### Tax Code Review

The current "General — Electronically Supplied Services" category is a
reasonable fallback for internet-delivered digital services. However, Stripe
offers more specific SaaS and PaaS classifications. Because LiTTree serves
both individuals and businesses, confirm the classification with a qualified
tax professional before treating it as final.

## Founder Checkout Enablement Gates

Founder checkout can be enabled only after ALL of the following pass:

1. `STRIPE_PRICE_FOUNDER` is configured with the verified $149 Price ID
2. Test-mode checkout successfully charges $149
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

### Creator Beta
- Checkout charges $7/month
- Subscription row becomes active
- `invoice.paid` grants exactly 6,000 LiTTBits
- Replaying the webhook does not grant twice
- Cancellation removes future plan access at the correct time
- Failed payment marks access past due

### Pro Builder Beta
- Checkout charges $19/month
- Exactly 20,000 LiTTBits granted on successful billing
- Pro entitlement and 25-project limit apply
- Terminal entitlement does not claim connected unless a real PTY session exists

### Founding Member
- Checkout charges exactly $149 once
- No Stripe recurring subscription is created (mode=one_time)
- Permanent Founder entitlement record stored in subscriptions table
- No six-month expiration is written
- No recurring LiTTBits are granted (monthlyCredits = 0)
- Duplicate checkout cannot create duplicate Founder access
- Refund handling revokes or flags the entitlement

### Premium Agents
- Paid amount equals `agent_versions.price_cents`
- Stripe Price ID exists
- Fulfillment creates entitlement and private user-agent instance
- Duplicate ownership is blocked
- Refund revokes the entitlement
- Failed and expired sessions create no entitlement
- Agent memory remains isolated by instance namespace
