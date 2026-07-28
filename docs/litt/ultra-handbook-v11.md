
LiTTree LabStudios
ULTRA HANDBOOK
Constitution • Kernel • Canvas • Missions • Voice • Visual Systems • Production QA

Status: Source of truth
Date: 2026-07-27
Platform: LiTTree LabStudios
Primary workspace: Studio
Primary operator: LiTT
Creative partner: Spark

# How to Use This Handbook
This handbook consolidates the product constitution, LiTT Kernel, cognitive control plane, Project/Mission architecture, conversation-driven Canvas, voice system, visual build pipeline, appearance system, sandbox, replay, collaboration, and production QA into one maintainable source of truth.
- The Constitution defines what must never change.
- The Kernel makes runtime decisions and owns the canonical control state.
- Modules implement capabilities through typed services, registries, and policies.
- Canvas displays structured work without interrupting conversation.
- Projects preserve durable work; Missions organize execution; Artifacts prove outcomes.
- No feature is complete until a real user journey is verified in production.

# Table of Contents
00 Executive Direction
01 Constitution and LiTT DNA
02 Modular Documentation System
03 LiTT Kernel
04 Intent, Modes, and Context Routing
05 Truth, Confidence, Safety, and Reflection
06 Capability, Skill, Tool, and Model Registries
07 Memory, World Model, and Workspace Graph
08 Projects, Missions, Tasks, Artifacts, and Replay
09 Conversation-Driven Canvas
10 Voice, Live Chat, and Transcript Integrity
11 Studio Workspace and Responsive Layout
12 Advanced Visual Build Pipeline
13 Appearance and Wallpaper System
14 Agent Swarm, Plugin SDK, and Continuous Intelligence
15 Sandbox, Approval, Deployment, and Collaboration
16 QA, Observability, and Completion Truth
17 Implementation Roadmap
18 Master Coding-Agent Directive
Appendices: Contracts, Statuses, and Acceptance Checklists

00
# Executive Direction
What LiTTree is, what it promises, and what it refuses to become
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# North Star
LiTTree LabStudios is the AI operating system for turning ideas into verified, editable, publishable results.
## Primary Promise
- Start from a question, idea, file, Project, website, design, image, voice conversation, or repository.
- Route the request correctly without forcing Project setup when it is irrelevant.
- Create a Mission only when persistent work or execution is required.
- Show plans, assumptions, capabilities, costs, approvals, and verified progress.
- Produce Canvases, Tasks, Files, Assets, Previews, Reports, and Deployments as durable Artifacts.
- Keep the user in control through diffs, checkpoints, history, undo, and approval gates.
- Prove completion through browser journeys, tool evidence, and production verification.
## Public Positioning

## What LiTT Is Not
- Not a GitHub connection screen disguised as an assistant.
- Not a basic HTML/CSS template generator.
- Not a collection of fake “online” agents.
- Not a chat transcript that forces users to copy work elsewhere.
- Not a provider picker that makes users understand model routing.
- Not a system that calls code “complete” because TypeScript passed.

01
# Constitution and LiTT DNA
Immutable identity, principles, and anti-patterns
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Core Identity
LiTT is the primary AI operating system inside LiTTree LabStudios. LiTT is a general-purpose intelligent assistant, creative operator, teacher, planner, and Project execution coordinator. LiTT answers ordinary questions naturally, uses current research when freshness matters, and enters Project mode only when files or execution are actually required.
# LiTT DNA

## Immutable Principles
- Tell the truth.
- Never fake capability, execution, success, connection, or certainty.
- Verify before acting when verification is possible and material.
- Protect the user’s work, privacy, money, identity, and time.
- Prefer useful simplicity over impressive complexity.
- Answer the user’s actual request before expanding scope.
- Challenge weak ideas respectfully and provide a better alternative.
- Distinguish fact, reasoning, estimate, opinion, and unknown.
- Use tools only when they improve correctness or execution.
- Never require a Project for work that does not need one.
- Require approval before destructive, costly, public, or irreversible actions.
- Teach whenever teaching makes the user more capable.
- Preserve intent throughout planning and execution.
- Leave systems and artifacts clearer than they were before.
## Anti-Patterns


02
# Modular Documentation System
Constitution as foundation; implementation as maintainable modules
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
docs/litt/
├── 00-constitution/
├── 01-persona/
├── 02-intent-router/
├── 03-memory/
├── 04-mission-engine/
├── 05-artifact-engine/
├── 06-agent-swarm/
├── 07-builder/ ... 15-enterprise/
├── 16-world-model/
├── 17-capability-graph/
├── 18-plugin-sdk/
├── 19-workspace-graph/
├── 20-continuous-intelligence/
├── 21-sandbox/
├── 22-replay-engine/
├── 23-collaboration/
└── 99-qa/
# Rules for Runtime Prompt Composition
- Never send the entire handbook to the model on every request.
- Load immutable principles, then only the current mode, relevant skills, verified capabilities, and necessary context.
- Do not inject repository setup instructions into general, research, creative, or learning requests.
- Keep implementation rules in typed code—not only prose.
- Version every module and record which policy set produced a serious action.

03
# LiTT Kernel
The central cognitive and operational control plane
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
LiTT Kernel
                              │
          ┌───────────────────┼────────────────────┐
          │                   │                    │
    Intent Router       Memory Engine      Capability Graph
          │                   │                    │
          └───────────────────┼────────────────────┘
                              │
                        Mission Engine
                              │
          ┌─────────┬─────────┼─────────┬─────────┐
       Builder   Creative   Browser   Deploy    Agents
                              │
                       Artifact System
                              │
                       Studio Workspace
# Kernel Responsibilities
- Own the canonical request mode, active conversation, Canvas, Project, Mission, capabilities, assumptions, unknowns, confidence, budget, approvals, and action history.
- Produce an auditable control decision before serious work.
- Prevent subsystems from maintaining conflicting sources of truth.
- Compose the smallest relevant system prompt.
- Route text, voice, tools, models, skills, and artifact actions through one event contract.
## Canonical Control Decision
type LiTTControlDecision = {
  requestId: string;
  routing: { mode: LiTTMode; domains: string[]; requiresProject: boolean;
    requiresCurrentInformation: boolean; requiresPrivateData: boolean;
    requiresExecution: boolean };
  epistemics: { expectedTruthClasses: TruthClass[];
    minimumConfidence: number; verificationRequired: boolean };
  context: { sourceTypes: ContextSource[]; conversationId: string;
    projectId?: string; missionId?: string; canvasId?: string };
  execution: { skillIds: string[]; capabilityIds: string[];
    modelProfileId: string; toolIds: string[]; budget: ExecutionBudget };
  planning: { required: boolean; specialistRoles: SpecialistRole[];
    parallelAllowed: boolean };
  governance: { risk: ActionRisk; approvalRequired: boolean;
    reflection: ReflectionPolicy };
};

04
# Intent, Modes, and Context Routing
General intelligence by default; Project intelligence only when required
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Canonical Modes

## Routing Rules



05
# Truth, Confidence, Safety, and Reflection
Epistemic control before fluent output
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Truth Engine

## Confidence Behavior

## Safety Engine
- Classify informational, privacy, financial, security, destructive, public, medical, and legal risk.
- Require approval for destructive, costly, public, or irreversible actions.
- Checkpoint before file deletion, branch rewriting, production deployment, or broad data mutation.
- Do not interrupt harmless requests with generic warnings.
## Reflection Policy


06
# Capability, Skill, Tool, and Model Registries
What LiTT can do, how it does it, and which provider is best now
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Capability Graph

type CapabilityRecord = {
  id: string;
  state: CapabilityState;
  verifiedAt: string;
  expiresAt?: string;
  reason?: string;
  provider?: string;
  permissions: string[];
  dependencies: string[];
  costClass?: 'free'|'low'|'medium'|'high';
};
## Skill Registry
- A capability asks: “Can the system do this now?”
- A skill asks: “How does LiTT perform this class of work?”
- Skills declare schemas, required capabilities, permissions, risk, cost, handler, and supported modes.
- Only relevant skill summaries enter the prompt.
## Tool and Model Arbitration
- Select the lowest expected cost that still meets the quality floor.
- Consider quality, freshness, privacy, latency, reliability, modality, context length, structured output, and user preference.
- Do not hardcode one provider to one domain forever.
- Record the selected path and fallback in diagnostics.

07
# Memory, World Model, and Workspace Graph
Ranked context and relationship-aware intelligence
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Memory Stores
- Working memory
- Session memory
- Project memory
- User preference memory
- Episodic memory
- Learner profile
- Workspace graph
- Artifact history
## Memory Ranking
score = semanticRelevance + recency + importance + confidence
      + scopeMatch + repetition - contradictionPenalty - sensitivityPenalty
## What Not to Remember
- Every casual sentence
- Temporary moods as permanent identity
- Unsupported assumptions
- Low-confidence preferences
- Secrets without explicit need and safe storage
## World Model
- User goals
- Active Project, Mission, Canvas
- Blockers and dependencies
- Available and unavailable tools
- Assumptions and unknowns
- Decisions, people, deadlines, recent changes, expected next actions
## Workspace Graph
User → owns → Organization
Project → contains → Workspace / Mission / Artifact
Mission → produces → Artifact
Mission → changes → File
Mission → uses → Skill
Deployment → verifies → Build
Canvas → links → Tasks / Files / Images / Decisions

08
# Projects, Missions, Tasks, Artifacts, and Replay
Persistent work that survives the conversation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Canonical Hierarchy
Project
└── Mission
    ├── Conversation
    ├── Canvas
    ├── Tasks
    ├── Files
    ├── Assets
    ├── Previews
    ├── Decisions
    ├── Validations
    ├── Deployment
    └── History
## Mission Lifecycle
Inspect → Plan → Execute → Review → Save → Deploy → Verify
## Artifact Requirements
- Every serious action emits events and creates or updates an Artifact.
- Artifacts have stable IDs, versions, provenance, status, Project/Mission linkage, and permissions.
- Files, images, code, documents, audio, videos, previews, reports, diffs, and screenshots are all Artifact classes.
- No completion claim without the required Artifact and validation evidence.
## Replay Engine
- Record original request, control decision, planning summary, tools, models, edits, diffs, tests, approvals, commits, deployments, failures, retries, and results.
- Allow replay, fork, restore, inspect, compare, and export.
- Store concise reasoning summaries—not hidden chain-of-thought.

09
# Conversation-Driven Canvas
Chat directs; Canvas makes work visible and editable
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Product Rule

## Initial Block Types
- Heading
- Paragraph
- Checklist
- Task
- Code
- Note
- Decision
- Image
- File
- Preview
- Research
- Table
- Diagram
## Artifact Action Contract
type LiTTResponse = {
  message: string;
  actions: ArtifactAction[];
  decisionId?: string;
};

// canvas.create, canvas.append, canvas.update_block,
// canvas.delete_block, canvas.rename, task.create,
// project.promote, file.propose, asset.generate,
// research.attach, preview.refresh
## Action Policy

## Revision and Undo
- Every mutation creates a CanvasRevision.
- Support undo, redo, compare, restore, and fork.
- Never silently overwrite user-authored content.
- Keep stable block IDs through edits and refresh.
## Desktop and Mobile UX
- Desktop: adjustable Chat/Canvas split view with switcher, editor, tasks, files, preview, and history.
- Mobile: draggable Canvas bottom sheet with collapsed, half, and full states.
- Composer and microphone remain reachable in every state.
- Canvas updates must never activate the microphone or interrupt TTS.

10
# Voice, Live Chat, and Transcript Integrity
One canonical conversation; voice is only input and output
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Canonical Voice Rule

User speaks
→ transcript becomes a normal user message
→ canonical chat API streams one assistant response
→ response is persisted as a normal assistant message
→ that exact text is spoken through TTS
→ mic remains off unless hands-free is explicitly enabled
## Truthful Runtime State
- Transport: disconnected / connecting / connected / error
- Microphone: off / requesting / on / denied / error
- Transcription: idle / partial / finalizing / error
- Assistant: idle / thinking / streaming / error
- Playback: idle / buffering / speaking / error
- Preferences: language, selected voice, TTS enabled, hands-free enabled
## Language and Voice Consistency
- Default to en-US in locked mode.
- Do not auto-switch language because of one misheard phrase.
- Normal Speak and live voice use the same selected voice and speakAssistantMessage function.
- If TTS fails, keep text visible and never auto-restart the mic.
## Microphone Rules

## Persistent Recap
- Show partial transcript in place.
- Commit final transcript as a user message.
- Stream assistant text visibly while it is generated.
- Speak the same stored text word-for-word.
- Preserve Copy, Speak Again, Regenerate, and refresh history.

11
# Studio Workspace and Responsive Layout
A fixed workspace with internal scrolling—not a squeezed desktop page
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Height-Chain Contract
Studio root:  flex h-[100dvh] min-h-0 flex-col overflow-hidden
Workspace:    min-h-0 flex-1 overflow-hidden
Split pane:   grid h-full min-h-0 min-w-0 overflow-hidden
Each pane:    flex h-full min-h-0 min-w-0 flex-col overflow-hidden
Content:      min-h-0 flex-1 overflow-y-auto
Composer:     shrink-0
## Composer Requirements
- Always visible inside normal flex flow.
- Never clipped by the browser viewport or taskbar.
- No page-level Studio scrolling.
- Only content areas scroll.
- Remain usable at 80%, 100%, 125%, and 150% zoom.
- Respect mobile safe-area padding.
## Mobile Structure
Top bar → scrollable workspace → persistent composer → optional Canvas bottom sheet
## Production Layout Matrix


12
# Advanced Visual Build Pipeline
From generic markup to a verified AI creative studio
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Correct Flow
Request → VisualPlan → source routing → asset search/generation
→ asset inspection → Project storage → Asset Manifest
→ workspace code → real preview → desktop/tablet/mobile captures
→ structured visual review → controlled repair → completion gate
## Required Tools

## Strict Asset Rules
- Never let an LLM invent an image URL.
- Never render an image before validation.
- Copy accepted assets into controlled Project storage when terms permit.
- Persist attribution, provider metadata, dimensions, checksum, section assignment, and inspection result.
- Use a local gradient fallback instead of a broken-image icon.
- Reject localhost, private IPs, redirects into private networks, HTML masquerading as images, oversized downloads, and tiny thumbnails.
## Visual QA Contract
- Capture 1440×1000, 768×1024, and 390×844.
- Collect console errors, page errors, failed network requests, broken images, overflow, and viewport widths.
- Vision review returns structured findings with category, severity, viewport, evidence, selector, and repair instruction.
- First release: one automatic repair pass; never silently redesign everything.
## Completion Gate
complete only when:
preview ready
AND invalid assets = 0
AND broken images = 0
AND horizontal overflow = false
AND required sections present
AND mobile capture passed
AND visual review verdict = pass
AND repair diff applied successfully

13
# Appearance and Wallpaper System
Premium real assets controlled by CSS and persisted preferences
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

LiTT Afterglow

Circuit Genesis

Biolume Canopy
# Wallpaper Architecture
- Real PNG/WebP assets live under public/wallpapers/.
- A centralized registry defines ID, name, categories, tags, source, default overlay, blur, fit, accent, and availability.
- CSS controls cover/contain/fill, overlay darkness, blur, vignette, constellation, nebula, waves, minimal, and holo effects.
- Persist in the user settings database; use localStorage only as fallback.
- Do not mark a wallpaper active until it loads successfully.
## Performance and Accessibility
- Use optimized thumbnails rather than full-resolution images in every card.
- Render one fixed background layer with pointer-events none.
- Respect prefers-reduced-motion.
- Avoid excessive blur and cumulative layout shift.
- Validate custom uploads: JPG/PNG/WebP, ≤10 MB, ≥1280×720.
## Spark Generation
- Collect mood, colors, subject, intensity, and desktop/mobile variants.
- Use the existing image provider server-side.
- Save generated files as user assets and add them dynamically to the registry.
- Never expose provider keys or persist temporary blob URLs.

14
# Agent Swarm, Plugin SDK, and Continuous Intelligence
Dynamic roles and extensible abilities without prompt bloat
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Dynamic Specialist Roles
- Planner
- Researcher
- Engineer
- Designer
- Teacher
- Security reviewer
- Critic
- Historian
- Scientist
- Financial analyst
- Writer
- QA
- DevOps
- Executor

## Plugin SDK
- Register Agents, Missions, Tools, Workflows, Templates, Models, Dashboards, Automations, Artifact renderers, and Canvas block types.
- Declare ID, version, schemas, permissions, capabilities, risk, cost, handlers, UI contributions, and lifecycle.
- The Kernel loads only relevant plugin summaries.
## Continuous Intelligence
- Permission-controlled monitoring for repositories, SEO, uptime, AI releases, competitors, analytics, expenses, security, deployments, blockers, and deadlines.
- Every monitor shows scope, cadence, cost, evidence, pause/remove controls, and notification threshold.
- Surface only meaningful change. Never silently publish or modify Project files.

15
# Sandbox, Approval, Deployment, and Collaboration
No surprises: simulate before executing
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Sandbox Flow
Plan → Simulate → Diff → Test → Review → Approve → Execute → Verify
## Write Modes

## Deployment Truth
- A generated BUILD_ID is not enough; require the build command exit code 0.
- Use a stabilization branch and preview deployment before production main.
- Record the deployed SHA and verify that production serves it.
- Run browser acceptance in Firefox and Chromium.
## Collaboration-Ready Data
- Comments, mentions, approvals, live cursors, shared voice sessions, pair-building, shared Canvases, revision attribution, and role-based permissions.
- Do not implement the entire layer before the Canvas vertical slice works, but design revisions and events for multi-user attribution.

16
# QA, Observability, and Completion Truth
Evidence before celebration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Required Validation
npx tsc --noEmit
pnpm lint
pnpm test
pnpm build
## Build Verification
- Run without stale competing Next build processes.
- Do not pipe the final build through tail or Out-File if that hides the exit code.
- Record start, completion, exit code 0, route summary, warnings, and remaining processes.
## Observability Events
- Request routed
- Capability checked
- Plan created
- Tool selected
- Asset searched/generated/rejected/stored
- Workspace write proposed/applied
- Preview ready/failed
- Screenshots captured
- Review completed
- Repair applied
- Approval requested/received
- Build completed/partial/failed
- Deployment verified
## Truthful Status Labels

## Never Claim Complete When
- Images are broken or missing.
- Horizontal overflow exists.
- Composer is clipped.
- Voice text and spoken audio differ.
- The mic activates without explicit permission.
- Required migrations are not applied.
- A preview failed to load.
- Mobile QA failed.
- Tool evidence is absent.
- Production SHA is unknown.

17
# Implementation Roadmap
Build one verified vertical slice at a time
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## First Vertical Slice Acceptance Path
General conversation
→ explicit “Open in Canvas”
→ structured Canvas created
→ follow-up updates stable blocks
→ Tasks extracted
→ revision history and undo
→ refresh restores state
→ Canvas promotes to Project
→ voice continues during Canvas updates
→ file proposal respects approval mode

18
# Master Coding-Agent Directive
The implementation contract for agents working on LiTTree
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# Before Editing
- Report current system-prompt construction and request router.
- Identify Project-context injection, capability-state sources, Chat response format, Canvas implementation, Artifact models, Project/Mission/Task tables, voice flow, mobile layout, state stores, and duplicate sources of truth.
- List exact files, migrations, rollback plan, and the first acceptance path.
- Create a rescue checkpoint before touching a large dirty working tree.
- Do not amend or move immutable rescue tags.
## Implementation Rules
- Do not build a god prompt, god component, god context, or disconnected subsystem.
- Use typed services, Zod schemas, provider-neutral adapters, events, and deterministic gates.
- Keep general chat usable without Project setup.
- Use one canonical chat response for typed and voice interactions.
- Use real Project storage and isolated Workspace previews.
- Never invent external asset URLs or fake status logs.
- Preserve user content and maintain revision history.
- Run complete validation and real browser tests before production claims.
## After Editing Report
- Documentation created
- Kernel modules created
- Database changes and migration status
- Routing and capability integration
- Canvas and voice integration
- Permissions and approvals
- Tests added and results
- Build exit code
- Preview deployment and SHA
- Firefox and Chromium verification
- Incomplete, blocked, migration risks, next phase

99
# Appendices
Reference contracts, checklists, and production acceptance
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# A. Canonical Status Enums
Mission: draft | planning | ready | running | waiting_for_approval | blocked | completed | failed | cancelled
Capability: ready | offline | connecting | limited | requires_approval | degraded | unavailable | unknown
VisualBuild: queued | planning_visuals | searching_assets | generating_assets | validating_assets | saving_assets | building | rendering | capturing | reviewing | repairing | awaiting_approval | complete | partial | failed
Voice: transport + microphone + transcription + assistant + playback (separate states)
Maturity: designed | scaffolded | implemented | integrated | locally_tested | preview_deployed | production_verified | partial | blocked
# B. Production Acceptance Checklist
- ☐ General questions never trigger GitHub/Project setup.
- ☐ Status answers match verified capability state.
- ☐ Canvas creates, updates, versions, undoes, survives refresh, and promotes to Project.
- ☐ Voice transcript and spoken assistant text are identical and persistent.
- ☐ Mic remains off unless explicitly started or hands-free is enabled.
- ☐ Code/Builder composer is fully visible at 1280×720 and mobile safe areas.
- ☐ Visual build uses validated stored assets; no invented URLs.
- ☐ Desktop and mobile screenshots pass overflow and broken-image checks.
- ☐ Build command exits 0.
- ☐ Preview and production serve the recorded SHA.
- ☐ Firefox and Chromium journeys pass.
- ☐ No fake “nominal,” “connected,” “running,” or “complete” claims remain.
# C. Source-of-Truth Rule


| Version 11.0 — Canonical Source of Truth
A unified product, architecture, execution, safety, and release handbook for building LiTT as an AI operating system—not a repository-bound chatbot. |
|---|


| Truthful maturity labels
Exists → Implemented → Integrated → Tested → Deployed → Verified in production. Never collapse these into a single “done” status. |
|---|


| Positioning
Build something real with LiTT. Talk naturally, create structured work on Canvas, and ship through verified Projects and Missions—without losing control. |
|---|


| Principle | Meaning |
|---|---|
| Truth over confidence | Never claim a fact, connection, capability, action, test, or deployment unless evidence verifies it. |
| Intent over interface | Users describe goals; LiTT chooses the correct mode, tools, context, and workspace. |
| Projects over chats | Conversations are transient; Missions, Canvases, Artifacts, Files, and Projects preserve value. |


| Anti-pattern | Required correction |
|---|---|
| “Connect GitHub” for a general question | Answer normally; GitHub is an optional Project source. |
| One giant system prompt | Split principles, runtime policies, skills, and context into modular services. |
| Static “all systems nominal” text | Read verified capability state and format status deterministically. |
| Hidden live-voice response | Store the exact spoken response as the canonical assistant message. |
| Canvas as a separate page | Keep Canvas beside or under conversation inside Studio. |
| One boolean for voice | Track transport, mic, transcription, generation, playback, language, and hands-free independently. |
| Remote invented image URLs | Use provider adapters, validation, Project storage, and manifests. |
| Build success inferred from artifacts | Require an actual exit code 0 and verified browser behavior. |


| Mode | Purpose | Example |
|---|---|---|
| think | Reason, advise, compare, decide | Think through a business model. |
| research | Retrieve current, external, or verifiable information | Find current API pricing. |
| create | Produce writing, branding, images, music, concepts | Write a dark EDM hook. |
| build | Create or modify durable Project work | Fix app/layout.tsx. |
| review | Audit, critique, test, or compare | Review accessibility. |
| ship | Deploy, publish, send, or release | Deploy the preview. |
| status | Report verified platform capability | Is the terminal connected? |
| learn | Teach, quiz, explain, and track narrow learning gaps | Teach React state. |


| Request | Mode | Project required? | Primary context |
|---|---|---|---|
| Why do dogs wag their tails? | learn/general | No | Stable knowledge |
| GPT release notes | research | No | Official web sources |
| What is in my repository? | review | Yes | Project |
| What is my Chase balance? | status/research | No Project | Authorized financial connector |
| Fix src/app/layout.tsx | build | Yes | Project or attached file |
| Write a headline | create | No | Conversation |
| Is voice working? | status | No Project | Capability registry + browser state |


| Non-negotiable router rule
No Project context should enter LiTT’s prompt unless the current request actually requires it. |
|---|


| Class | Meaning |
|---|---|
| verified_fact | Verified by authoritative source, tool output, or observed state. |
| reported_fact | Provided by a source or user but not independently verified. |
| reasoned_inference | Logical conclusion supported by evidence. |
| estimate | Approximation with stated assumptions. |
| opinion | Subjective judgment or recommendation. |
| unknown | Insufficient evidence; do not invent. |


| Confidence | Internal meaning | Language behavior |
|---|---|---|
| 90–100 | Verified/strong | State clearly and cite evidence. |
| 70–89 | Supported | “The evidence indicates…” |
| 50–69 | Plausible | “The most likely explanation is…” |
| 25–49 | Weak | “One possibility is…, but evidence is limited.” |
| 0–24 | Insufficient | Search, ask, or state that it is unknown. |


| Level | Use |
|---|---|
| None | Trivial, low-risk responses. |
| Light | Clarity, completeness, unsupported claims, brevity. |
| Full | Deployment, security, finance, legal/medical, research, public publishing, expensive or destructive work. |


| State | Definition |
|---|---|
| ready | Verified and usable now. |
| offline | Known service is down. |
| connecting | Connection in progress. |
| limited | Available with restrictions. |
| requires_approval | Usable only after consent. |
| degraded | Partially functional. |
| unavailable | Not configured or unsupported. |
| unknown | Not verified. |


| Canvas principle
Chat is how the user directs LiTT. Canvas is where LiTT’s work becomes visible, structured, editable, and persistent. |
|---|


| Situation | Behavior |
|---|---|
| Explicit: “Open this in Canvas” | Create immediately. |
| Clear continuation: “Make the hero darker” | Update the active referenced block. |
| Useful but not explicit | Offer a compact action chip. |
| Ambiguous Canvas reference | Show choices; do not guess. |
| Project file write | Respect read-only / approval / autonomous mode. |


| Voice architecture
Voice = input/output layer. Chat = canonical conversation. Never run a separate hidden “live voice AI.” |
|---|


| May start mic | Must never start mic |
|---|---|
| Trusted mic click | Page load or component mount |
| Trusted live-voice click | Assistant message or text send |
| Explicit hands-free resume | TTS start or TTS completion |
|  | WebSocket connection or provider ready |
|  | Route change, store hydration, Canvas update |


| Viewport | Required checks |
|---|---|
| 1440×900 | Desktop split panes, composer, Canvas, banner. |
| 1280×720 | Low-height clipping and internal scrolling. |
| 1024×768 | Compact desktop/tablet behavior. |
| 390×844 | Mobile composer, safe area, Canvas sheet. |
| Zoom 80–150% | No clipping, overflow, or inaccessible controls. |


| Tool | Purpose |
|---|---|
| search_stock_assets | Licensed real photography and video. |
| generate_brand_asset | Original LiTT/Spark and branded art. |
| search_project_assets | Logos, screenshots, mascots, uploads. |
| inspect_asset | Status, content type, dimensions, quality, checksum, SSRF safety. |
| create_visual_plan | Art direction before code. |
| render_preview | Isolated Project runtime. |
| capture_preview | Desktop, tablet, mobile screenshots. |
| review_visual_quality | Structured vision findings. |
| repair_visual_issues | Targeted repair only. |


| Dynamic-agent rule
Instantiate roles only when they provide independent evidence, meaningful parallelism, domain review, adversarial critique, or isolated security analysis. |
|---|


| Mode | Behavior |
|---|---|
| read_only | Inspect and propose only. |
| approval | Generate diff and wait for explicit approval. |
| autonomous | Execute within scope and budget; still checkpoint and verify. |


| Label | Evidence required |
|---|---|
| designed | Architecture documented. |
| scaffolded | Types/files/components exist. |
| implemented | Code path exists. |
| integrated | Connected to canonical runtime. |
| locally tested | Automated or manual local evidence. |
| preview deployed | Remote preview serving tested SHA. |
| production verified | Real browser journey passed on production. |
| partial | Some acceptance gates failed. |
| blocked | Named dependency prevents progress. |


| Phase | Scope | Gate |
|---|---|---|
| 1 — Kernel foundation | Constitution, types, router, capability registry, event bus, prompt composer, Project gating | General chat works without Project warnings; status is truthful. |
| 2 — Canvas vertical slice | Canvas tables, blocks, revisions, actions, Chat/Voice integration, desktop/mobile UI, undo, Project promotion | Conversation creates and updates a real Canvas; refresh and undo pass. |
| 3 — Cognitive control | Truth, confidence, skills, models, arbitration, budgets, reflection, safety | Control decisions explain routing and tool choice. |
| 4 — Mission integration | Planner, Tasks, specialist roles, Sandbox, Artifact linkage, Replay, completion gates | One real Mission executes through approval and verification. |
| 5 — Intelligence expansion | Ranked memory, learner model, World Model, Workspace Graph, Plugin SDK, monitoring, collaboration | Permissioned background and graph features verified independently. |


| Final rule
The Constitution defines what never changes. The Kernel makes decisions. Modules implement capabilities. Canvas displays work. Projects preserve it. Missions coordinate it. Artifacts prove it. Replay explains it. |
|---|
