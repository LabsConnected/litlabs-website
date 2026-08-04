# LiTTree Lab Studios — Full Codebase Blueprint

> Generated 2026-07-26. 510 source files, 142 API routes, 54 pages, 3 servers.

## Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 16.2.10 (Turbopack) + React 19 + React Compiler |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS v4 |
| Auth | Clerk (`@clerk/nextjs` 6.39) + custom JWT (`jose`) |
| Database | Supabase (Postgres) — service role + anon |
| Payments | Stripe 18 |
| AI | OpenRouter, Gemini (`@google/genai`), Together, Fal, MiniMax |
| Storage | Cloudflare R2 (`@aws-sdk/client-s3`) |
| Editor | Monaco (`@monaco-editor/react`) |
| Terminal | xterm.js + socket.io + custom terminal-server |
| State | Zustand 5 |
| Validation | Zod 4 |
| Package manager | pnpm 9.15 (workspaces) |
| Deploy | Vercel (main app) + Railway (terminal-server, voice-server) |
| Testing | Vitest 2 + jsdom + Testing Library |

## Deployments

| Service | Platform | URL |
|---|---|---|
| Main app (Next.js) | Vercel | `litlabs.net` |
| Terminal server | Railway | `*.up.railway.app` (WebSocket) |
| Voice proxy | Railway | `*.up.railway.app` (Inworld relay) |

## Top-level structure

```
litlab/
├── src/                    # Main Next.js app (517 files)
├── public/                 # Static assets (83 files: images, icons, games, sounds)
├── supabase/               # DB schema + 39 migrations
├── terminal-server/        # WebSocket terminal server (Railway)
├── voice-server/           # Inworld voice proxy (Railway)
├── packages/litt-agent-core/  # Shared agent core library
├── scripts/                # Deploy + diagnostics scripts
├── tests/                  # Integration tests
├── docker/                 # Dockerfiles
├── docs/                   # Documentation
├── prds/                   # Product requirement docs
├── prompts/                # AI prompt templates
├── tasks/                  # Task tracking
├── cli/                    # CLI bridge
├── OmniRoute/              # Routing config
└── .devcontainer/          # Codespaces config
```

---

## src/ — Main application

### src/app/ — Next.js App Router (161 routes)

#### Pages (user-facing)

| Route | File | Purpose |
|---|---|---|
| `/` | `page.tsx` | Home → redirects to dashboard or landing |
| `/landing` | `landing/page.tsx` | Marketing landing page |
| `/dashboard` | `dashboard/page.tsx` | Main user dashboard |
| `/studio` | `studio/page.tsx` | **AI Studio** — the main workspace |
| `/studio/github` | `studio/github/page.tsx` | GitHub connection flow |
| `/studio/image` | `studio/image/page.tsx` | Image generation (redirects to studio) |
| `/agents` | `agents/page.tsx` | Agent marketplace/listing |
| `/agents/[slug]` | `agents/[slug]/page.tsx` | Individual agent page |
| `/gallery` | `gallery/page.tsx` | Public creation gallery |
| `/gallery/[id]` | `gallery/[id]/page.tsx` | Individual artwork |
| `/marketplace` | `marketplace/page.tsx` | Capability marketplace |
| `/pricing` | `pricing/page.tsx` | Pricing plans (LiTTBits) |
| `/games` | `games/page.tsx` | Game Cloud hub |
| `/games/cloud` | `games/cloud/page.tsx` | Browser games |
| `/games/retro` | `games/retro/page.tsx` | Retro Arcade (ROM library) |
| `/games/retro/play/[gameId]` | `games/retro/play/[gameId]/page.tsx` | EmulatorJS player |
| `/games/dos` | `games/dos/page.tsx` | DOS games |
| `/settings` | `settings/page.tsx` | User settings (themes, wallpaper, workspace) |
| `/settings/connections` | `settings/connections/page.tsx` | Integration connections |
| `/settings/connections/diagnostics` | `settings/connections/diagnostics/page.tsx` | Connection diagnostics |
| `/settings/agents/voice` | `settings/agents/voice/page.tsx` | Voice agent settings |
| `/profile` | `profile/page.tsx` | User profile |
| `/profile/[username]` | `profile/[username]/page.tsx` | Public profile |
| `/wallet` | `wallet/page.tsx` | LiTTBits wallet |
| `/projects` | `projects/page.tsx` | Project list |
| `/deployments` | `deployments/page.tsx` | Deployment history |
| `/memories` | `memories/page.tsx` | AI memory browser |
| `/social` | `social/page.tsx` | Social feed |
| `/showcase` | `showcase/page.tsx` | Creator showcase |
| `/library/files` | `library/files/page.tsx` | File library |
| `/library/saved` | `library/saved/page.tsx` | Saved items |
| `/voice` | `voice/page.tsx` | Voice settings |
| `/sign-in/[[...sign-in]]` | `sign-in/[[...sign-in]]/page.tsx` | Clerk sign-in |
| `/sign-up/[[...sign-up]]` | `sign-up/[[...sign-up]]/page.tsx` | Clerk sign-up |
| `/order/success` | `order/success/page.tsx` | Stripe checkout success |
| `/privacy` | `privacy/page.tsx` | Privacy policy |
| `/terms` | `terms/page.tsx` | Terms of service |
| `/cookies` | `cookies/page.tsx` | Cookie policy |
| `/resources/facebook-growth` | `resources/facebook-growth/page.tsx` | Resource guide |
| `/admin` | `admin/page.tsx` | Admin panel |
| `/admin/terminal` | `admin/terminal/page.tsx` | Admin terminal |
| `/docs` | `docs/page.tsx` | Documentation |

**Redirects** (in `next.config.ts`): `/builder`, `/ai-builder`, `/chat`, `/code`, `/litt`, `/litt-terminal`, `/flow`, `/generate`, `/agent`, `/agents`, `/agent-chat`, `/creator`, `/landing`, `/login` → all redirect to `/studio` or appropriate destination.

#### API Routes (100+ endpoints)

##### Auth
| Endpoint | File | Purpose |
|---|---|---|
| `POST /api/auth/clerk` | `api/auth/clerk/route.ts` | Clerk webhook handler |
| `POST /api/auth/login` | `api/auth/login/route.ts` | Custom login |
| `POST /api/auth/logout` | `api/auth/logout/route.ts` | Logout |
| `GET /api/auth/session` | `api/auth/session/route.ts` | Session info |
| `GET /api/auth/spotify/callback` | `api/auth/spotify/callback/route.ts` | Spotify OAuth callback |

##### GitHub Integration
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/github/install` | `api/github/install/route.ts` | Redirect to GitHub App install |
| `GET /api/github/callback` | `api/github/callback/route.ts` | GitHub App install callback |
| `GET /api/github/connection-state` | `api/github/connection-state/route.ts` | Check connection status |
| `GET /api/github/installations` | `api/github/installations/route.ts` | List installations |
| `GET /api/github/repositories` | `api/github/repositories/route.ts` | List repos |
| `GET /api/github/branches` | `api/github/branches/route.ts` | List branches |
| `POST /api/github/sync` | `api/github/sync/route.ts` | Sync repo |
| `GET /api/github/diagnostics` | `api/github/diagnostics/route.ts` | Diagnostics |
| `POST /api/github/webhook` | `api/github/webhook/route.ts` | GitHub webhook receiver |
| `POST /api/gitlab/webhook` | `api/gitlab/webhook/route.ts` | GitLab webhook |
| `POST /api/integrations/github/reconcile` | `api/integrations/github/reconcile/route.ts` | Reconcile installations |

##### AI / Chat
| Endpoint | File | Purpose |
|---|---|---|
| `POST /api/chat` | `api/chat/route.ts` | Basic chat |
| `POST /api/chat/unified` | `api/chat/unified/route.ts` | Unified chat (all providers) |
| `POST /api/ai/chat` | `api/ai/chat/route.ts` | AI chat |
| `POST /api/ai-chat` | `api/ai-chat/route.ts` | Legacy AI chat |
| `POST /api/gemini` | `api/gemini/route.ts` | Gemini direct |
| `POST /api/gemini/chat` | `api/gemini/chat/route.ts` | Gemini chat |
| `POST /api/gemini/build` | `api/gemini/build/route.ts` | Gemini code build |
| `GET /api/llm/health` | `api/llm/health/route.ts` | Provider health check |
| `POST /api/orchestrate` | `api/orchestrate/route.ts` | Agent orchestration |
| `POST /api/director/plan` | `api/director/plan/route.ts` | Director agent planning |

##### Agents
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/agents` | `api/agents/route.ts` | List agents |
| `GET /api/agents/[slug]` | `api/agents/[slug]/route.ts` | Get agent |
| `GET /api/agents/activity` | `api/agents/activity/route.ts` | Agent activity |
| `GET /api/agents/backlog` | `api/agents/backlog/route.ts` | Agent backlog |
| `POST /api/agents/chat` | `api/agents/chat/route.ts` | Agent chat |
| `GET /api/agents/commits` | `api/agents/commits/route.ts` | Agent commits |
| `GET /api/agents/completed` | `api/agents/completed/route.ts` | Completed tasks |
| `POST /api/agents/execute` | `api/agents/execute/route.ts` | Execute agent |
| `GET /api/agents/logs` | `api/agents/logs/route.ts` | Agent logs |
| `POST /api/agents/run` | `api/agents/run/route.ts` | Run agent (60s) |
| `GET /api/agents/services` | `api/agents/services/route.ts` | Agent services |
| `GET /api/agents/status` | `api/agents/status/route.ts` | Agent status |
| `POST /api/agents/task` | `api/agents/task/route.ts` | Agent task |
| `GET /api/agent-tasks` | `api/agent-tasks/route.ts` | List tasks |
| `GET /api/agent-tasks/[taskId]` | `api/agent-tasks/[taskId]/route.ts` | Get task |
| `GET /api/user-agents` | `api/user-agents/route.ts` | User's agents |

##### Media Generation
| Endpoint | File | Purpose |
|---|---|---|
| `POST /api/media/generate` | `api/media/generate/route.ts` | Generate image (60s) |
| `POST /api/media/generate-video` | `api/media/generate-video/route.ts` | Generate video (60s) |
| `POST /api/media/generate-audio` | `api/media/generate-audio/route.ts` | Generate audio (60s) |
| `POST /api/media/generate-music` | `api/media/generate-music/route.ts` | Generate music (60s) |
| `POST /api/media/transcribe` | `api/media/transcribe/route.ts` | Transcribe audio (60s) |
| `POST /api/media/analyze-image` | `api/media/analyze-image/route.ts` | Analyze image (vision) |
| `POST /api/media/analyze-video` | `api/media/analyze-video/route.ts` | Analyze video (60s) |
| `GET /api/media/video-status` | `api/media/video-status/route.ts` | Video job status (30s) |
| `GET /api/media/video-download` | `api/media/video-download/route.ts` | Download video (60s) |
| `POST /api/studio/generate` | `api/studio/generate/route.ts` | Studio generate |
| `POST /api/studio/video` | `api/studio/video/route.ts` | Studio video (120s) |
| `POST /api/audio` | `api/audio/route.ts` | Audio generation |
| `POST /api/music/generate` | `api/music/generate/route.ts` | Music generation (60s) |
| `POST /api/skybox/generate` | `api/skybox/generate/route.ts` | Skybox generation |
| `GET /api/skybox/poll/[id]` | `api/skybox/poll/[id]/route.ts` | Poll skybox status |

##### Billing / Wallet
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/wallet` | `api/wallet/route.ts` | Get LiTTBits balance |
| `POST /api/billing/checkout` | `api/billing/checkout/route.ts` | Stripe checkout |
| `GET /api/billing/portal` | `api/billing/portal/route.ts` | Stripe portal |
| `GET /api/billing/subscription` | `api/billing/subscription/route.ts` | Subscription status |
| `POST /api/stripe/checkout` | `api/stripe/checkout/route.ts` | Stripe checkout |
| `GET /api/stripe/session` | `api/stripe/session/route.ts` | Stripe session |
| `POST /api/stripe/webhook` | `api/stripe/webhook/route.ts` | Stripe webhook |
| `GET /api/usage/check` | `api/usage/check/route.ts` | Check usage limits |
| `GET /api/usage/stats` | `api/usage/stats/route.ts` | Usage statistics |
| `GET /api/users/[userId]/credits` | `api/users/[userId]/credits/route.ts` | User credits |
| `GET /api/users/[userId]/plan` | `api/users/[userId]/plan/route.ts` | User plan |

##### Projects / Deployments
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/projects` | `api/projects/route.ts` | List projects |
| `POST /api/projects` | `api/projects/route.ts` | Create project |
| `GET /api/projects/[projectId]` | `api/projects/[projectId]/route.ts` | Get project |
| `GET /api/deployments` | `api/deployments/route.ts` | List deployments |
| `GET /api/deployments/digest` | `api/deployments/digest/route.ts` | Deploy digest (cron) |
| `POST /api/deploy/trigger` | `api/deploy/trigger/route.ts` | Trigger deploy |

##### Dashboard
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/dashboard` | `api/dashboard/route.ts` | Dashboard data |
| `GET /api/dashboard/events` | `api/dashboard/events/route.ts` | Dashboard events |
| `POST /api/dashboard/events/read` | `api/dashboard/events/read/route.ts` | Mark events read |
| `GET /api/dashboard/stats` | `api/dashboard/stats/route.ts` | Dashboard stats |

##### Social
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/feed` | `api/feed/route.ts` | Social feed |
| `GET /api/posts` | `api/posts/route.ts` | List posts |
| `POST /api/posts` | `api/posts/route.ts` | Create post |
| `POST /api/posts/[id]/like` | `api/posts/[id]/like/route.ts` | Like post |
| `GET /api/posts/[id]/comments` | `api/posts/[id]/comments/route.ts` | Post comments |
| `GET /api/follows` | `api/follows/route.ts` | Follows |
| `GET /api/gallery` | `api/gallery/route.ts` | Gallery items |
| `GET /api/artwork/[slug]` | `api/artwork/[slug]/route.ts` | Get artwork |

##### Voice
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/voice/token` | `api/voice/token/route.ts` | Voice token |
| `GET /api/voice/session` | `api/voice/session/route.ts` | Voice session |
| `GET /api/voice/settings` | `api/voice/settings/route.ts` | Voice settings |
| `POST /api/voice/speak` | `api/voice/speak/route.ts` | TTS |
| `POST /api/voice/transcribe` | `api/voice/transcribe/route.ts` | STT |

##### Terminal
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/terminal/token` | `api/terminal/token/route.ts` | Terminal token |
| `GET /api/terminal/history` | `api/terminal/history/route.ts` | Command history |

##### Capabilities / Integrations
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/capabilities` | `api/capabilities/route.ts` | List capabilities |
| `GET /api/capabilities/project-terminal` | `api/capabilities/project-terminal/route.ts` | Project terminal |
| `GET /api/integrations/status` | `api/integrations/status/route.ts` | Integration status |
| `POST /api/integrations/meta-developer/connect` | `api/integrations/meta-developer/connect/route.ts` | Meta connect |
| `GET /api/integrations/meta-developer/callback` | `api/integrations/meta-developer/callback/route.ts` | Meta callback |
| `GET /api/integrations/meta-developer/status` | `api/integrations/meta-developer/status/route.ts` | Meta status |
| `GET /api/integrations/meta-developer/insights` | `api/integrations/meta-developer/insights/route.ts` | Meta insights |
| `POST /api/webhooks/meta-developer` | `api/webhooks/meta-developer/route.ts` | Meta webhook |

##### LiTT Brain
| Endpoint | File | Purpose |
|---|---|---|
| `POST /api/litt/command` | `api/litt/command/route.ts` | LiTT command |
| `POST /api/litt/file` | `api/litt/file/route.ts` | LiTT file op |
| `POST /api/litt/notify` | `api/litt/notify/route.ts` | LiTT notification |
| `POST /api/litt/scan` | `api/litt/scan/route.ts` | LiTT code scan |
| `POST /api/litt/think` | `api/litt/think/route.ts` | LiTT reasoning |

##### Other
| Endpoint | File | Purpose |
|---|---|---|
| `GET /api/account` | `api/account/route.ts` | Account info |
| `GET /api/admin/live` | `api/admin/live/route.ts` | Admin live data |
| `POST /api/bridge/cli` | `api/bridge/cli/route.ts` | CLI bridge (60s) |
| `GET /api/builder/sessions` | `api/builder/sessions/route.ts` | Builder sessions |
| `GET /api/conversations` | `api/conversations/route.ts` | Conversations |
| `GET /api/conversations/[id]/messages` | `api/conversations/[id]/messages/route.ts` | Messages |
| `GET /api/ha/devices` | `api/ha/devices/route.ts` | Home Assistant devices |
| `POST /api/ha/service` | `api/ha/service/route.ts` | HA service call |
| `GET /api/ha/state` | `api/ha/state/route.ts` | HA state |
| `POST /api/invites/create` | `api/invites/create/route.ts` | Create invite |
| `GET /api/invites/list` | `api/invites/list/route.ts` | List invites |
| `POST /api/invites/redeem` | `api/invites/redeem/route.ts` | Redeem invite |
| `POST /api/invites/validate` | `api/invites/validate/route.ts` | Validate invite |
| `POST /api/keys/create` | `api/keys/create/route.ts` | Create API key |
| `GET /api/keys/list` | `api/keys/list/route.ts` | List API keys |
| `POST /api/keys/revoke/[id]` | `api/keys/revoke/[id]/route.ts` | Revoke key |
| `GET /api/marketplace/items` | `api/marketplace/items/route.ts` | Marketplace items |
| `GET /api/marketplace/installations` | `api/marketplace/installations/route.ts` | Installations |
| `GET /api/marketplace/installations/[id]` | `api/marketplace/installations/[id]/route.ts` | Installation |
| `GET /api/memory` | `api/memory/route.ts` | AI memories |
| `POST /api/memory/search` | `api/memory/search/route.ts` | Search memories |
| `GET /api/notifications` | `api/notifications/route.ts` | Notifications |
| `GET /api/notifications/count` | `api/notifications/count/route.ts` | Notification count |
| `GET /api/settings/preferences` | `api/settings/preferences/route.ts` | User preferences |
| `POST /api/settings/profile` | `api/settings/profile/route.ts` | Update profile |
| `GET /api/spotify/token` | `api/spotify/token/route.ts` | Spotify token |
| `GET /api/spotify/search` | `api/spotify/search/route.ts` | Spotify search |
| `GET /api/spotify/player` | `api/spotify/player/route.ts` | Spotify player |
| `GET /api/stats` | `api/stats/route.ts` | Site stats |
| `POST /api/storage` | `api/storage/route.ts` | Storage upload |
| `POST /api/telemetry` | `api/telemetry/route.ts` | Telemetry |
| `GET /api/tracks` | `api/tracks/route.ts` | Music tracks |
| `POST /api/upload` | `api/upload/route.ts` | File upload |
| `POST /api/user/ensure` | `api/user/ensure/route.ts` | Ensure user exists |
| `POST /api/voice-monkey/trigger` | `api/voice-monkey/trigger/route.ts` | Voice Monkey |
| `POST /api/webhook/agent-action` | `api/webhook/agent-action/route.ts` | Agent action webhook |
| `POST /api/webhook/clerk` | `api/webhook/clerk/route.ts` | Clerk webhook |
| `GET /api/galaxy/files` | `api/galaxy/files/route.ts` | Galaxy files |

---

### src/app/studio/ — The AI Studio (main workspace)

#### Components
| File | Purpose |
|---|---|
| `StudioOS.tsx` | **Main Studio shell** — tool rail, workspace, LiTT drawer, camera/screen docks |
| `StudioOnboarding.tsx` | Onboarding screen for users with no project (source chooser, templates, permission modes) |
| `StudioSidebar.tsx` | Left tool rail (Code, Build, Chat, Image, Video, Audio, Terminal, etc.) |
| `StudioTopBar.tsx` | Top bar (search, model picker, deploy, LiTTBits balance) |
| `StudioInspector.tsx` | Right inspector panel |
| `StudioCommandDock.tsx` | Command dock |
| `StudioModeSwitcher.tsx` | Mode switcher |
| `ChatShell.tsx` | Chat shell (legacy) |
| `MultimodalComposer.tsx` | **Message composer** — text, camera (vision-on-send), file upload, slash commands |
| `CameraSession.tsx` | Camera component (live preview, frame capture, vision-on-send) |
| `ModelPicker.tsx` | AI model selector |
| `OnboardingCanvas.tsx` | Step-based onboarding canvas |
| `SessionSidebar.tsx` | Session sidebar |
| `GitHubProjectConnection.tsx` | GitHub repo connection UI |
| `DemoBootstrap.tsx` | Demo mode bootstrap (public preview) |
| `MobileStudio.tsx` | Mobile studio layout |
| `CameraSession.test.tsx` | Camera tests |

#### Tools (each is a full workspace panel)
| File | Tool | Purpose |
|---|---|---|
| `ChatTool.tsx` | chat | **LiTT chat** — main AI conversation |
| `BuilderTool.tsx` | build | Visual builder (templates, code generation) |
| `CanvasTool.tsx` | code | Monaco code editor |
| `ImageTool.tsx` | image | Image generation |
| `VideoTool.tsx` | video | Video generation |
| `AudioTool.tsx` | audio | Audio generation |
| `AgentTool.tsx` | agents | LiTT & Spark agent panel |
| `MissionForge.tsx` | workflows | **Mission Forge** — visual agent canvas (pan, zoom, nodes) |
| `AgentsTerminalTool.tsx` | terminal | Terminal (xterm.js + WebSocket) |
| `GalleryTool.tsx` | assets | Asset gallery |
| `PluginsTool.tsx` | plugins | Plugin manager |
| `CameraTool.tsx` | camera | Camera overlay (dockable) |
| `ScreenTool.tsx` | screen | Screen share overlay (dockable) |
| `SpaceTool.tsx` | space | 3D space |
| `CLIBridgeTool.tsx` | clibridge | CLI bridge |
| `ColorByNumberTool.tsx` | color | Color by number |
| `FlowTool.tsx` | flow | Flow editor |
| `PipelineTool.tsx` | pipeline | Legacy pipeline (→ workflows) |

#### Context & Stores
| File | Purpose |
|---|---|
| `context/VoiceSessionContext.tsx` | **Voice session** — Inworld STT/TTS, mic, lifecycle guards (528 lines) |
| `stores/useStudioAgentStore.ts` | Active agent (LiTT/Spark) state |
| `stores/useStudioModelStore.ts` | Active AI model state |

#### Hooks
| File | Purpose |
|---|---|
| `hooks/useConnectionSummary.ts` | Summary of all integration connections |
| `hooks/useCapabilities.ts` | Studio capabilities |
| `hooks/useBuilderSessions.ts` | Builder session management |
| `hooks/useMediaPermissions.ts` | Camera/mic permissions |

#### Lib
| File | Purpose |
|---|---|
| `lib/builder-command-router.ts` | Route builder commands |
| `lib/studio-intent.ts` | Parse studio intents |

#### Types
| File | Purpose |
|---|---|
| `types/builder-blocks.ts` | Builder block type definitions |

---

### src/components/ — Shared components (80+ files)

#### Layout
| File | Purpose |
|---|---|
| `LayoutShell.tsx` | Main layout wrapper |
| `Navbar.tsx` | Top navigation bar |
| `NavbarWrapper.tsx` | Navbar wrapper (auth-aware) |
| `Sidebar.tsx` | Sidebar |
| `Footer.tsx` | Footer |
| `FooterWrapper.tsx` | Footer wrapper |
| `PageShell.tsx` | Page shell |
| `MobileBottomNav.tsx` | Mobile bottom navigation |
| `GlassCard.tsx` | Glass-morphism card |
| `ErrorBoundary.tsx` | Error boundary |
| `LoadingSkeleton.tsx` | Loading skeleton |

#### Auth
| File | Purpose |
|---|---|
| `ClerkAuth.tsx` | Clerk auth component (NavAuth) |
| `UserSync.tsx` | Sync Clerk user to Supabase |
| `HomeAuthRedirect.tsx` | Home auth redirect |

#### Dashboard
| File | Purpose |
|---|---|
| `DashboardView.tsx` | Main dashboard view |
| `dashboard/DashboardContent.tsx` | Dashboard content |
| `dashboard/DashboardCards.tsx` | Dashboard cards |
| `dashboard/DashboardWidgets.tsx` | Dashboard widgets |
| `dashboard/CommandCenter.tsx` | Command center |
| `dashboard/DeveloperControlCenter.tsx` | Dev control center |
| `dashboard/AutonomicLoopBanner.tsx` | Autonomic loop banner |
| `dashboard/MusicPlayer.tsx` | **Music player** (dashboard) |
| `dashboard/SpotifyPlayer.tsx` | Spotify player |
| `dashboard/RadioPanel.tsx` | Radio panel |
| `dashboard/UsageChart.tsx` | Usage chart |
| `dashboard/FileGalaxy.tsx` | File galaxy view |
| `dashboard/HologramCore.tsx` | Hologram core |
| `dashboard/LiTTTerminal.tsx` | LiTT terminal widget |
| `dashboard/MarketplacePreview.tsx` | Marketplace preview |
| `dashboard/dashboard-data.ts` | Dashboard data helpers |
| `dashboard/AudioTool.tsx` | Dashboard audio tool |

#### Games
| File | Purpose |
|---|---|
| `games/GameCloudHome.tsx` | Game Cloud home |
| `games/GameHero.tsx` | Game hero banner |
| `games/GameCard.tsx` | Game card |
| `games/RetroArcadeHero.tsx` | Retro Arcade hero artwork |
| `games/RetroControlsModal.tsx` | Retro controls modal |
| `games/DosPlayer.tsx` | DOS player |
| `games/CategoryChips.tsx` | Category chips |
| `games/DailyMissions.tsx` | Daily missions |
| `games/FriendsPlaying.tsx` | Friends playing |
| `games/MobileGameNav.tsx` | Mobile game nav |
| `games/MultiplayerRooms.tsx` | Multiplayer rooms |

#### LiTT Terminal
| File | Purpose |
|---|---|
| `litt-terminal/LiTTTerminalPage.tsx` | Full terminal page |
| `litt-terminal/TerminalPanel.tsx` | Terminal panel (xterm) |
| `litt-terminal/FileExplorer.tsx` | File explorer |
| `litt-terminal/CodeEditor.tsx` | Code editor |
| `litt-terminal/LeftSidebar.tsx` | Left sidebar |
| `litt-terminal/AgentCommandCenter.tsx` | Agent command center |
| `litt-terminal/AgentRunner.tsx` | Agent runner |
| `litt-terminal/AIIntelligencePanel.tsx` | AI intelligence panel |
| `litt-terminal/BuilderPanel.tsx` | Builder panel |
| `litt-terminal/CommandHistory.tsx` | Command history |
| `litt-terminal/ConnectorStrip.tsx` | Connector strip |
| `litt-terminal/DeployButton.tsx` | Deploy button |
| `litt-terminal/HoloDirector.tsx` | Holo director |
| `litt-terminal/LiTTAssistantPanel.tsx` | LiTT assistant panel |
| `litt-terminal/LogsPanel.tsx` | Logs panel |
| `litt-terminal/OutputPanel.tsx` | Output panel |

#### LiTT Director
| File | Purpose |
|---|---|
| `litt-director/HoloDirector.tsx` | Holo director |
| `litt-director/DirectorRuntime.tsx` | Director runtime |
| `litt-director/MissionCanvas.tsx` | Mission canvas (pan/zoom) |

#### Settings
| File | Purpose |
|---|---|
| `settings/SettingsPrimitives.tsx` | Settings UI primitives |
| `settings/WallpaperSection.tsx` | Wallpaper settings |
| `settings/VisualPackSettings.tsx` | Visual pack settings |
| `settings/IntegrationCard.tsx` | Integration card |
| `settings/LivePreviewPanel.tsx` | Live preview panel |

#### Studio (shared)
| File | Purpose |
|---|---|
| `studio/PreviewPanel.tsx` | Preview panel |
| `studio/ProjectSourceSelector.tsx` | Project source selector |
| `studio/SystemTopologyPanel.tsx` | System topology |

#### UI Primitives
| File | Purpose |
|---|---|
| `ui/Card.tsx` | Card |
| `ui/Panel.tsx` | Panel |
| `ui/PageHeader.tsx` | Page header |
| `ui/StatCard.tsx` | Stat card |
| `ui/StatusBadge.tsx` | Status badge |
| `ui/EmptyState.tsx` | Empty state |
| `ui/ErrorState.tsx` | Error state |
| `ui/Skeleton.tsx` | Skeleton |
| `ui/WorkspaceShell.tsx` | Workspace shell |
| `ui/index.ts` | UI barrel export |

#### Other components
| File | Purpose |
|---|---|
| `AnimatedBackground.tsx` | Canvas animated background (30fps, respects reduced-motion) |
| `AnimatedBackgroundWrapper.tsx` | Background wrapper |
| `AgentBuilder.tsx` | Agent builder |
| `AgentDashboard.tsx` | Agent dashboard |
| `AssetLibrary.tsx` | Asset library |
| `CookieConsent.tsx` | Cookie consent |
| `CreateFAB.tsx` | Create FAB |
| `DragDropCanvas.tsx` | Drag-drop canvas |
| `EventStream.tsx` | Event stream |
| `GalaxyMap.tsx` | Galaxy map |
| `ImageLightbox.tsx` | Image lightbox |
| `ImageViewer.tsx` | Image viewer |
| `KeyManager.tsx` | API key manager |
| `LiTTChatBox.tsx` | LiTT chat box |
| `LiTTPresenceCard.tsx` | LiTT presence card |
| `Lightbox.tsx` | Lightbox |
| `ModelPicker.tsx` | Model picker |
| `NeuralImagingStudio.tsx` | Neural imaging studio |
| `PromptComposer.tsx` | Prompt composer |
| `ServiceWorkerRegistration.tsx` | Service worker registration |
| `SocialFeed.tsx` | Social feed |
| `SocialPageContent.tsx` | Social page content |
| `StockAgentLibrary.tsx` | Stock agent library |
| `StylePresets.tsx` | Style presets |
| `TelemetryPanel.tsx` | Telemetry panel |
| `TemplateLibrary.tsx` | Template library |
| `VersionHistory.tsx` | Version history |
| `chat/MessageAvatar.tsx` | Chat message avatar |
| `color/ColorByNumber.tsx` | Color by number |
| `color/Palette.tsx` | Color palette |
| `color/TemplateGallery.tsx` | Color template gallery |

---

### src/lib/ — Core libraries (50+ files)

#### AI / LLM
| File | Purpose |
|---|---|
| `litt.ts` | **LiTT brain** — main assistant logic |
| `llm.ts` | LLM abstraction layer |
| `llm-completion.ts` | LLM completion |
| `llm-executor.ts` | LLM executor |
| `ai/client.ts` | AI client |
| `ai/providers.ts` | AI provider config |
| `gemini.ts` | Gemini integration |
| `director-graph.ts` | Director agent graph |

#### Agents
| File | Purpose |
|---|---|
| `agents.ts` | Agent definitions |
| `agent-logger.ts` | Agent action logging |
| `agent-validation.ts` | Agent validation |
| `agent-worker.ts` | Agent worker |

#### Auth
| File | Purpose |
|---|---|
| `auth.ts` | Auth layer (Clerk + JWT) |
| `jwt.ts` | JWT utilities (jose) |
| `authz.ts` | Authorization (canMutateBalances, etc.) |
| `terminal-auth.ts` | Terminal auth |
| `roles.ts` | Role definitions |

#### Database
| File | Purpose |
|---|---|
| `supabase.ts` | Supabase client (auto-detect service vs anon) |
| `supabase-admin.ts` | Supabase service role client |
| `supabase-client.ts` | Supabase anon client |
| `db.ts` | DB helpers |
| `user-db.ts` | User DB operations |
| `require-database-user.ts` | Require DB user middleware |

#### GitHub
| File | Purpose |
|---|---|
| `github-app.ts` | GitHub App Octokit |
| `github-install-state.ts` | Signed installation state tokens (HMAC) |

#### Connections / Integrations
| File | Purpose |
|---|---|
| `connections/state.ts` | Connection state upsert |
| `connections/audit.ts` | Connection audit log |
| `integrations/status.ts` | Integration status |
| `integrations/types.ts` | Integration types |

#### Capabilities
| File | Purpose |
|---|---|
| `capability-registry.ts` | Capability registry |
| `capabilities/studio-context.ts` | Studio context capabilities |
| `capabilities/translate.ts` | Capability translation |
| `capabilities/types.ts` | Capability types |

#### Media
| File | Purpose |
|---|---|
| `media.ts` | Media generation |
| `music.ts` | Music generation |
| `games.ts` | Game library definitions |
| `retro-arcade.ts` | Retro arcade config |
| `code-scanner.ts` | Code scanner |

#### Storage
| File | Purpose |
|---|---|
| `r2.ts` | Cloudflare R2 storage |

#### Billing
| File | Purpose |
|---|---|
| `wallet-ledger.ts` | **LiTTBits ledger** — credit balances (monthly, purchased, beta_promotional) |
| `entitlements.ts` | Entitlements |
| `usage.ts` | Usage tracking |

#### Other
| File | Purpose |
|---|---|
| `rate-limiter.ts` | Rate limiting |
| `deployments.ts` | Deployment helpers |
| `chatRooms.ts` | Chat rooms |
| `command-executor.ts` | Command executor |
| `discord.ts` | Discord integration |
| `ha-api.ts` | Home Assistant API |
| `ha-tools.ts` | HA tools |
| `litt-context.ts` | LiTT context |
| `navigation.ts` | Navigation config |
| `plugin-registry.ts` | Plugin registry |
| `siteConfig.ts` | Site configuration |
| `studio-models.ts` | Studio models |
| `terminal-client.ts` | Terminal client |
| `themes.ts` | Theme definitions |
| `tokens.ts` | Design tokens |
| `utils.ts` | General utilities |
| `voice-client.ts` | Voice client |
| `avatars.ts` | Avatar URLs |
| `color-templates.ts` | Color templates |
| `visual-packs/generation-presets.ts` | Visual pack presets |
| `visual-packs/types.ts` | Visual pack types |
| `wallpapers.ts` | Wallpaper definitions |

---

### src/features/voice/ — Voice system (Inworld)

| File | Purpose |
|---|---|
| `hooks/useInworldSession.ts` | **Inworld session** — STT + TTS + LLM, scheduled seamless playback |
| `hooks/useVoiceSession.ts` | Voice session hook |
| `hooks/useAgentSpeech.ts` | Agent speech |
| `hooks/useMicrophone.ts` | Microphone hook |
| `hooks/useVoiceVisualizer.ts` | Voice visualizer |
| `components/VoiceController.tsx` | Voice controller |
| `components/VoiceOrb.tsx` | Voice orb visualizer |
| `components/FloatingVoiceButton.tsx` | Floating voice button |
| `components/VoiceSettings.tsx` | Voice settings |
| `components/VoiceStatus.tsx` | Voice status |
| `components/AgentVoiceSelector.tsx` | Agent voice selector |
| `lib/agentProfiles.ts` | Agent voice profiles |
| `lib/audioQueue.ts` | Audio queue (scheduled playback) |
| `lib/sanitizeSpeech.ts` | Speech sanitization |
| `lib/voiceConfig.ts` | Voice config (browser fallback) |
| `lib/voiceRouting.ts` | Voice routing |
| `store/useVoiceStore.ts` | Voice Zustand store |
| `types.ts` | Voice types |

---

### src/context/ — React contexts

| File | Purpose |
|---|---|
| `AuthContext.tsx` | Auth context (client session) |
| `ClerkAuthContext.tsx` | Clerk auth context |
| `ThemeContext.tsx` | **Theme context** — 4 themes (Holo Command, Cosmic Creator, Arctic Focus, Miami Night), layouts, wallpaper |
| `ProfileContext.tsx` | Profile context (Creator, Builder, Focus) |
| `VisualContext.tsx` | Visual context |
| `WalletContext.tsx` | Wallet context |

---

### src/hooks/ — Custom hooks

| File | Purpose |
|---|---|
| `useClerkAuth.ts` | Clerk auth hook |
| `useAgentSubscription.ts` | Agent subscription |
| `useIntegrationStatus.ts` | Integration status |
| `useSelfHeal.ts` | Self-heal hook |
| `useSessionAuth.ts` | Session auth |
| `useSupabaseAuth.ts` | Supabase auth |

---

### src/stores/ — Zustand stores

| File | Purpose |
|---|---|
| `useSettingsStore.ts` | Settings store |
| `useTerminalStore.ts` | Terminal store |

---

### src/config/ — Configuration

| File | Purpose |
|---|---|
| `plans.ts` | Pricing plans |
| `usage-costs.ts` | Usage cost per action |

---

### src/server/voice/ — Server-side voice

| File | Purpose |
|---|---|
| `deepgram.ts` | Deepgram STT |
| `elevenlabs.ts` | ElevenLabs TTS |
| `sessionManager.ts` | Voice session manager |

---

### src/types/ — Type definitions

| File | Purpose |
|---|---|
| `agents.ts` | Agent types |

---

### Other src files
| File | Purpose |
|---|---|
| `daemon.ts` | Daemon process |
| `proxy.ts` | Proxy config |

---

## terminal-server/ — WebSocket Terminal Server

| File | Purpose |
|---|---|
| `server.ts` | Main server (socket.io + Docker manager) |
| `auth.ts` | Terminal auth |
| `security.ts` | Security (sandbox, command filtering) |
| `docker-manager.ts` | Docker container management |
| `jarvis-ai.ts` | AI assistant in terminal |
| `litt-code.ts` | LiTT code integration |
| `Dockerfile` | Terminal server Docker image |
| `railway.json` | Railway deployment config |
| `package.json` | Dependencies |
| `tsconfig.json` | TS config |

---

## voice-server/ — Inworld Voice Proxy

| File | Purpose |
|---|---|
| `server.mjs` | Voice proxy server (Express + WebSocket) |
| `Dockerfile` | Voice server Docker image |
| `package.json` | Dependencies |
| `.railway/railway.ts` | Railway config |

**Features:** Per-user rate limiting (3 concurrent sessions), `/health` endpoint, auth logging, session cleanup.

---

## packages/litt-agent-core/ — Shared Agent Library

Shared agent core library (workspace package).

---

## supabase/ — Database

| File | Purpose |
|---|---|
| `schema.sql` | **Canonical schema** (idempotent, `users` table with `clerk_id`) |
| `migrations/` | 39 migrations (agent tasks, tracks, deployments, GitHub projects, wallet, marketplace, etc.) |
| `rls_fix.sql` | RLS policy fixes |
| `studio_projects.sql` | Studio projects schema |

**Key tables:** `users`, `github_installations`, `agent_tasks`, `agent_runs`, `deployments`, `tracks`, `wallet_ledger`, `projects`, `studio_projects`, `marketplace_items`, `memories`, `notifications`, `posts`, `follows`, `conversations`, `messages`, `api_keys`, `invites`, `worker_instances`, `worker_heartbeats`, `provider_connections`, `agent_voice_profiles`, `credit_ledger`.

---

## public/ — Static assets (83 files)

- `images/` — Logos, game covers, hero artwork, icons
- `games/` — Game assets (XQuest, ROM covers)
- `sounds/` — Sound effects
- `fonts/` — Custom fonts
- `icons/` — PWA icons

---

## Configuration files

| File | Purpose |
|---|---|
| `next.config.ts` | Next.js config (CSP, headers, redirects, images, Turbopack) |
| `vercel.json` | Vercel config (crons, function timeouts up to 120s) |
| `tsconfig.json` | TypeScript config (strict) |
| `eslint.config.mjs` | ESLint flat config |
| `postcss.config.mjs` | PostCSS (Tailwind v4) |
| `vitest.config.ts` | Vitest config (jsdom) |
| `pnpm-workspace.yaml` | pnpm workspace config |
| `.npmrc` | npm config (`ignore-scripts=true`) |
| `docker-compose.yml` | Docker compose |
| `package.json` | Dependencies + scripts |

---

## Environment variables (production)

### Clerk
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`
- `CLERK_SECRET_KEY`
- `CLERK_WEBHOOK_SECRET`

### Supabase
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Stripe
- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`

### AI
- `OPENROUTER_API_KEY`
- `GEMINI_API_KEY`
- `TOGETHER_API_KEY`
- `FAL_KEY`
- `MINIMAX_API_KEY`
- `HUGGING_FACE_API_KEY`

### GitHub App
- `GITHUB_APP_ID`
- `GITHUB_APP_SLUG`
- `GITHUB_PRIVATE_KEY`
- `GITHUB_INSTALL_STATE_SECRET`

### R2 Storage
- `R2_ACCOUNT_ID`
- `R2_ACCESS_KEY_ID`
- `R2_SECRET_ACCESS_KEY`

### Voice
- `INWORLD_API_KEY`
- `INWORLD_WORKSPACE_ID`
- `VOICE_AUTH_SECRET`

### Other
- `AUTH_SECRET`
- `NEXT_PUBLIC_APP_URL`
- `TERMINAL_AUTH_SECRET`
- `SKYBOX_API_KEY`

---

## Build & Deploy Commands

```powershell
pnpm dev              # Dev server (Turbopack, :3000)
pnpm build            # Production build
pnpm lint             # ESLint
pnpm test             # Vitest
npx tsc --noEmit      # Type-check
vercel --prod --yes   # Deploy to production
pnpm terminal:dev     # Terminal server dev
pnpm terminal:build   # Terminal server build
```

---

## Feature Status (What's Connected vs Placeholder)

| Feature | Status |
|---|---|
| GitHub App install + callback | Working (commit f765cf4b) |
| GitHub repo/branch selection | Working |
| Project creation (blank + from source) | Working |
| Website/Git URL to Chat handoff | Working |
| Image generation (Fal, Gemini) | Working |
| Video generation (Fal, MiniMax) | Working |
| Audio/Music generation | Working |
| Stripe billing + LiTTBits ledger | Working |
| Inworld voice (STT + TTS) | Working |
| Terminal (WebSocket + Docker) | Working |
| Camera vision-on-send | Working |
| Mission Forge canvas (pan/zoom) | Working |
| Themes + wallpaper + workspace profiles | Working |
| Paste Git URL (generic clone) | UI ready, auto-clone not implemented |
| GitLab/Bitbucket/Azure DevOps | Coming soon (UI visible) |
| ZIP/Folder upload | Coming soon |
| Figma/Google Drive/API import | Coming soon |

---

## Recent commits (current state)

| Commit | Description |
|---|---|
| `f765cf4b` | Repair GitHub callback - preserves signed user state |
| `43cc2ad9` | Restore complete tool navigation (Chat, Code, Terminal, etc.) |
| `c56d4c76` | Categorized source chooser + permission modes + Paste Git URL |
| `db295c09` | Project-first onboarding and source chooser |
| `52320588` | Onboarding-first experience with multi-source connection |
| `5327fb5b` | Harden retro player + curate Game Cloud |
| `fda9bc59` | Retro Arcade hero artwork |
| `485505e5` | Dashboard music + mission canvas + LiTTBits rename |
| `a5da0a3f` | Unify LiTTBits ledger + Stripe grants |
| `e7860f48` | Deep Settings pass - themes, layouts, wallpaper, profiles |
| `be951665` | Voice lifecycle guards + dead code cleanup (-199 lines) |
| `512b402a` | Camera vision-on-send - capture fresh frame on send |
| `ecafcdba` | Match official Inworld quickstart pattern + remove dead fallbacks |
| `1534dc49` | Eliminate crackling with scheduled seamless playback |
| `5d9c3be0` | Voice proxy rate limiting, health endpoint, improved logging |
| `177e14b3` | Sync lockfile after dep removal, fix unused catch params |
| `2944f8a9` | Deep-scan cleanup: security, deps, DB, dead code (-1730 lines) |
| `461b1142` | Fix VS Code code-spell-checker extension ID format |

> **Note:** The deep-scan cleanup (commit `2944f8a9`) removed 7 orphaned lib files
> (`agent-tools.ts`, `agent-user.ts`, `agentCommands.ts`, `studio-actions.ts`,
> `voice-auth.ts`, `project-context.ts`, `storage.ts`), 8 duplicate migration files,
> and ~1,730 lines of dead code. The file counts above reflect the current state.

All deployed to `litlabs.net`.
