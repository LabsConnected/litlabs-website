# LiTTree Lab Studios — Deep Scan Report

**Date:** 2026-06-08
**Agent:** explore
**Scope:** 11 pages, 40+ API routes, 5 library files

---

## Priority Tiers

### CRITICAL — Revenue + Security (Fix Now)

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| C-1 | `/api/music/generate` has NO auth | API route | Music generation (real API cost) open to anyone |
| C-2 | `/api/gemini/build` has NO auth | API route | AI code generation open to anyone |
| C-3 | `/api/users/[userId]/credits` has no admin check | API route | Any user can modify any other user's coin balance |
| C-4 | User ID mismatch — Clerk ID vs Supabase UUID | `/api/conversations`, `/api/user-agents`, `/api/agents` | Every user-scoped query returns empty results |
| C-5 | Marketplace — all 5 Stripe priceIds are empty | `marketplace/page.tsx` | Checkout fails immediately. Cannot sell coins. |
| C-6 | `/api/orchestrate` uses setInterval — broken on serverless | API route | Background agent conversations never run on Vercel |

---

### HIGH — Security + UX

| # | Issue | Location | Fix Effort |
|---|-------|----------|-----------|
| H-1 | No auth guard on 4 pages | `/agent-chat`, `/ai-builder`, `/agents`, `/showcase` | 5 min each |
| H-2 | CRT missing on 3 pages | `/flow`, `/ai-builder`, `/agents` | 10 min each |
| H-3 | Profile data localStorage only — no Supabase | `profile/page.tsx` | 30 min |
| H-4 | ActivePieces webhook URL hardcoded as secret | `builder/page.tsx` line 19 | 5 min |
| H-5 | Rate limiter in-memory — broken on serverless | `lib/rate-limiter.ts` | 1-2 hours |
| H-6 | Boardroom AI orchestrator is pure mock | `page.tsx` | 30 min |
| H-7 | Marketplace pre-installed agents hardcoded | `marketplace/page.tsx` | 20 min |
| H-8 | Settings all localStorage — no backend sync | `settings/page.tsx` | 20 min |

---

### MEDIUM — UX + Polish

| # | Issue | Location |
|---|-------|----------|
| M-1 | Profile comments are non-functional stubs | `profile/page.tsx` |
| M-2 | `generate/page.tsx` — `polling` status never set | `generate/page.tsx` |
| M-3 | `auth/logout` uses redirect() inside try/catch | `api/auth/logout/route.ts` |
| M-4 | `agents/services` hardcodes "active" — no real health checks | `api/agents/services/route.ts` |
| M-5 | CRT default inconsistency — page.tsx defaults to false, useCrtToggle defaults to true | Multiple pages |
| M-6 | `agents.ts` orchestrator in-memory only — lost on deploy | `lib/agents.ts` |
| M-7 | `agents/commits` uses execSync — won't work on Vercel | `api/agents/commits/route.ts` |

---

### LOW — Nice to Have

| # | Issue |
|---|-------|
| L-1 | Settings localStorage.clear() has no confirmation dialog |
| L-2 | Custom CSS leaves empty style tag when cleared |
| L-3 | agent-chat keyword detection has false positives |
| L-4 | Marketplace sellPrice has no input validation |
| L-5 | /api/posts/[id]/like error fallback returns `success: true` masking failures |
| L-6 | agents/logs shows hardcoded demo logs |
| L-7 | showcase page is fully static (acceptable for marketing) |

---

## What's Working Well

- Wallet API: properly wired, daily claim + spend + balance
- Gallery API: wired to Supabase with graceful fallback
- Stripe webhook: properly credits wallet on purchase
- LLM client (llm.ts): excellent failover chain, proper error handling
- Supabase: RLS enabled, service_role bypass, proper admin separation
- Auth: Clerk surfaced in navbar, UserSync guarded
- AgentTerminalTool: provider toggle, SSE streaming, CRT, agent selector
- Flow API: sequential cell execution with prior output chaining
- Rate limiter: good pattern (just needs persistent backend)
- Home Assistant integration: graceful mock fallback

---

## Recommended Coding Order

### Quick Wins (do first)
1. Add Clerk auth to `/api/music/generate` (2 min)
2. Add Clerk auth to `/api/gemini/build` (2 min)
3. Add admin check to `/api/users/[userId]/credits` (2 min)
4. Add CRT toggle to `/flow`, `/ai-builder`, `/agents` (10 min each)
5. Add auth guards to `/agent-chat`, `/ai-builder`, `/agents` (5 min each)

### Medium Effort, Big Impact
6. Fix User ID mismatch in conversations/user-agents/agents routes (1-2 hours)
7. Wire profile page to Supabase via `/api/settings/profile` (30 min)
8. Move ActivePieces URL to env var (5 min)
9. Wire settings to `/api/settings/preferences` (20 min)
10. Stripe priceIds — needs real Stripe Dashboard work (user action required)

### Eventually
11. Replace setInterval orchestrate with Supabase Edge Functions
12. Replace in-memory rate limiter with Supabase-backed one
13. Wire boardroom to real agent service
14. Fix polling status in generate page

---

## User ID Mismatch — Technical Detail

The pattern: all routes use `auth()` from Clerk to get `userId` (a Clerk-specific string like `user_abc123`). But the `users` table in Supabase has an internal UUID as its primary key (`id` column), with `clerk_id` as a separate column mapping Clerk IDs to Supabase UUIDs.

Correct pattern (already used correctly in some routes like `/api/gallery`):
```typescript
const { userId: clerkId } = await auth();
const { data: user } = await supabase.from("users").select("id").eq("clerk_id", clerkId).single();
const dbUserId = user.id; // This is the Supabase UUID
// Use dbUserId for all subsequent queries
```

Broken pattern (used in conversations, user-agents, agents):
```typescript
const { userId } = await auth();
const { data } = await supabase.from("conversations").eq("user_id", userId); // WRONG: userId is Clerk string, user_id is Supabase UUID
```

---

## API Route Audit Summary

| Route | Status | Notes |
|-------|--------|-------|
| gemini/chat | ✅ | Properly uses llm.ts with failover |
| gemini/build | 🔴 | NO AUTH — exposed |
| gemini | ✅ | Rate limited, uses llm.ts |
| agents | 🟡 | User ID mismatch bug |
| agents/[slug] | ✅ | |
| agents/status/logs/backlog/task | 🟡 | Stubs with demo fallback |
| agents/services | 🟡 | No real health checks |
| agents/commits | 🟡 | execSync won't work on Vercel |
| posts | ✅ | Properly wired |
| posts/[id]/like | ✅ | Masks errors (returns success on fail) |
| wallet | ✅ | Fully functional |
| stripe/webhook | ✅ | Credits wallet on purchase |
| stripe/checkout | ✅ | Validates priceId prefix |
| gallery | ✅ | Properly wired |
| media/generate | ✅ | 4/7 providers (Luma/Veo/Runway missing) |
| auth/session | ✅ | |
| auth/logout | 🟡 | redirect() in try/catch issue |
| auth/login | 🟡 | Hardcoded admin only, parallel auth system |
| upload | ✅ | Falls back to base64 when unconfigured |
| llm/health | ✅ | |
| account | ✅ | |
| chat | 🟡 | In-memory only |
| flow | ✅ | Best media pipeline, wallet pre-deduction |
| conversations | 🔴 | User ID mismatch |
| conversations/[id]/messages | 🔴 | User ID mismatch |
| user-agents | 🔴 | User ID mismatch |
| orchestrate | 🔴 | setInterval broken on serverless |
| webhook/clerk | ✅ | Svix signature verification |
| webhook/agent-action | 🟡 | In-memory queue |
| ha/* | ✅ | Mock fallback when not in HA mode |
| skybox/generate | ✅ | Properly deducts wallet |
| skybox/poll | ✅ | |
| music/generate | 🔴 | NO AUTH — exposed |
| storage | 🟡 | Mock URLs only |
| settings/profile | ✅ | |
| settings/preferences | ✅ | |
| users/[userId]/credits | 🔴 | NO ADMIN CHECK |
| users/[userId]/plan | 🟡 | In-memory Map — data lost on restart |

---

## Page Audit Summary

| Page | Auth | Real APIs | CRT | Key Issues |
|------|------|-----------|-----|------------|
| page.tsx (home) | Clerk | wallet, posts, gemini | Local (wrong default) | Boardroom is mock; visitor count localStorage |
| generate | Clerk | media, wallet, gallery | Local | polling status never set |
| flow | Clerk | flow, wallet, gallery | NONE | No CRT at all |
| profile | Clerk | None | Local | All data localStorage; comments stubs |
| settings | Clerk | None | Local (wrong default) | No backend sync; wipe has no confirm |
| builder | Clerk | agents, gemini/chat, wallet | Local | ActivePieces URL hardcoded |
| showcase | None | None | Local | Fully static |
| marketplace | Clerk | wallet, stripe | Local | Stripe priceIds empty; hardcoded agents |
| agent-chat | NONE | media, gemini | Local | No auth; naive keyword detection |
| ai-builder | NONE | gemini | NONE | No auth; preview is stub |
| agents | NONE | 7 agent APIs | NONE | No auth; 7 polls/5s with race risk |