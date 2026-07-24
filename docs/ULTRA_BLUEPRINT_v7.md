# LiTTree LabStudios — Ultra Blueprint v7.0
## Master Handoff for a New Chat

**Purpose:** This document is the canonical handoff for continuing LiTTree LabStudios in a fresh chat without losing architectural decisions, product direction, implementation priorities, or quality rules.

**North Star:**  
> LiTT is the operating system for turning ideas into reality.

**Primary abstraction:**  
> The Mission is the operating system's primary object.

---

# 1. Product Identity

## Platform
- **Name:** LiTTree LabStudios
- **Domain:** litlabs.net
- **Core product:** An AI operating system for builders.
- **Primary experience:** One workspace where users can create, code, chat, publish, run tools, manage projects, use voice/vision, and coordinate AI services without leaving the platform.

## Core promise
The user should be able to:

1. Describe an outcome.
2. Let LiTT create a Mission.
3. Watch the system inspect, plan, execute, verify, and produce artifacts.
4. Approve important changes.
5. Ship the result.

## Messaging
Do not market internal machinery such as DAGs, event buses, AST indexes, schedulers, or worker queues.

Use simple language:

> Describe it.  
> Watch LiTT build it.  
> Approve the important changes.  
> Ship it.

---

# 2. Canonical Agent Model

## User-facing agents
Exactly two primary user-facing agents:

### LiTT
- Main operating agent
- Calm, precise, strategic, project-aware
- Controls missions, routing, planning, approvals, and execution coordination
- Does not falsely claim tools or capabilities are connected
- Verifies system state before making claims

### Spark
- Creative and energetic companion
- Faster, warmer, more expressive
- Best for ideation, content, branding, visual direction, and brainstorming
- Uses the same underlying capability system and project context

## Retired names
Remove or migrate:
- LiTT-Code
- LiTTle-Bit
- Jarvis
- duplicate agent identities
- extra permanent agent cards

## Internal workers
Do not expose every specialist as a separate chatbot.

Use internal services:
- Research Service
- Planning Service
- Architecture Service
- Frontend Service
- Backend Service
- Database Service
- Design Service
- QA Service
- Security Service
- DevOps Service
- Media Service
- Social Service
- Finance Service
- Legal Service

LiTT and Spark remain the user-facing personalities. Internal services scale as needed.

---

# 3. Mission-Centric Architecture

## Mission object
Every serious task becomes a Mission.

A Mission owns:

- goal
- conversation
- plan
- execution graph
- tasks
- workers
- workspace
- project
- branch
- terminal sessions
- artifacts
- approvals
- runtime
- deployments
- analytics
- memory
- learning
- replay
- rollback
- version history
- audit events

## Mission lifecycle
```text
Created
→ Inspecting
→ Planning
→ Awaiting Approval
→ Ready
→ Executing
→ Verifying
→ Review
→ Deploying
→ Completed
```

Additional states:
```text
Blocked
Paused
Cancelled
Failed
Rolled Back
```

## Mission modes
- Immediate
- Scheduled
- Recurring
- Triggered
- Event-driven
- Dependency-gated

Examples:
- Deploy after tests pass
- Publish after approval
- Run nightly health checks
- Review dependencies weekly
- Retry failed production build

---

# 4. Mission Runtime

## Runtime responsibilities
The Mission Runtime owns:

- queueing
- task dependencies
- priority
- scheduling
- worker allocation
- runtime selection
- terminal sessions
- containers
- CPU/GPU placement
- timeouts
- retries
- cancellation
- snapshots
- checkpoints
- rollback
- budget
- health
- recovery

## Runtime targets
Eventually support:

- local
- Docker
- cloud
- edge
- GPU worker
- browser
- mobile

Routing must be based on capability, risk, cost, availability, and project policy.

---

# 5. Event-Driven System

Nothing important should rely on fake UI state or direct uncontrolled coupling.

## Mission event examples
```text
mission.created
mission.inspection.started
mission.plan.created
mission.approval.requested
mission.approval.granted
workspace.provisioned
task.started
task.completed
artifact.created
tests.failed
repair.started
tests.passed
deployment.started
deployment.failed
deployment.completed
mission.completed
mission.rolled_back
```

## Event contract
```ts
type MissionEvent = {
  id: string;
  missionId: string;
  taskId?: string;
  type: string;
  source: string;
  occurredAt: string;
  payload: unknown;
  correlationId: string;
  causationId?: string;
};
```

## Delivery
- database persistence
- authenticated SSE or Supabase Realtime
- event history
- idempotency
- replay support
- audit trail

---

# 6. Capability Registry

Use one shared capability system across the platform.

## Status model
```ts
type CapabilityStatus =
  | "unavailable"
  | "not_configured"
  | "connecting"
  | "validating"
  | "ready"
  | "running"
  | "degraded"
  | "expired"
  | "error";
```

## Categories
- project
- runtime
- model
- media
- storage
- deployment
- social
- communication
- analytics

## Core APIs
```text
GET    /api/capabilities
GET    /api/capabilities/[id]
POST   /api/capabilities/[id]/connect
POST   /api/capabilities/[id]/validate
POST   /api/capabilities/[id]/disconnect
```

## Truth rule
Never show:
- Connected
- Online
- Ready
- Running
- Live

unless verified by the server.

---

# 7. Project and Workspace System

## Supported project sources
- GitHub App
- Upload ZIP/project
- Template
- Blank project

GitHub is recommended, never mandatory.

## Project chain
```text
Project Source
→ Workspace
→ Runtime
→ Terminal
→ Dependencies
→ Preview
→ Logs
→ Deployment
```

## Correct unlock chain
```text
Select project
→ Prepare workspace
→ Load real files
→ Bind project terminal
→ Enable Git
→ Enable tests
→ Start preview
→ Stream logs
```

## Workspace requirements
- isolated workspace per user/project/session
- project-bound terminal tokens
- authorized file adapters
- version hashes
- patch records
- approval records
- checkpoints
- preview processes
- audit events
- conflict protection
- no direct destructive writes without approval

---

# 8. GitHub Integration

## Architecture
Use GitHub App installation flow, not personal access tokens as the default.

## Required behavior
- detect existing installations
- persist installation IDs
- map installation to authenticated Clerk user
- list repositories with pagination
- show branch, latest commit, PRs, issues, Actions, deployments
- verify webhook signatures
- store webhook deliveries
- support reconciliation
- refresh after callback
- disable stale caching

## Status endpoints
```text
GET  /api/integrations/github/status
GET  /api/integrations/github/diagnostics
POST /api/integrations/github/repair
POST /api/integrations/github/reconcile
```

## Important UI states
```text
checking
connected
not_installed
record_missing
permission_denied
expired
error
```

## Critical rule
Do not ask the user to reinstall until GitHub and local records have both been checked.

---

# 9. External Information and Integrations

LiTT needs four data paths.

```text
Current public information
→ Web search

Private connected services
→ MCP / Integration Gateway

LiTTree-owned data
→ Internal tools

Instant external changes
→ Webhooks + event stream
```

## MCP gateway
Target endpoint:
```text
https://api.litlabs.net/mcp
```

## Initial read-only tools
- GitHub repositories, files, commits, PRs, Actions
- Vercel deployments and domains
- Supabase project health
- LiTTree projects, agents, missions, notifications
- Stripe status and webhook failures
- Google Drive, Gmail, Calendar later

## Security
- encrypted credentials server-side
- short-lived scoped tokens
- strict tool allowlists
- approval for writes
- tool output treated as untrusted
- sources and retrieval times preserved
- no raw secrets in client or model context

---

# 10. Studio — Unified Builder

## Product rule
Studio is one workspace, not many disconnected pages.

## Desktop layout
```text
72px tool rail
+ flexible workspace
+ 360–440px persistent conversation panel
```

Inside Code mode:
```text
220–260px Explorer
+ flexible Monaco editor
+ 220–340px docked terminal
```

## Mobile layout
- `100dvh` 
- compact header
- one active workspace
- one primary scroll container
- one sticky composer in normal flex flow
- terminal as bottom sheet
- no stacked Chat, Mission, Activity, and Terminal sections

## Mobile modes
- Chat
- Build
- Mission

## Composer
Exactly:
```text
[+] [Message LiTT or Spark…] [Send] [Mic]
```

No duplicate microphone.
No top-right microphone.
No floating voice bar.

## Header
```text
[Menu] [LiTT/Spark] [Model] [Project] [Settings]
```

## Slash commands
Slash commands must switch real modes/actions:
```text
/build
/code
/terminal
/video
/audio
```

---

# 11. Unified Chat Backend

## Canonical route
```text
POST /api/chat/unified
```

## Server function
```ts
handleUnifiedChat()
```

It must handle:
- authentication
- active agent
- project/workspace context
- memory
- intent
- model routing
- tools
- streaming
- artifacts
- missions
- persistence
- provider fallback
- usage

## Request shape
```ts
type UnifiedChatRequest = {
  conversationId?: string;
  message: string;
  agentId: "litt" | "spark";
  mode: "chat" | "build" | "code" | "research" | "mission";
  projectId?: string;
  workspaceId?: string;
  provider?: string;
  model?: string;
  attachments?: unknown[];
  context?: unknown;
};
```

## SSE events
```text
start
status
text-delta
tool-start
tool-result
artifact
mission
usage
error
done
```

## Client stack
```text
src/app/studio/chat/
├── UnifiedChatProvider.tsx
├── UnifiedChatShell.tsx
├── UnifiedComposer.tsx
├── MessageList.tsx
├── ArtifactPanel.tsx
├── useUnifiedChat.ts
├── streamParser.ts
└── types.ts
```

No second chat system should own conversations independently.

---

# 12. Model Routing

## Selection model
Agent and model are independent.

Examples:
```text
LiTT · Gemini Fast
Spark · Gemini Pro
LiTT · Auto Best
```

## Model options
- Gemini Fast
- Gemini Pro
- Auto Best
- configured OpenAI models
- configured Anthropic models
- configured OpenRouter models
- local Ollama models

## Persistence
Use validated local storage:
```text
litt-selected-model-v2
```

## Rules
- validate provider/model server-side
- never silently change models
- report fallback visibly
- preserve actual provider/model in final SSE `done` 

---

# 13. Terminal

## Truthful status
```ts
type TerminalStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";
```

## Requirements
- shared PTY engine
- terminal remains mounted while collapsed
- project-bound session
- commands invoked through real API
- natural-language requests call execution tools
- results returned to chat

## Command result
```ts
type TerminalCommandResult = {
  command: string;
  cwd: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
};
```

## Rule
The browser shell is not a PTY.

If disconnected, LiTT must say:
> The browser shell is open, but the real project PTY is disconnected.

---

# 14. Voice

## One controller
One mic, one session, one voice engine.

## State machine
```text
idle
→ connecting
→ listening
→ user_speaking
→ transcribing
→ thinking
→ speaking
→ listening
```

Additional:
```text
cooldown
muted
error
```

## Mobile recording
- use `getUserMedia` 
- use `MediaRecorder` 
- detect supported MIME type
- never force WebM on iPhone
- stop all tracks
- detect silence
- auto-stop after about 1.2 seconds
- insert transcript into composer
- auto-send only when enabled

## Performance timing
Measure:
```text
speech_end
transcription_complete
AI_first_token
AI_complete
TTS_request
TTS_first_audio
playback_started
```

## Speech behavior
- stream model response
- start TTS after first complete sentence
- keep spoken replies short
- strip markdown, code, URLs, logs, and paths
- support barge-in
- cancel old audio immediately
- text remains usable during voice cooldown

## Voices
### LiTT
- deep
- calm
- precise
- confident
- slightly synthetic
- neutral American
- medium-slow

### Spark
- bright
- warm
- quicker
- curious
- expressive, not childish

---

# 15. Camera and Vision

## Camera states
```text
idle
requesting_permission
starting
live
paused
capturing
analyzing
permission_denied
no_device
device_busy
unsupported
error
```

## Live criteria
Do not show LIVE until:
- track `readyState === "live"` 
- metadata loaded
- `videoWidth > 0` 
- `videoHeight > 0` 
- `video.play()` succeeds

## Controls
- start
- stop
- pause
- flip
- device
- snapshot
- Ask LiTT
- attach

Record remains disabled until implemented.

## Vision flow
```text
video frame
→ canvas
→ JPEG/WebP Blob
→ upload
→ CameraArtifact
→ vision analysis
→ VisionBlock
```

## Endpoint
```text
POST /api/vision/analyze
```

The actual image must reach the model. Never invent descriptions.

---

# 16. Agents / Base Station

## Route
```text
/agents
```

## Purpose
Immersive LiTT Base Station, not another dashboard.

## Desktop layout
```text
260px roster
+ flexible station
+ 340px inspector
+ full-width mission dock
```

## Modes
- Explore
- Edit
- Command
- Saved layouts

## Rules
- exactly LiTT and Spark
- "More agents coming"
- transparent mascot renders
- real environment art
- drag/resize/reposition
- save only after movement ends
- terminal launcher opens shared Studio terminal
- mission history comes from real `agent_tasks` 

---

# 17. Dashboard / Developer Control Center

## Purpose
Real-time operational control center.

## Show
- projects
- GitHub repositories
- branches
- latest commits
- PRs/issues
- Actions
- deployments
- domains
- connection health
- recent activity
- worker health
- agent missions

## Integrations
- GitHub
- Vercel
- Supabase
- Meta
- Cloudflare
- model providers

## Diagnostics
Show exact:
- endpoint
- HTTP status
- missing permission
- failed stage
- repair action
- last verified time

No vague "not syncing" messages.

---

# 18. Settings / LiTT Control Deck

## Control modes
- Standard
- Advanced
- Pro
- Owner

Do not tie control modes directly to billing.

## Setting precedence
```text
System defaults
→ User global settings
→ Device overrides
→ Page-specific settings
→ Session overrides
```

Most specific valid setting wins.

## Main sections
- Overview
- Account
- Appearance
- Living UI
- Pages
- Navigation
- Workspace
- AI & Models
- Agents
- Voice & Camera
- Connections
- Automation
- Notifications
- Billing & LiTBits
- Privacy & Security
- Performance
- Advanced
- System Control

## Owner mode
Require:
- verified owner role
- reauthentication
- optional 2FA
- audit logs
- confirmation for destructive actions

---

# 19. Marketplace Beta Mode

## Current state
Marketplace remains full Public Beta.

## Rules
```text
BETA_MODE=true
BILLING_ENABLED=false
MARKETPLACE_PURCHASES_ENABLED=false
ALL_AGENTS_FREE_DURING_BETA=true
```

Server-side enforcement required.

## Beta currency
Display:
```text
Beta LiTBits
Testing credits · No cash value
```

Do not sell coin packs during beta.

## Agent model
LiTT and Spark remain primary agents.
Marketplace entries are specialists/skills invoked through them.

## Statuses
```text
available
installing
installed
updating
degraded
permission_required
unavailable
error
```

---

# 20. Games and Retro Arcade

## `/games` 
- cinematic Game Cloud hero
- no controller emoji hero
- artwork-first layout
- Continue Playing
- Quick Play shelf
- Emulator Labs
- instant browser games
- Build a Game callout
- legal/private storage messaging lower on page

## `/games/retro` 
- no permanent sidebars
- full-width Continue Playing hero
- horizontal system filters
- Quick Play shelf
- Recently Added
- Favorites
- Full Library
- floating LiTT companion
- compact legal footer

## Artwork system
Resolution order:
```text
custom local artwork
→ bundled Quick Play artwork
→ internal artwork mapping
→ original LiTT fallback artwork
```

No copyrighted commercial cover art bundled.

## Preserve
- IndexedDB ROM storage
- browser-only privacy
- legal confirmation
- emulator routes
- favorites
- launch count
- last played
- search
- filters
- imports
- delete
- drag and drop

---

# 21. Global Navigation

## Desktop
- 240px sidebar
- collapsible to 72px
- 64px top bar

Navigation:
- Dashboard
- Studio
- Agents
- Gallery
- Games
- Social
- Marketplace

Settings/profile at bottom.

## Mobile
- 56px compact header
- 5-item bottom nav:
  - Dashboard
  - Studio
  - Agents
  - Games
  - More

More sheet:
- Gallery
- Social
- Marketplace
- Settings
- Connections
- Account

Hide global chrome only in full-screen Studio.

---

# 22. Data Model

Canonical tables:

```text
conversations
conversation_messages
memories
agents
agent_tasks
task_events
artifacts
worker_heartbeats
projects
project_files
usage_events
missions
mission_steps
mission_events
mission_approvals
mission_checkpoints
integration_accounts
integration_projects
integration_credentials
integration_sync_runs
integration_events
project_deployments
project_activity
```

Consolidate overlapping orchestration tables into canonical `agent_tasks` and Mission tables.

---

# 23. Trust, Governance, and Audit

## Every action needs
- confidence
- evidence
- risk
- affected resources
- reversibility
- approval requirement
- suggested reviewer

## Risk examples
```text
CSS spacing change
→ low risk
→ optional auto-approval

Authentication rewrite
→ high risk
→ approval required

Production database deletion
→ critical
→ blocked by default
```

## Governance records
- model version
- provider
- prompt version
- tools used
- token usage
- cost
- approvals
- denials
- artifacts
- retries
- rollback
- security events
- deployment outcome

---

# 24. Memory and Builder DNA

## Memory hierarchy
```text
Global
Organization
User
Workspace
Project
Mission
Worker
Task
Execution scratchpad
```

Only retrieve the smallest relevant context.

## Builder DNA
Store:
- architecture conventions
- naming
- folder structure
- coding style
- design language
- typography
- spacing
- components
- animation style
- testing philosophy
- commit conventions
- infrastructure
- deployment strategy
- approval preferences

---

# 25. Digital Twin

LiTT should maintain a verified, continuously updated model of:

- repository state
- database schema
- API topology
- runtime health
- dependencies
- deployments
- feature flags
- open defects
- security findings
- usage
- cost
- technical debt
- analytics
- billing health

The Digital Twin must come from real adapters and events, never invented summaries.

---

# 26. Mission Replay and Marketplace

## Replay
Users should be able to:
- observe
- pause
- inspect
- fork
- retry from checkpoint
- continue
- publish as template

## Mission Marketplace
Future marketplace objects:
- complete missions
- workflows
- worker services
- skills
- project templates
- automation packs

Not merely prompts.

---

# 27. Performance and UX Rules

## Interaction
- visible response under 100ms
- target INP under 200ms
- 44px touch targets
- no nested interactive controls
- decorative SVGs use `pointer-events-none` 
- no heavy synchronous click handlers
- no global rerenders during drag or scroll

## Mobile
- test 375, 390, 430 widths
- safe areas
- keyboard open/closed
- portrait/landscape
- one main scroll region
- no page-wide overflow
- no covered composer

## Motion
- respect `prefers-reduced-motion` 
- performance governor:
  - battery
  - balanced
  - high
  - auto

Reduce effects when:
- mobile
- low battery
- FPS below 45
- hidden tab
- reduced motion
- limited hardware

---

# 28. Truth and Safety Rules

Never:
- fake connection state
- invent terminal access
- invent repo contents
- invent deployment state
- claim "production-ready" without verification
- expose secrets client-side
- silently change providers/models
- perform destructive actions without approval
- add dead UI controls
- ship visual placeholders as real functionality

Always:
- inspect the repository first
- verify backend state
- report exact failure stages
- preserve user data
- make incremental changes
- run validation
- provide rollback path
- use server-side authorization

---

# 29. Required Validation

For coding changes, run:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

Also verify:
- no console errors
- no failed network calls
- no hydration warnings
- no stale capability states
- no broken mobile layout
- no inaccessible dialogs
- no fake success states
- no missing cleanup on unmount

Do not claim completion until checks pass.

---

# 30. Recommended Build Order

## Phase 1 — Truthful Foundation
1. Capability Registry
2. Unified authentication/context resolver
3. GitHub installation repair and diagnostics
4. Real project selection
5. Workspace provisioning
6. Project-bound terminal
7. Real files and version hashes
8. Preview/log process
9. Unified chat endpoint
10. truthful status surfaces

## Phase 2 — Mission Core
1. Mission schema
2. Mission state machine
3. mission events
4. agent tasks
5. approvals
6. artifacts
7. checkpoints
8. retries
9. worker health
10. replay foundation

## Phase 3 — Connected Intelligence
1. web search
2. MCP gateway
3. GitHub/Vercel/Supabase tools
4. external webhooks
5. unified SSE
6. live activity
7. connection diagnostics

## Phase 4 — Experience
1. unified Studio
2. mobile shell
3. one composer
4. voice
5. camera/vision
6. Base Station
7. Control Deck
8. Dashboard
9. Marketplace beta
10. Game Cloud redesign

## Phase 5 — Advanced OS
1. Scheduler
2. Distributed runtime
3. Trust engine
4. Builder DNA
5. Digital Twin
6. Learning engine
7. sandboxed skills
8. Mission Replay
9. Mission Marketplace
10. Governance

---

# 31. Immediate Next Milestone

The next meaningful milestone should be a fully verified vertical slice:

```text
Choose GitHub or Blank Project
→ Initialize project
→ Runtime Ready
→ Workspace Loaded
→ Terminal Connected
→ Files Visible
→ Preview Running
→ Logs Streaming
→ Ask LiTT to make a small change
→ Review diff
→ Approve
→ Run tests
→ See result
```

This one flow proves the architecture.

---

# 32. Definition of Success

LiTTree LabStudios succeeds when:

- LiTT understands the user's intent
- creates a Mission
- inspects real project state
- plans transparently
- selects the correct internal services
- executes in a verified workspace
- produces reviewable artifacts
- requests approval for risky actions
- validates the result
- deploys safely
- learns from the outcome
- preserves replay and rollback

The system should feel simple even when the architecture is sophisticated.

---

# 33. New Chat Starter Prompt

Paste this after uploading this blueprint:

```text
This file is the canonical LiTTree LabStudios Ultra Blueprint.

Treat every decision in it as the current source of truth unless I explicitly
change it.

Before proposing implementation:
1. Identify the exact section involved.
2. Separate what already exists from what is still missing.
3. Do not invent repository state.
4. Do not claim capabilities are connected without verification.
5. Prefer one real vertical slice over broad visual redesign.
6. Preserve LiTT and Spark as the only primary user-facing agents.
7. Keep the Mission as the platform's primary object.
8. Run typecheck, lint, tests, and build before reporting completion.

Start by summarizing:
- the current architecture
- the next highest-value milestone
- the exact files and services that must be inspected first
- the risks that could cause fake or disconnected behavior
```

---

# Final Product Principle

> The architecture may be complex.  
> The user experience must feel effortless.  
> Everything begins with a Mission.
