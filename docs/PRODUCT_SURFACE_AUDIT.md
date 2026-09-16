# PRODUCT_SURFACE_AUDIT

Baseline: `ffca0411` (main, 2026-09-15). Auth boundary source of truth: `src/proxy.ts` (`isProtectedRoute`).

Status legend: ✅ working · 🟡 partial · 🧪 placeholder/demo · 💀 dead CTA · 🔁 duplicate surface · → redirect

## Canonical destinations

| Route | Access | Purpose | Status | Mobile | Verdict |
|---|---|---|---|---|---|
| `/` (marketing) | public | Landing | ✅ | ✅ | keep |
| `/studio` | auth | Canonical work surface (chat, build, preview, missions, more) | ✅ | ✅ | keep — THE product |
| `/dashboard` | auth | Overview | ✅ | ✅ | keep |
| `/projects` | auth | Project list | ✅ | ✅ | keep — add to main nav |
| `/marketplace` | public browse / auth install | Capability + agent marketplace | 🟡 (see below) | ✅ | keep |
| `/discover` | public | Community feed | 🟡 sample feed labeled "coming soon" | ✅ | keep, honestly labeled; consider nav label "Explore" |
| `/docs/*` | public | Documentation (7 pages) | ✅ | ✅ | keep, indexable |
| `/pricing` | public | Pricing | ✅ | ✅ | keep, indexable |
| `/cli` | public | CLI landing | ✅ | ✅ | keep, indexable |
| `/showcase`, `/showcase/[slug]` | public | Public project showcase | ✅ | ✅ | keep |
| `/sign-in`, `/sign-up`, `/login`, `/oauth-consent` | public | Auth | ✅ | ✅ | keep |

## Redirects (legacy → canonical) — all intentional, keep

| Route | Target |
|---|---|
| `/agent` | `/agents` → `/studio?tool=agents` |
| `/agent-chat` | `/studio?tool=chat` |
| `/agents` | `/studio?tool=agents` |
| `/ai-builder` | `/studio?tool=workflows` |
| `/builder` | `/studio?tool=build` |
| `/chat` | `/studio?tool=chat` (param-aware via `buildChatRedirectUrl`) |
| `/creator` | `/dashboard` |
| `/gallery` | `/showcase` |
| `/gallery/[id]` | `notFound()` — intentionally retired |
| `/generate` | `/studio?tool=image` |
| `/hire` | `/studio` |
| `/litt` | `/studio` |
| `/litt-terminal` | `/studio` |
| `/memories` | `/studio?tool=memory` |
| `/social` | `/discover` |
| `/studio/image` | `/studio?tool=image` (client redirect) |

## Authenticated pages (all noindex via layout `robots: {index:false}`)

| Route | Status | Notes | Verdict |
|---|---|---|---|
| `/dashboard` | ✅ | | keep |
| `/projects` | ✅ | | keep |
| `/studio` + subroutes | ✅ | `/studio/github` = GitHub connect surface; `/studio/visual-test` = guarded dev harness | keep |
| `/deployments` | ✅ | noindex in page metadata | keep |
| `/settings`, `/settings/connections`, `/settings/connections/diagnostics` | ✅ | | keep |
| `/wallet` | 🟡 | `?tab=history` shows "Full transaction history is coming soon" stub — no live UI links to it; reachable only by URL. Actionable CTA to `/settings?section=billing` present | keep; remove or wire history tab |
| `/profile`, `/profile/[username]` | ✅ | public profile page is auth-protected | keep |
| `/library/files`, `/library/saved` | ✅ | | keep — add to secondary nav |
| `/flow` | 🧪 **fake** | `runPipeline` is setTimeout animation + `Math.random()` tokens + simulated `[OK]` logs. Not linked from live nav, but reachable by URL. Real pipeline surface is Studio Mission Forge (`?tool=workflows`) which posts to `/api/flow` | **redirect `/flow` → `/studio?tool=workflows`** (mirrors `/ai-builder`) |
| `/code` | ✅ | Code scanner, real file tree | keep; candidate for secondary nav |
| `/voice` | ✅ | Real VoiceController orb | keep |
| `/owner` | ✅ | n8n health; client-side `NEXT_PUBLIC_ADMIN_USER_ID` gate (view-only; APIs auth server-side) | keep; internal |
| `/admin`, `/admin/terminal` | ✅ | EventSource `/api/admin/live` | keep; internal |
| `/runtime-test` | 🟡 | client page, **missing noindex** (no layout) | add noindex; internal tool |
| `/order/success` | ✅ | covered by `order/layout.tsx` noindex | keep |
| `/memories` | → | redirects to `/studio?tool=memory` | keep |

## Findings — unfinished-product signals

| # | Surface | Signal | Severity | Action |
|---|---|---|---|---|
| 1 | `/flow` standalone page | Fake pipeline execution (setTimeout + random tokens + fake OK logs) | **P1** | Redirect to `/studio?tool=workflows` |
| 2 | `/discover` | "Sample feed — community posts coming soon" banner when API returns mock | P2 | Honestly labeled; keep but flag — feed is not real |
| 3 | `/wallet?tab=history` | "Full transaction history is coming soon" | P2 | No live UI links here; has real CTA to settings/billing. Remove stub or keep honest text |
| 4 | Marketplace capability items | `?capability=` param in "Use in Studio" link is **read by nothing**; `CAPABILITY_REGISTRY` has no executors; installed capabilities never reach the agent loop | **P1** | Remove "Use in Studio" CTA for capability items, or wire capability activation |
| 5 | Marketplace `coming_soon` items | Dimmed card, "Coming soon" label, no install CTA | ✅ correct | keep as-is (honest) |
| 6 | `AgentModelViewer` | "3D model coming soon" — shows artwork fallback | P2 | Honest fallback text; acceptable |
| 7 | `LiTTTerminalPage` | `{tab} tab coming soon` — **dead component**, not imported anywhere; `/litt-terminal` redirects to `/studio` | P3 | dead code, not user-visible; safe to delete |
| 8 | `/runtime-test` | Missing noindex | P2 | add layout with `robots:{index:false}` |
| 9 | Marketing pricing copy | "Cinema and 4K are coming soon" in plan text | P3 | honest marketing copy; acceptable |

## Navigation (current → requested canonical)

Current `APP_NAV_SECTIONS`: Command→Dashboard; Studio→Studio; Explore→Games(flag-gated)/Discover/Marketplace. Bottom: Wallet, Settings. Account menu: Profile/Wallet/Settings.

Requested: **Main**: Dashboard, Studio, Projects, Explore, Marketplace. **Secondary**: Library, Wallet/Billing, Developer Tools (CLI, Terminal, Connections, Docs), Settings, Profile.

Gaps: Projects not in main nav; no Library; no Developer Tools group (CLI/Terminal/Connections/Docs); Explore should map to `/discover`.

## CLI verification (task 7) — ✅ verified 2026-09-15

- `npm i -g @litlabs1/litt-cli` — clean install, 62 pkgs
- `litt --version` → `litt 0.1.0`
- `litt --help` → full command list
- `litt doctor` → real checks (Node/Git/pnpm/network/project detection: correctly reports non-repo and detects Next.js/pnpm/TS/branch in real repo)
- `litt login` — browser PKCE flow (interactive auth not headlessly verified)
- `/cli` + `/docs/cli` pages exist, indexable
- **Gap**: CLI not exposed in authenticated nav (no Developer Tools section)

## First-user flow (task 8)

Current: Landing → `/sign-up` → `fallbackRedirectUrl=/studio` → Studio shows FirstMissionLaunchpad (no_project → start_blank_project → workspace prepare → describe idea). Matches requested linear flow; no Builder/AI-Builder/Flow/Forge choice is presented to new users — those routes all redirect into Studio.

## SEO/noindex (task 10)

All auth pages have `robots:{index:false}` via layout or page metadata **except `/runtime-test`** (client page, no layout). Marketing/docs/pricing/cli/showcase/games indexable.

## Catch-up changes applied in this pass (branch: product-audit)

| Change | File(s) | Status |
|---|---|---|
| `/flow` → redirect to `/studio?tool=workflows` (removed 1,230-line fake pipeline) | `src/app/(app)/flow/page.tsx` | applied |
| Marketplace: dependency items link to `/settings/connections`; installed+enabled shows truthful "Active" (removed dead `?capability=` CTA nothing consumed) | `src/app/(app)/marketplace/page.tsx` | applied |
| Canonical nav: single `main` section (Dashboard, Studio, Projects, Explore, Marketplace + flag-gated Games); new `APP_NAV_SECONDARY` (Library, Developer Tools) rendered in the account menu | `src/lib/navigation.ts`, `src/components/AppShell.tsx` | applied, tests updated |
| `/runtime-test` noindex | `src/app/(app)/runtime-test/layout.tsx` | applied |
| Media dock tab: truthful empty state when media hub is hidden (was a blank panel) | `src/components/media/MediaUtilityDock.tsx` | applied |
| MusicTool: removed "Upload Audio" tab — working-looking tab leading to a disabled button + "coming soon" | `src/app/(app)/studio/tools/MusicTool.tsx` | applied |
| Wallet `?tab=history`: removed "coming soon" copy; points to real Stripe portal history via Settings→Billing | `src/app/(app)/wallet/page.tsx` | applied |
| AgentModelViewer: removed "3D model coming soon" footer (honest "Premium artwork shown") | `src/app/(app)/studio/tools/AgentModelViewer.tsx` | applied |
| Dashboard RecentMedia: video Play / image View buttons had empty handlers — now open the real asset URL | `src/components/dashboard/v3/RecentMedia.tsx` | applied |
| `docs/PRODUCT_SURFACE_AUDIT.md` | this file | new |

## Related fixes shipped as separate PRs this pass

| PR | Fix | Status |
|---|---|---|
| #301 | `/api/conversations` HTTP 500 — invalid PostgREST embed on TEXT `agent_id` | merged `5ffa4f3b`, prod verified 200 |
| #303 | `/studio` React #418 hydration mismatch (SSR loading branch vs Clerk-ready client render) | in review |

## Remaining known items (not hidden — tracked)

| Item | Status |
|---|---|
| `/api/owner/test-mode` 403 | **expected** — owner-only endpoint correctly rejects non-owners; smoke filters it |
| `LiTTTerminalPage` "{tab} coming soon" | dead component, not imported anywhere; P3 delete |
| Discover mock feed | only when Supabase admin unconfigured; banner is honest; prod serves real posts |
| Marketplace `coming_soon` items | correctly dimmed, no install CTA — intentional honest labeling |
| Marketplace capability activation | installed capabilities persist, but `capability_key` never reaches the agent loop — capabilities are catalog entries, not runtime executors. The dead "Use in Studio" CTA was removed; wiring capability→agent is future work (P3) |
| Route-level Playwright acceptance suite | P3 — the prod Activity smoke + Ember Roast golden are the current coverage |
