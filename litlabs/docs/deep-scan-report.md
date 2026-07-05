# LiTTree Lab Studios — Deep Scan Report

**Date:** 2026-07-02 (Refreshed) | **Previous Report:** 2026-06-08 (superseded)

---

## Executive Summary

| Metric          | Value                                     |
| --------------- | ----------------------------------------- |
| Framework       | Next.js 16.2.9 + React 19.2.7 + Turbopack |
| Language        | TypeScript 5.8 (strict: false)            |
| Package Manager | pnpm 9.15.0                               |
| Pages           | 62 (all compile)                          |
| API Routes      | 50+                                       |
| Components      | ~40                                       |
| Hooks           | 12                                        |
| Library Files   | 40+ (src/lib/)                            |
| Test Coverage   | 0%                                        |
| Supabase Tables | 11 in schema + 4 missing                  |
| Deploy Targets  | Vercel, Netlify, Cloudflare Pages, Docker |
| Active Task     | "System Initialization" — pending         |

**Overall Health:** 🟡 Improving. 3 of 8 critical issues from the previous scan are now fixed. User ID mismatch persists in 2 routes, strict mode still disabled, 4 DB tables missing from schema. 0% test coverage remains a systemic risk.

---

## Changes Since Last Scan

| #   | Issue                        | Before | After              |
| --- | ---------------------------- | ------ | ------------------ |
| C-1 | music/generate no auth       | 🔴     | ✅ Fixed           |
| C-2 | gemini/build no auth         | 🔴     | ✅ Fixed           |
| C-3 | users/credits no admin check | 🔴     | ✅ Fixed           |
| C-4 | User ID mismatch (3 routes)  | 🔴     | 🟡 1/3 fixed       |
| C-5 | Stripe priceIds empty        | 🔴     | 🟡 2/4 have IDs    |
| C-6 | Orchestrate setInterval      | 🔴     | ✅ Fixed           |
| C-7 | Rate limiter in-memory       | 🔴     | ✅ Supabase-backed |
| C-8 | TypeScript strict: false     | 🔴     | 🔴 Still disabled  |
| H-1 | No auth on 4 pages           | 🟡     | 🟡 2/4 fixed       |
| H-6 | agents.ts → gemini.ts        | 🟡     | ✅ Uses llm.ts     |
| H-7 | ActivePieces hardcoded       | 🟡     | ✅ Fixed           |
| —   | pnpm-workspace litlabs/      | 🟡     | ✅ Fixed           |

---

## 1. CRITICAL — Fix Immediately

| #   | Issue                         | Location                       | Impact                                                     |
| --- | ----------------------------- | ------------------------------ | ---------------------------------------------------------- |
| C-1 | User ID mismatch (2 routes)   | conversations, user-agents API | All queries return empty                                   |
| C-2 | 2 Stripe priceIds empty       | marketplace/page.tsx           | Elite tier can't sell                                      |
| C-3 | TypeScript strict: false      | tsconfig.json                  | Hides null/any bugs                                        |
| C-4 | 4 tables missing from schema  | supabase/schema.sql            | rate_limit_store, orchestration_jobs, agents, active_tasks |
| C-5 | agents table columns mismatch | /api/agents vs schema          | is_public, is_core, owner_id not in schema                 |

### C-1 Detail: User ID Mismatch

Clerk returns string ID (`user_abc123`), Supabase users table uses UUID with `clerk_id` mapping column.

**Broken** (conversations, user-agents):

```typescript
const { userId } = await auth(); // Clerk string
supabase.from("conversations").eq("user_id", userId); // WRONG
```

**Fixed** (agents, orchestrate, wallet):

```typescript
const { userId: clerkId } = await auth();
const { data: user } = await supabase
  .from("users")
  .select("id")
  .eq("clerk_id", clerkId)
  .single();
const dbUserId = user.id; // UUID
```

---

## 2. HIGH — Fix This Sprint

| #    | Issue                               | Location          |
| ---- | ----------------------------------- | ----------------- |
| H-1  | No auth on /agents, /showcase       | 2 page files      |
| H-2  | UserSync depends on Clerk useAuth() | layout.tsx        |
| H-3  | Profile localStorage only           | profile/page.tsx  |
| H-4  | Settings localStorage only          | settings/page.tsx |
| H-5  | Boardroom orchestrator is mock      | page.tsx          |
| H-6  | chat API in-memory only             | /api/chat         |
| H-7  | users/plan in-memory Map            | API route         |
| H-8  | Dual auth (Clerk + custom JWT)      | Multiple files    |
| H-9  | agents/commits uses execSync        | API route         |
| H-10 | agents/status refs active_tasks     | Table missing     |
| H-11 | supabaseAdmin export unverified     | lib/supabase.ts   |

---

## 3. MEDIUM — Next Sprint

| #    | Issue                             | Location             |
| ---- | --------------------------------- | -------------------- |
| M-1  | CRT default inconsistency         | Multiple pages       |
| M-2  | generate polling never set        | generate/page.tsx    |
| M-3  | auth/logout redirect in try/catch | API route            |
| M-4  | agents/services hardcoded         | API route            |
| M-5  | agents/logs demo data             | API route            |
| M-6  | storage API mock URLs             | API route            |
| M-7  | Profile comments stubs            | profile/page.tsx     |
| M-8  | Marketplace agents hardcoded      | marketplace/page.tsx |
| M-9  | PageShell inconsistent            | Layout               |
| M-10 | Gallery uses DEMO_ITEMS           | gallery/page.tsx     |
| M-11 | Video/AudioTool hardcoded models  | Studio tools         |
| M-12 | SpaceTool hardcoded URL           | Studio tool          |
| M-13 | CookieConsent ignores theme       | Component            |

---

## 4. LOW — Backlog

| #   | Issue                        |
| --- | ---------------------------- |
| L-1 | Settings clear() no confirm  |
| L-2 | Empty style tag on CSS clear |
| L-3 | agent-chat false positives   |
| L-4 | sellPrice no validation      |
| L-5 | posts/like masks errors      |
| L-6 | Showcase static (fine)       |
| L-7 | /social redirect stub        |
| L-8 | CRT missing on 4 pages       |

---

## 5. Architecture Overview

### What's Working Well

- **Wallet API**: daily claim, spend, balance, transactions
- **Stripe Webhook**: signature verification, wallet credit
- **LLM Client**: Gemini 2.5 Flash → OpenRouter → DeepSeek V3 failover
- **Clerk Auth**: UserSync guarded, surfaced in navbar
- **Theme System**: 16 skins, 6 backgrounds, dark/light
- **Social Feed**: posts, likes, comments wired to Supabase
- **AgentTerminalTool**: SSE streaming, CRT, agent selector
- **Flow API**: sequential cell execution, wallet pre-deduction
- **Media Gen**: Pollinations, SkyBox, MiniMax, ElevenLabs
- **Build**: 62/62 pages, 0 warnings, 0 errors
- **Rate Limiter**: Supabase-backed, serverless-compatible
- **Agent Orchestrator**: unified LLM, Clerk→UUID resolution
- **Stripe Checkout**: price IDs + ad-hoc price_data

### Source Code Structure

```
src/
├── daemon.ts              # Standalone daemon process (potentially obsolete)
├── proxy.ts               # Proxy server (potentially obsolete)
├── app/                   # 62 pages, 50+ API routes
│   ├── (auth)/            # Clerk auth pages
│   ├── admin/             # Admin panel + terminal
│   ├── agents/            # Agent gallery + detail pages
│   ├── ai-builder/        # AI builder interface
│   ├── api/               # 50+ API route handlers
│   ├── builder/           # Builder interface
│   ├── code/              # Code editor view
│   ├── dashboard/         # Main dashboard
│   ├── flow/              # Flow/canvas editor
│   ├── gallery/           # Media gallery
│   ├── games/             # Games section
│   ├── lit/               # LiTTree LiT interface
│   ├── library/           # File library
│   ├── marketplace/       # Agent marketplace
│   ├── profile/           # User profiles
│   ├── settings/          # User settings
│   ├── showcase/          # Showcase page
│   ├── social/            # Social feed
│   └── studio/            # Studio tools (image, video, audio, space)
├── components/            # ~40 components
├── context/              # Theme, auth, agent contexts
├── hooks/                # 12 custom hooks
├── knowledge-harvest/    # Knowledge harvesting system
├── lib/                  # 40+ utility files
└── types/                # TypeScript type definitions
```

### Component Inventory (37 files)

| Component                | Purpose                                         |
| ------------------------ | ----------------------------------------------- |
| `AgentBuilder.tsx`       | 3-step wizard for creating custom agents        |
| `AgentDashboard.tsx`     | Live agent pipeline viewer with real-time tasks |
| `AnimatedBackground.tsx` | CSS-based animated background                   |
| `AssetLibrary.tsx`       | Asset browser with search                       |
| `ClerkAuth.tsx`          | Clerk authentication wrapper                    |
| `CookieConsent.tsx`      | Cookie consent banner                           |
| `CreateFAB.tsx`          | Floating action button for quick create         |
| `DragDropCanvas.tsx`     | Drag-and-drop canvas component                  |
| `ErrorBoundary.tsx`      | React error boundary                            |
| `GalaxyMap.tsx`          | Galaxy map visualization                        |
| `GlassCard.tsx`          | Reusable glass-morphism card                    |
| `ImageLightbox.tsx`      | Image lightbox viewer                           |
| `Footer.tsx`             | Site footer                                     |

### Hooks (12)

| Hook                   | Purpose                      |
| ---------------------- | ---------------------------- |
| `useAgentSubscription` | Real-time agent task updates |
| `useTheme`             | Theme context consumer       |
| `useAuth`              | Auth context consumer        |
| + 9 more               | Various utility hooks        |

### Library Files (40+ in src/lib/)

Key utilities: `supabase.ts`, `llm.ts`, `r2.ts`, `rate-limiter.ts`, `agent-logger.ts`, `lit.ts`, Stripe helpers, Clerk helpers, and more.

### DB Schema (11 tables in schema.sql)

`users`, `user_preferences`, `user_agents`, `subscriptions`, `wallets`, `transactions`, `posts`, `post_likes`, `post_comments`, `user_media`, `deployments` — all with RLS enabled and proper indexes.

### Missing Tables

`rate_limit_store`, `orchestration_jobs`, `agents`, `active_tasks` — referenced by code, not in schema.

---

## 6. Infrastructure & Deployment

### Deploy Targets (4)

| Target           | Config File                         | Status          |
| ---------------- | ----------------------------------- | --------------- |
| Vercel           | `vercel.json`                       | ✅ Primary      |
| Netlify          | `netlify.toml`                      | ⚠️ Secondary    |
| Cloudflare Pages | `wrangler.toml`                     | ⚠️ Experimental |
| Docker           | `Dockerfile` + `docker-compose.yml` | ✅ Self-hosted  |

### Config Issues

- `docker-compose.yml`: Uses deprecated `version: '3.8'` key (ignored by Compose v2)
- `wrangler.toml`: Experimental Cloudflare Pages config
- `netlify.toml`: Secondary deploy target — may conflict with Vercel
- `tsconfig.json`: `strict: false` — hides type errors
- `package.json`: Named `frontend` (mismatch with repo name `litlabs-website`)

### Dependency Notes

- `@clerk/nextjs` ^6.39.5 — one major version behind (7.5.12 latest)
- `@google/genai` ^2.8.0 — used in 7 media API routes
- `@google/generative-ai` ^0.24.1 — legacy, may conflict with `@google/genai`
- Dual Google AI SDKs (`@google/genai` + `@google/generative-ai`) — should consolidate

---

## 7. Documentation, Plans & Tasks

### Documentation

- `docs/agents-terminal-design.md` — Agents Terminal UI design (Draft v1)
- `docs/deep-scan-report.md` — This report

### Plans

- `plans/code-fixes.md` — Code fix roadmap
- `plans/implementation-settings-cli-tools.md` — Settings CLI implementation
- `plans/settings-cli-enhancement*.md` — Settings CLI enhancement details

### PRDs

- `prds/ai-studio-optimization.md` — AI Studio optimization PRD

### Prompts

- `prompts/director.md` — Director agent prompt
- `prompts/executor.md` — Executor agent prompt

### Tasks

- **Active**: "System Initialization" — pending
- **Backlog**: 3 items (Settings P1, Dashboard P2, Agent Chat P3)
- **Completed**: empty

---

## 8. Files Needing Attention

**Potentially obsolete:** `src/daemon.ts`, `src/proxy.ts`, `scripts/generate_office_files.py`, `scripts/verify_outputs.py`, `lint_output.txt`

**Missing:** `.env.example`, `vitest.config.*`, `CONTRIBUTING.md`, `DEPLOY.md`

---

## 9. Required Env Vars

`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `ADMIN_CLERK_IDS`

---

## 10. Action Plan — What's Needed

### Phase 1 — Security (2-3 hours) 🔴

1. **Fix User ID mismatch** in `conversations` + `user-agents` API routes (C-1)
2. **Add missing DB tables** to `supabase/schema.sql` (C-4, C-5):
   - `rate_limit_store`
   - `orchestration_jobs`
   - `agents` (with `is_public`, `is_core`, `owner_id` columns)
   - `active_tasks`
3. **Enable TypeScript strict mode** in `tsconfig.json` (C-3)
4. **Add auth guards** to `/agents`, `/showcase` pages (H-1)
5. **Create Elite Stripe price ID** (C-2)

### Phase 2 — Stability (1-2 days) 🟡

1. Fix all TypeScript strict mode errors
2. Wire `profile/page.tsx` to Supabase (H-3)
3. Wire `settings/page.tsx` to Supabase (H-4)
4. Fix in-memory `users/plan` API (H-7)
5. Consolidate dual auth to Clerk-only (H-8)
6. Verify `supabaseAdmin` export (H-11)
7. Replace `execSync` in agents/commits (H-9)

### Phase 3 — Revenue (4-8 hours) 💰

1. Create Elite Stripe price ID
2. Update marketplace with real price IDs
3. Test full checkout flow end-to-end

### Phase 4 — UX (1-2 days) 🎨

1. Wire Gallery to Supabase (replace `DEMO_ITEMS`)
2. Add CRT to `/studio`, `/generate`, `/flow`
3. Unify `PageShell` across all pages
4. Wire Boardroom orchestrator to real API (H-5)
5. Fix `generate/page.tsx` polling (M-2)
6. Dynamic model catalog for Video/Audio tools (M-11, M-12)

### Phase 5 — Testing (ongoing) 🧪

1. Install Vitest + Playwright
2. Unit tests for `llm.ts`, `rate-limiter.ts`, `supabase.ts`
3. Integration tests for wallet/auth/stripe
4. E2E: sign-in → agent chat → media gen
5. CI pipeline (GitHub Actions)

### Phase 6 — Cleanup (2-4 hours) 🧹

1. Remove or repurpose `src/daemon.ts`, `src/proxy.ts`
2. Consolidate dual Google AI SDKs (`@google/genai` + `@google/generative-ai`)
3. Update `package.json` name from `frontend` to `litlabs-website`
4. Remove deprecated `version` key from `docker-compose.yml`
5. Create `.env.example` with all required vars
6. Add `CONTRIBUTING.md` and `DEPLOY.md`

---

## Summary

| Category  | Count  | Key Issues                                                                   |
| --------- | ------ | ---------------------------------------------------------------------------- |
| CRITICAL  | 5      | User ID mismatch (2 routes), missing DB tables, strict mode, Stripe priceIds |
| HIGH      | 11     | Auth gaps, localStorage-only data, in-memory state                           |
| MEDIUM    | 13     | UX inconsistencies, hardcoded values, demo data                              |
| LOW       | 8      | Polish items                                                                 |
| **Total** | **37** | Down from 40 — 3 issues resolved since last scan                             |

**Top 3 Actions:**

1. Fix User ID mismatch in `conversations` + `user-agents` routes
2. Add missing DB tables (`agents`, `active_tasks`, `rate_limit_store`, `orchestration_jobs`)
3. Enable TypeScript strict mode and fix resulting errors
