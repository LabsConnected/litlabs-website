# LiTTree Ultra Roadmap Blueprint

This is the master build brief for LiTTree. Use it to guide product, UI, agent, and implementation decisions.

> The sections below the **Engineering Execution Plan** are the brand / design / product vision brief. The Execution Plan translates that vision into phased, verifiable engineering work with concrete deliverables, success criteria, dependencies, and live status.

---

# Engineering Execution Plan

LiT is a TypeScript / Next.js LLM companion (there is no separate Python agent engine). "Intelligence" is delivered by: a shared prompt+memory layer (`src/lib/ai/lit-brain.ts`), structured user facts in Supabase (`user_brain`), optional Supermemory vector RAG, and a small persisted personality state (`lit_state`). All layers degrade gracefully when keys/DB are absent.

Status legend: ✅ done · 🟡 in progress · ⬜ planned

### Phase 0 — Memory foundation & one brain ✅

- **Deliverables**
  - Shared memory/personality module `src/lib/ai/lit-brain.ts` (`loadLitMemory`, `persistLitTurn`, Supermemory, fact extraction, conversation logging).
  - Main console endpoint `/api/litt-code/think` wired to load identity + brain facts + memories and to persist facts after each reply (previously it had none).
  - `/api/gemini/chat` refactored onto the same shared module — duplicated prompt/memory logic removed.
  - Full rename of the legacy "Jarvis" surface to **LiTT CODE** (routes, components, display labels).
- **Success criteria**: main chat recalls user facts across sessions; both endpoints share one code path; `tsc`/`lint`/`build` green.
- **Dependencies**: Supabase `user_brain`/`users`, optional `SUPERMEMORY_API_KEY`.

### Phase 1 — Short-term summarization & memory aging ✅

- **Deliverables**
  - Rolling summarization of turns beyond the recent window (`summarizeHistory`) so long chats keep early context.
  - Relevance-ordered fact retrieval with an injection cap (`BRAIN_FACT_LIMIT`) so low-signal facts fall out of the prompt.
  - Aging columns `user_brain.last_used_at` / `usage_count` + soft-forget (`decayStaleFacts`) via migration `20260708220000`.
- **Success criteria**: prompt size bounded regardless of history length; unused facts expire; reads never break pre-migration.
- **Dependencies**: Phase 0; migration applied before deploy for aging to take effect.

### Phase 2 — Persisted personality / mood state ✅

- **Deliverables**
  - `lit_state` table (rapport / energy / momentum, bounded 0–100) via migration `20260708220000`.
  - Deterministic bounded update per turn (`updateLitState`) + idle energy recovery; injected into the prompt as an internal-state block that subtly shapes tone.
- **Success criteria**: state persists per user, stays within bounds, and measurably shifts reply tone (warmth/brevity) as it changes.
- **Dependencies**: Phase 0; `lit_state` migration.

### Phase 3 — Conversation persistence & retrieval ⬜

- **Deliverables**: first-class `conversations`/`messages` tables (server-owned history instead of client-sent), thread list + resume UI, server-side truncation feeding Phase 1 summarization.
- **Success criteria**: a user can leave and resume a titled thread; history survives client state loss.
- **Dependencies**: Phases 0–1.

### Phase 4 — Multi-agent orchestration & tools ⬜

- **Deliverables**: shared memory/state across all agents (Forge, Pulse, Visionary…), tool/function calling with permissioned actions, richer action routing beyond keyword matching.
- **Success criteria**: agents hand off with shared context; tool calls are auditable and permissioned.
- **Dependencies**: Phases 0–3.

---

## Core Direction

Build LiTTree as a technical AI operating system, not a basic SaaS dashboard.

The product identity combines:

- AI command center
- Cyberpunk IDE
- Living circuit-tree system
- Holographic glass interface
- Creator ecosystem
- Agent-powered workspace

The tree concept must feel technical, not fantasy.

LiTTree is the central system architecture:

- Roots: memory, knowledge, user data
- Trunk: core runtime and platform engine
- Branches: agents, workflows, pipelines
- Leaves: active tasks
- Fruit: completed projects, apps, songs, games, agents, images
- Orbit: deployed products and live projects
- Energy flow: AI processing, thinking, building, deploying

The product should feel like Cursor, Tony Stark lab, TRON, a space command center, an AI IDE, and a game-like creator OS, while remaining unmistakably LiTTree.

## Signature Palette

```css
:root {
  --void-black: #050507;
  --panel-black: #0A0E12;
  --glass-dark: rgba(10, 16, 22, 0.72);

  --electric-cyan: #2DF6FF;
  --solar-orange: #FF8A1C;
  --emerald-glow: #49FF9E;
  --soft-white: #F7FAFC;

  --danger-red: #FF4D4D;
  --warning-yellow: #FFD166;
  --muted-blue: #6B8CFF;
}
```

## Style Rules

Use:

- Dark glass panels
- Neon cyan/orange edge lighting
- Thin technical borders
- Holographic depth
- Terminal grid backgrounds
- Circuit-vine linework
- Subtle animated particles
- Code-stream overlays
- Rounded hexagon cards
- Soft purposeful glow

Avoid:

- Generic purple SaaS style
- Plain rectangle cards
- Flat black empty sections
- Fantasy forest visuals
- Random animations that do not represent real state

## Product Modules

LiTTree should feel like a full OS with districts/modules:

1. Dashboard / Command Center
2. Studio / AI IDE
3. Agents / Agent Runtime Registry
4. Memory / Root Graph
5. Gallery / Artifact Museum
6. Marketplace / Creator Economy
7. Games / Arcade Engine
8. Music / Audio Lab
9. Deployments / Launch Pad
10. Analytics / Signal Tower
11. Settings / Control Panel
12. LiTT Companion / AI Co-Pilot

## Dashboard / Command Center

The dashboard is the user's home universe, not a boring stats page.

Required elements:

- Welcome greeting
- LiTTree Core visual in center
- Active agents panel
- Recent projects
- Running missions
- Credit balance
- Deployment status
- Marketplace earnings
- Notifications
- System health
- Quick actions
- Command input bar

Expected behavior:

- Tree pulses when the user enters
- LiTT greets them
- Active agents appear as glowing orbs
- Completed projects appear as fruit/crystals
- Deployments orbit around the tree
- Memory roots glow when new data is added

## Studio / AI IDE

Studio is the highest-priority page. It is where users build.

Required panels:

- File explorer
- Chat / agent conversation
- Code editor
- Live preview
- Terminal
- Artifact output panel
- Agent runtime panel
- Logs/errors
- Deploy button
- Model picker
- Version history

Studio must support:

- Code generation
- File editing
- Live preview
- Terminal commands
- Deployment flow
- Error fixing
- Agent collaboration
- Prompt history
- Project memory
- Build progress
- Voice input later

## Agents / Runtime Registry

The Agents page should feel like a futuristic control room.

Required agent types:

- Director Agent
- Code Agent
- Design Agent
- Writer Agent
- Social Agent
- Music Agent
- Game Agent
- Deployment Agent
- Debugger Agent
- Research Agent
- Data Agent
- Marketplace Agent

Agent cards should show:

- Name
- Role
- Status
- Current task
- Model used
- Memory access
- Tools enabled
- Last run
- Performance score
- Start / Pause / Configure buttons

Status colors:

- Cyan: online
- Orange: working
- Emerald: completed
- Red: error
- Gray: sleeping

## Memory / Root Graph

Memory should be visualized as glowing roots beneath the LiTTree.

Required memory features:

- User memories
- Project memories
- Agent memories
- Uploaded documents
- Code context
- Conversations
- Searchable knowledge graph
- Semantic connections
- Delete/edit memory
- Pin important memories

Each root node can represent:

- Project
- File
- Conversation
- User preference
- Agent knowledge
- Website/page
- Asset

Clicking a node opens related context.

## Gallery / Artifact Museum

Gallery should feel like a trophy room and artifact repository, not just a grid.

Artifact types:

- Images
- Apps
- Websites
- Songs
- Games
- Agents
- Prompts
- Videos
- Documents
- Deployments

Important gallery fix:

- Remove duplicate items.
- Use unique IDs and hash checking.
- Same image hash = duplicate.
- Same project ID = duplicate.
- Same title + same URL = likely duplicate.

Gallery cards need:

- Preview
- Type
- Created date
- Project source
- Open
- Edit
- Share
- Publish
- Delete

## Marketplace

Marketplace should sell the ecosystem and connect back to Studio.

Categories:

- Agents
- Templates
- Games
- Music packs
- UI kits
- Prompt packs
- Workflows
- Automation tools
- Creator assets

Cards should show:

- Preview image
- Creator
- Price
- Rating
- Installs
- Category
- Buy button
- Preview button

Every CTA should lead to one of:

- Use in Studio
- Customize in Studio
- Deploy from Studio

## Games / Arcade Engine

Games should feel like a neon arcade inside the OS.

Required features:

- Game grid
- Categories
- Featured games
- Continue playing
- Leaderboards
- Achievements
- Favorites
- Play now
- Build your own game in Studio

Connect game pages to:

- AI Game Builder
- Asset Library
- Music Lab
- Publishing system

## Music / Audio Lab

Music should feel like waveform engineering.

Required features:

- AI music generator
- Beat sequencer
- Audio waveform preview
- Prompt-to-song
- Genre presets
- Export button
- Save to Gallery
- Publish to Marketplace

Visual style:

- Neon waveform
- Audio-reactive background
- Equalizer grid
- Cyan/orange beat markers

## LiTT Companion

LiTT is the platform guide, not just a chatbot.

Behaviors:

- Idle: waves, looks around, sleeps after inactivity
- Working: watches code stream, thinks with animated glow, points to active panels
- Success: celebrates, fist bump, holographic confetti
- Error: looks concerned, points to issue, offers fix
- Voice: mouth/face animation, audio waveform ring, listening state, speaking state

LiTT should be helpful without being annoying. Users must be able to minimize, mute, or disable animations.

## Motion System

Animations must communicate real state.

Allowed animations:

- Agent running: energy moving through branches
- Build running: progress pipeline
- Memory saved: roots glow
- Deployment success: project launches into orbit
- Error: red pulse on affected panel
- Marketplace sale: orange bloom
- New artifact: fruit appears on tree

Do not use:

- Random spinning loaders
- Constant distracting motion
- Fake progress
- Heavy animations on mobile

Respect `prefers-reduced-motion`.

## Loading States

Never use basic spinners alone. Use technical progress states:

- Mission Accepted
- Researching...
- Planning Architecture...
- Generating Files...
- Running Tests...
- Preparing Preview...
- Deploying...
- Mission Complete

Show real logs when available.

## Mobile Requirements

Mobile is priority.

Required mobile layout:

- Sticky bottom command bar
- Visible chat input at all times
- Collapsible side menu
- Full-screen panels
- Swipe between Chat / Preview / Files / Logs
- Floating LiTT minimized bubble
- Large tap targets
- No hidden menu issue
- No blocked input field

Mobile bottom dock buttons:

- Home
- Studio
- Agents
- Create
- LiTT

## Technical Stack Recommendation

Use:

- Next.js
- TypeScript
- Tailwind CSS
- Framer Motion
- Zustand or Redux Toolkit
- Supabase
- Clerk
- Stripe
- OpenRouter / multi-model router
- xterm.js
- Monaco Editor
- React Flow for memory graph / agent graph
- WebSockets for live agent updates

## Required Component Targets

Build reusable components under `/components/littree/`:

- `LiTTreeCore.tsx`
- `LiTTreeEnergyFlow.tsx`
- `LiTTreeOrbit.tsx`
- `LiTTCompanion.tsx`
- `CommandDock.tsx`
- `AgentRuntimePanel.tsx`
- `MissionBoard.tsx`
- `MemoryRootGraph.tsx`
- `ArtifactMuseum.tsx`
- `MarketplaceGrid.tsx`
- `StudioShell.tsx`
- `TerminalPanel.tsx`
- `ModelRouterPanel.tsx`
- `MobileBottomNav.tsx`
- `SystemHealthPanel.tsx`
- `DeploymentOrbit.tsx`

## Accessibility Requirements

Must include:

- Keyboard navigation
- Proper contrast
- Reduced motion mode
- Screen reader labels
- Focus states
- Mobile readability
- Buttons with clear labels
- No unreadably small text

## Performance Requirements

Use:

- Lazy loading
- Dynamic imports
- Reduced animation on low-end devices
- Memoized heavy components
- Lightweight particles
- Canvas only where useful
- Skeleton loading
- Image optimization

Targets:

- Fast mobile load
- No jank
- Smooth 60fps where possible
- Graceful fallback without WebGL

## Production Phases

### Phase 1: Foundation

- Fix branding from Jarvis to LiTTree LiT / LiTT
- Build dashboard shell
- Build mobile nav
- Fix mobile chat input
- Add command dock
- Add Studio layout
- Add reusable glass panel system
- Add signature colors
- Add reduced motion support

### Phase 2: Core OS

- Build LiTTree Core visual
- Build Agent Runtime Panel
- Build Memory Root Graph
- Build Studio IDE layout
- Add terminal with xterm.js
- Add Monaco editor
- Add live preview
- Add model picker

### Phase 3: Creator Tools

- Gallery dedupe
- Artifact Museum
- Music Lab
- Game Builder
- Marketplace connection
- Deployments page
- Project history
- Version timeline

### Phase 4: Living System

- LiTT animations
- Agent movement indicators
- Deployment orbit
- Mission progress animation
- Achievement system
- Creator profile tree
- Sound effects toggle

### Phase 5: Ecosystem

- Marketplace monetization
- Creator profiles
- Agent store
- Template store
- Community feed
- Academy
- Analytics
- Mobile app/PWA

## Final Product Feeling

LiTTree should feel like:

> A living cyber AI operating system where creators build apps, agents, games, music, websites, and businesses through one intelligent command center.

It should not feel like:

- A normal chatbot
- A boring dashboard
- A clone of Cursor
- A Google AI Studio copy
- A generic SaaS template

The final result should be unmistakably LiTTree:

- Glowing circuit tree
- LiTT companion
- Cyan/orange energy
- Holographic glass UI
- AI IDE workflow
- Game-like progression
- Creator economy
- Live agents
- Real building tools
