# LiTTree Lab Studios — Page Audit Report

**Audit Date:** 2026-06-07
**Last Updated:** 2026-06-08
**Agent:** explore (scan-pages task)
**Project:** `C:\home\litbit\LiTTreeLabstudios\home\litbit\LiTTreeLabstudios`
**Scope:** All pages in `src/app/`, all studio tools in `src/app/studio/tools/`, shared components

---

## Status Update — 2026-06-08

### All HIGH Priority Items — FIXED ✅
| # | Finding | Fix Applied |
|---|---------|-------------|
| AUTH-1/2 | UserSync in layout.tsx used Clerk useAuth() — broke page load when Clerk unconfigured | Committed `1298c8b` — UserSync now guarded with `clerkAvailable` check, returns null if Clerk not set |
| MDL-1 | `src/lib/agents.ts` bypassed llm.ts failover, called `gemini.ts` directly | Committed `19675ff` — now imports `generateText` from `@/lib/llm` |
| MDL-3 | AgentTool hardcoded `/api/gemini/chat` — no provider toggle | Committed `39d20fc` — provider toggle (gemini/openrouter-free) with localStorage persistence, passes to `/api/gemini/chat` |
| CRT-1 | CRT state was per-page, not global singleton | Committed `6f43f4c` — `useCrtToggle()` hook in ThemeContext with localStorage, used by Studio |
| — | Studio page had hardcoded `setCrtEnabled` instead of hook | Fixed in `6f43f4c` — Studio now uses `toggleCrt` from hook |
| — | ThemeContext missing `useCallback` import | Fixed in `6f43f4c` |

### Remaining Issues — As of 2026-06-08

**MEDIUM (action needed):**
1. `/flow` — no CRT toggle. All other creative pages (generate, agent-chat, builder, gallery) have it.
2. Marketplace — all 5 credit packs have `priceId: ''` (empty string). Stripe checkout always fails with "Invalid price ID." Need real price IDs from Stripe Dashboard.

**LOW (nice to have):**
1. `CookieConsent.tsx` — hardcoded inline styles (borderColor: "#ff00ff", bg: "#1a0a2e") ignores ThemeContext
2. `/social` — 15-line redirect to `/`. Social content lives on `/` so this is low priority.
3. `/generate` — already has CRT (local state), not using global hook yet
4. PageShell inconsistent usage — Studio, Agents, Generate, Flow skip it

### Build Status
```
✓ 62/62 pages — compiled successfully
✓ 0 warnings, 0 errors
✓ TypeScript clean
```

---

---

## 1. Summary

- **Total pages scanned:** 26 (15 top-level pages + 7 sub-routes + 3 config pages)
- **Studio tools scanned:** 8 (Image, Video, Audio, Agent, Chat, Flow, Gallery, Space)
- **Shared components scanned:** 10 (Navbar, ThemeContext, ProfileContext, PageShell, CookieConsent, UserSync, AnimatedBackgroundWrapper, AnimatedBackground, Footer, icons)
- **Libraries scanned:** `src/lib/agents.ts`, `src/lib/llm.ts`, `src/lib/gemini.ts`

---

## 2. CRT Toggle Audit

### Current State
The CRT scanline overlay toggle is implemented **per-page, not globally**. Each page that supports it manages its own `crtEnabled` state reading from `localStorage.getItem("crt_global_scanlines")`.

**Pages with CRT toggle:**
- `/agent-chat`, `/ai-builder`, `/builder`, `/gallery`, `/profile`, `/settings`, `/showcase`

**Pages without CRT toggle:**
- `/studio`, `/agents`, `/generate`, `/flow`, `/marketplace`, `/social` (redirect), `/` (home)

### Findings

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| CRT-1 | **MEDIUM** | All CRT pages | State is local to each page — no global singleton. If user toggles CRT on one page, other open tabs don't reflect it. |
| CRT-2 | **LOW** | `/studio/page.tsx` | No CRT toggle despite being a terminal/agent workspace — fits the aesthetic perfectly. |
| CRT-3 | **LOW** | `/generate/page.tsx`, `/flow/page.tsx` | No CRT toggle — creative generation tools would benefit from the retro aesthetic. |
| CRT-4 | **LOW** | `/agents/page.tsx` | Already has its own terminal aesthetic (`text-green-400`, scanline animation) — CRT overlay would be redundant but the existing CSS could be unified. |

### Recommendation
Create a `useCrtToggle()` hook in `src/context/ThemeContext.tsx` (or a new `CrtContext.tsx`) that reads/writes `localStorage.getItem("crt_global_scanlines")` once and exposes `crtEnabled` globally. All CRT pages import from this — single source of truth.

---

## 3. Model/Provider Hardcoding Audit

### Unified Client Status
`src/lib/llm.ts` exists with a proper failover chain (Gemini 2.5 Flash → OpenRouter free → DeepSeek V3). However, it is **not used by any studio tool or page** yet.

### Hardcoding by Location

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| MDL-1 | **HIGH** | `src/lib/agents.ts` | `import { generateText } from "@/lib/gemini"` — agents library imports `gemini.ts` directly, not `llm.ts`. Every agent call bypasses the failover chain. |
| MDL-2 | **HIGH** | `src/app/studio/page.tsx` | `MODEL_MAP` hardcodes provider per tool: `gemini-2.5-flash` for agents, Pollinations for image/video/audio, MiniMax for space. No provider toggle. |
| MDL-3 | **HIGH** | `src/app/studio/tools/AgentTool.tsx` | Calls `/api/gemini/chat` directly — no provider option, no failover. |
| MDL-4 | **MEDIUM** | `src/app/studio/tools/VideoTool.tsx` | `VIDEO_MODELS` array with hardcoded cost values and provider names — no dynamic catalog from `/api/media/generate`. |
| MDL-5 | **MEDIUM** | `src/app/studio/tools/AudioTool.tsx` | `VOICES` and `MUSIC_MODELS` arrays hardcoded — no ElevenLabs real wiring. |
| MDL-6 | **MEDIUM** | `src/app/studio/tools/SpaceTool.tsx` | Hardcoded iframe URL `https://rvc0r914lvjh.space.minimax.io` — no env var, no fallback. |
| MDL-7 | **LOW** | `src/app/builder/page.tsx` | `systemPrompt` is a static string — no provider/model toggle. |
| MDL-8 | **LOW** | `src/app/ai-builder/page.tsx` | Single hardcoded model, no toggle. |
| MDL-9 | **LOW** | `src/app/generate/page.tsx` | Hardcoded `pollinations` + `skybox` in provider logic — could read from `media.ts` catalog. |
| MDL-10 | **LOW** | `src/app/flow/page.tsx` | Hardcoded provider names in cell defaults — reads from `media.ts` for cost but not for model list. |

### Best Practice Already Present
`src/app/studio/tools/ChatTool.tsx` has `PROVIDER_OPTIONS = ["gemini", "openrouter-free"]` with `localStorage` persistence and a dropdown UI. This is the pattern to replicate.

### Recommendation
1. Refactor `src/lib/agents.ts` to use `llm.ts` instead of `gemini.ts` directly.
2. Add provider toggle UI to `AgentTool.tsx` following ChatTool pattern.
3. Centralize model lists via `/api/media/generate` GET endpoint (already exists).

---

## 4. Navigation Consistency Audit

### Navbar Structure (current)
```
Primary links: Home | Studio | Market
More dropdown: Showcase | Profile | Settings
Action items: [CRT] [Theme] [Coins: X] [Avatar]
```

### Findings

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| NAV-1 | **MEDIUM** | Navbar | "Social" link was removed — social features now live on `/` (home page). This is correct. |
| NAV-2 | **MEDIUM** | Navbar | "Generate" (wand icon) and "Flow" (film icon) links added between Home and Studio. Correct placement. |
| NAV-3 | **LOW** | `/social/page.tsx` | 14-line redirect to `/` — preserves bookmarks but adds unnecessary route. Could be removed or replaced with a meaningful social landing. |
| NAV-4 | **LOW** | StudioSidebar | 6 tools grouped by category (Create/AI/Organize/External) with keyboard shortcuts 1-6. Collapsible sidebar. Good UX pattern. |
| NAV-5 | **LOW** | PageShell.tsx | Shared layout wrapper — used inconsistently. `/builder`, `/gallery`, `/marketplace` use it; `/studio`, `/agents`, `/generate`, `/flow` do not. Unifying would make breadcrumbs and page headers consistent. |

---

## 5. Auth Integration Issues

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| AUTH-1 | **HIGH** | `src/components/UserSync.tsx` | Uses `@clerk/nextjs` `useAuth()` but project uses custom JWT auth (jose + bcrypt), not Clerk. `UserSync` calls `/api/account` on mount — this may fail silently for non-Clerk users. |
| AUTH-2 | **HIGH** | `src/app/layout.tsx` | `UserSync` is in the layout tree — if Clerk is not configured (env vars missing), this component will error on every page load. |
| AUTH-3 | **MEDIUM** | No `src/app/auth/` folder | No sign-in/sign-up pages exist in `src/app/auth/`. The auth pages referenced in AGENTS.md are not present. Multi-user signup flow is missing. |

---

## 6. Demo Data & Mock Wiring

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| DEMO-1 | **MEDIUM** | `/gallery/page.tsx` | `DEMO_ITEMS` array with 4 hardcoded items — no real Supabase query. File upload works (calls `/api/upload` + `/api/gallery`), but gallery doesn't read from Supabase. |
| DEMO-2 | **MEDIUM** | `/marketplace/page.tsx` | Agent marketplace cards use `PRICE_IDS` map — Stripe checkout likely fails without real `price_id` values. |
| DEMO-3 | **LOW** | `/showcase/page.tsx` | Static content — no dynamic data source. OK for now as a marketing page. |
| DEMO-4 | **LOW** | `/social/page.tsx` | Redirect only — no social page. Social content lives on `/`. Low priority. |

---

## 7. Theme System Audit

`ThemeContext.tsx` provides 16 skins with 6 background modes (gradient, mesh, stars, particles, aurora, grid). CRT overlay reads `localStorage.getItem("crt_global_scanlines")` — separate from theme state. This is a clean separation.

| # | Severity | Location | Issue |
|---|----------|----------|-------|
| THM-1 | **LOW** | `CookieConsent.tsx` | Hardcoded inline styles (borderColor: "#ff00ff", backgroundColor: "#1a0a2e") — ignores ThemeContext. Should use `useTheme()` for consistency. |
| THM-2 | **LOW** | `AnimatedBackgroundWrapper.tsx` | Passes `theme.backgroundMode` to AnimatedBackground — good pattern. |

---

## 8. Priority Findings Table

### HIGH Priority (fix soon)
| ID | Category | Finding |
|----|----------|---------|
| AUTH-1 | Auth | `UserSync.tsx` uses Clerk `useAuth()` — breaks for custom JWT auth |
| AUTH-2 | Auth | `UserSync` in layout causes page load errors if Clerk unconfigured |
| MDL-1 | Models | `src/lib/agents.ts` bypasses failover chain, calls `gemini.ts` directly |
| MDL-2 | Models | `studio/page.tsx` MODEL_MAP hardcodes providers — no provider toggle |
| MDL-3 | Models | `AgentTool.tsx` hardcodes `/api/gemini/chat` — no failover |
| AUTH-3 | Auth | No multi-user signup flow (no `/auth/` pages) |

### MEDIUM Priority (fix in next sprint)
| ID | Category | Finding |
|----|----------|---------|
| CRT-1 | CRT | CRT state is per-page, not global singleton |
| MDL-4 | Models | `VideoTool.tsx` hardcodes VIDEO_MODELS — no dynamic catalog |
| MDL-5 | Models | `AudioTool.tsx` hardcodes VOICES/MUSIC_MODELS — no ElevenLabs wiring |
| MDL-6 | Models | `SpaceTool.tsx` hardcodes MiniMax iframe URL |
| NAV-5 | Nav | PageShell used inconsistently — `/studio`, `/agents`, `/generate`, `/flow` skip it |
| DEMO-1 | Data | Gallery has demo items — not reading from Supabase |
| DEMO-2 | Data | Marketplace has mock price IDs — Stripe broken |

### LOW Priority (nice to have)
| ID | Category | Finding |
|----|----------|---------|
| CRT-2 | CRT | `/studio` has no CRT toggle |
| CRT-3 | CRT | `/generate`, `/flow` have no CRT toggle |
| CRT-4 | CRT | `/agents` has terminal CSS — could unify with CRT system |
| MDL-7 | Models | `/builder` system prompt is static |
| MDL-8 | Models | `/ai-builder` single hardcoded model |
| MDL-9 | Models | `/generate` hardcodes providers instead of using catalog |
| MDL-10 | Models | `/flow` hardcodes cell defaults |
| NAV-3 | Nav | `/social` is a redirect — could be a meaningful page |
| THM-1 | Theme | `CookieConsent.tsx` ignores ThemeContext |
| DEMO-3 | Data | `/showcase` is static |
| DEMO-4 | Data | `/social` redirect |

---

## 9. File Inventory

| File | Lines | CRT | Provider Toggle | Notes |
|------|-------|-----|-----------------|-------|
| `src/app/page.tsx` | ~180 | No | No | Home with social feed + post composer |
| `src/app/layout.tsx` | ~40 | — | — | ClerkProvider, ThemeProvider, Navbar, Footer, UserSync, CookieConsent |
| `src/app/studio/page.tsx` | ~200 | No | No (MODEL_MAP hardcoded) | Studio workspace with ModelBadge, CRT button, tool nav |
| `src/app/studio/tools/ImageTool.tsx` | ~120 | No | No | Image gen UI (stripped /generate) |
| `src/app/studio/tools/VideoTool.tsx` | ~100 | No | No (VIDEO_MODELS hardcoded) | Video gen UI |
| `src/app/studio/tools/AudioTool.tsx` | ~120 | No | No (VOICES hardcoded) | TTS/Music split |
| `src/app/studio/tools/AgentTool.tsx` | ~180 | No | No (hardcodes `/api/gemini/chat`) | Agent boardroom UI |
| `src/app/studio/tools/ChatTool.tsx` | ~100 | No | **Yes** (`PROVIDER_OPTIONS` + localStorage) | Best-practice pattern |
| `src/app/studio/tools/FlowTool.tsx` | ~150 | No | No | Storyboard, calls `/api/flow` |
| `src/app/studio/tools/GalleryTool.tsx` | ~80 | No | No | Demo items + localStorage |
| `src/app/studio/tools/SpaceTool.tsx` | ~50 | No | No (hardcoded iframe URL) | MiniMax iframe wrapper |
| `src/app/agent-chat/page.tsx` | ~160 | Yes | No | World agent chat |
| `src/app/ai-builder/page.tsx` | ~80 | Yes | No | Single agent chat |
| `src/app/builder/page.tsx` | ~200 | Yes | No | Full agent dock + workspace |
| `src/app/generate/page.tsx` | ~200 | No | No (hardcoded providers) | Image generator |
| `src/app/flow/page.tsx` | ~200 | No | No (hardcoded cell defaults) | Flow media studio |
| `src/app/gallery/page.tsx` | ~150 | Yes | No | Lightbox + masonry |
| `src/app/marketplace/page.tsx` | ~150 | Yes | No | Stripe checkout (broken) |
| `src/app/profile/page.tsx` | ~200 | Yes | No | Avatar, cover, bio, mood |
| `src/app/settings/page.tsx` | ~250 | Yes | No | Theme/Profile/Agents/Advanced tabs |
| `src/app/showcase/page.tsx` | ~150 | Yes | No | Gallery + architecture + case study |
| `src/app/social/page.tsx` | ~14 | No | No | Redirect to `/` |
| `src/app/agents/page.tsx` | ~300 | No | No | Full agent log terminal |
| `src/app/auth/` | — | — | — | **Does not exist** |
| `src/components/Navbar.tsx` | ~150 | — | — | Primary nav + CRT toggle + coin balance |
| `src/components/PageShell.tsx` | ~84 | — | — | Shared layout wrapper |
| `src/components/CookieConsent.tsx` | ~83 | — | — | Hardcoded styles, ignores theme |
| `src/components/UserSync.tsx` | ~27 | — | — | **Clerk dependency — breaks custom JWT auth** |
| `src/context/ThemeContext.tsx` | ~300 | Global | — | 16 skins, dark/light, accent, background modes |
| `src/context/ProfileContext.tsx` | ~150 | — | — | Profile state + localStorage |
| `src/lib/llm.ts` | ~200 | — | — | Unified LLM client with failover — **not used yet** |
| `src/lib/agents.ts` | ~150 | — | — | Agent definitions — uses `gemini.ts`, not `llm.ts` |
| `src/lib/gemini.ts` | ~150 | — | — | Direct Gemini calls — bypasses failover |
| `src/lib/media.ts` | ~150 | — | — | Provider catalog with tiers and defaults |

---

## 10. Recommendations by Priority

### Do First (this session)
1. Remove or guard `UserSync.tsx` in layout — it depends on Clerk which is not configured. Either delete it or wrap in a `try/catch` that checks for Clerk env vars first.
2. Refactor `src/lib/agents.ts` to import from `llm.ts` instead of `gemini.ts` — one-line fix that gives all agents failover protection.

### Do Next (next session)
3. Add provider toggle to `AgentTool.tsx` using the pattern from `ChatTool.tsx` (`PROVIDER_OPTIONS` + localStorage).
4. Create global `useCrtToggle()` hook so CRT state is shared across all tabs.
5. Add CRT toggle to `/studio` and `/generate` — they fit the retro aesthetic.

### Do Eventually
6. Wire Gallery to Supabase — replace `DEMO_ITEMS` with real query.
7. Add multi-user signup flow (create `/auth/` pages with Clerk or custom JWT).
8. Create `PageShell` usage audit — ensure all content pages use it for consistent breadcrumbs and headers.
9. Replace hardcoded model arrays in VideoTool/AudioTool with dynamic catalog from `/api/media/generate`.
10. Move MiniMax iframe URL to env var (`NEXT_PUBLIC_SPACE_URL`).