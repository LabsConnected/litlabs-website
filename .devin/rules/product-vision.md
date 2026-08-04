# Product Vision Rules — LiTTree OS

> Source: LiTTree OS Product Vision & Architecture Direction
> These rules govern product decisions and feature prioritization.

## Naming (locked)

- Company/platform: **LiTTree LabStudios**
- Product: **LiTTree OS**
- Main AI operator: **LiTT**
- Creative companion: **Spark**
- Domain: **litlabs.net**
- Do NOT alternate between LiT and LiTT in product UI.

## Five Core Objects

1. **Mission** — what the user wants accomplished
2. **Project** — where everything belongs
3. **Conversation** — how the user directs LiTT
4. **Artifact** — code, image, video, document, deployment
5. **Capability** — GitHub, terminal, image generation, Stripe, publishing

Everything else is a view around those objects.

## User Flow (NOT tool-picker)

```
Describe outcome → LiTT creates Mission → Project opens → Tools activate → Work executes → User reviews → Result ships
```

NOT: Choose Builder → Choose Agent → Choose Console → Choose Files → Choose Preview → Figure out what to do next

## Navigation

**Desktop top-level:** Home · Projects · Studio · Marketplace · Games · Community · Settings

**Inside Studio:** Chat · Canvas · Files · Preview · Activity
Secondary tools open in panels: Terminal · Database · Deploy · Logs · GitHub · Analytics · Agents

**Mobile:** Home · Studio · Create · Projects · More
Floating LiTT button opens universal command bar. No seven permanent bottom-nav buttons.

## Builder + Studio Merge

"Builder" is NOT a separate product. Studio adapts based on Mission:
- Build a website → code workspace
- Create a wallpaper → image workspace
- Make a video → video workspace
- Analyze a file → document workspace
- Deploy my project → deployment workspace

Same conversation. Same project. Same Mission.

## Agents (simplified)

- **LiTT** — operating agent
- **Spark** — creative agent
- Do NOT create permanent user-facing roles (Director, Engineer, Designer, Researcher, Social Agent). Those are internal services LiTT invokes.
- Agent Forge for custom agents comes AFTER core execution loop works.

## Autopilot (the "wow" feature)

Must be truthful. Every displayed action must come from a real event.
Never fake: reading files, running build, deploying, connected, preview ready, tests passed.
Transparency = trustworthiness.

## Build Phases

**Phase 1 — Prove the OS (vertical slice):**
Create/connect project → Workspace loads → Files are real → PTY connects → Ask LiTT for one change → Diff appears → Approve → Tests run → Preview updates → Checkpoint saved

Do NOT expand Marketplace, Business Hub, Community, Agent Forge, or gamification until this works.

**Phase 2 — Creation tools:**
Image, Video, Audio, Voice, Camera, Screen capture, Asset library (all stored as project artifacts)

**Phase 3 — Connected publishing:**
Vercel, GitHub, Supabase, Cloudflare, social publishing, deployment history, analytics

**Phase 4 — Ecosystem:**
Marketplace, Agent Forge, Community, Teams, Business Hub, Plugin Store, Advanced automation

## What NOT to Build Yet

Delay: Taxes, CRM, Season passes, Agent battles, Heatmaps, Courses, Organizations, Hackathons, Complex income systems, Hundreds of plugins.

## Positioning

- Headline: "Turn an idea into something real."
- Subheadline: "LiTTree OS gives you one AI workspace to create, code, automate, review, and publish—without juggling separate tools."
- Product statement: "Tell LiTT what you want to accomplish. It creates a Mission, activates the right tools, keeps everything organized inside your project, and helps you ship."

## Product Model

```
LiTTree OS
├── Home
├── Projects
│   ├── Missions
│   ├── Conversations
│   ├── Files
│   ├── Artifacts
│   ├── Deployments
│   └── History
├── Studio
│   ├── Chat
│   ├── Canvas
│   ├── Code
│   ├── Media
│   ├── Preview
│   └── Activity
├── Marketplace
├── Games
├── Community
└── Settings
```

## Core Principle

The advantage will NOT come from having the longest feature list. It will come from one conversation reliably coordinating real tools and shipping a verified result. That is the product worth finishing first.
