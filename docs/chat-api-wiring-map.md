# 🔱 LiTTree Lab Studios — Chat & API Wiring Map
**Generated:** 2026-07-20
**Scope:** Every chat-related front-end component, every API route, every server lib it depends on, and how the active message flows wire together.

---

## 1. CHAT FRONT-END (where users type)

### Pages
| File | Role |
|---|---|
| `src/app/chat/page.tsx` | Server redirect → `/studio?tool=chat` |
| `src/app/agent/page.tsx` | Standalone agent page (legacy) |
| `src/app/agent-chat/page.tsx` | Legacy agent-chat URL |
| `src/app/litt/page.tsx` | The `/litt` command-center page |
| `src/app/litt-terminal/page.tsx` | LiTT terminal page (separate from Studio) |
| `src/app/studio/page.tsx` | The main Studio surface (the chat home) |
| `src/app/builder/page.tsx` | Builder interface |
| `src/app/flow/page.tsx` | Flow/canvas editor |

### Chat components (and the API each one calls)
| Component | Calls |
|---|---|
| `src/components/FloatingChat.tsx` | `POST /api/agents/chat` |
| `src/components/dashboard/LiTTTerminal.tsx` | `GET /api/litt/scan` |
| `src/components/litt-terminal/TerminalPanel.tsx` | terminal-server WebSocket |
| `src/app/studio/ChatDrawer.tsx` | `POST /api/ai-chat` |
| `src/app/studio/prompt-bridge.ts` | cross-pane prompt bridge (Monaco ↔ chat) |
| `src/app/studio/studio-context.tsx` | Studio React context |
| `src/app/studio/registry.tsx` | Studio tool registry |
| `src/app/studio/components/ChatShell.tsx` | `POST /api/agents/chat` (SSE) |
| `src/app/studio/components/LITTTerminalShell.tsx` *(currently open)* | `POST /api/agents/chat` + `POST /api/chat/unified` (SSE) |
| `src/app/studio/components/MultimodalComposer.tsx` | composer |
| `src/app/studio/components/LiveVoiceBar.tsx` | `POST /api/voice/live-token` |
| `src/app/studio/components/SessionSidebar.tsx` | chat history |
| `src/app/studio/components/PluginPanel.tsx` | context plugins |
| `src/app/studio/components/ImageGenPopover.tsx` | image popover |
| `src/app/studio/components/BuilderStream.tsx` | `POST /api/ai-chat` (SSE) |
| `src/app/studio/components/ModelPicker.tsx` | LLM picker |
| `src/app/studio/components/StudioCommandDeck.tsx` | command-deck shell |
| `src/app/studio/components/StudioHybridWorkspace.tsx` | hybrid workspace |
| `src/app/studio/components/StudioOS.tsx` | Studio OS shell |
| `src/app/studio/components/StudioModeSwitcher.tsx` | Chat/Builder/Code switcher |
| `src/app/studio/components/StudioMonacoEditor.tsx` | Monaco editor (pinned) |
| `src/app/studio/components/StudioHealthPanel.tsx` | `GET /api/llm/health` |
| `src/app/studio/components/StudioMobileChrome.tsx` | mobile shell |
| `src/app/studio/components/CameraSession.tsx` | vision context |
| `src/app/studio/components/ProjectDrawer.tsx` | `GET/POST /api/studio/projects` |
| `src/app/studio/tools/ChatTool.tsx` | `POST /api/agents/chat` |
| `src/app/studio/tools/CanvasTool.tsx` | `POST /api/ai-chat` |
| `src/app/studio/tools/ImageTool.tsx` | `POST /api/media/generate` |
| `src/app/studio/tools/VideoTool.tsx` | `POST /api/media/generate-video` |
| `src/app/studio/tools/AudioTool.tsx` | `POST /api/media/generate-audio` |
| `src/app/studio/tools/LoopsTool.tsx` | `GET /api/loops` |
| `src/app/studio/tools/{BuilderTool,FlowTool,PipelineTool,CodeTool,SpaceTool,GalleryTool,CLIBridgeTool,ColorByNumberTool,TerminalTool,AgentTool}.tsx` | various |

### Hooks & context
- **Hooks:** `useAgentSubscription`, `useClerkAuth`, `useSelfHeal`, `useSessionAuth`, `useSupabaseAuth`
- **Context:** `AuthContext`, `ClerkAuthContext`, `WalletContext`, `ThemeContext`, `NavDrawerContext`, `ProfileContext`, `VoiceSessionContext` (studio)
- **Studio hooks:** `useBuilderSessions`, `useGeminiLiveVoice`, `useMediaPermissions`

---

## 2. CHAT & LLM API ROUTES (`src/app/api/`)

### Primary chat endpoints (the ones chat UI actually calls)
| Route | File | Streaming | Auth | Called by |
|---|---|---|---|---|
| `POST /api/agents/chat` | `agents/chat/route.ts` | **SSE** | Clerk | FloatingChat, ChatShell, LITTTerminalShell, ChatTool |
| `POST /api/chat/unified` | `chat/unified/route.ts` | SSE | Clerk | LITTTerminalShell fallback |
| `POST /api/chat` | `chat/route.ts` | JSON | rate-limit | legacy `gallery/[id]` |
| `POST /api/ai-chat` | `ai-chat/route.ts` | SSE (opt-in) | auth-aware | ChatDrawer, CanvasTool, BuilderStream |
| `POST /api/ai/chat` | `ai/chat/route.ts` | — | — | newer AI chat |
| `POST /api/litt/think` | `litt/think/route.ts` | JSON | Clerk | `/litt` command-center |
| `POST /api/litt/command` | `litt/command/route.ts` | JSON | Clerk | LiTT action execution |
| `GET /api/litt/scan` | `litt/scan/route.ts` | JSON | — | LiTTTerminal, code page (live probe) |
| `POST /api/litt/file` | `litt/file/route.ts` | — | — | file ops |
| `POST /api/litt/notify` | `litt/notify/route.ts` | — | — | triggers `litt.notify()` dispatcher |
| `GET /api/llm/health` | `llm/health/route.ts` | — | — | StudioHealthPanel |

### Director / orchestration
- `POST /api/director/plan` — uses `buildDirectorPlan` (director-graph.ts)
- `POST /api/orchestrate`

### Agent / task / memory (the Autonomic Loop)
- `GET/POST /api/agents` — list + create (Supabase `agents`, core fallback)
- `GET /api/agents/[slug]`, `/activity`, `/backlog`, `/completed`, `/execute`, `/logs`, `/run`, `/services`, `/status`
- `GET/POST /api/agent-tasks` + `/[taskId]`
- `POST /api/agent`
- `GET/POST /api/agent/memory`
- `GET/POST /api/memory` + `/search` (Supabase `memories` + Supermemory)
- `GET/POST /api/conversations` + `/[id]`

### User / account / wallet
- `GET /api/account`, `POST /api/user/ensure`, `GET /api/users/[userId]`
- `GET/POST /api/user-agents`
- `GET/POST /api/wallet`
- `GET /api/usage/{check,stats}`
- `GET/POST/DELETE /api/keys/{list,create,revoke}`
- `POST /api/invites/{create,list,redeem,validate}`

### Media
- `POST /api/media/{generate,generate-audio,generate-music,generate-video,analyze-image,analyze-video,transcribe,video-download}`
- `GET /api/media/video-status`
- `POST /api/music/generate`, `POST /api/audio`, `POST /api/tts`
- `POST /api/gemini` + `/chat` + `/build`
- `POST /api/skybox/generate`, `GET /api/skybox/poll`
- `POST /api/artwork/[slug]`

### Studio / projects / builder
- `GET /api/studio/feature`, `POST /api/studio/generate`, `GET/POST /api/studio/projects`, `POST /api/studio/video`
- `GET/POST /api/projects`
- `POST /api/builder/sessions`

### Stripe / billing
- `POST /api/stripe/checkout`, `GET /api/stripe/session`, `POST /api/stripe/webhook`

### Auth / social / community
- `POST /api/auth/{login,logout,session,spotify,clerk}`
- `GET/POST /api/posts` + `/[id]`, `GET/POST /api/feed`, `GET/POST /api/follows`
- `POST /api/facebook/post`

### Storage / uploads
- `POST /api/upload`, `POST /api/storage`, `GET /api/galaxy/files`, `GET /api/gallery`

### Voice / live
- `POST /api/voice/live-token` (Gemini Live)
- `POST /api/voice-monkey/trigger`

### GitHub / GitLab / deploy
- `GET /api/github/{callback,install,installations,repositories}`, `POST /api/github/webhook`
- `POST /api/gitlab/webhook`
- `POST /api/deploy/trigger`, `GET /api/deployments`, `GET /api/deployments/digest`
- `POST /api/webhook/clerk`, `POST /api/webhook/agent-action`

### IoT / Spotify / misc
- `GET/POST /api/ha/{devices,service,state}`
- `GET/POST /api/spotify/{player,search,token}`
- `POST /api/bridge/cli`
- `GET/POST /api/loops` + `/[id]`
- `GET/POST /api/notifications` + `/count`
- `GET /api/telemetry`, `GET /api/stats`, `GET /api/dashboard/{stats,command-center}`
- `GET /api/health/studio`
- `GET /api/terminal/{history,token}`
- `GET /api/tracks`
- `GET/POST /api/settings/{preferences,profile}`
- `GET/POST /api/admin/live`

> **~100 route handlers total.**

---

## 3. THE CHAT BRAIN (`src/lib/` — what every chat route depends on)

| File | Role | Critical for |
|---|---|---|
| `llm.ts` | Unified LLM client. Gemini 2.5 Flash primary → OpenRouter free / Qwen / DeepSeek / Mistral / Llama / Trinity fallbacks. Exports `generateText`, `generateJSON`, `streamText`, `streamAgentTurn`, `llmHealth`. Auto-prepends project identity. | every chat route |
| `llm-completion.ts`, `llm-executor.ts` | LLM helper layers | chat |
| `litt.ts` | `litt` notification dispatcher (Discord, webhook, push, email). `jarvis` alias kept for back-compat. | system alerts, sales |
| `litt-context.ts` | Builds LiTT prompts, parses LiTT actions (`add_goal`, `remember`, `run_command`, `create_file`, `edit_file`, `start_agent`, `deploy`) | `/api/litt/think` |
| `litt-identity.ts` | Static `LITLABS_IDENTITY_SNIPPET` injected into every LLM call | every chat route |
| `agents.ts` | `AGENTS` registry (one canonical `litt` agent; `littcode`/`littlebit` are non-enum aliases). Exports `orchestrator` singleton — message routing, memory, `simulateAgentResponse`, `startBackgroundConversation`. | chat, agents API |
| `AgentOrchestrator.ts` | DB-backed orchestrator (orchestration_sessions, agent_tasks tables) | agent-tasks API |
| `core-agents.ts` | Built-in core agent fallbacks when `agents` table missing | `/api/agents` GET |
| `director-graph.ts` | `buildDirectorPlan(goal)` pure function → 4-task plan (root/researcher/builder/reviewer). Back-compat `DirectorGraphPlanner` class. | `/api/director/plan` |
| `agent-profiles.ts`, `agent-tools.ts`, `agent-validation.ts`, `agent-worker.ts`, `agent-user.ts` | Agent subsystem | agent tasks |
| `agent-memory.ts` | `recallPersonaMemory`, `savePersonaMemory` (Supabase + Supermemory) | `/api/litt/think` |
| `agent-logger.ts` | Agent logger | agent observability |
| `agentCommands.ts` | Slash-commands for the in-terminal agent (`/help`, `/status`, `/orchestrate`, etc.) | LiTTTerminal |
| `persona.ts` | Persona IDs (`littcode`, `littlebit`, etc.) | chat |
| `auth.ts`, `authz.ts`, `jwt.ts` | Auth helpers | most API routes |
| `supabase.ts`, `supabase-admin.ts`, `supabase-client.ts` | Supabase clients (anon + service role) | every DB call |
| `r2.ts` | Cloudflare R2 storage (signed URLs with LRU cache) | media |
| `rate-limiter.ts` | Supabase-backed rate limiter (serverless-safe) | every API route via `withRateLimit` |
| `usage.ts` | Usage telemetry | usage endpoints |
| `user-db.ts` | `getUserByClerkId` (Clerk string → Supabase UUID) | agents/chat |
| `project-context.ts` + `project-context-server.ts` | `PROJECT_CONTEXT` string injected into Director + LiTT system prompts | agents/chat, litt/think |
| `integrations.ts` | `detectIntegrations`, `integrationStatusBlock`, `getProjectHealth` — used by `/api/litt/scan` tour | LiTT tour, StudioHealthPanel |
| `provider-error.ts` | `sanitizeProviderError` (clean 4xx/5xx for LLM failures) | ai-chat, agents/chat, litt/think |
| `siteConfig.ts` | `SITE_URL` for OpenRouter referer | llm.ts |
| Other libs: `wallet-ledger.ts`, `storage.ts`, `tokens.ts`, `api.ts`, `api-keys.ts`, `roles.ts`, `avatars.ts`, `color-templates.ts`, `command-executor.ts`, `code-scanner.ts`, `deployments.ts`, `discord.ts`, `games.ts`, `github-app.ts`, `gemini.ts`, `ha-api.ts`, `ha-tools.ts`, `media.ts`, `music.ts`, `navigation.ts`, `projects.ts`, `repo-scanner.ts`, `retro-arcade.ts`, `retro-artwork.ts`, `retro-quickplay.ts`, `skybox.ts`, `studio-actions.ts`, `studio-models.ts`, `studio-projects.ts`, `terminal-auth.ts`, `terminal-client.ts`, `themes.ts`, `tts-clean.ts`, `utils.ts`, `voices.ts`, `wallpapers.ts`, `chatRooms.ts`, `layout-schema.ts` | various subsystems | various |
| `src/lib/ai/` | AI provider adapters (`runAI`, providers) | `/api/litt/think` |
| `src/lib/project-loops/` | Project loops (Autonomic Loop) | background work |

---

## 4. THE ACTIVE WIRING — how a chat message flows

### Path A: User types in `LITTTerminalShell` or `FloatingChat` → "LiTT Director"
```
Browser (LITTTerminalShell.tsx / FloatingChat.tsx)
  → POST /api/agents/chat     { agentId, message, stream:true }
  → auth() (Clerk)
  → buildChatContext()
       - getUserByClerkId(userId)            [user-db.ts]
       - orchestrator.getAgent("director")   [agents.ts]
       - recallMemories(userId, msg)         [Supabase memories + Supermemory]
       - maybeGenerateImage(msg)             [Pollinations URL pre-compute]
  → Director path (image intent or fallback):
       streamText()                          [llm.ts]
         → Gemini 2.5 Flash primary
         → OpenRouter free / Qwen / DeepSeek fallbacks
  → composeImageCaption() if image intent
  → SSE chunks → { meta, image, text…, done }
  → persistMemory() (Supabase + Supermemory) [non-blocking]
```

### Path B: User types in `ChatDrawer` / `CanvasTool` / `BuilderStream`
```
Browser (ChatDrawer.tsx / CanvasTool.tsx / BuilderStream.tsx)
  → POST /api/ai-chat          { messages, model, stream:true }
  → auth() (Clerk)
  → Supermemory recall (per user containerTag)
  → streamText() (task:"code", provider per model map)   [llm.ts]
  → SSE chunks → { text… } → { done, provider, model, latencyMs }
  → Supermemory.add() (background)
```

### Path C: User on `/litt` page
```
Browser (studio/components/LITTTerminalShell.tsx or /litt page)
  → POST /api/litt/think       { message, context, history, persona, goals, visionContext, timeOfDay }
  → auth() (Clerk)
  → recallPersonaMemory()      [agent-memory.ts, Supabase + Supermemory, 1500ms timeout]
  → tour short-circuit? (no LLM call)
  → buildLiTTPrompt() + buildLiTTSystemPrompt()   [litt-context.ts]
  → runAIWithFallbacks()       [Gemini 2.5 Flash → Gemini 2.5 Pro → openrouter/free]
  → sanitizeLiTTResponse()     (strip fake tool calls)
  → parseLiTTActions()         (extract add_goal, remember, run_command, insert_command, etc.)
  → savePersonaMemory() for `remember` actions (background)
  → JSON { answer, actions }
  → Client renders answer + handles actions
```

### Path D: Director plans a multi-agent job
```
Browser → POST /api/director/plan     { goal }
  → buildDirectorPlan(goal)           [director-graph.ts]
  → returns PlanGraph { goal, tasks:[4] }
       task-researcher → task-builder → task-reviewer
       each assigned to littlebit or littcode, all using NEXT_PUBLIC_MODEL_NAME
```

---

## 5. WHAT'S NEEDED FOR EVERYTHING TO WORK

### Environment variables (must be set)
- `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) — primary LLM
- `OPENROUTER_API_KEY` — fallback chain
- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` + `CLERK_WEBHOOK_SECRET` — auth
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY` — DB
- `SUPERMEMORY_API_KEY` — semantic memory
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET` + `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` — billing
- `R2_ACCOUNT_ID` + `R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY` + `R2_BUCKET_NAME` — media storage
- `NEXT_PUBLIC_TERMINAL_WS_URL` (or `TERMINAL_WS_URL` or `TERMINAL_PORT`) — terminal server
- `ADMIN_CLERK_IDS` — admin gating
- `DISCORD_WEBHOOK_URL`, `ADMIN_EMAIL`, `JARVIS_WEBHOOK_URL`, `VAPID_*`, `RESEND_API_KEY` — `litt` notifications
- `NEXT_PUBLIC_MODEL_NAME` — used by `director-graph.ts`
- `STUDIO_LIVE_VOICE_ENABLED` — gates Gemini Live voice

### Supabase tables needed
- **In schema.sql:** `users`, `user_preferences`, `user_agents`, `subscriptions`, `wallets`, `transactions`, `posts`, `post_likes`, `post_comments`, `user_media`, `deployments`
- **Referenced by code (need to exist for full functionality):** `agents` (with `is_public`, `is_core`, `owner_id`, `is_featured`, `features`, `price_cents`, `rating`, `installs`, `avatar_url`), `memories` (with `owner_id`, `agent_id`, `scope`, `source`, `reason`, `sync_status`, `supermemory_id`), `agent_tasks`, `orchestration_sessions`, `orchestration_jobs`, `active_tasks`, `rate_limit_store`, `notifications`, `push_subscriptions`
- **Used by `/api/litt/scan` integration probe:** `memories`, `agents`, `agent_tasks`, `conversations`, `loops`, `notifications`, `wallets`

### Other infrastructure
- Terminal server (`pnpm terminal:dev` on its own port, or the docker/Fly/Railway deploy)
- R2 bucket configured for media uploads
- Stripe products/prices created (incl. Elite tier)

### Pieces already wired and live
✅ SSE streaming on `/api/agents/chat` (Director + image-intent paths)
✅ SSE streaming on `/api/ai-chat`
✅ LRU cache on `r2.ts` for `getSignedAudioUrl`
✅ `director-graph.ts` is a pure function
✅ `streamText` imported and used in `/api/ai-chat`
✅ `AutonomicLoopBanner` mounted on dashboard + agent + studio layouts
✅ `litt` notification dispatcher (with `jarvis` alias)
✅ `withLittIdentity` injected into every LLM call automatically
✅ `STUDIO_LIVE_VOICE_ENABLED` flag for Gemini Live
✅ Monaco isolated in dynamic component with error boundary
✅ Mobile Studio layout (single nav, fixed composer + bottom shell)

### What's still pending / live vs. dead (Autonomic Loop)

The banner pings these four endpoints every 60s (and immediately on tab visible):

1. `GET /api/director/plan`
   - **Live.** Returns 200 `{ status: "ok", ready: true }` with no auth.
   - Real work is in `POST` (auth + goal) which enqueues via `/api/agent-tasks`.
   - No hard dependency on DB tables for the health probe.

2. `GET /api/agents`
   - **Live with graceful degradation.**
   - On Supabase error or missing table: returns 200 + `agents` (core fallback) + `warning`.
   - Banner always sees 200.

3. `GET /api/memory`
   - **Live with graceful degradation.**
   - No query → returns recent memories (or `[]` + warning).
   - On missing `SUPERMEMORY_API_KEY` or `memories` table: 200 + `warning`, `source`.
   - Banner always sees 200.

4. `GET /api/agent-tasks`
   - **Live with graceful degradation (after patch).**
   - GET no longer requires auth (banner does plain fetch).
   - On missing table / error / no user: returns 200 + `tasks:[]` + `warning`.
   - POST still requires auth (real intake path).

**Worker / execution side (what actually runs tasks):**
- `src/lib/agent-worker.ts` → `AgentWorkerMatrix` (poll + claim + `OpenRouterExecutor`).
- `src/daemon.ts` → standalone Node process (reads `.env.local` directly, starts the matrix).
- This is **not** bundled into the Next.js app. It must be launched separately (Railway/Fly/Render/etc.).
- No in-Next.js background consumer exists (by design for serverless).
- The banner is the **health surface**; execution is out-of-band.

**Where the banner is mounted (as of this update):**
- Dashboard: `src/app/dashboard/layout.tsx`
- Agent: `src/app/agent/layout.tsx`
- Studio: `src/app/studio/layout.tsx`

All three surfaces now show the Autonomic Loop status.

**Summary for the active task:**
- The 4 endpoints the banner cares about are **all 200-safe** (never 4xx/5xx for probes).
- Core fallbacks + table-not-initialized warnings keep the UI green even in fresh DBs.
- Real loop execution depends on the external daemon + `SUPABASE_SERVICE_ROLE_KEY` + `SUPERMEMORY_API_KEY` + the `agent_tasks` table.
- The "dead" piece is any assumption that a Next.js serverless function is running the worker loop — it doesn't. The daemon is the live execution path.