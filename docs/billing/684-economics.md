# #684 economics comparison

This note compares the Studio build hold, the plan allowances in
`src/config/plan-entitlements.ts`, and model costs from
`src/lib/llm-cost-engine.ts`. It does not change prices, allowances,
balances, or Stripe.

The 100 LiTTBits = $1 LLM rate is **UNAPPROVED** pending owner economics
review (`littbits-exchange-v2-100-unapproved`). The legacy policy
`littbits-exchange-v1` stays identifiable at **1,000 LiTTBits = $1** on
the LLM lane. Generation stays 100 LiTTBits = $1 in both policies.

Retail bits for a paid model, from `calculateLlmCost` (margin target 0.50,
the code default):

```
providerUsd = promptPer1M * promptTokens / 1e6 + completionPer1M * completionTokens / 1e6
retailBits  = max(1, round(providerUsd * bitsPerUsd * 1.50 + baseBitsPer1K * totalTokens / 1000 * 0.1))
```

`bitsPerUsd` is 100 in the unapproved candidate and 1,000 in the legacy
LLM policy. The 1-bit floor applies only to a successful billable call.
Plain Studio chat is free (0 bits) behind the shared limiter.

## Assumptions (labeled)

These are not measured Studio sessions. The repo does not record a
canonical "typical build" token count.

| Assumption | Value | Why |
| --- | --- | --- |
| Chat sample | 1,000 prompt + 500 completion tokens | One short turn. Same order of magnitude as the cost-engine samples. |
| Build step | 2,000 prompt + 800 completion tokens | One agent-loop model call with a modest tool context. |
| Typical build | 8 successful steps | Well under `DEFAULT_LOOP_CONFIG.maxSteps` (50). Not a measured average. |
| Max build | 50 steps | The loop cap. Still an assumption about tokens per step. |
| Hold | 200 bits | `STUDIO_BUILD_RESERVE_BITS`. A build cannot settle more than this. |
| Models | catalog rows, not guessed prices | Groq `openai/gpt-oss-120b` (standard), managed OpenAI `gpt-4o` (premium), Gemini `gemini-2.5-flash` (standard). |
| Margin | 0.50 | `LLM_COST_MARGIN_TARGET` default in `llm-cost-engine.ts`. |

Catalog rates used (USD per 1M tokens, `baseBitsPer1K`):

| Model | Prompt | Completion | baseBitsPer1K |
| --- | --- | --- | --- |
| groq / openai/gpt-oss-120b | $0.59 | $0.79 | 2 |
| openai / gpt-4o (managed) | $2.50 | $10.00 | 5 |
| gemini / gemini-2.5-flash | $0.075 | $0.30 | 1 |

## Hold

200 bits at the unapproved 100/$ rate is **$2.00** of LiTTBits reserved
before a builtin Studio build. At the legacy 1,000/$ LLM rate the same
200 bits are **$0.20**. The hold size was not changed. Settle charges
the accrued bits, capped at 200, and releases the rest. Cancel or abandon
with no completed steps releases all 200. The 1-bit minimum applies only
when the build completes successfully.

## Plan allowances

From `PLAN_ENTITLEMENTS`. Not modified.

| Plan | Price | Bits | Kind |
| --- | --- | --- | --- |
| Starter | $0 | 1,500 | one-time grant, not monthly |
| Creator (`creator_beta`) | $15 / month | 7,500 / month | recurring |
| Pro Builder (`pro_builder_beta`) | $39 / month | 18,000 / month | recurring |
| Founder | not purchasable | 7,500 | retired, Creator-equivalent access |
| Owner | not purchasable | 0 | billing exempt |

"~5x" at the unapproved 100 bits/$ rate means allowance bits divided by
`monthlyPriceDollars * 100`:

- Creator: 7,500 / (15 * 100) = **5.0x** the $15 price.
- Pro: 18,000 / (39 * 100) = **4.62x** the $39 price.
- Starter has no monthly price. 1,500 bits is the one-time grant.
- At the legacy 1,000 bits/$ rate the same allowances are one tenth of
  that face value: Creator 7,500 bits = $7.50 face on a $15 plan (0.5x),
  Pro 18,000 bits = $18 face on a $39 plan (0.46x).

The ~5x figure is preserved on purpose and is not an approval of the
100/$ rate.

## Purchasing power

Unapproved 100 bits = $1. Legacy LLM 1,000 bits = $1. A max-cost build
spends the whole 200-bit hold.

| Plan | Bits | Face at 100/$ | Face at 1,000/$ | Full 200-bit holds | 1-bit chats |
| --- | --- | --- | --- | --- | --- |
| Starter | 1,500 | $15.00 | $1.50 | 7 (100 bits left) | 1,500 |
| Creator | 7,500 | $75.00 | $7.50 | 37 (100 bits left) | 7,500 |
| Pro | 18,000 | $180.00 | $18.00 | 90 | 18,000 |
| Founder | 7,500 | $75.00 | $7.50 | 37 (100 bits left) | 7,500 |

37 Creator holds is 37 * 200 = 7,400 bits. The comment in
`studio-billing.ts` matches that. Free chat does not spend these bits.

## Expected model cost

Computed with the formula above. Figures below were checked against
`calculateLlmCost` for the 100/$ column.

### One chat (1,000 + 500 tokens)

| Model | Provider USD | Bits at 100/$ | Bits at 1,000/$ |
| --- | --- | --- | --- |
| Groq gpt-oss-120b | $0.000985 | 1 | 2 |
| Gemini 2.5 Flash | $0.000225 | 1 | 1 |
| Managed gpt-4o | $0.0075 | 2 | 12 |

### One build step (2,000 + 800 tokens)

| Model | Provider USD | Bits at 100/$ | Bits at 1,000/$ |
| --- | --- | --- | --- |
| Groq gpt-oss-120b | $0.001812 | 1 | 3 |
| Gemini 2.5 Flash | $0.000390 | 1 | 1 |
| Managed gpt-4o | $0.013 | 3 | 21 |

### A build, and the 200-bit cap

| Build | Groq bits at 100/$ | gpt-4o bits at 100/$ | Versus the 200 hold |
| --- | --- | --- | --- |
| 8 steps (assumption) | 8 ($0.08) | 24 ($0.24) | Both under the hold. The other 192 or 176 bits are released on settle. |
| 50 steps (loop cap, same token assumption) | 50 ($0.50) | 150 ($1.50) | Both still under 200. A more expensive step size would hit the cap and the overflow would be logged, not charged past 200. |

At the legacy 1,000/$ rate the same gpt-4o step is 21 bits, so 8 steps
are 168 bits and 10 steps would meet the 200-bit hold. The hold is much
tighter if bits are worth 10x less in dollars of model.

Provider cost for an 8-step Groq build is about 8 * $0.001812 = $0.0145.
Customer retail at the unapproved rate is 8 bits = $0.08. That margin is
the 1.50 multiplier plus the `baseBitsPer1K * 0.1` term and the 1-bit
floor, not a measured contribution margin.

## What this does not decide

- It does not approve 100 LiTTBits = $1.
- It does not change Creator 7,500, Pro 18,000, or Starter 1,500.
- It does not schedule the expired-reservation sweep or apply its migration.
- A real session can use more tokens than the assumed step, mix models, or
  stop early. The 200-bit hold is the cap either way.
