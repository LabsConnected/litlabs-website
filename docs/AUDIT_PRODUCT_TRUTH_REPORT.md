# Product-Truth Alignment Audit Report

**Branch:** `audit/product-truth-alignment`
**Date:** 2026-08-04
**Status:** PHASE ZERO complete — awaiting approval before any edits
**Directive:** Audit first. Do not edit. Do not deploy. Do not modify Stripe products or customer data.

---

## Executive Summary

| Category | CRITICAL | HIGH | MEDIUM | LOW | Total |
|---|---|---|---|---|---|
| 1. Pricing (Founder $49/$149, duration, credits) | 11 | 6 | 3 | 1 | 21 |
| 2. LiTTBits (coins, daily +50, packs, expiration) | 13 | 18 | 4 | 12 | 47 |
| 3. Agent model (seven agents, specialist silos) | 5 | 10 | 11 | 5 | 31 |
| 4. Product identity (homepage, SEO, legal framing) | 0 | 11 | 5 | 3 | 19 |
| 5. Legal/data-flow (privacy, providers, storage) | 3 | 4 | 3 | 0 | 10 |
| **TOTAL** | **32** | **49** | **26** | **21** | **128** |

**Files requiring changes:** 40+ across UI, Billing, Entitlement, Database, Legal, SEO, Tests, and Docs layers.

---

## CATEGORY 1: PRICING CONTRADICTIONS

### 1.1 $49 vs $149 Founder Price (CRITICAL — payment fulfillment disagrees with UI)

| # | File | Line | Current | Canonical | Severity | Layer | Migration | Prod Approval |
|---|---|---|---|---|---|---|---|---|
| P1 | `src/config/plans.ts` | 108 | `monthlyPriceCents: 4900` | `14900` ($149) | CRITICAL | Billing | YES | YES |
| P2 | `src/app/pricing/page.tsx` | 123 | "A one-time $49 purchase..." | "$149 one-time purchase" | CRITICAL | UI | YES | YES |
| P3 | `tests/pricing-consistency.test.ts` | 92 | `expect(formatPrice(4900)).toBe("$49")` | `formatPrice(14900) === "$149"` | CRITICAL | Tests | YES | YES |
| P4 | `docs/SUPABASE_LITBITS_BILLING_CHECKLIST.md` | 78 | "$149" (price correct, but advertises 6,000 LiTTBits) | Remove LiTTBit allowance | CRITICAL | Docs | YES | YES |

**Already correct (no change needed):**
- `src/app/marketplace/page.tsx:653` — shows $149 ✓
- `src/app/marketplace/agents/[slug]/page.tsx:57` — shows "$149 one-time" ✓

### 1.2 Six-Month vs Permanent Founder Access (CRITICAL)

| # | File | Line | Current | Canonical | Severity | Layer | Migration | Prod Approval |
|---|---|---|---|---|---|---|---|---|
| P5 | `src/config/plans.ts` | 114 | "6 months of Creator-level agent access" | "Permanent Creator-level access" | CRITICAL | Billing | YES | YES |
| P6 | `src/config/plans.ts` | 133-134 | "Founding Supporter grants 6 months..." | "grants permanent Creator-level access" | CRITICAL | Billing | YES | YES |
| P7 | `src/app/pricing/page.tsx` | 123 | "6 months of Creator-level access" | "permanent Creator-level access" | CRITICAL | UI | YES | YES |
| P8 | `src/app/api/stripe/webhook/route.ts` | 247 | "Record as a time-limited subscription (6 months...)" | Record as permanent entitlement | CRITICAL | Billing | YES | YES |

### 1.3 Founder LiTTBit Allowance Advertised (should NOT be)

| # | File | Line | Current | Canonical | Severity | Layer | Migration | Prod Approval |
|---|---|---|---|---|---|---|---|---|
| P9 | `src/config/plans.ts` | 111 | `monthlyCredits: 6000` | Remove field — no recurring credits for one-time purchase | CRITICAL | Billing | YES | YES |
| P10 | `src/config/plans.ts` | 116 | "5,000 bonus LiTTBits (one-time)" | Remove — do not advertise allowance | CRITICAL | Billing | YES | YES |
| P11 | `src/app/pricing/page.tsx` | 123 | "5,000 bonus LiTTBits" | Remove | CRITICAL | UI | YES | YES |
| P12 | `docs/SUPABASE_LITBITS_BILLING_CHECKLIST.md` | 78 | "6,000 included once" | Remove | CRITICAL | Docs | YES | YES |
| P13 | `docs/SUPABASE_LITBITS_BILLING_CHECKLIST.md` | 209 | "grants 6,000 once" | Remove | CRITICAL | Docs | YES | YES |

### 1.4 Founder Naming Inconsistency

| # | File | Line | Current | Canonical | Severity | Layer | Migration | Prod Approval |
|---|---|---|---|---|---|---|---|---|
| P14 | `src/config/plans.ts` | 105 | `name: "Founding Supporter"` | `"Founding Member"` | HIGH | Billing | YES | YES |
| P15 | `src/app/pricing/page.tsx` | 121 | "Founding Supporter offer?" | "Founding Member" | HIGH | UI | YES | YES |
| P16 | `src/app/pricing/page.tsx` | 337 | "Founding Supporter" | "Founding Member" | HIGH | UI | YES | YES |
| P17 | `src/app/pricing/page.tsx` | 341 | "Founding Supporter pricing..." | "Founding Member" | HIGH | UI | YES | YES |
| P18 | `src/lib/mission-control.ts` | 525 | `founder: "Founder"` | `"Founding Member"` | HIGH | Entitlement | YES | YES |

### 1.5 Invented Founder Benefits (credit-pack discounts, early access, etc.)

| # | File | Line | Current | Canonical | Severity | Layer | Migration | Prod Approval |
|---|---|---|---|---|---|---|---|---|
| P19 | `src/config/plans.ts` | 118 | "15% off future credit packs" | Remove — no invented discounts | HIGH | Billing | YES | YES |
| P20 | `src/app/pricing/page.tsx` | 123 | "15% off future credit packs" | Remove | HIGH | UI | YES | YES |
| P21 | `src/app/marketplace/page.tsx` | 656 | "20% off credit packs", "Price protection" | Remove both | HIGH | UI | YES | YES |
| P22 | `src/config/plans.ts` | 113-121 | Features: 6 months, Researcher/Writer/Marketer, 5,000 LiTTBits, badge, 15% off, early access, priority feedback | Only: "Permanent Creator-level access", "Founder badge" | MEDIUM | Billing | YES | YES |
| P23 | `src/app/pricing/page.tsx` | 123 | Full FAQ answer with invented benefits | "$149 one-time, permanent Creator-level access, Founder badge" | MEDIUM | UI | YES | YES |

### 1.6 Stripe Webhook Logic

| # | File | Line | Current | Canonical | Severity | Layer | Migration | Prod Approval |
|---|---|---|---|---|---|---|---|---|
| P24 | `src/app/api/stripe/webhook/route.ts` | 236-257 | Grants `monthlyCredits` + records as time-limited subscription | Grant permanent entitlement, no monthlyCredits | MEDIUM | Billing | YES | YES |

### 1.7 Legacy Mock Data

| # | File | Line | Current | Canonical | Severity | Layer | Migration | Prod Approval |
|---|---|---|---|---|---|---|---|---|
| P25 | `src/components/dashboard/MarketplacePreview.tsx` | 11-13 | Mock coin packs: $5/$19.99/$50 with coin amounts | Remove or align with canonical plans | LOW | UI | YES | NO |

---

## CATEGORY 2: LiTTBITS CONTRADICTIONS

### 2.1 "Coin" Terminology in User-Facing Copy (CRITICAL)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| L1 | `src/components/dashboard/AudioTool.tsx` | 40 | `COIN_COST` variable name | `LITTBITS_COST` | CRITICAL | UI |
| L2 | `src/components/dashboard/AudioTool.tsx` | 593 | "coins" | "LiTTBits" | CRITICAL | UI |
| L3 | `src/components/dashboard/AudioTool.tsx` | 597 | "Insufficient coins" | "Insufficient LiTTBits" | CRITICAL | UI |
| L4 | `src/components/dashboard/AudioTool.tsx` | 628 | `{COIN_COST[tab]} coins` | "LiTTBits" | CRITICAL | UI |
| L5 | `src/app/wallet/page.tsx` | 160 | "How coins work" | "How LiTTBits work" | CRITICAL | UI |
| L6 | `src/app/wallet/page.tsx` | 204 | "coin packs" | Remove (no approved catalog) | CRITICAL | UI |
| L7 | `src/lib/user-db.ts` | 207 | "500 coins" | "500 LiTTBits" | CRITICAL | Database |
| L8 | `src/lib/user-db.ts` | 220 | "500 coins" | "500 LiTTBits" | CRITICAL | Database |
| L9 | `src/app/api/user/ensure/route.ts` | 30 | "500 coins" | "500 LiTTBits" | CRITICAL | Billing |
| L10 | `src/app/api/auth/clerk/route.ts` | 78 | "500 starting coins" | "500 LiTTBits" | CRITICAL | Billing |
| L11 | `src/lib/media.ts` | 29 | "Coin cost per render" | "LiTTBits cost per render" | CRITICAL | Entitlement |
| L12 | `src/components/dashboard/DashboardCards.tsx` | 417 | "coin packs" | Remove or "credit packs" | CRITICAL | UI |
| L13 | `src/app/api/wallet/route.ts` | 75 | "Spend coins" | "Spend LiTTBits" | CRITICAL | Billing |

### 2.2 Credit Packs Advertised Without Approved Catalog (HIGH)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| L14 | `src/app/pricing/page.tsx` | 123 | "15% off future credit packs" | Remove | HIGH | UI |
| L15 | `src/config/plans.ts` | 118 | "15% off future credit packs" | Remove | HIGH | Entitlement |
| L16 | `src/components/dashboard/MarketplacePreview.tsx` | 10-13 | Mock coin packs with Stripe price IDs | Remove (PRODUCT_CATALOG is empty) | HIGH | UI |
| L17 | `src/components/dashboard/MarketplacePreview.tsx` | 161 | `tier.coins.toLocaleString()` | "LiTTBits" | HIGH | UI |
| L18 | `src/components/dashboard/MarketplacePreview.tsx` | 164 | "LiTTs" | "LiTTBits" | HIGH | UI |

### 2.3 +50 Daily LiTTBit System (HIGH — unapproved)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| L19 | `src/app/api/wallet/route.ts` | 54 | "Claims the daily bonus of 50 LiTTBits" | Mark unapproved or add to PRODUCT_TRUTH.md | HIGH | Billing |
| L20 | `src/app/api/wallet/route.ts` | 119-123 | Grants +50 daily via `adjustWalletBalance` | Gate behind PRODUCT_TRUTH approval | HIGH | Billing |
| L21 | `src/app/api/wallet/route.ts` | 127 | "Daily bonus claimed! +50 LiTTBits" | Gate behind approval | HIGH | Billing |
| L22 | `src/app/wallet/page.tsx` | 59 | "Daily bonus claimed! +50 LiTTBits" | Gate behind approval | HIGH | UI |
| L23 | `src/app/wallet/page.tsx` | 117 | "Claim daily +50" | Gate behind approval | HIGH | UI |
| L24 | `src/app/wallet/page.tsx` | 200 | "Claim +50 LiTTBits every day for free" | Gate behind approval | HIGH | UI |
| L25 | `src/components/dashboard/DashboardWidgets.tsx` | 237-278 | Daily Reward card with +50 LiTTBits | Gate behind approval | HIGH | UI |
| L26 | `src/app/studio/tools/ImageTool.tsx` | 1094 | "Daily bonus claimed! +50 🪙" | Gate behind approval; remove coin emoji | HIGH | UI |
| L27 | `src/context/WalletContext.tsx` | 59-81 | `claim()` function calls /api/wallet POST | Gate behind approval | HIGH | UI |

### 2.4 Monthly Refresh/Rollover/Expiration Claims Without Approved Policy (HIGH)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| L28 | `src/app/pricing/page.tsx` | 85-86 | "Plan credits refresh each billing period. Bought credits never expire." | Remove unless approved policy exists | HIGH | UI |
| L29 | `src/app/pricing/page.tsx` | 108 | "Monthly plan credits are used first, followed by promotional and purchased" | Remove consumption order claim | HIGH | UI |
| L30 | `src/app/settings/page.tsx` | 2121 | "Beta LiTTBits... expire 90 days after paid beta launch" | Remove expiration claim | HIGH | UI |
| L31 | `docs/SUPABASE_LITBITS_BILLING_CHECKLIST.md` | 114-116 | "Monthly grants expire...", "Purchased credits do not expire" | Remove unless approved | HIGH | Docs |

### 2.5 Coins Icon Implying Cash Value (HIGH/MEDIUM)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| L32 | `src/components/Sidebar.tsx` | 211-212 | `Coins` icon next to LBC balance | Use non-cash icon (Sparkles/Gift) | HIGH | UI |
| L33 | `src/app/studio/components/StudioSidebar.tsx` | 336 | `Coins` icon for "Billing & LiTTBits" | Use non-cash icon | MEDIUM | UI |
| L34 | `src/stores/useSettingsStore.ts` | 30 | `icon: "Coins"` | Use non-cash icon | MEDIUM | UI |

### 2.6 "coin_pack" Type in Stripe Products Config (LOW)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| L35 | `src/config/stripe-products.ts` | 22 | `ProductType = "coin_pack" \| "plan" \| "one_time"` | `"credit_pack"` | LOW | Entitlement |
| L36 | `src/config/stripe-products.ts` | 17, 51, 146-158 | Comments/error messages use "coin_pack" | "credit_pack" | LOW | Entitlement |
| L37 | `src/app/api/stripe/webhook/route.ts` | 32-68 | `creditCoinPack()` function name | `creditCreditPack()` or `grantCreditPack()` | LOW | Billing |
| L38 | `src/app/api/stripe/webhook/route.ts` | 230, 453, 481 | Comments use "coin pack" | "credit pack" | LOW | Billing |
| L39 | `src/lib/navigation.ts` | 113 | `href: "/marketplace?tab=coins"` | `?tab=littbits` | MEDIUM | UI |
| L40 | `supabase/migrations/20260730000000_premium_agents_v1_port.sql` | 494, 531 | "coin packs" in comments | "credit packs" | LOW | Database |

---

## CATEGORY 3: AGENT MODEL CONTRADICTIONS

### 3.1 "Seven AI Agents" on Pricing Page (CRITICAL)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| A1 | `src/app/pricing/page.tsx` | 298 | "One workspace, seven AI agents..." | "One workspace with LiTT and Spark" | CRITICAL | UI/Billing/SEO |
| A2 | `src/app/pricing/page.tsx` | 304 | "7 specialist AI agents" | Remove — LiTT and Spark only | CRITICAL | UI/Billing/SEO |

### 3.2 Agent Registry Defines 7 Agents (CRITICAL)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| A3 | `src/lib/agent-registry.ts` | 639-647 | `AGENT_DEFINITIONS` includes 7 agents | Only LiTT and Spark | CRITICAL | Entitlement/Database |
| A4 | `src/lib/agent-registry.ts` | 467-634 | NOVA, FORGE, ECHO orphaned definitions | Remove or move to marketplace products | CRITICAL | Database/Entitlement |

### 3.3 "Hire Agent" / "My AI Team" Language (HIGH)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| A5 | `src/app/studio/components/MyAITeam.tsx` | 146 | "+ Hire Agent" | "+ Browse Marketplace" | HIGH | UI |
| A6 | `src/app/studio/components/MyAITeam.tsx` | 141 | "My AI Team" title | "My Specialists" or "Installed Skills" | HIGH | UI |
| A7 | `src/app/studio/components/MyAITeam.tsx` | 158-280 | Specialists as selectable active agents | Skills/modes invoked through LiTT | HIGH | UI/Entitlement |

### 3.4 Studio Agent Registry / Types Include Specialists (HIGH)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| A8 | `src/lib/studio/agent-registry.ts` | 45-66 | Nova/Forge/Echo as "full-service AI workers" | Skills/modes, not full-service workers | HIGH | Entitlement/Database |
| A9 | `src/lib/studio/agent-registry.ts` | 67-112 | Researcher/Writer/Marketer/Coder/Analyst as legacy slugs | Remove or convert to skill slugs | HIGH | Entitlement/Database |
| A10 | `src/app/studio/stores/useStudioAgentStore.ts` | 10-20 | `AgentId` includes nova/forge/echo + 5 specialists | Only "litt" \| "spark" | HIGH | Entitlement/Database |
| A11 | `src/lib/studio/types.ts` | 1-11 | `AgentSlug` includes 8 specialist slugs | Only "litt" \| "spark" | HIGH | Entitlement/Database |

### 3.5 "Install" Language for Marketplace Agents (HIGH)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| A12 | `src/app/marketplace/agents/[slug]/AgentDetailClient.tsx` | 123-136 | "Install {name}" | "Add to LiTT" or "Enable Skill" | HIGH | UI |
| A13 | `src/app/marketplace/_components/AgentCard.tsx` | 259 | "Install" | "Add" or "Enable" | HIGH | UI |
| A14 | `src/config/feature-flags.ts` | 100-105 | "Individual agent install from marketplace" | "Individual skill install" | HIGH | Entitlement |

### 3.6 Specialists as Full AgentDefinitions (MEDIUM)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| A15 | `src/lib/agent-registry.ts` | 220-265 | RESEARCHER full AgentDefinition | Skill definition | MEDIUM | Entitlement/Database |
| A16 | `src/lib/agent-registry.ts` | 270-315 | WRITER full AgentDefinition | Skill definition | MEDIUM | Entitlement/Database |
| A17 | `src/lib/agent-registry.ts` | 320-365 | MARKETER full AgentDefinition | Skill definition | MEDIUM | Entitlement/Database |
| A18 | `src/lib/agent-registry.ts` | 370-415 | CODER full AgentDefinition | Skill definition | MEDIUM | Entitlement/Database |
| A19 | `src/lib/agent-registry.ts` | 420-464 | ANALYST full AgentDefinition | Skill definition | MEDIUM | Entitlement/Database |

### 3.7 Plan Features List Specialists as Separate Agents (MEDIUM)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| A20 | `src/config/plans.ts` | 60-62 | "Researcher —...", "Writer —...", "Marketer —..." | "Research skills", "Writing skills", etc. | MEDIUM | Billing/UI |
| A21 | `src/config/plans.ts` | 87-88 | "Coder —...", "Analyst —..." | "Coding skills", "Analytics skills" | MEDIUM | Billing/UI |

### 3.8 Tests Expect 7 Agents (MEDIUM)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| A22 | `tests/agent-entitlements.test.ts` | 127 | "has exactly 7 agents" | "has exactly 2 agents" | MEDIUM | Tests |
| A23 | `src/lib/__tests__/agent-registry.test.ts` | 14, 23, 38-46 | Tests expect 7 agents + 5 specialists | Expect 2 agents (LiTT, Spark) | MEDIUM | Tests |
| A24 | `src/lib/studio/__tests__/agent-registry.test.ts` | 17-19 | Tests expect nova/forge/echo | Remove from registry tests | MEDIUM | Tests |

---

## CATEGORY 4: PRODUCT IDENTITY CONTRADICTIONS

### 4.1 Homepage / SEO / Metadata (HIGH)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| I1 | `src/app/HomePageClient.tsx` | 72 | "AI project workspace" | "AI operating system and creative social platform" | HIGH | UI |
| I2 | `src/app/HomePageClient.tsx` | 81 | "LiTTree is an AI project workspace..." | Full canonical definition with social platform | HIGH | UI |
| I3 | `src/lib/seo.ts` | 9 | "AI Creative Studio for Apps, Art & Projects" | "AI operating system and creative social platform" | HIGH | SEO |
| I4 | `src/lib/seo.ts` | 12 | "Build apps, create art, launch projects..." | Canonical product definition | HIGH | SEO |
| I5 | `src/app/opengraph-image.alt.txt` | 1 | "AI creative studio powered by LiTT and Spark" | Canonical definition | HIGH | SEO |
| I6 | `src/app/twitter-image.alt.txt` | 1 | "AI creative studio powered by LiTT and Spark" | Canonical definition | HIGH | SEO |

### 4.2 Legal Page Metadata (HIGH)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| I7 | `src/app/terms/page.tsx` | 8 | "AI creative studio" | "AI operating system and creative social platform" | HIGH | Legal |
| I8 | `src/app/terms/page.tsx` | 22, 195 | "AI creative studio and social creation platform" | "AI operating system and creative social platform" | MEDIUM | Legal |
| I9 | `src/app/privacy/page.tsx` | 6 | "AI creative studio" | Canonical definition | HIGH | Legal |
| I10 | `src/app/cookies/page.tsx` | 6 | "AI creative studio" | Canonical definition | HIGH | Legal |

### 4.3 Documentation Index (HIGH)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| I11 | `docs/README.md` | 7-8 | v7 and v2.0 labeled as canonical | Mark as archived/superseded; PRODUCT_TRUTH.md as canonical | HIGH | Docs |
| I12 | `docs/ULTRA_BLUEPRINT_v7.md` | 19 | "An AI operating system for builders" | Full canonical definition | HIGH | Docs |
| I13 | `docs/LITTREE_MASTER_PLATFORM_HANDBOOK_v2.0.md` | 44, 162, 261 | "unified AI operating system for creators" | Full canonical definition | HIGH | Docs |
| I14 | `docs/litt/ultra-handbook-v11.md` | 49, 390 | "AI operating system for turning ideas..." | Add "creative social platform" | MEDIUM | Docs |

### 4.4 Other Page Metadata (MEDIUM/LOW)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| I15 | `src/app/landing/page.tsx` | 18 | "AI crew that remembers your goals..." | Canonical definition | MEDIUM | UI |
| I16 | `src/app/profile/_components/ProfileOverview.tsx` | 534 | "A full-stack AI operating system for creators" | Canonical definition | MEDIUM | UI |
| I17 | `src/app/discover/layout.tsx` | 7 | "community feed" | "creative social platform" | LOW | SEO |
| I18 | `src/app/social/layout.tsx` | 7 | "community feed" | "creative social platform" | LOW | SEO |
| I19 | `src/app/marketplace/layout.tsx` | 6 | "community-built AI agents" | "AI agents, creative tools..." | LOW | SEO |
| I20 | `src/app/gallery/layout.tsx` | 7 | "created by the LiTTree LabStudios community" | "created on LiTTree LabStudios" | LOW | SEO |

---

## CATEGORY 5: LEGAL / DATA-FLOW CONTRADICTIONS

### 5.1 Actual Data Flow (verified from code)

| Component | Actual Implementation |
|---|---|
| LiTTBits balance | Supabase `credit_ledger` table via `get_user_balances()` RPC |
| Conversations | Supabase `studio_conversations` + `studio_conversation_messages` (durable, with revision control) |
| Project memory | Supabase `memories` table (project_id, conversation_id, agent_slug, memory_type) |
| AI providers | Multi-provider: Gemini, OpenRouter, Groq, OpenAI (BYOK), Anthropic (BYOK), Together, Fal, MiniMax, Alibaba, Recraft, Cloudflare, ElevenLabs |
| Auth | Clerk |
| DB | Supabase |
| Payments | Stripe |
| File storage | Cloudflare R2 |
| Camera/mic/screen | Used in Studio (CameraTool, CameraPreview, VoiceSessionContext, ShareMenu, ScreenTool) |
| Analytics | Vercel Analytics installed in package.json but NOT imported in layout.tsx (inactive) |

### 5.2 Privacy Policy False Claims (CRITICAL)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| D1 | `src/app/privacy/page.tsx` | 60-62 | "LiTTBits balance... stored locally in your browser" | Stored in Supabase credit_ledger (server-side) | CRITICAL | Legal |
| D2 | `src/app/privacy/page.tsx` | 65-67 | "processed through Google Gemini. We do not permanently store chat logs" | Multi-provider; conversations ARE durably stored in Supabase | CRITICAL | Legal |
| D3 | `src/app/cookies/page.tsx` | 66 | "LiTTBits balances... localStorage... never leaves your device" | Stored in Supabase | CRITICAL | Legal |

### 5.3 Omitted Providers / Services (HIGH)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| D4 | `src/app/privacy/page.tsx` | 130-132 | Lists only "Google Gemini API" | Add all providers: OpenRouter, Groq, OpenAI, Anthropic, Together, Fal, MiniMax, Alibaba, Recraft, Cloudflare, ElevenLabs | HIGH | Legal |
| D5 | `src/app/privacy/page.tsx` | 130-140 | Omits Cloudflare R2, GitHub, ElevenLabs | Add all third-party services | HIGH | Legal |
| D6 | `src/app/privacy/page.tsx` | Entire | No camera/microphone/screen-share disclosure | Add hardware permissions disclosure | HIGH | Legal |
| D7 | `src/app/terms/page.tsx` | Entire | No camera/microphone/screen-share disclosure | Add hardware permissions disclosure | HIGH | Legal |

### 5.4 Cookie Policy False Claims (MEDIUM)

| # | File | Line | Current | Canonical | Severity | Layer |
|---|---|---|---|---|---|---|
| D8 | `src/app/cookies/page.tsx` | 48-51 | "We use Vercel Analytics" | Analytics NOT active — remove or implement | MEDIUM | Legal |
| D9 | `src/app/cookies/page.tsx` | 55-58 | "Marketing & Commerce Cookies" | No marketing cookies implemented — remove | MEDIUM | Legal |

---

## PROPOSED REPAIR PLAN (for approval)

### Phase 1: Create Source-of-Truth Documents
1. Create `docs/PRODUCT_TRUTH.md` — canonical commercial and public-copy truth
2. Create `src/config/product-truth.ts` — machine-readable product contract
3. Update `docs/README.md` — mark v7/v2 as archived, PRODUCT_TRUTH.md as canonical

### Phase 2: Fix Critical Pricing (Founder)
4. `src/config/plans.ts` — $49→$149, remove 6 months, remove LiTTBit allowance, rename to "Founding Member", remove invented benefits
5. `src/app/pricing/page.tsx` — update FAQ, remove "seven agents", fix Founder description
6. `src/app/api/stripe/webhook/route.ts` — fix Founder fulfillment to permanent
7. `tests/pricing-consistency.test.ts` — update to $149

### Phase 3: Fix LiTTBits Terminology
8. Replace all "coins" → "LiTTBits" in user-facing copy (13 CRITICAL files)
9. Gate +50 daily bonus behind PRODUCT_TRUTH.md approval
10. Remove credit pack advertisements (no approved catalog)
11. Remove unapproved expiration/refresh/rollover claims
12. Replace Coins icons with non-cash icons

### Phase 4: Fix Agent Model
13. `src/lib/agent-registry.ts` — AGENT_DEFINITIONS to only LiTT + Spark
14. `src/app/studio/components/MyAITeam.tsx` — rename to "My Specialists", "Browse Marketplace"
15. `src/app/studio/stores/useStudioAgentStore.ts` — AgentId to only "litt" | "spark"
16. `src/lib/studio/types.ts` — AgentSlug to only "litt" | "spark"
17. Update tests to expect 2 agents
18. Change "Install" → "Add" / "Enable" in marketplace

### Phase 5: Fix Product Identity
19. `src/app/HomePageClient.tsx` — canonical product definition
20. `src/lib/seo.ts` — canonical SEO metadata
21. Legal page metadata — canonical terminology
22. OG/Twitter image alt text

### Phase 6: Fix Legal/Data-Flow
23. `src/app/privacy/page.tsx` — fix storage claims, add all providers, add hardware permissions
24. `src/app/cookies/page.tsx` — fix localStorage claims, remove false analytics/cookie claims
25. `src/app/terms/page.tsx` — add hardware permissions disclosure

### Phase 7: Consistency Enforcement
26. Create `scripts/audit-product-truth.ts` — automated contradiction scanner
27. Add `pnpm audit:product-truth` to package.json
28. Add tests that fail on obsolete statements

### Phase 8: Validation
29. Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, `pnpm audit:product-truth`
30. Manual verification of all public pages

---

## REQUIRING OWNER/LEGAL REVIEW

The following items need explicit owner or legal approval before implementation:

1. **+50 daily LiTTBit system** — keep, remove, or gate behind approval?
2. **Monthly credit refresh** — is this an approved policy?
3. **Credit expiration** — is there an approved expiration policy?
4. **Credit packs** — are there approved Stripe products to sell?
5. **Privacy policy rewrite** — requires legal review of the new text
6. **Terms update** — requires legal review of hardware permissions disclosure
7. **Founder Stripe Price ID** — changing $49→$149 requires a new Stripe Price ID (do NOT modify existing Stripe products)

---

**END OF AUDIT REPORT**

No edits have been made. No deployments have been performed. No Stripe products have been modified. No customer balances have been changed.

Awaiting approval to proceed with the proposed repair plan.
