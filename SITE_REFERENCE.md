# LiTTree Lab Studios — Compact Site Reference

> Generated for sharing with another AI agent. Captures the full app structure,
> pages, components, libs, and architecture without the 10GB folder.
> Repo: `E:\LiTTreeLabStudio Prod` (Next.js 16 + React 19 + Tailwind v4)
> Live: https://litlabs.net

---

## 1. Stack & Build

- **Framework:** Next.js 16.2.11 (App Router, Turbopack dev), React 19.2.7
- **Styling:** Tailwind CSS v4 (via `@tailwindcss/postcss`)
- **Auth:** Clerk (`@clerk/nextjs` 6.39.5) — wraps entire app in root layout
- **DB:** Supabase (`@supabase/supabase-js` + `@supabase/ssr`)
- **Payments:** Stripe 18
- **AI:** `@google/genai`, `@google/generative-ai`, OpenRouter, Together, Fal, MiniMax
- **Editor:** `@monaco-editor/react` + `monaco-editor` 0.55.1
- **Terminal:** `@xterm/xterm` 6, `@xterm/addon-fit`, `xterm-addon-web-links`
- **Layout:** `react-grid-layout` 2.2.4 (draggable dashboard widgets)
- **State:** `zustand` 5.0.14
- **Storage:** Cloudflare R2 (`@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`)
- **Markdown:** `react-markdown` 10
- **Validation:** `zod` 4
- **Realtime:** `socket.io-client` 4.8.3, `ws` 8.21
- **Auth tokens:** `jose` 6 (custom JWT, externalized from middleware bundle)
- **Memory:** `supermemory` 4.24
- **Evals:** `braintrust` 3.27
- **Icons:** `lucide-react` ^1.24.0 (PINNED OLD — many modern icons missing, fall back to inline SVG)
- **Compiler:** `babel-plugin-react-compiler` 1.0
- **Package manager:** pnpm 9.15.0
- **Node:** 22+ required

### Commands
```
pnpm dev              # Turbopack dev on :3000
pnpm dev:webpack      # Webpack dev (rare)
pnpm build            # Production build
pnpm lint             # ESLint flat config
pnpm test             # Vitest (jsdom)
npx tsc --noEmit      # Type-check (strict: true)
pnpm test:e2e         # Playwright
pnpm terminal:dev     # terminal-server (Docker-based, blocked in prod)
pnpm daemon:dev       # src/daemon.ts
pnpm dev:all          # web + terminal + daemon concurrently
```

### Key Config Quirks
- `cleanDistDir: false` in next.config (avoids Windows EPERM on `.next/` cleanup)
- `serverExternalPackages: ["jose"]` — jose must be externalized from middleware
- Turbopack root set to `__dirname` to suppress lockfile warning
- `ignore-scripts=true` in `.npmrc` — postinstall scripts skipped
- `strict: true` in tsconfig — full strict type checking
- `lucide-react` pinned to ^1.24.0 — fall back to inline SVG for modern icons
- Local artifacts `litlabs/`, `litlabs-website/`, `Zoo-Code/`, `work/`, `meta/` excluded from tsconfig — do NOT import from them
- Supabase migrations in `supabase/migrations/` — do NOT edit `supabase/schema.sql` directly

---

## 2. Root Layout & Providers

`src/app/layout.tsx` (216 lines) — wraps everything in this provider stack:
```
ClerkProvider (if key present) → ClerkAuthContextProvider
  → ThemeProvider → ProfileProvider → WalletProvider → VisualProvider
    → MediaHubProvider → YouTubePlayerProvider → LayoutShell
```
- Dark theme: `backgroundColor: #03050b`, Clerk `colorPrimary: #a970ff`
- SEO metadata with OG/Twitter cards, JSON-LD organization schema
- Manifest at `/manifest.json`, icons at `/icon.png`, `/favicon.ico`, `/apple-icon.png`

### Context Providers (`src/context/`)
- `AuthContext.tsx` — client-side session state
- `ClerkAuthContext.tsx` — Clerk availability flag
- `ProfileContext.tsx` — user profile data
- `ThemeContext.tsx` — theme/wallpaper
- `VisualContext.tsx` — visual pack settings
- `WalletContext.tsx` — LiTTBits balance
- `YouTubePlayerContext.tsx` — global YouTube player state

### Auth Architecture
- No global `middleware.ts` — auth per-route in API handlers + Clerk components
- `NavAuth` (`src/components/ClerkAuth.tsx`) calls `useUser()` in try-catch (intentional)
- API auth via `src/lib/auth.ts` → `auth()` returns `{ userId, clerkId }`
- Bearer token fallback for CLI/bridge clients
- Custom JWT via `src/lib/jwt.ts` (`signToken`, `verifyToken`) using jose
- API keys via `src/lib/api-keys.ts` (`validateApiKey`)

---

## 3. Pages (App Router)

### Public / Marketing
| Route | File | Lines | Notes |
|---|---|---|---|
| `/` | `page.tsx` | 64 | Home with `HomePageClient` + JSON-LD |
| `/landing` | `landing/page.tsx` | 41 | Marketing: Hero, Logos, Comparison, HowItWorks, Features, TreeOS, Stats, CTA |
| `/pricing` | `pricing/page.tsx` | 446 | Plan comparison, Stripe checkout, FAQ |
| `/showcase` | `showcase/page.tsx` | 880 | Featured projects, architecture maps, case studies, lightbox |
| `/showcase/[slug]` | `showcase/[slug]/page.tsx` | 218 | Demo project page, static params, SEO |
| `/docs` | `docs/page.tsx` | 20 | Docs hub (Suspense + DocsPageClient) |
| `/resources/facebook-growth` | `resources/facebook-growth/page.tsx` | 40 | FB growth checklist, follower goal 125→500 |
| `/privacy` | `privacy/page.tsx` | 493 | Privacy policy |
| `/terms` | `terms/page.tsx` | 262 | Terms of service |
| `/cookies` | `cookies/page.tsx` | 96 | Cookie policy |

### Auth
| Route | File | Lines | Notes |
|---|---|---|---|
| `/sign-in` | `sign-in/[[...sign-in]]/page.tsx` | 90 | Clerk SignIn, dark theme, redirect → Studio |
| `/sign-up` | `sign-up/[[...sign-up]]/page.tsx` | 90 | Clerk SignUp, 500 free credits offer |
| `/login` | `(auth)/login/page.tsx` | 5 | Legacy redirect → `/sign-in` |

### Core App (auth required)
| Route | File | Lines | Notes |
|---|---|---|---|
| `/dashboard` | `dashboard/page.tsx` | 12 | Dynamic import of `DashboardView` (no SSR) |
| `/settings` | `settings/page.tsx` | **2,611** | ⚠️ HUGE — appearance, integrations, workspace, AI models, visual packs, wallpapers, live preview |
| `/settings/connections` | `settings/connections/page.tsx` | 204 | Integration management, Meta Developer status |
| `/settings/connections/diagnostics` | `.../diagnostics/page.tsx` | 201 | PASS/WARNING/FAIL diagnostic checks |
| `/profile` | `profile/page.tsx` | 286 | Own profile, edit avatar/cover/bio, tabs |
| `/profile/[username]` | `profile/[username]/page.tsx` | 949 | Public profile, generated demo data, agent chat |
| `/wallet` | `wallet/page.tsx` | 228 | LiTTBits balance, transactions, daily bonus |
| `/projects` | `projects/page.tsx` | 177 | Quick actions → Studio, Code, Gallery, Mission Forge |
| `/deployments` | `deployments/page.tsx` | 15 | Wrapper → `DeploymentsPageClient` |
| `/gallery` | `gallery/page.tsx` | **1,770** | ⚠️ HUGE — community gallery, masonry, drag-drop upload, localStorage fallback |
| `/gallery/[id]` | `gallery/[id]/page.tsx` | 388 | Item detail, like/comment/share, video support |
| `/marketplace` | `marketplace/page.tsx` | 915 | Skills/tools/workflows/templates/agents, install/uninstall |
| `/marketplace/agents/[slug]` | `marketplace/agents/[slug]/page.tsx` | 219 | Agent detail, plan gating, starter actions |
| `/library/saved` | `library/saved/page.tsx` | 54 | Bookmarks/favorites hub |
| `/library/files` | `library/files/page.tsx` | 176 | Uploaded/generated media files |

### Studio (the main workspace — auth required)
| Route | File | Lines | Notes |
|---|---|---|---|
| `/studio` | `studio/page.tsx` | 170 | Auth guard → `CommandStudio` (the real hub) |
| `/studio/github` | `studio/github/page.tsx` | 201 | GitHub App install + repo connection |
| `/studio/image` | `studio/image/page.tsx` | 18 | Redirect → `/studio?tool=image` |
| `/studio/visual-test` | `studio/visual-test/page.tsx` | 98 | Visual verification harness |

**Studio is the heart of the app.** `CommandStudio.tsx` routes between 18+ tools via `?tool=` query param. See §5 for the full tool list.

### Redirects (legacy routes → Studio tools)
| Route | Redirects To |
|---|---|
| `/ai-builder` | `/studio?tool=workflows` |
| `/builder` | `/studio?tool=image` |
| `/litt` | `/studio` |
| `/litt-terminal` | `/studio` |
| `/agent` | `/agents` |
| `/agents` | `/studio?tool=agents` |
| `/agents/[slug]` | `/studio?tool=workflows` |
| `/agent-chat` | `/studio?tool=chat` |
| `/chat` | `/studio?tool=chat` (preserves query) |
| `/memories` | `/studio?tool=memory` |
| `/generate` | `/studio?tool=image` |
| `/social` | `/discover` |
| `/creator` | `/dashboard` |

### Standalone Tools
| Route | File | Lines | Notes |
|---|---|---|---|
| `/flow` | `flow/page.tsx` | **1,225** | Visual pipeline builder, drag-drop nodes, YAML export, AI prompts |
| `/code` | `code/page.tsx` | 986 | Code scanner, file tree, syntax highlighting, tech stack detection |
| `/voice` | `voice/page.tsx` | 48 | Voice interaction, `VoiceController`, transcripts |
| `/discover` | `discover/page.tsx` | 34 | Social feed (`SocialPageContent`) |

### Games (LiTT Arcade)
| Route | File | Lines | Notes |
|---|---|---|---|
| `/games` | `games/page.tsx` | 553 | Hub: search, favorites, iframe player, quick play |
| `/games/cloud` | `games/cloud/page.tsx` | 5 | `GameCloudHome` wrapper |
| `/games/dos` | `games/dos/page.tsx` | 102 | DOS Box Lab, js-dos 8.4, WebGL, save/load, .jsdos upload |
| `/games/retro` | `games/retro/page.tsx` | 213 | Retro arcade, ROM upload, IndexedDB storage, NES/SNES/GB/GBA/Genesis |
| `/games/retro/play/[gameId]` | `.../play/[gameId]/page.tsx` | **1,556** | EmulatorJS iframe, state machine, watchdogs, core fallback, BS-X BIOS |
| `/games/retro/test` | `games/retro/test/page.tsx` | 366 | NES vertical slice diagnostics, SHA256 validation |

### Admin
| Route | File | Lines | Notes |
|---|---|---|---|
| `/admin` | `admin/page.tsx` | 248 | Admin-only (`user_litbit`), live telemetry, galaxy map, SSE event stream |
| `/admin/terminal` | `admin/terminal/page.tsx` | 705 | Server OS commands, ANSI parsing, audit log, abort controller |

### Order
| Route | File | Lines | Notes |
|---|---|---|---|
| `/order/success` | `order/success/page.tsx` | 106 | Stripe receipt, order details, next-action links |

---

## 4. API Routes (200+ endpoints)

All under `src/app/api/`. Grouped by domain:

### Agent System
- `agents/` — list, `[slug]`, activity, backlog, chat, commits, completed, execute, logs, run, services, status, task
- `agent-tasks/` + `[taskId]/` — task queue
- `approvals/` + `[approvalId]/` — approval workflow
- `director/plan/` — director agent planning
- `orchestrate/` — orchestration entry

### AI / LLM
- `ai/chat/`, `ai-chat/` — chat endpoints
- `gemini/` — build, chat, root
- `llm/health/` — LLM provider health check
- `litt/` — artifacts, command, file, jobs, models, notify, runs, scan, think, tools, usage (+ nested `[jobId]`, `[runId]/cancel`, `[runId]/retry`, `tools/execute`)

### Studio / Builder
- `studio/` — conversations (+ `[id]`, `[id]/messages`, `[id]/regenerate`), generate, video, video/tiers
- `studio-projects/[projectId]/` — checkpoints, checks, files, preview, workspace (+ `checks/run-all`, `preview/proxy`, `workspace/prepare`)
- `builder/sessions/`
- `canvases/` + `[canvasId]/` — blocks, promote, revisions (+ nested `[blockId]`)

### Media Generation
- `media/` — generate, generate-audio, generate-music, generate-video, analyze-image, analyze-video, transcribe, search, history, playlists, providers, resolve, suggest-video-ideas, video-download, video-status, alibaba-status, apple/token, providers/status
- `music/` — generate, generations (+ `[id]`, `[id]/cancel`), tracks (+ `[id]`, `[id]/stream`)
- `skybox/` — generate, poll, poll/[id]
- `audio/`

### Auth / Users
- `auth/` — clerk, login, logout, session
- `user/ensure/`, `users/[userId]/` (+ credits, plan)
- `account/`
- `keys/` — create, list, revoke/[id]

### Billing
- `billing/` — checkout, portal, subscription
- `stripe/` — checkout, session, webhook
- `usage/` — check, stats
- `wallet/`

### Dashboard
- `dashboard/` — events, events/read, layout, mission-control, stats, widgets

### Gallery / Social
- `gallery/` — publish, `[id]`, `[id]/comments`, `[id]/like`, `[id]/share`
- `artwork/[slug]/`
- `posts/[id]/` — comments, like
- `feed/`, `follows/`

### Marketplace
- `marketplace/` — agents, agents/[id], agents/entitlements, agents/[id]/checkout, agents/[id]/install, agents/[id]/state, items, installations/[id]

### GitHub / Integrations
- `github/` — branches, callback, connection-state, diagnostics, install, installations, repositories, sync, webhook
- `gitlab/webhook/`
- `connections/` — github/sync
- `integrations/` — github/reconcile, meta-developer (callback, connect, insights, status), status
- `webhooks/meta-developer/`

### Terminal / Projects
- `terminal/` — history, token
- `capabilities/` — project-terminal
- `project/active/`, `projects/[projectId]/` — visual-builds (+ `[buildId]`, approve, retry)
- `project-runtime/`

### Missions
- `missions/[missionId]/` — cancel, events, run

### Voice
- `voice/` — health, realtime-token, token, tts
- `voice-monkey/trigger/`

### Memory / Intelligence
- `memory/search/`
- `intelligence/` — context, permissions, weather

### System / Health
- `health/`, `system/capabilities/`, `system-health/`
- `telemetry/`, `notifications/count/`
- `admin/live/`

### Connectors
- `ha/` — devices, service, state (Home Assistant)
- `n8n/[...path]` — n8n proxy
- `youtube/search/`
- `live/token/`

### Webhooks
- `webhook/` — agent-action, clerk
- `webhooks/meta-developer/`

### Deploy
- `deploy/trigger/`, `deployments/`, `deployments/digest/`

### Invites
- `invites/` — create, list, redeem, validate

### Settings
- `settings/` — agents, preferences, profile

### Bridge / CLI
- `bridge/cli/`

---

## 5. Components (`src/components/`)

### Top-level
- `LayoutShell.tsx` — main app shell (navbar + sidebar + content + footer)
- `Navbar.tsx` / `NavbarWrapper.tsx` — top navigation
- `Sidebar.tsx` — left sidebar
- `MobileBottomNav.tsx` — mobile bottom navigation
- `Footer.tsx` / `FooterWrapper.tsx`
- `PageShell.tsx` — standard page wrapper
- `DashboardView.tsx` — main dashboard view (dynamic import target)
- `AnimatedBackground.tsx` / `AnimatedBackgroundWrapper.tsx` — 30fps canvas bg (throttled, respects reduced-motion)
- `GlassCard.tsx` — glassmorphism card
- `Lightbox.tsx` / `ImageLightbox.tsx` / `ImageViewer.tsx`
- `CookieConsent.tsx`
- `CreateFAB.tsx` — floating action button
- `ErrorBoundary.tsx`
- `EventStream.tsx` — SSE event stream
- `GalaxyMap.tsx` — galaxy visualization (admin)
- `TelemetryPanel.tsx` — telemetry display
- `KeyManager.tsx` — API key management
- `ModelPicker.tsx` — AI model selector
- `PromptComposer.tsx`
- `StylePresets.tsx`
- `TemplateLibrary.tsx` / `AssetLibrary.tsx`
- `VersionHistory.tsx`
- `SocialFeed.tsx` / `SocialPageContent.tsx`
- `LiTTChatBox.tsx` / `LiTTPresenceCard.tsx`
- `NeuralImagingStudio.tsx`
- `DragDropCanvas.tsx`
- `StockAgentLibrary.tsx` / `AgentBuilder.tsx` / `AgentDashboard.tsx`
- `ClerkAuth.tsx` — NavAuth (useUser in try-catch)
- `UserSync.tsx` — syncs Clerk user to Supabase
- `HomeAuthRedirect.tsx` / `LoadingSkeleton.tsx`
- `ServiceWorkerRegistration.tsx`

### Subdirectories
- `branding/` — `BrandLogo.tsx`
- `chat/` — `MessageAvatar.tsx`
- `color/` — `ColorByNumber.tsx`, `Palette.tsx`, `TemplateGallery.tsx`
- `companion/` — `GlobalCompanion.tsx`
- `seo/` — `JsonLd.tsx`
- `ui/` — `Card`, `EmptyState`, `ErrorState`, `PageHeader`, `Panel`, `Skeleton`, `StatCard`, `StatusBadge`, `WorkspaceShell`
- `settings/` — `IntegrationCard`, `LivePreviewPanel`, `SettingsPrimitives`, `VisualPackSettings`, `WallpaperSection`
- `studio/` — `PreviewPanel`, `ProjectSourceSelector`, `SystemTopologyPanel`
- `youtube/` — `YouTubeDock`, `YouTubeMiniPlayer`, `YouTubePlayerHost`, `YouTubePlayerShell`, `YouTubeSearchPanel`
- `media/` — `MediaHubProvider`, `MediaCollapsedBar`, `MediaExpandedDrawer`, `MediaNowPlayingCard`, `MediaProviderTabs`, `MediaQueue`, `MediaUrlInput`, `MediaUtilityDock` + `providers/` (Apple, Direct, LittAsset, SoundCloud, Spotify, YouTube)
- `landing/` — `InteractiveProductDemo`, `MissionSequence`, `RealCreations`, `TrustSection`, `WhyDifferent`
- `games/` — `CategoryChips`, `DailyMissions`, `DosPlayer`, `FriendsPlaying`, `GameCard`, `GameCloudHome`, `GameHero`, `MobileGameNav`, `MultiplayerRooms`, `RetroArcadeEmbedded`, `RetroArcadeHero`, `RetroControlsModal`
- `litt-director/` — `DirectorRuntime`, `HoloDirector`, `MissionCanvas`
- `litt-terminal/` — `AgentCommandCenter`, `AgentRunner`, `AIIntelligencePanel`, `BuilderPanel`, `CodeEditor`, `CommandHistory`, `ConnectorStrip`, `DeployButton`, `FileExplorer`, `HoloDirector`, `LeftSidebar`, `LiTTAssistantPanel`, `LiTTTerminalPage`, `LogsPanel`, `OutputPanel`, `TerminalPanel`

### Dashboard (`src/components/dashboard/`)
**v1 (legacy):** `DashboardV2.tsx`, `DashboardContent.tsx`, `DashboardCards.tsx`, `DashboardWidgets.tsx`, `CommandCenter.tsx`, `DeveloperControlCenter.tsx`, `AutonomicLoopBanner.tsx`, `AudioTool.tsx`, `FileGalaxy.tsx`, `HologramCore.tsx`, `LiTTTerminal.tsx`, `MarketplacePreview.tsx`, `MusicPlayer.tsx`, `RadioPanel.tsx`, `UsageChart.tsx`, `dashboard-data.ts`

**v2 (current, in `v2/`):** `DashboardV2.tsx`, `MissionControlDashboard.tsx`, `DraggableWidgetGrid.tsx`, `DashboardV2Primitives.tsx`, `DashboardQuickCreate.tsx`, `LiTTDailyBrief.tsx`, `SystemHealthStrip.tsx`, `CommunityPulseCard.tsx`, `ContinueProjectCard.tsx`, `CurrentMissionCard.tsx`, `RecentWorkCard.tsx`, `UnifiedInboxCard.tsx`, `YourWorldCard.tsx`, `dashboard-v2-utils.tsx`, `dashboard-v2-types.ts`

**Widgets (`widgets/`):** `DashboardWidgets.tsx`, `WidgetLibraryDrawer.tsx`

### Studio Components (`src/app/studio/`)
**`components/` (44 files):** `CommandStudio.tsx` (main hub), `CommandStudioHeader.tsx`, `CommandStudioNav.tsx`, `StudioSidebar.tsx`, `StudioCommandDock.tsx`, `StudioPreviewPanel.tsx`, `StudioTerminalDrawer.tsx`, `StudioTranscript.tsx`, `StudioWorkspaceFrame.tsx`, `StudioActivityTimeline.tsx`, `StudioFloatingPresence.tsx`, `StudioHealthPanel.tsx`, `StudioInspector.tsx`, `StudioModeSwitcher.tsx`, `StudioProjectFiles.tsx`, `StudioProjectPicker.tsx`, `ProjectDrawer.tsx`, `CommandComposer.tsx`, `BuilderStream.tsx`, `GenerationHistoryCard.tsx`, `ModelPicker.tsx`, `MyAITeam.tsx`, `ShareMenu.tsx`, `LiTEmptyState.tsx`, `LiTTLivePanel.tsx`, `LiTTPresence.tsx`, `LiveVoiceOverlay.tsx`, `CameraPreview.tsx`, `CameraSession.tsx`, `MediaRecorderPanel.tsx`, `VoiceDiagnosticsPanel.tsx`, `AttachmentMenu.tsx`, `AttachmentPreviewStrip.tsx`, `GitHubProjectConnection.tsx` + `canvas/` (ActionChips, BlockRenderer, CanvasPanel, RevisionHistory)

**`context/`:** `ConversationContext.tsx`, `VoiceSessionContext.tsx`

**`hooks/`:** `useCanonicalConversation`, `useCapabilities`, `useConnectionSummary`, `useLiTTRealtimeSession`, `useMediaPermissions`, `useProjectRuntime`, `useStudioAttachments`, `useUserPlan`

**`lib/`:** `attachment-types.ts`, `builder-command-router.ts`, `create-api.ts`, `studio-destinations.ts`, `studio-intent.ts`

**`stores/` (Zustand):** `useCanvasStore.ts`, `useConversationStore.ts`, `useStudioAgentStore.ts`, `useStudioModelStore.ts`

**`tools/` (18 tools — routed via `?tool=`):**
| Tool | File | Purpose |
|---|---|---|
| `chat` | `AgentTool.tsx` | Agent chat/conversation |
| `agents` | `AgentsTerminalTool.tsx` | Agent management terminal |
| `audio` | `AudioTool.tsx` | Audio generation |
| `builder` | `BuilderTool.tsx` | Content builder |
| `cli` | `CLIBridgeTool.tsx` | CLI bridge |
| `camera` | `CameraTool.tsx` | Camera capture |
| `canvas` | `CanvasTool.tsx` | Visual canvas editing |
| `color` | `ColorByNumberTool.tsx` | Color-by-number |
| `flow` | `FlowTool.tsx` | Workflow/pipeline |
| `gallery` | `GalleryTool.tsx` | Gallery management |
| `image` | `ImageTool.tsx` | Image generation |
| `loops` | `LoopsTool.tsx` | Loop/iteration |
| `missions` | `MissionForge.tsx` | Mission/task creation |
| `memory` | `MusicTool.tsx` | (memory tool) |
| `music` | `MusicTool.tsx` | Music generation |
| `pipeline` | `PipelineTool.tsx` | Pipeline config |
| `plugins` | `PluginsTool.tsx` | Plugin management |
| `screen` | `ScreenTool.tsx` | Screen capture |
| `space` | `SpaceTool.tsx` | Space/environment |
| `video` | `VideoTool.tsx` | Video generation |

**`types/`:** `builder-blocks.ts`

---

## 6. Lib Architecture (`src/lib/`)

### Core Files (top-level)

**LiTT Assistant Brain:**
- `litt.ts` (350) — `LiTT` class singleton: notify via Discord/webhook/push/email, `agent_system_notifications` table. Exports `litt`, `jarvis` (alias)
- `litt-context.ts` (117) — `JarvisContext`, `JarvisAction`, `buildJarvisPrompt()`, `parseJarvisActions()`, `collectJarvisContext()`

**Agent Orchestration:**
- `agents.ts` (359) — `AgentOrchestrator` class, `AGENTS` record, `buildSystemPrompt()`, `simulateAgentResponse()`. Types: `Agent`, `AgentMessage`, `AgentConversation`, `ProjectContext`
- `agent-registry.ts` (~500) — Canonical source of truth: `AGENT_DEFINITIONS`, `getAgentDefinition()`. Types: `AgentDefinition`, `AgentToolPolicy`, `AgentCostPolicy`, `AgentStarterAction`, `AgentRuntime`, `AgentBillingModel`, `AgentModelTask`
- `agent-runtime.ts` — `resolveRuntimeAgent()`, `RuntimeAgent`
- `agent-selection.ts` — `parseAgentSelection()`, `BuiltinAgentSlug`
- `agent-validation.ts` — `validateAgentTaskInput()`, `BLOCKED_PATTERNS`
- `agent-work-queue.ts` / `agent-worker.ts` — background task queue + worker
- `agent-billing.ts` (366) — `reserveCredits()`, `settleRun()`, reserve→execute→settle/refund
- `agent-entitlements.ts` (704) — `resolveAgentEntitlement()`, `chargeAgentRun()`, `ChargeResult`
- `agent-logger.ts` (144) — `logCommandExecution()`, `logAgentEvent()`, `agentLog`

**Director & Planning:**
- `director-graph.ts` (60) — `DirectorGraphPlanner`, `PlanGraph`, `SubTask`

**LLM Abstraction:**
- `llm.ts` (905) — Unified client, failover chain Gemini→Groq→OpenRouter. `generateText()`, `generateJSON<T>()`, `streamText()`, `llmHealth()`. Types: `LLMTask`, `LLMProvider`, `ModelCategory`, `LLMOptions`, `LLMUsage`, `LLMResult`, `LLMHealth`. Const: `DEFAULT_MODELS`
- `llm-completion.ts` (125) — Legacy: `complete()`, `CompletionOptions`, `CompletionResult`
- `llm-executor.ts` (62) — `LlmExecutor` interface, `OpenRouterExecutor`

**Database:**
- `supabase.ts` (128) — Build-safe proxies: `getSupabase()`, `supabase`, `getSupabaseAdmin()`, `supabaseAdmin`. Types: `Agent`, `UserAgent`, `Conversation`, `Message`
- `supabase-admin.ts` (26) — `getAdminSupabase()`, `isAdminSupabaseConfigured()`
- `supabase-client.ts` (24) — Browser `createClient()` (null if env missing)
- `db.ts`, `env.ts`

**Auth & Security:**
- `auth.ts` (104) — `auth(req?)` → `{ userId, clerkId }`, `AuthResult`. Clerk + Bearer fallback
- `jwt.ts` (27) — `signToken()`, `verifyToken()` (jose)
- `api-keys.ts` (99) — `validateApiKey()`, `ApiKeyAuthResult`
- `authz.ts`, `roles.ts`, `tokens.ts`, `fetch-auth.ts`, `require-database-user.ts`

**Storage:**
- `r2.ts` (232) — `uploadAudio()`, `getSignedAudioUrl()`, `deleteAudio()`, `uploadBinaryAsset()`, `getPublicAssetUrl()`

**Usage & Billing:**
- `entitlements.ts` (125) — `getUserPlan()`, `getUserEntitlements()`, `getEntitlementsForPlan()`, `Entitlements`
- `usage.ts` (24) — `checkUsageLimit()`
- `wallet-ledger.ts` (126) — `getCreditBalances()`, `adjustWalletBalance()`, `CreditBalances`, `WalletAdjustment`

**Terminal:**
- `terminal-auth.ts` (93) — `createTerminalToken()`, `verifyTerminalToken()`
- `terminal-client.ts` (80) — `getTerminalToken()`, `terminalAuthHeaders()`, `clearTerminalTokenCache()`, `WorkspaceNotReadyError`
- `terminal-internal-client.ts` (97) — `prepareWorkspaceInternal()`, `getWorkspaceInternal()`
- ⚠️ Terminal requires Docker for prod (currently BLOCKED — see AGENTS.md)

**Site Config:**
- `siteConfig.ts` (7) — `SITE_URL`
- `seo.ts` (81) — `buildMetadata()`, `absoluteUrl()`, `SITE_NAME`, `DEFAULT_TITLE`, `DEFAULT_DESCRIPTION`
- `navigation.ts` (230) — `NAV_GROUPS`, `MOBILE_BOTTOM_ITEMS`, `QUICK_CREATE_ITEMS`, `isActive()`, `flattenNav()`

**API Helpers:**
- `api-response.ts` (370) — `readApiResponse()`, `apiFetch()`, `ApiResponseError`
- `api-route-helpers.ts` (126) — `jsonError()`, `newRequestId()`, `jsonHeaders()`, `withApiHandler()`

**Registries:**
- `capability-registry.ts` (102) — `CAPABILITY_REGISTRY`, `getCapability()`, `isCapabilityAvailable()`
- `plugin-registry.ts` (94) — `PLUGIN_REGISTRY`, `PluginDefinition`, `PluginStatus`

**Mission Control:**
- `mission-control.ts` (640) — `resolveActiveProject()`, `getMissionControlState()`, `isOwnerClerkId()`

**Other:**
- `avatars.ts`, `chatRooms.ts`, `code-scanner.ts`, `color-templates.ts`, `command-executor.ts`, `deployments.ts`, `discord.ts`, `file-audit.ts`, `games.ts`, `gemini.ts`, `github-app.ts`, `github-install-state.ts`, `ha-api.ts`, `ha-tools.ts`, `alibaba-video.ts`, `metrics.ts`, `music.ts`, `retro-arcade.ts` (351), `studio-models.ts`, `system-health.ts`, `themes.ts`, `user-db.ts`, `utils.ts`, `voice-client.ts`, `wallpapers.ts`

### Lib Subdirectories

| Dir | Files | Purpose |
|---|---|---|
| `ai/` | `client.ts`, `providers.ts` | AI client abstraction + provider config |
| `arcade/` | `EmulatorSessionController.ts` | Arcade emulator session (state machine, watchdogs) |
| `canvas/` | `actions.ts`, `repository.ts`, `types.ts` (+ tests) | Canvas/blueprint editing |
| `capabilities/` | `studio-context.ts`, `translate.ts`, `types.ts` | Agent capabilities + translation |
| `connections/` | `audit.ts`, `state.ts` | External service connection audit/state |
| `connectors/` | `connector-repository.ts`, `db-types.ts`, `provider-registry.ts` | Connector provider registry |
| `dashboard/` | `discover-widget-data.ts`, `drag-layout-store.ts`, `gallery-widget-data.ts`, `layout-store.ts`, `recent-creations.ts`, `widget-registry.ts` | Dashboard widgets + layout |
| `emulator/` | `arcade-launch.ts`, `asset-preflight.ts`, `control-profiles.ts`, `core-fallback.ts`, `rom-validation.ts`, `runtime-bridge.ts`, `types.ts`, `watchdogs.ts` | ROM emulator runtime |
| `evals/` | `braintrust.ts` | Braintrust eval integration |
| `integrations/` | `status.ts`, `types.ts` | Third-party integration status |
| `litt/` | `conversation-engine.ts`, `event-bus.ts`, `types.ts`, `canvas/canvas-engine.ts`, `capability/capability-registry.ts`, `live/LiTTRealtimeSessionController.ts`, `live/types.ts`, `voice/openai-realtime.ts`, `voice/text-only-fallback.ts` | LiTT assistant core |
| `litt-intelligence/` | `agent-identity.ts`, `agent-profiles.ts`, `evaluator.ts`, `knowledge-service.ts`, `mcp-adapter.ts`, `openapi-adapter.ts`, `permission-gate.ts`, `project-scanner.ts`, `research-engine.ts`, `research-providers.ts`, `runtime-context-injector.ts`, `tool-executor.ts`, `tool-registry.ts`, `user-context.ts`, `weather-provider.ts`, `weather-tool.ts` | LiTT intelligence: tools, research, MCP/OpenAPI |
| `litt-kernel/` | `kernel.ts`, `intent-router.ts`, `mode-router.ts`, `prompt-composer.ts`, `context-resolver.ts`, `event-bus.ts`, `capability-registry.ts`, `principles.ts`, `schemas.ts`, `types.ts` | LiTT kernel: intent/mode routing, prompt composition |
| `missions/` | `mission-executor.ts`, `mission-repository.ts` | Mission execution + repository |
| `music/` | `generation-service.ts`, `safety-filter.ts`, `providers/` (elevenlabs, factory, http, mock, mureka, index) | Music generation (ElevenLabs, Mureka) |
| `projects/` | `project-repository.ts`, `resolve-current-project.ts`, `runtime-state.ts`, `types.ts`, `use-active-project.ts` | Project repo + runtime state |
| `studio/` | `agent-registry.ts`, `conversation-service.ts`, `memory-service.ts`, `message-copy.ts`, `project-resolver.ts`, `logger.ts`, `types.ts`, `index.ts` | Studio runtime services |
| `visual-builds/` | `orchestrator.ts`, `capture.ts`, `observability.ts`, `providers.ts`, `qa.ts`, `repository.ts`, `security.ts`, `storage.ts`, `types.ts` | Visual build generation + QA |
| `visual-packs/` | `generation-presets.ts`, `types.ts` | Visual generation presets |
| `youtube/` | `YouTubePlayerController.ts`, `url-parser.ts`, `types.ts` | YouTube player control |
| `__tests__/` | `agent-registry.test.ts` | Top-level tests |

---

## 7. Database

- **Supabase project:** `rokbfvuoqildggnhappy`
- **Canonical schema:** `supabase/schema.sql` (idempotent, `public.users` with `clerk_id` column)
- **Migrations:** `supabase/migrations/` (do NOT edit schema.sql directly)
- **App code uses `.from("users")` consistently**
- Key tables (inferred): `users`, `agents`, `user_agents`, `conversations`, `messages`, `agent_logs`, `agent_system_notifications`, `wallet_ledger`, `gallery`, `posts`, `follows`, `marketplace_agents`, `marketplace_installations`, `invites`, `api_keys`, `projects`, `studio_projects`, `visual_builds`, `missions`, `deployments`, `tracks`, `music_generations`

---

## 8. Environment Variables

Copy `.env.example` → `.env.local`. Key groups:

- **Clerk:** `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `CLERK_WEBHOOK_SECRET`
- **Supabase:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- **Stripe:** `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, price IDs
- **AI:** `OPENROUTER_API_KEY`, `GEMINI_API_KEY`, `TOGETHER_API_KEY`, `FAL_KEY`, `MINIMAX_API_KEY`, `HUGGING_FACE_API_KEY`, `SKYBOX_API_KEY`
- **Auth:** `AUTH_SECRET` (gen: `openssl rand -hex 32`)
- **R2:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`
- **Misc:** `NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION`

⚠️ Production blockers (missing/placeholder): `CLERK_WEBHOOK_SECRET`, `STRIPE_SECRET_KEY` (REGENERATE_REQUIRED), `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, R2 keys, several AI provider keys

---

## 9. Known Issues & Follow-ups

### Stale Provisioning Lock (TODO)
`claimProvisioningLock()` in `src/lib/projects/project-repository.ts` transitions `workspace_status` from `not_prepared`/`failed` → `provisioning`. If the request crashes, the row stays `provisioning` forever. Need `recoverStaleProvisioning(projectId, userId, maxAgeMs)` to detect stale locks (>5min) and atomically transition `provisioning` → `failed`.

### Terminal Production (BLOCKED)
Terminal server requires Docker for workspace isolation. Railway doesn't provide Docker daemon. Need either:
- Dedicated VM with Docker + `littree-terminal:latest` image
- Sandbox provider (E2B, Fly Machines) replacing Docker

`terminal-server/Dockerfile` currently has `TERMINAL_USE_DOCKER=false` and `TERMINAL_WORKSPACE_ROOT=/tmp/...` — both must change for prod.

### Performance Notes
- `AnimatedBackground.tsx` — throttled to 30fps, pauses on tab hidden, respects `prefers-reduced-motion`
- Do NOT add frequent `setInterval`/`setTimeout` in client components without cleanup guards + visibility checks
- Never leave `console.log`/`console.warn`/`console.error` in server-side code (API routes, `src/lib/*.ts`)

---

## 10. CI / Deploy

- **GitHub Actions:** build/type-check, terminal deployment, Lighthouse, cron jobs (deploy digest, music worker)
- **Build workflow** is the required quality gate for PRs (lint + tests + TS + prod build)
- **Railway:** web, terminal-server, voice-worker services (see `railway.json` and `RAILWAY.md`)
- **Deploy:** push to `main` triggers Railway deployment. Heavy builds (`/studio`, image gen) belong in GitHub Codespaces
- **Cron jobs:** GitHub Actions scheduled workflows (replaced former Vercel Cron)

---

## 11. File Size Hotspots (largest pages)

| File | Lines | Note |
|---|---|---|
| `settings/page.tsx` | 2,611 | ⚠️ Settings mega-page — candidate for splitting |
| `games/retro/play/[gameId]/page.tsx` | 1,556 | Emulator runtime |
| `gallery/page.tsx` | 1,770 | ⚠️ Gallery — candidate for splitting |
| `flow/page.tsx` | 1,225 | Visual pipeline builder |
| `code/page.tsx` | 986 | Code scanner |
| `profile/[username]/page.tsx` | 949 | Public profile |
| `marketplace/page.tsx` | 915 | Marketplace |
| `showcase/page.tsx` | 880 | Showcase |
| `admin/terminal/page.tsx` | 705 | Admin terminal |

---

*End of reference. Generated 2026-08-05 from repo at `E:\LiTTreeLabStudio Prod`.*
