# PRODUCT_TRUTH.md

**Effective date:** 2026-08-04
**Document version:** 1.0
**Status:** APPROVED — canonical commercial and public-copy truth

> This document is the single source of truth for product definition, pricing,
> LiTTBits policy, agent model, and public-facing terminology. All UI copy,
> pricing pages, wallet explanations, entitlement labels, metadata, and
> agent-facing product descriptions must derive from this document.
>
> Architecture and operating-model truth lives separately in the Ultra Handbook.
> Older Blueprint v7 and Handbook v2.x documents are archived and superseded.

---

## Brand

- **Name:** LiTTree LabStudios
- **Domain:** litlabs.net
- **Product definition:** LiTTree LabStudios is an AI creative operating system
  and social creator platform where LiTT helps people build apps, create media,
  preserve project context, collaborate and ship real work from Studio.
- **Core promise:** Bring the idea. LiTT helps you build the rest.
- **Primary workspace:** Studio

## Product Hierarchy

1. **AI creative Studio** — the primary workspace
2. **Social creator world** — publishing, discovery, collaboration, creator identity
3. **Marketplace** — optional agents, tools, templates, assets, themes

Studio is the primary workspace. Social features support publishing, discovery,
collaboration and creator identity. Marketplace sells optional products — it
does not redefine the core platform. Do not let social or marketplace wording
make Studio appear to be a separate product.

## Official Personalities

### LiTT

The primary operator and control plane. LiTT owns intent routing,
conversation, project context, research, code, files, terminal, missions,
tools, approvals, testing, deployment, and truthful runtime status.

### Spark

LiTT's creative partner. Spark specializes in creative direction, design,
branding, images, music, video, copy, and exploration. Spark works inside
the same canonical conversation, Project, and Mission. Spark must NOT
independently control terminal, files, Git, missions, or deployment.

**The official user-facing core personality count is two: LiTT and Spark.**

## Specialist Model

### Internal Specialists

Examples: researcher, coder, analyst, writer, marketer, security, tester,
deployment worker.

Rules:
- Delegated by LiTT — not competing permanent primary assistants
- No independent hidden conversation silo
- No separate canonical project truth
- Activity may show delegation, but LiTT remains the primary operator

### Marketplace Agents

Rules:
- Optional user-purchased specialist products
- Private user instances
- May have specialized prompts, tools, and entitlements
- Must not replace the LiTT control plane
- Must not contaminate LiTT or Spark memory
- Must use explicit instance IDs and namespaces
- Marketplace remains part of the product

**Do not advertise "seven built-in AI agents."**

## Plans

### Starter

- **Price:** Free
- **LiTTBits:** 500 once at account creation (not monthly)
- **Projects:** 1 active project
- **No credit card required**

### Creator Beta

- **Price:** $15/month during beta (standard price: $25/month)
- **LiTTBits:** 6,000 after each successful monthly billing event
- **Projects:** 5 active projects

### Pro Builder Beta

- **Price:** $39/month during beta (standard price: $49/month)
- **LiTTBits:** 20,000 after each successful monthly billing event
- **Projects:** 25 active projects

### Founding Member

- **Price:** $149 one-time
- **Access:** Permanent Creator-level feature access
- **No recurring subscription charge**
- **No promised monthly LiTTBit allowance**
- **No unlimited LiTTBits**
- **No six-month limitation**
- **No unapproved credit-pack discount**
- **Checkout disabled until an approved $149 Stripe Price ID is supplied**

## LiTTBits

LiTTBits are internal platform usage credits.
- Never call them coins, cryptocurrency, tokens, or cash.
- They have no value outside LiTTree.

### Credit Policy

| Category | Source | Expiration | Rollover |
|---|---|---|---|
| Starter | 500 once at account creation | Does not expire | N/A (one-time) |
| Monthly subscription | Granted after successful Stripe billing | Valid for current billing period; resets on next grant | Does not roll over |
| Purchased | Bought via approved Stripe products | Does not expire | N/A |
| Promotional / beta | Must define explicit expiration when created | Per grant | N/A |

### Consumption Order

Monthly balances are consumed first, followed by promotional and purchased
credits.

### Monthly Grant Requirements

Monthly LiTTBit grants must originate only from verified successful Stripe
billing events (invoice-based fulfillment). Do not grant subscription LiTTBits
merely because:
- checkout opened
- a subscription object was created
- an environment variable exists
- a client says payment succeeded

### Daily Bonus

The +50 daily LiTTBit reward is **NOT approved** for public production.
- User-facing claims about a daily bonus must be removed.
- The daily claim button must be removed from normal production UI.
- The server behavior must be disabled by default
  (`ENABLE_DAILY_LITTBITS=false`).
- The endpoint must reject daily claims while the feature is disabled.
- Do not delete ledger history from users who previously received grants.
- Do not silently deduct previously granted balances.

### Credit Packs

No public credit-pack catalog is currently approved.
- Remove credit-pack advertising.
- Remove inactive or misleading purchase buttons.
- Do not expose empty, fake, or client-owned product definitions.
- Credit packs may return only after approved pack sizes, prices, Stripe Price
  IDs, server-owned catalog entries, webhook fulfillment, and documented
  purchase/refund policies exist.

## Commercial Wording

- Free to join
- No credit card required to join
- Paid plans are optional upgrades
- Users retain ownership of their work
- Do not promise credit rollover, refresh, expiration, or refunds unless an
  approved policy explicitly defines them (this document is that approval)

## Banned Obsolete Claims

The following must not appear in any user-facing copy, metadata, or
documentation outside of archived files:

- "$49" as a Founder price
- "six months" as a Founder duration
- "Founding Supporter" (use "Founding Member")
- "seven AI agents" or "7 AI agents"
- "coins" or "coin packs" (use "LiTTBits" or "credit packs")
- "AI creative studio" as the sole product definition (use full canonical definition)
- "AI project workspace" as the sole product definition
- "500 monthly LiTTBits" for Starter (it's 500 once)
- "15% off future credit packs" or "20% off credit packs"
- "5,000 bonus LiTTBits" or "6,000 LiTTBits" for Founder
- Claims that LiTTBits are stored in localStorage
- Claims that all AI goes through Google Gemini exclusively
- Claims that conversations are not permanently stored

## Feature Availability States

Features must be labeled accurately:
- **Live** — backend-verified, functioning in production
- **Beta** — functioning but with known limitations
- **Coming Soon** — actively being built, not yet functional
- **Planned** — on the roadmap, not yet started

Never describe simulations or placeholder interfaces as functioning production
capabilities. Never report Connected/Ready/Live/Deployed/Available without
backend verification.
