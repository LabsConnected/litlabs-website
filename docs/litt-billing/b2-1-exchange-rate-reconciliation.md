# B2.1 — Canonical Exchange-Rate Reconciliation

**Date:** 2026-08-14
**Status:** AUDIT COMPLETE — NO RATE CHOSEN YET

---

## The Discrepancy the User Predicted

> "You might discover the right answer isn't simply 100 or 1000, but instead that one engine was historically expressing retail BITS pricing while another represented provider-cost conversion."

**That is exactly what happened.**

---

## Exchange Rates In Use

| Engine | File | BITS per $ | 1 BIT = | Semantic |
|--------|------|-----------|---------|----------|
| Generation cost engine | `src/lib/generation/cost-engine.ts:19` | 100 | $0.01 (1 cent) | **Retail price** — what users are charged |
| LLM cost engine | `src/lib/llm-cost-engine.ts:279` | 1000 | $0.001 | **Cost-accounting** — internal provider cost conversion |
| Stripe webhook refunds | `src/app/api/stripe/webhook/route.ts:565` | 100 | $0.01 (1 cent) | Matches generation engine |
| Plan grants (implied) | `src/config/plans.ts` | varies | varies | Neither rate |

### The 10× gap

The generation engine charges 100 BITS per dollar of provider cost.
The LLM engine converts at 1000 BITS per dollar of provider cost.

**Same user, same BITS balance, same wallet — but a $1 LLM call costs 1000 BITS while a $1 image generation costs 100 BITS.**

---

## Plan Grant Implied Rates (Neither 100 nor 1000)

| Plan | Price | BITS granted | Implied BITS/$ |
|------|-------|-------------|----------------|
| Starter | $0 (free) | 500 | N/A (free) |
| Creator Beta | $15/mo | 6,000/mo | **400** |
| Pro Builder Beta | $39/mo | 20,000/mo | **513** |
| Founder | $149 one-time | 0 | N/A (permanent access) |

Plan grants don't match either engine rate. They were set independently based on perceived value, not a consistent exchange rate.

---

## Historical Ledger Evidence

From the 10 production `credit_ledger` entries:

| Entry | Amount | Category | Description | Implied rate |
|-------|--------|----------|-------------|--------------|
| Music generation | 30 BITS debit | usage | "Neo-soul R&B..." | Generation engine (retail) |
| Music generation | 8 BITS debit | usage | "Lo-fi boom-bap..." | Generation engine (retail) |
| Music generation | 8 BITS debit | usage | "Neo-soul R&B..." | Generation engine (retail) |
| Music refund | 30 BITS credit | promotion | "ElevenLabs error" | Reversal of above |
| Subscription grant | 500 BITS credit | subscription_grant | "Starter monthly grant" | Plan grant |
| Beta grant | 50 BITS credit | promotion | "Daily bonus" | Promotional |

**All historical charges use the generation engine rate (100 BITS/$ retail).** No LLM-engine charges (1000 BITS/$) appear in the ledger because:
1. `agent-billing.ts` calls `reserve_credits` which doesn't exist → fails closed
2. LLM cost engine computes BITS but the charging path is broken

---

## What Each Rate Actually Means

### Generation engine: 100 BITS/$ = "1 BIT = 1 cent"
This is a **retail pricing** convention. The formula is:
```
retailBits = ceil((providerCostCents + infraAllowanceCents) * (1 + marginPercent/100) / CENTS_PER_BIT)
```
- Provider cost: 8 cents for music
- Infra allowance: 1 cent
- Margin: 50%
- Retail: ceil((8 + 1) * 1.5 / 1) = ceil(13.5) = 14 BITS

But `studio-models.ts` lists `lyria-3-pro-preview` at 8 BITS, which is **below** the formula's output. This means either:
- The studio-models prices are manually set overrides, OR
- The cost-engine formula is not the actual charging path for studio models

### LLM engine: 1000 BITS/$ = "1 BIT = 0.1 cent"
This is a **cost-accounting** convention. The `baseBitsPer1K` values (1-2 BITS per 1K tokens) are retail prices set independently of the provider cost. The 1000 BITS/$ rate is used to convert provider costs into BITS for margin analysis, not for direct charging.

Example: Gemini 2.5 Flash
- Provider cost: $0.075/1M input tokens = $0.000075/1K tokens
- At 1000 BITS/$: 0.075 BITS per 1K tokens (cost)
- Retail: 1 BIT per 1K tokens (`baseBitsPer1K: 1`)
- Effective margin: 1/0.075 = 13.3× (not the configured 50%)

The LLM engine's `baseBitsPer1K` is the **actual retail price**. The 1000 BITS/$ conversion is only used for cost tracking/margin analysis, not for what the user pays.

---

## The Real Picture

| Subsystem | What user pays | How it's computed |
|-----------|---------------|-------------------|
| Music generation | 8-30 BITS per generation | Flat retail price from `studio-models.ts` |
| Image generation | 10-25 BITS per image | Flat retail from `usage-costs.ts` (legacy) |
| Video generation | 79-599 BITS per clip | Tiered retail from `video-tiers.ts` |
| LLM chat | 1-8 BITS per message | Flat retail from `usage-costs.ts` |
| Agent runs | 0-4 BITS per run + 0-2 per 1K tokens | `estimateCredits()` from `agent-registry.ts` |
| Plan grants | 500-20000 BITS | Manually set per plan |

**None of these retail prices are derived from a single exchange rate.** They are all independently set flat rates or tiered prices. The exchange rates (100 and 1000) only appear in cost-tracking/margin-analysis code, not in the actual user-facing pricing.

---

## Decision Required (NOT made in B2)

Before B2 can unify billing under one canonical exchange rate, the following must be decided:

1. **Should BITS be a retail currency or a cost-accounting unit?**
   - If retail: 1 BIT = 1 cent (100 BITS/$) — matches generation engine and Stripe
   - If cost-accounting: 1 BIT = 0.1 cent (1000 BITS/$) — matches LLM engine
   - If hybrid: need two separate units (e.g., "retail BITS" vs "cost microunits")

2. **Should existing retail prices change?**
   - Music at 8 BITS/generation: at 100 BITS/$, that's $0.08 retail for an 8-cent provider cost (0% margin)
   - Music at 8 BITS/generation: at 1000 BITS/$, that's $0.008 retail for an 8-cent provider cost (90% loss)
   - Neither rate makes the current retail prices economically consistent

3. **Should plan grants be repriced?**
   - Creator: 6000 BITS at 100 BITS/$ = $60 value for $15 price (4× value)
   - Creator: 6000 BITS at 1000 BITS/$ = $6 value for $15 price (0.4× value)
   - Pro Builder: 20000 BITS at 100 BITS/$ = $200 value for $39 price (5× value)
   - Pro Builder: 20000 BITS at 1000 BITS/$ = $20 value for $39 price (0.5× value)

4. **What about the LLM `baseBitsPer1K` prices?**
   - At 100 BITS/$: 1 BIT/1K tokens = $0.01/1K = $10/1M tokens (very expensive)
   - At 1000 BITS/$: 1 BIT/1K tokens = $0.001/1K = $1/1M tokens (reasonable for Gemini Flash)
   - The LLM retail prices only make economic sense at 1000 BITS/$

---

## B2 Design Implication

**The reserve/settle/release RPCs should operate in BITS, not in dollars.** They should be exchange-rate-agnostic. The conversion from provider cost to BITS happens in the application layer, before calling `reserve_bits`.

This means B2.2-B2.5 can proceed without choosing the canonical exchange rate. The RPCs will:
- Reserve N BITS
- Settle against M actual BITS (M ≤ N)
- Release (N - M) BITS

The exchange rate decision affects the application code that computes N, not the RPCs themselves.

---

## Recommendation (for user decision, not implementation)

The generation engine rate (100 BITS/$, 1 BIT = 1 cent) is the most consistent with:
- Stripe webhook logic (1 cent = 1 BIT)
- Historical ledger entries
- User-facing pricing intuition

But the LLM retail prices (`baseBitsPer1K`) only make sense at 1000 BITS/$.

**Suggested path:** Adopt 100 BITS/$ as the canonical retail exchange rate, and reprice LLM `baseBitsPer1K` values by dividing by 10. But this is a business decision, not a technical one.

**Do not change any prices or rates in B2.** B2 only builds the reserve/settle/release plumbing. Price reconciliation is a separate workstream.
