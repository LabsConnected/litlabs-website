# LiTTree Ultra Roadmap Blueprint

This is the master build brief for LiTTree. Use it to guide product, UI, agent, and implementation decisions.

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
