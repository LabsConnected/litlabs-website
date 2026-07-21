# LiTTree LabStudios — MASTER PLATFORM HANDBOOK

**OFFICIAL — VERSION 2.1**  
**July 20, 2026**

**Repository:** `LabsConnected/litlabs-website`  
**Canonical Workspace:** `/studio` (one unified Builder)  
**Base Branch:** `main` — all work **must** be done on a safe feature branch

This is the **canonical reference** for architecture, implementation, safety, and delivery for LiTTree LabStudios.

---

## Document Control

| Field                  | Value |
|------------------------|-------|
| Document owner         | LiTTree LabStudios |
| Primary product        | litlabs.net |
| Canonical workspace    | `/studio` — one unified Builder |
| Repository             | `LabsConnected/litlabs-website` |
| Base branch            | `main`; all work on safe feature branches only |
| Version                | 2.1 |
| Status                 | Official Master Platform Handbook |
| Review cadence         | After every shipped architecture phase, major route redesign, or execution-provider change |

### Change-Control & Anti-Free-Balling Rule

This handbook **stops "free-balling"**. No agent or developer may:
- Invent architecture
- Create duplicate pages or composers
- Claim connections without backend verification
- Redesign approved interfaces without an audit

**Every implementation must follow the locked protocol:**
Audit → Safe branch → One narrow phase → Validate (typecheck/lint/test/build + responsive) → Report → **STOP** for human authorization.

---

## Core Truths (Non-Negotiable)

| Truth | Statement |
|-------|-----------|
| **One Product Truth** | LiTTree is a unified AI operating system for creators. **Studio** is the single execution center. |
| **One Execution Truth** | A terminal UI is not a terminal. Real command execution requires an **authenticated isolated PTY** and a shared project sandbox. |
| **One State Truth** | Every status in the UI ("Connected", "Ready", "Running", etc.) **must** be derived from real backend state. |
| **One Safety Truth** | Read/test actions may be automatic. External, destructive, financial, production, and privileged actions **require explicit policy + user approval**. |
| **One Delivery Truth** | A phase is not complete until `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`, and responsive review have passed with zero exit codes on the actual repo scripts. |

---

## System Lockdown Protocol (How to Keep the Agent & Project in Sync)

To ensure the agent and project stay true to this handbook:

1. **Lead with the Master Contracts** — Always feed the agent the exact contracts from Appendix A (especially the Master Contract and the Execution Spine prompt).
2. **Enforce Phase-Zero Audit** — Before any code change, the agent must produce a written audit of current routes, components, persistence, providers, and the exact files it will touch.
3. **Micro-Manage Phases** — One phase at a time. Authorize → Implement → Validate → Report → **STOP**.
4. **Protect Core Architecture**:
   - No standalone Next.js replacements.
   - Exactly **one** persistent composer in Studio.
   - No client-side Owner Mode.
   - Real state only.
5. **Demand the Validation Gate** — Force the agent to run the repo's real commands and report exit codes + screenshots (390px + 1440px).

### Master Initialization Prompt (Copy-Paste at Start of Every Session)

```
You are operating inside the LabsConnected/litlabs-website repository, canonical workspace /studio.

You are bound by the LiTTree Master Platform Handbook v2.1.

CRITICAL DIRECTIVES:
- One Product: Studio is the single unified Builder. No duplicate Code/Terminal/Preview/Media pages.
- One Composer: Maintain exactly one persistent command composer.
- Real State Only: Never output "Connected", "Ready", "Running", etc. unless actively verified by the backend.
- No Standalones: Never overwrite the repository with a disconnected demo. Merge into the existing approved Builder shell.
- Branch Discipline: Work only on a safe feature branch. Never touch main.

OPERATIONAL PROTOCOL (you must follow this loop and STOP):
1. Audit — Read current files and report exact state + files you will change.
2. Branch — Confirm you are on a safe feature branch.
3. Code — Implement only the authorized narrow scope.
4. Validate — Run pnpm typecheck, pnpm lint, pnpm test, pnpm build and report exit codes.
5. Report & Stop — Output changed files, migrations, command results, risks, and wait for explicit human authorization before the next phase.
```

**For AI Agents & Coding Sessions (BINDING)**
- Always start the session by pasting the prompt above + the full Appendix A Master Contract.
- Never skip the Audit step.
- One phase, validate with the repo's actual scripts, report, STOP.
- Violations (duplicate composers, fake states, un-audited edits) are out-of-scope and must be rejected.

---

**BINDING STATUS**: This handbook (v2.1) + the embedded Master Contracts + the project rules in `.clinerules` / `.cursorrules` / `AGENTS.md` (where present) are the single source of truth. All agents and contributors are required to follow the lockdown protocol.

## How To Use This Handbook

- **Chapters 1–5**: Product direction and non-negotiables (read first).
- **Chapters 6–15**: Technical implementation details.
- **Chapters 16–20**: Operations, safety, observability, and roadmap.
- **Appendices A–D**: Copy-ready agent contracts, types, checklists, and glossary.

**Rule:** Do not attempt the entire roadmap in one change set. One phase. Validate. Stop.

---

## Contents

| Chapter | Title |
| --- | --- |
| 1 | Executive Product Direction |
| 2 | Non-Negotiable Product Principles |
| 3 | Platform and Route Architecture |
| 4 | Unified Studio Experience |
| 5 | Repository-Grounded Delivery Protocol |
| 6 | Production Execution Architecture |
| 7 | GitHub Project Connection |
| 8 | Sandbox and Real Terminal |
| 9 | LiTT Coding Tools and Mission Engine |
| 10 | Files, Editor, Preview, and Deployment |
| 11 | Voice, Camera, and Response Timing |
| 12 | Settings Control System |
| 13 | Appearance and Wallpaper Architecture |
| 14 | Integration and Provider Framework |
| 15 | Image Generation Reliability |
| 16 | LiTT Game Cloud and Retro Arcade |
| 17 | Security, Permissions, and Owner Control |
| 18 | Persistence, Data Model, and Realtime |
| 19 | Observability, Performance, and Cost Control |
| 20 | Delivery Roadmap and Definition of Done |
| A | Master Coding-Agent Contract (Binding) |
| B | Canonical Types and API Contracts |
| C | Phase Checklists and Acceptance Tests |
| D | Glossary and Decision Log |

---

## North-Star Experience

> *Connect one repository, open one verified isolated terminal, run `pwd`, edit one file, run checks, view the preview, review the diff, and create a pull request — without leaving Builder.*

| User Question | LiTTree Must Prove |
|---------------|--------------------|
| Can it access my project? | Show the connected repository, installation, branch, permissions, and project health. |
| Does it understand my stack? | Show detected framework, package manager, runtime versions, database, and deployment provider. |
| Can it actually run code? | Open a verified PTY and return real output, exit code, duration, and errors. |
| Can it fix problems? | Use inspect → plan → execute → test → diff → preview → approve. |
| Can I see the result? | Keep the live preview, console, changed files, and screenshot review inside Studio. |
| Will it damage my repository? | Use branch isolation, checkpoints, diff review, permissions, limits, and undo. |
| Can I return later? | Persist project, missions, messages, files, approvals, and resumable runtime state. |
| What is happening now? | Stream honest progress, logs, current process, timing, and failure state. |
| How much will it cost? | Show usage, plan limits, model/provider status, and compute consumption. |

---

# 1. Executive Product Direction

## 1.1 Product Vision

LiTTree LabStudios is a **unified AI operating system** for creators and developers. Value comes from one cohesive workspace where a user can connect a real project, talk to LiTT, generate media, edit code, run real terminal commands, preview, review, approve, deploy, and return later without losing state.

**North-Star Proof:** One repo → one verified PTY → real `pwd` → edit → checks → preview → diff review → PR, all inside the Builder.

## 1.2 Core Product Promises (User Questions → What LiTTree Must Prove)

| User Question | LiTTree Must Prove |
|---------------|--------------------|
| Can it access my project? | Show connected repo, installation, branch, permissions, health. |
| Does it understand my stack? | Show detected framework, package manager, runtimes, DB, deployment. |
| Can it actually run code? | Open verified PTY and return real output, exit code, duration, errors. |
| Can it fix problems? | inspect → plan → execute → test → diff → preview → approve. |
| Will it damage my repository? | Branch isolation, checkpoints, diff review, permissions, limits, undo. |
| What is happening now? | Stream honest progress, logs, timing, and failure state. |

---

# 2. Non-Negotiable Product Principles

## 2.1 Operating Principles

| Principle | Operational Requirement |
|-----------|--------------------------|
| Studio is the center | Do not create separate Code/Terminal/Preview/Media pages when an inline block, drawer, or panel will work. |
| One composer | Exactly one persistent command composer in Studio. |
| Real state only | No "Connected/Ready/Running" labels unless backend-verified. |
| Audit before edit | Inspect existing routes, components, persistence, and state before proposing changes. |
| One phase at a time | Narrow scope → validation gate → report → explicit stop. |
| Safe by default | Read/test automatic. Gate production/destructive/financial/privileged actions. |
| Durable state | localStorage is a cache/draft only. |
| Graceful failure | Normalize provider errors. Show actionable states. Never pretend 402 is a 500. |
| Mobile is first-class | All primary workflows must work at 390px with 44px targets. |

## 2.2 Forbidden Patterns

- Duplicating pages or composers because "the agent didn't audit".
- Client-side Owner Mode.
- Exposing secrets or long-lived tokens to the browser.
- Running project commands on the Vercel host filesystem.
- Calling a browser-only xterm "a real terminal".
- Bundling copyrighted commercial game art.
- Changing main directly.

---

# Keeping the Agent & Project True to Word (System Lockdown)

**This is the operational contract for all AI agents and human contributors.**

## How to Keep the System Locked In (5 Steps)

1. **Lead with the Master Contracts**  
   Start every session by pasting the "Master Initialization Prompt" (above) + the full Appendix A Master Contract.

2. **Enforce Phase-Zero Audit**  
   The agent must first produce a written audit of current routes, components, persistence, providers, and the exact files it intends to change.  
   **Rule:** No accurate audit → no edits allowed.

3. **Micro-Manage the Delivery Loop**  
   One narrow phase at a time:

   | Step | Your Instruction | Agent Must Deliver |
   |------|------------------|--------------------|
   | 1 | "Initiate Phase Zero Audit for [X]" | Current state report + exact files + branch plan |
   | 2 | "Audit approved. Create feature branch." | Branch confirmation + scoped implementation only |
   | 3 | "Run global validation." | Exit codes for pnpm typecheck / lint / test / build + screenshots |
   | 4 | Manual review | Agent waits in STOP state |
   | 5 | "Validation passed. Create PR." | PR link + full report, then STOP |

4. **Protect the Core Architecture**  
   - Studio is the **single** unified workspace. No duplicate Code/Terminal/Preview/Media pages or composers.  
   - Exactly **one** persistent composer.  
   - No client-side Owner Mode.  
   - No standalone Next.js replacements over the repo.  
   - **Real state only** — never hardcode "Connected", "Ready", etc.

5. **Demand the Validation Gate**  
   Agent must execute the repo's actual scripts and show zero exit codes:
   ```bash
   pnpm typecheck
   pnpm lint
   pnpm test
   pnpm build
   ```
   UI changes: prove 390px and 1440px behavior.

**Pre-Merge Verification Checklist**
- [ ] Real PTY: `pwd` returns actual working directory (not simulated xterm)
- [ ] Only one composer in Studio
- [ ] No secrets/tokens in browser
- [ ] Provider errors are truthful (402 stays 402)
- [ ] All status labels come from backend verification

---

# 1. Executive Product Direction

## 1.1 Product Vision

LiTTree LabStudios is a unified AI operating system for creators and developers. Its value is not another collection of isolated AI pages. Its value is a single workspace where a person can connect a real project, communicate with LiTT, generate media, inspect and edit code, run terminal commands, preview results, approve changes, deploy, publish, and return later without losing state.

## 1.2 Core Product Promise

One real, verified, persistent creative surface — not a collection of disconnected tools.

## 1.3 Intended Product Shape

| Surface | Purpose |
| --- | --- |
| **Dashboard** | Launch center, project health, missions, usage, and quick actions — not a second Builder. |
| **Studio** | The single operating workspace for chat, code, terminal, files, preview, media, agents, and approvals. |
| **Agents** | Agent configuration, permissions, reusable roles, and operational visibility. |
| **Gallery** | Generated and imported artifacts with source, status, rights, and project context. |
| **Games** | Game Cloud, browser games, Retro Arcade, and build-your-own workflows. |
| **Social** | Content planning, publishing connections, schedules, and performance. |
| **Marketplace** | Assets, agents, workflows, and creator economics. |
| **Settings** | Progressive controls from Standard through Owner without duplicating pages. |

## 1.4 Strategic Differentiation

LiTTree should compete on **orchestration and continuity** rather than raw model novelty. Models can change. The durable advantage is the **workspace graph**: authenticated projects, persistent missions, permissioned tools, shared sandboxes, structured artifacts, reproducible changes, integrated approval, and a branded companion that tells the truth about system state.

---

# 2. Non-Negotiable Product Principles

## 2.1 Forbidden Implementation Patterns

- Duplicating existing pages because the agent did not inspect the route map.
- Using client state or query parameters to enable Owner Mode.
- Exposing provider secrets, GitHub tokens, private keys, or raw environment variables to browser JavaScript.
- Running project commands on the Vercel host filesystem.
- Sending the model unrestricted shell access without typed schemas, policy checks, limits, and logging.
- Retrying non-retryable budget or authentication errors in loops.
- Calling a browser-only xterm instance a "real terminal."
- Resetting settings when the user changes visibility modes.
- Bundling commercial game cover art without permission.
- Changing `main` directly or deploying production without approval.

## 2.2 Operating Principles

| Principle | Operational Requirement |
| --- | --- |
| Studio is the center | Do not create separate Code, Terminal, Preview, Image, Video, Agent, or Pipeline experiences when an inline Builder block, drawer, panel, or modal will work. |
| One composer | Studio must have exactly one persistent command composer. Tools may change the mode or attach context, but they must not create competing chat bars. |
| Real state only | No card may show Connected, Running, Passed, Deployed, Synced, Installed, or Ready unless the backend verified that state. |
| Audit before edit | The agent must inspect existing routes, components, persistence, providers, and state before proposing file changes. |
| Preserve approved UI | Architecture work must connect existing Builder blocks to real services before redesigning the shell. |
| One phase at a time | Each phase has a narrow scope, validation gate, report, and explicit stop. |
| Safe by default | Read and test automatically; gate production, destructive, financial, secret, or external actions. |
| Shared environment | LiTT and the user operate in the same authorized project workspace and sandbox. |
| Durable state | localStorage is a cache or draft mechanism, never the authoritative multi-device project store. |
| Graceful failure | Provider errors must be normalized, actionable, correctly coded, and visible without pretending they are internal platform failures. |
| Mobile is first-class | All primary workflows must work at 390px width with 44px targets, no hidden critical controls, and no page-wide overflow. |
| No copyrighted shortcuts | Retro artwork and bundled media must use original, licensed, public-domain, or user-provided assets. |

## 2.3 Truthful Language Rules for LiTT

| State | Allowed Language |
| --- | --- |
| Terminal drawer open; no PTY | "The terminal panel is open, but the real PTY is disconnected." |
| WebSocket connected; PTY not verified | "Transport connected; shell verification pending." |
| PTY verified with prompt | "Terminal connected to the project sandbox." |
| Repository visible but unauthorized | "Repository discovered; installation permission is required." |
| Provider key configured but zero budget | "Provider configured; generation budget exhausted." |
| Mission queued | "Queued." Never say "running." |
| Build command requested but not executed | "I can prepare the command." Never claim a build result. |

---

# 3. Platform and Route Architecture

> *One product map, one workspace center.*

## 3.1 Canonical Route Responsibilities

| Route | Responsibility | Must Not Become |
| --- | --- | --- |
| `/` | Brand and product landing | A duplicate dashboard |
| `/dashboard` | Launch center, project/missions summary | A second Studio |
| `/studio` | Unified creation and execution workspace | A collection of separate tool pages |
| `/studio/builder` | Hybrid Builder shell (code, media, command center) | A separate tool page |
| `/agents` | Agent library, configuration, permissions | A separate chat workspace |
| `/gallery` | Artifact library and provenance | An image-only dead end |
| `/games` | Game Cloud landing and discovery | A plain card dashboard |
| `/games/retro` | Artwork-first local Retro Arcade | A cramped three-column admin screen |
| `/games/cloud` | Game Cloud browser catalogue | A duplicate `/games` page |
| `/games/dos` | DOS / classic browser games | An empty emulator stub |
| `/social` | Publishing and content operations | A disconnected feed |
| `/marketplace` | Agents, assets, workflows, economics | A static catalog |
| `/settings` | Progressive controls | Four separate settings applications |
| `/admin` | Privileged platform operations (canonical) | A client-gated hidden page |
| `/profile` | User profile, public presence, connected accounts | A disconnected settings page |
| `/profile/[username]` | Public profile view | A duplicate `/profile` |
| `/wallet` | LiTBits, credits, billing history | A nested settings screen |
| `/memories` | User memories and agent recall | An orphan conversation list |
| `/library/files` | Saved files and asset library | A dead download-only page |
| `/library/saved` | Saved content and bookmarks | A separate social feed |
| `/order/success` | Post-purchase confirmation | A generic thank-you page |
| `/projects` | Project directory and status | A duplicate Studio dashboard |
| `/deployments` | Deployment history and status | A static release log |
| `/docs` | Product documentation and guides | A blank placeholder |
| `/showcase` | Public project showcase | An unmaintained gallery |
| `/resources/facebook-growth` | Growth resource hub | A marketing PDF dump |
| `/terms` | Terms of service | An unreachable legal page |
| `/privacy` | Privacy policy | An unreachable legal page |
| `/cookies` | Cookie policy | An unreachable legal page |
| `/facebook` | Facebook growth tools | A disconnected social page |
| `/sign-in/[[...sign-in]]` | Clerk sign-in route | A custom auth implementation |
| `/sign-up/[[...sign-up]]` | Clerk sign-up route | A custom auth implementation |
| `(auth)` group | Non-URL route group for shared auth layouts | A public-facing route |

> **Note:** Legacy alias directories (`/creator`, `/landing`, `/login`, `/ai-builder`, `/code`, `/flow`, `/generate`, `/litt`, `/litt-terminal`, `/chat`, `/builder`) still exist on disk and redirect to their canonical destinations. They are preserved for deep-link compatibility and should not be developed as independent pages.

## 3.2 Studio Tool Aliases

Legacy or convenience routes should resolve into Studio state rather than maintain duplicate implementations. Preserve useful deep links, but normalize them into a canonical tool model.

```ts
export type StudioTool =
  | "home"
  | "chat"
  | "image"
  | "video"
  | "audio"
  | "build"
  | "code"
  | "agents"
  | "assets"
  | "plugins"
  | "loops";

const TOOL_ALIASES: Record<string, StudioTool> = {
  builder: "build",
  canvas: "code",
  gallery: "assets",
  terminal: "loops",
  pipeline: "loops",
  clibridge: "code",
  space: "home",
};
```

## 3.3 Navigation Requirements

- Navigation labels may be customized without changing stable route identifiers.
- Protected destinations — Settings, account/security, authorized System Control, and logout — must remain reachable.
- Mobile navigation should expose the user's highest-frequency destinations and move the rest into one coherent drawer.
- Opening a Studio tool must not destroy the current mission, files, terminal process, or preview.
- Every page may expose "Customize this page" as a side panel, not a route transition.

---

# 4. Unified Studio Experience

> *The approved workspace shell and interaction model.*

## 4.1 Desktop Composition

| Region | Function |
| --- | --- |
| Top bar | Project, branch, environment, connection health, usage, exit to Dashboard. |
| LiTT presence | Current state: idle, listening, transcribing, thinking, executing, speaking, cooldown, error. |
| Left tool rail | Small number of stable tool modes; not a page navigator. |
| Main canvas | Ordered Builder blocks: conversation, code, terminal results, diff, preview, plans, media, approvals. |
| Context panel | Files, artifacts, run settings, model route, process state, or inspector. |
| Terminal drawer | Verified PTY view attached to the same sandbox; collapse without stopping processes. |
| Command dock | One composer with attachments, camera, plugins, mic, send, and agent state. |

## 4.2 Builder Block Model

Blocks are **ordered durable events**, not disposable UI fragments. Each block should include its mission, project, actor, status, timestamps, and source-of-truth reference. The visual representation may collapse or summarize, but the underlying event must remain inspectable.

```ts
export type BuilderBlock =
  | MessageBlock
  | PlanBlock
  | ProgressBlock
  | TerminalBlock
  | CodeBlock
  | DiffBlock
  | PreviewBlock
  | ImageBlock
  | VideoBlock
  | AudioBlock
  | AgentBlock
  | ApprovalBlock
  | ErrorBlock;
```

## 4.3 First-Run Builder Experience

1. Connect GitHub or create a blank project.
2. Select a repository and branch.
3. LiTT scans package files, framework, runtimes, database, deployment metadata, and scripts.
4. A sandbox is created or resumed.
5. Terminal, files, and preview report verified readiness independently.
6. The user receives three focused starting actions: **Fix an issue**, **Build a feature**, or **Run the project**.

## 4.4 Connection Health Strip

| Connection | States | Verification |
| --- | --- | --- |
| GitHub | Disconnected / Connecting / Ready / Permission issue | Installation and repository token test |
| Sandbox | Starting / Running / Paused / Failed | Provider state and ownership |
| Terminal | Disconnected / Connecting / Connected / Error | PTY prompt handshake |
| Preview | Stopped / Starting / Ready / Crashed | HTTP health check and process state |
| Database | Unknown / Ready / Migration pending / Error | Server-side health query |
| Deployment | Unlinked / Linked / Building / Ready / Failed | Provider API status |
| AI providers | Available / Limited / Rate-limited / Budget exhausted / Down | Server-side provider health |

## 4.5 Mobile Behavior

- Composer stays reachable above the mobile navigation and safe-area inset.
- Tool selection opens a compact sheet instead of a permanent sidebar.
- Files, preview, and terminal use resizable full-height sheets with persistent process state.
- The mic supports automatic stop detection; the user should not have to manually end ordinary speech input.
- Camera / Holo mode must remain inside Studio and preserve the current project context.
- No critical action may depend solely on hover.

---

# 5. Repository-Grounded Delivery Protocol

> *How agents are allowed to change LiTTree.*

## 5.1 Required Sequence

1. **Audit** the current repository and report the real starting state.
2. **Identify** the narrow phase and exact files that require changes.
3. **Branch** safely from the current `main` branch.
4. **Implement** only the approved phase; do not redesign unrelated surfaces.
5. **Validate** with targeted tests, type checking, linting, and a production build.
6. **Capture** responsive screenshots or structured verification at 390px and 1440px when UI changes.
7. **Report** files changed, database migrations, environment variables, validation results, and remaining risks.
8. **Stop** before the next phase unless the instruction explicitly authorizes continuation.

## 5.2 Mandatory Audit Report

| Area | Questions |
| --- | --- |
| Routes | Which pages, aliases, layouts, and redirects already exist? |
| Components | Which approved components can be connected instead of rebuilt? |
| Persistence | What is in localStorage, IndexedDB, Supabase, or provider state? |
| Auth | How are user, role, project, and installation permissions verified? |
| Terminal | Does a real PTY exist, or only xterm UI? |
| GitHub | Which app routes, installations, permissions, and repository records exist? |
| Providers | Which integrations are real, partial, mocked, or stale? |
| Validation | What scripts exist: `typecheck`, `lint`, `test`, `build`? |
| Risks | What will break if data models or routes change? |

## 5.3 Branch and Commit Discipline

```
main
  └─ feature/<focused-scope>
       ├─ audit: document starting state
       ├─ feat:  implement one capability
       ├─ fix:   repair discovered state bug
       ├─ test:  add targeted validation
       └─ docs:  update handbook or runbook
```

> 🚫 **DO NOT TOUCH MAIN DIRECTLY.** Every risky or visible change must be implemented on a branch, reviewed through a diff, validated, and merged through a pull request. Production deployment remains an explicit approval action.

---

# 6. Production Execution Architecture

> *Control plane, execution plane, background plane, and persistence.*

## 6.1 Reference Architecture

```
┌─────────────────────────────────────────────────────────────┐
│  LiTTree Builder — browser                                  │
│  ├── Builder conversation and blocks                        │
│  ├── xterm.js terminal renderer                             │
│  ├── File explorer and Monaco editor                        │
│  ├── Preview and console                                    │
│  ├── Changes, diff, and approvals                           │
│  └── Voice, camera, and media tools                         │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  LiTTree control API — Next.js                              │
│  ├── Authentication and project authorization               │
│  ├── Tool schema validation                                 │
│  ├── Permission and risk policy                             │
│  ├── Mission creation and usage enforcement                 │
│  ├── Provider adapters                                      │
│  └── Realtime session authorization                         │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Background runner                                          │
│  ├── Durable missions                                       │
│  ├── Queueing, retries, cancellation                        │
│  ├── Time and step limits                                   │
│  └── Realtime progress events                               │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Isolated project sandbox                                   │
│  ├── Repository checkout and branch                         │
│  ├── Real PTY shell                                         │
│  ├── Filesystem and processes                               │
│  ├── Node / Python tooling                                  │
│  ├── Dev server and tests                                   │
│  └── Browser automation                                     │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│  Supabase / durable storage                                 │
│  ├── Projects and memberships                               │
│  ├── Missions and ordered Builder blocks                    │
│  ├── Sandboxes, terminals, and processes                    │
│  ├── Artifacts, approvals, and usage                        │
│  └── Audit logs and settings                                │
└─────────────────────────────────────────────────────────────┘
```

## 6.2 Component Recommendations

| Responsibility | Recommended starting choice | Reason |
| --- | --- | --- |
| Terminal renderer | `@xterm/xterm` + `@xterm/addon-fit` (installed) | Mature browser terminal rendering and sizing |
| Real shell | `node-pty` in Docker (current production implementation) | Real process, input, resize, reconnection, isolation. E2B is aspirational and not currently installed. |
| Transport | Authenticated WebSocket gateway (Socket.IO, installed) | Bidirectional low-latency terminal communication |
| Durable missions | Trigger.dev or equivalent *(aspirational; not in `package.json` yet)* | Queues, retries, cancellation, duration limits, realtime |
| Repository auth | GitHub App (`@octokit/auth-app`, installed) | Selected-repository permissions and short-lived installation tokens |
| Database | Supabase Postgres (installed) | Auth-adjacent relational persistence and RLS |
| Realtime | Private authorized channels | Mission/block updates without public leakage |
| Editor | Monaco (`@monaco-editor/react`, installed) | Developer-grade editing and diagnostics |
| Browser testing | Playwright in sandbox *(aspirational; not in `package.json` yet)* | Screenshot, console, mobile, network, and accessibility review |
| Artifacts | Supabase Storage or R2 (`@aws-sdk/client-s3`, installed) | Durable generated assets and build outputs |
| Deployment | Existing Vercel integration | Preview and production deployment status |
| Error tracking | Sentry or equivalent *(aspirational; not in `package.json` yet)* | Trace frontend, API, mission, and provider failures |

## 6.3 Control-Plane Responsibilities

- Never execute arbitrary project commands inside serverless application hosts.
- Authorize every request against the authenticated user, project membership, and resource ownership.
- Validate typed tool inputs and normalize provider responses.
- Create missions and return identifiers quickly rather than holding one long request open.
- Enforce plan, provider, command, output, file, runtime, and spending limits on the server.
- Redact secrets before logs or model-visible results are stored.

## 6.4 Execution-Plane Responsibilities

- Own the project checkout, active branch, filesystem, terminal processes, development server, and test environment.
- Provide a resumable identifier and a verified state transition model.
- Expose only scoped operations through the control plane.
- Stop or pause idle resources according to plan limits while preserving safe resumability.
- Keep user terminal activity and LiTT tool activity in the same project workspace while retaining separate actor attribution.

---

# 7. GitHub Project Connection

> *Real repository access without persistent tokens.*

## 7.1 Connection Goals

- Install the LiTTree GitHub App for a user or organization.
- List only repositories granted to the installation.
- Allow the user to select a repository and branch.
- Store stable repository and installation identifiers.
- Generate short-lived installation tokens **server-side only**.
- Show explicit reconnect, change repository, and permission-repair actions.

## 7.2 Canonical Project Model

```ts
export type ProjectStatus =
  | "disconnected"
  | "connecting"
  | "scanning"
  | "ready"
  | "permission_error"
  | "error";

export type Project = {
  id: string;
  ownerId: string;
  name: string;
  githubInstallationId?: string;
  repositoryId?: string;
  repositoryOwner?: string;
  repositoryName?: string;
  defaultBranch: string;
  activeBranch: string;
  workspacePath?: string;
  detectedFramework?: string;
  packageManager?: "pnpm" | "npm" | "yarn" | "bun";
  status: ProjectStatus;
};
```

## 7.3 Token Handling

- Never expose the GitHub App private key to the browser.
- Never return installation tokens in API JSON.
- Never write tokens into terminal history, logs, database rows, or Builder blocks.
- Use secret redaction on command output and thrown errors.
- If installation access changes, transition the project to `permission_error` rather than silently using stale state.

> 🔐 **TOKEN RULE** — Never persist a GitHub installation token. Generate it on the server when needed, restrict it to the authorized installation/repository/permissions, use it for the immediate operation, and discard it.

## 7.4 Repository Scan

| Detection | Evidence |
| --- | --- |
| Framework | `next.config.*`, package dependencies, route structure |
| Package manager | Lockfile priority: `pnpm-lock.yaml`, `yarn.lock`, `package-lock.json`, `bun.lockb` |
| Node version | `.nvmrc`, `.node-version`, `engines`, `packageManager` |
| Python version | `.python-version`, `pyproject.toml`, runtime files |
| Database | Supabase config, Prisma, Drizzle, migration directories, environment schema |
| Deployment | `vercel.json`, project link metadata, workflows |
| Scripts | `package.json` scripts and task runner configuration |
| Monorepo | workspace files, turbo/nx configuration, package graph |

## 7.5 Connection Acceptance Test

1. User signs in and initiates GitHub connection.
2. LiTTree receives an installation identifier and verifies the owner.
3. Allowed repositories are listed without leaking ungranted repositories.
4. User selects `LabsConnected/litlabs-website` and a branch.
5. Project record is created and scanning status is streamed.
6. The UI shows repository, branch, permissions, and detected stack from real results.
7. Revoking the installation causes a clear permission state and recovery action.

---

# 8. Sandbox and Real Terminal

> *The difference between a terminal-looking panel and real execution.*

## 8.1 Sandbox Lifecycle

```ts
export type SandboxState =
  | "starting"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "failed"
  | "stopped";

export type SandboxSession = {
  id: string;
  projectId: string;
  ownerId: string;
  provider: "node-pty" | "e2b" | "other";
  providerSandboxId: string;
  terminalPid?: number;
  state: SandboxState;
  createdAt: string;
  lastActiveAt: string;
};
```

## 8.2 Normal Open Flow

```
Open project
  → authorize membership
  → find active sandbox
  → reconnect or resume when safe
  → otherwise create sandbox
  → obtain short-lived repository token
  → clone repository
  → checkout isolated workspace branch
  → detect environment
  → install only when policy allows
  → open PTY
  → verify prompt and working directory
  → report terminal connected
```

## 8.3 Idle Flow

```
No activity
  → warn or mark idle
  → stop unnecessary expensive processes
  → persist process metadata
  → pause sandbox
  → preserve filesystem and resumable state
  → resume on next authorized visit
```

## 8.4 Terminal Transport Contract

```ts
type ClientTerminalEvent =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "interrupt" }
  | { type: "reconnect"; sessionId: string };

type ServerTerminalEvent =
  | { type: "output"; data: string }
  | { type: "connected"; sessionId: string; cwd: string }
  | { type: "status"; status: TerminalStatus }
  | { type: "exit"; exitCode: number | null }
  | { type: "error"; code: string; message: string };
```

```ts
export type TerminalStatus =
  | "disconnected"
  | "connecting"
  | "transport_connected"
  | "verifying_pty"
  | "connected"
  | "error";
```

## 8.5 Verified Terminal State

Only the **final connected state** permits LiTT to say it can execute commands. Verification should include authenticated ownership, a live PTY, a prompt or command handshake, and the expected project working directory.

## 8.6 Required Terminal Features

| Feature | Requirement |
| --- | --- |
| Input/output | Bidirectional real-time data with ANSI support |
| Resize | Fit addon plus server-side PTY resize |
| Interrupt | `Ctrl+C` or explicit interrupt event |
| Clipboard | Copy/paste with browser permission behavior |
| Reconnect | Resume the same authorized terminal session where possible |
| History | User-visible command history without secret exposure |
| Process survival | Collapsing the drawer does not stop running processes |
| Exit state | Exit code and process completion visible in chat and terminal |
| Mobile keys | Ctrl, Alt, Tab, Esc, arrows, and interrupt controls |
| Authorization | Ownership checked on every initial and reconnect handshake |

## 8.7 Inline Command Result

The inline Builder block is a compact, readable result. The full terminal transcript remains available in the terminal drawer and audit trail, subject to output limits and secret redaction.

```
LiTT is running:
$ pnpm typecheck

✓ Completed in 8.4s
Exit code: 0
Output: 42 lines
[Open full terminal output]
```

---

# 9. LiTT Coding Tools and Mission Engine

> *Typed operations, bounded autonomy, and visible progress.*

## 9.1 Tool Registry

| Category | Tools |
| --- | --- |
| Inspect | `list_files`, `read_file`, `search_files`, `inspect_project`, `inspect_package_json`, `inspect_git_status`, `inspect_logs` |
| Modify | `create_file`, `patch_file`, `rename_file`, `format_file`, `restore_file` |
| Execute | `run_command`, `start_process`, `stop_process`, `run_typecheck`, `run_lint`, `run_tests`, `start_dev_server` |
| Git | `create_branch`, `git_status`, `git_diff`, `commit_changes`, `push_branch`, `create_pull_request`, `revert_changes` |
| Browser | `open_preview`, `take_screenshot`, `inspect_console`, `inspect_network`, `test_mobile`, `run_accessibility_scan` |

## 9.2 Tool Definition Contract

```ts
type ToolDefinition<I, O> = {
  name: string;
  description: string;
  inputSchema: ZodSchema<I>;
  risk: "read" | "safe_write" | "external" | "destructive" | "production";
  requiresApproval: (input: I, context: ToolContext) => boolean;
  timeoutMs: number;
  execute: (input: I, context: ToolContext) => Promise<O>;
};
```

## 9.3 Permission Defaults

| Action | Default Policy |
| --- | --- |
| Read / search files | Automatic in authorized project |
| Run typecheck / lint / tests | Automatic within configured limits |
| Modify branch files | Automatic with checkpoint and undo |
| Install dependency | Confirm or policy-based allowlist |
| Commit changes | Confirm |
| Push branch | Confirm |
| Create pull request | Confirm |
| Deploy preview | Confirm |
| Deploy production | Always confirm |
| Database migration | Always confirm |
| Delete files / data | Always confirm |
| Read secrets | Never expose to model |

## 9.4 Mission Lifecycle

```ts
export type MissionStatus =
  | "queued"
  | "inspecting"
  | "planning"
  | "running"
  | "testing"
  | "waiting_for_approval"
  | "completed"
  | "failed"
  | "cancelled";
```

## 9.5 Mission Loop

```
User request
  → authorize project and tools
  → inspect repository and runtime
  → create visible plan
  → create/check isolated branch and checkpoint
  → execute typed tools
  → stream progress and timing
  → run relevant checks
  → produce changed-files summary and diff
  → start or refresh preview
  → request approval for external/production action
  → commit/push/PR only after approval
```

## 9.6 Hard Limits

```ts
const missionLimits = {
  maximumSteps: 40,
  maximumRuntimeMinutes: 30,
  maximumCommandSeconds: 300,
  maximumFilesChanged: 50,
  maximumOutputBytes: 2_000_000,
  maximumConcurrentProcesses: 4,
};
```

Limits are plan- and policy-aware. They prevent endless repair loops, runaway output, accidental broad rewrites, and uncontrolled cost. Hitting a limit should produce an **actionable pause**, not an opaque failure.

## 9.7 Agent Roles

| Agent | Primary Authority | Cannot Bypass |
| --- | --- | --- |
| **LiTTle-Bit** — Director | Plan, decompose, select agents, summarize decisions | Project permissions, approvals, limits |
| **LiTT-Code** — Engineer & Architect | Inspect, patch, test, debug, architecture | Secret policy, production approval |
| **UI Designer** | Layout, design system, responsive review | Approved shell constraints |
| **QA Agent** | Tests, screenshots, console, accessibility | Code ownership and environment isolation |
| **Ship Captain** | Commit, PR, deployment coordination | User approval and branch policy |

---

# 10. Files, Editor, Preview, and Deployment

> *One shared project environment.*

## 10.1 File Explorer

- Repository tree with lazy expansion, search, changed-file badges, ignored-file handling, and status filters.
- Open files in Monaco tabs without leaving Builder.
- Show binary, generated, large, or secret-sensitive files with explicit restrictions.
- Keep unsaved edits visible and reconcile external changes from LiTT tools.
- Provide restore from checkpoint for modified files.

## 10.2 Monaco Editor

| Capability | Initial release | Later |
| --- | --- | --- |
| Read / edit / save | Required | — |
| Tabs and dirty state | Required | — |
| Syntax highlighting | Required | — |
| Diagnostics | Basic TypeScript/JSON/CSS | Workspace language servers |
| Format | Configured formatter | Per-project advanced rules |
| Go to definition | Optional | Full language-service integration |
| AI inline edits | Diff-based | Multi-file transformations |

## 10.3 Process Manager

```ts
type WorkspaceProcess = {
  id: string;
  projectId: string;
  sandboxId: string;
  kind: "terminal" | "dev_server" | "test" | "worker" | "other";
  command: string;
  cwd: string;
  status: "starting" | "running" | "exited" | "failed" | "stopped";
  pid?: number;
  port?: number;
  startedAt: string;
  endedAt?: string;
  exitCode?: number | null;
};
```

## 10.4 Preview

- Attach the preview URL to the sandbox and process that owns the development server.
- Expose desktop/mobile sizing, reload, open externally, screenshot, console, and restart controls.
- **Never** show `Ready` until an HTTP health check succeeds.
- Stream console errors into inspectable Builder blocks without overwhelming the conversation.
- Keep preview state stable while the user switches tools or collapses panels.

## 10.5 Change Review

| Stage | Visible Evidence |
| --- | --- |
| Before edit | Branch, checkpoint, planned files |
| During edit | Current tool, file, progress, command timing |
| After edit | Changed files, additions/deletions, summary |
| Validation | Typecheck/lint/test/build results |
| Preview | URL, screenshot, console status |
| Approval | Action, target, risk, exact consequence |
| Delivery | Commit, push, PR, deployment link/status |

## 10.6 Deployment Policy

- Preview deployment may be offered after checks pass and must still identify the target project.
- Production deployment always requires **explicit approval** and a clear confirmation of branch, commit, environment, and migration state.
- Failed provider or deployment statuses must be preserved accurately; do not collapse all failures into "Internal Server Error."
- Rollback or previous deployment options should be visible in Owner or authorized operational controls.

---

# 11. Voice, Camera, and Response Timing

> *Fast, measurable, interruption-friendly interaction.*

## 11.1 Canonical Voice States

```ts
export type VoiceState =
  | "idle"
  | "listening"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "cooldown"
  | "error";
```

## 11.2 Required Timing Marks

| Mark | Meaning |
| --- | --- |
| `speech_end` | Automatic end-of-utterance detection |
| `transcription_complete` | Final transcript available |
| `AI_first_token` | First streamed model output |
| `AI_complete` | Model response complete |
| `TTS_request` | First text segment submitted |
| `TTS_first_audio` | First playable audio received |
| `playback_started` | Audio actually begins |

## 11.3 Voice Performance Card

```
Transcription:   620 ms
AI first token:  480 ms
AI complete:     1.40 s
TTS first audio: 840 ms
Playback start:  2.86 s total
```

## 11.4 Response-Speed Rules

- Stream the AI response rather than waiting for complete text.
- Start TTS after the first complete sentence or safe semantic chunk.
- Keep spoken answers concise while full detail remains visible in the Builder block.
- Strip markdown, code, URLs, bullets, slash commands, and formatting artifacts before speech synthesis.
- Cancel previous speech immediately when the user speaks or presses stop.
- Do not disable the entire mic during long playback; support interruption and new input.
- Use automatic speech-end detection for ordinary conversations.

## 11.5 Speech Sanitizer

```ts
export function sanitizeForSpeech(input: string): string {
  return input
    .replace(/```[\s\S]*?```/g, " Code is shown on screen. ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/^\s*[-*•]+\s+/gm, "")
    .replace(/^\s*\/\w+.*$/gm, "")
    .replace(/[\*_#>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
```

## 11.6 Camera and Holo Mode

- Camera permission is explicit, revocable, and never assumed.
- Camera / Holo mode remains an inline Studio capability attached to the same conversation and project.
- Visual analysis events must state whether they came from a live frame, uploaded image, or generated artifact.
- Video capture should not block terminal or mission progress; the interface must expose which subsystem is active.

---

# 12. Settings Control System

> *Standard, Advanced, Pro, and Owner as progressive visibility modes.*

## 12.1 Control Modes

| Mode | Designed For | Control Level |
| --- | --- | --- |
| **Standard** | Normal users | Basic global preferences and safe defaults |
| **Advanced** | Power users | Page, device, navigation, and layout overrides |
| **Pro** | Creators, developers, agent builders | AI routing, agent permissions, workflows, integrations, automation |
| **Owner** | You and trusted administrators | Global platform, financial, infrastructure, user, and audit controls |

> ⚙️ **MODE RULE** — These are control/visibility modes, not billing plans. Switching modes reveals or hides controls; it never resets, replaces, deletes, or downgrades stored values.

## 12.2 Settings Precedence

The most specific available value wins. A temporary session preview may override a mobile Studio wallpaper without changing the persistent Studio, mobile, global user, or system values.

```
Session override
  ↓
Page + device override
  ↓
Page override
  ↓
Device override
  ↓
User global value
  ↓
System default
```

## 12.3 Canonical Types

```ts
export type SettingsControlMode =
  | "standard"
  | "advanced"
  | "pro"
  | "owner";

export type SettingsScope =
  | "system"
  | "user"
  | "device"
  | "page"
  | "page-device"
  | "session";

export type CustomizablePage =
  | "dashboard"
  | "studio"
  | "agents"
  | "gallery"
  | "games"
  | "social"
  | "settings";
```

## 12.4 Setting Registry

```ts
export type SettingDefinition<T = unknown> = {
  key: string;
  label: string;
  description?: string;
  category:
    | "account" | "appearance" | "pages" | "navigation"
    | "studio" | "ai" | "agents" | "voice"
    | "notifications" | "integrations" | "automation"
    | "billing" | "privacy" | "system";
  minimumMode: SettingsControlMode;
  defaultValue: T;
  allowedScopes: SettingsScope[];
  validate: (value: unknown) => value is T;
  requiresAdmin?: boolean;
  requiresReauthentication?: boolean;
  destructive?: boolean;
  previewable?: boolean;
};
```

The registry is the **source of truth** for UI rendering, server validation, defaults, allowed scopes, permissions, and preview behavior. Do not scatter setting definitions across page components.

## 12.5 Standard Mode

| Category | Controls |
| --- | --- |
| Account | Profile, username, security, connected accounts, billing, LiTBits |
| Appearance | Theme preset, light/dark/system, accent, global wallpaper, font size, reduced motion |
| Notifications | Messages, agent updates, project updates, billing alerts |
| Studio | Default model mode, voice enabled, auto-speak, entry experience, save history |

## 12.6 Advanced Mode

| Area | Controls |
| --- | --- |
| Pages | Dashboard widgets; Studio rail/dock/layout/wallpaper; Agents cards; Gallery grid; Games performance; Social feed |
| Scope | Entire LiTTree, this page only, or selected pages |
| Navigation | Visibility, order, display label, mobile selection, default home, favorites |
| Wallpaper | Global/page/mobile/desktop, overlay, blur, motion, scheduled selection |

## 12.7 Pro Mode

| Area | Controls |
| --- | --- |
| AI and models | Default per task, coding/image/voice/research, routing, temperature, length, instructions, memory |
| Agents | Tool, terminal, GitHub, file, deployment permissions; spending; approvals; collaboration |
| Studio workflows | Layout, auto-test, preview, save, commit policy, deployment target, screenshot loop |
| Integrations | GitHub, Vercel, Supabase, Cloudflare, social, storage, keys, webhooks |
| Automation | Triggers, schedules, content pipelines, build/test/deploy loops, recovery |

## 12.8 Owner Mode

- Server-confirmed owner or administrator role.
- Recent reauthentication, with optional two-factor confirmation for high-risk actions.
- Global page enablement, maintenance mode, flags, roles, branding, themes, navigation, and default AI configuration.
- LiTBits pricing, plans, credit limits, promotions, marketplace fees, and payouts.
- Provider order, rate limits, fallback models, token budgets, health, global prompts, and safety controls.
- Environment, database, queue, terminal server, deployment, errors, cache, search, migrations.
- User search, suspension, credit adjustment, plan changes, settings reset, and audited impersonation.

## 12.9 Settings Storage

| Table | Purpose |
| --- | --- |
| `user_settings` | Global user preferences |
| `device_settings` | Per-device preferences |
| `page_settings` | Per-page overrides |
| `page_device_settings` | Page and device-specific overrides |
| `user_navigation_settings` | Visibility, label, order, pinning, mobile state |
| `user_control_modes` | Current settings visibility mode |
| `system_settings` | Owner-controlled platform defaults |
| `feature_flags` | Global and targeted feature rollout |
| `settings_audit_logs` | Privileged setting changes |
| `settings_presets` | Saved setting combinations |
| `settings_sessions` | Temporary previews and session overrides |

---

# 13. Appearance and Wallpaper Architecture

> *Make the wallpaper visible without sacrificing readability.*

## 13.1 Layering Model

```
Fixed wallpaper layer
  ↓
Readability overlay
  ↓
Transparent page shell
  ↓
Semi-transparent glass panels
  ↓
Content, controls, and focus states
```

## 13.2 Studio Implementation Pattern

```tsx
export default function StudioPage() {
  return (
    <main className="relative min-h-screen overflow-hidden bg-transparent text-white">
      <div className="fixed inset-0 -z-10">
        <img
          src="/wallpapers/litt-wallpaper.jpg"
          alt=""
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-black/50" />
      </div>

      <Builder />
    </main>
  );
}
```

## 13.3 Transparency Rules

| Surface | Recommended Behavior |
| --- | --- |
| Main shell | Transparent; never a solid black wall over the wallpaper |
| Top bar | Dark translucent background with blur and a restrained border |
| Message cards | Readable glass panel with sufficient contrast |
| Composer | Stronger blur and opacity than passive panels |
| Side panels | Semi-transparent; background remains visible but not distracting |
| Modals | Opaque enough to maintain focus and accessibility |

## 13.4 Common Causes of Hidden Wallpaper

- `html`, `body`, app root, `LayoutShell`, or `Builder` root has a solid background.
- A full-screen overlay is above the wallpaper rather than between wallpaper and content.
- The wallpaper is placed at a negative `z-index` below a solid document root.
- A child uses an opaque black flex container for the entire viewport.
- Mobile wrappers clip or replace the background.
- Wallpaper object URL is revoked too early or the file path is invalid.

## 13.5 Wallpaper Settings

- Global wallpaper and per-page override.
- Desktop and mobile variants.
- Overlay darkness, blur, saturation, parallax, and reduced-motion behavior.
- Time-based or scheduled selection.
- Preview session that can be applied or cancelled without overwriting persistent values.
- Fallback when a custom upload is missing, corrupt, or unsupported.

---

# 14. Integration and Provider Framework

> *Connections that are real, testable, and recoverable.*

## 14.1 Integration Card Contract

```ts
type IntegrationStatus =
  | "not_configured"
  | "connecting"
  | "connected"
  | "limited"
  | "reauthorization_required"
  | "budget_exhausted"
  | "rate_limited"
  | "degraded"
  | "error";

type IntegrationHealth = {
  provider: string;
  status: IntegrationStatus;
  checkedAt: string;
  capabilities: string[];
  message?: string;
  action?: "connect" | "reconnect" | "upgrade" | "configure" | "retry";
};
```

## 14.2 Priority Integrations

| Integration | Primary Purpose | Required Verification |
| --- | --- | --- |
| GitHub App | Repository access, branches, PRs | Installation and selected repository permissions |
| Vercel | Project linkage, deployments, logs | Project identity and environment access |
| Supabase | Database, auth-adjacent state, storage, realtime | Server-side query and migration status |
| Cloudflare | DNS, R2, Workers, tunnels | Resource health and authorization |
| OpenRouter / model providers | Model routing | Available model and billing/rate state |
| n8n / automation | Workflow execution | Webhook/credential and workflow health |
| Social providers | Publishing | OAuth scope and token refresh state |
| Terminal provider | Sandbox and PTY | Authenticated sandbox and prompt handshake |

## 14.3 Reconnect Behavior

- Use exponential backoff only for retryable transport or temporary provider failures.
- Do not retry authentication, permission, invalid configuration, or exhausted budget errors without user action.
- Persist a short provider-health cache to prevent repeated expensive failures.
- Expose the exact next step: reconnect, grant repository, add budget, choose fallback, or open settings.
- Keep the user's mission and draft intact while a connection is repaired.

## 14.4 Adapter Interface

```ts
interface ProviderAdapter<Request, Result> {
  id: string;
  health(context: ProviderContext): Promise<IntegrationHealth>;
  validate(request: Request): Request;
  execute(request: Request, context: ProviderContext): Promise<Result>;
  normalizeError(error: unknown): NormalizedProviderError;
}
```

## 14.5 Provider Routing

Routing should consider capability, current availability, user preference, quality, latency, cost, privacy, and plan policy. A hardcoded provider label such as "Free" is misleading when a key can have zero budget or a provider can change terms. Display **dynamic availability and the reason for unavailability**.

---

# 15. Image Generation Reliability

> *Correct status codes, current models, serialization, fallback, and user-facing recovery.*

## 15.1 Failure Case

> **OBSERVED FAILURE**
> The image provider returned HTTP 402 PAYMENT_REQUIRED because the configured key had a zero spending budget. The application incorrectly converted the provider failure into a 500 Internal Server Error and waited through an expensive failed request.

## 15.2 Normalized Errors

```ts
type ProviderErrorCode =
  | "BUDGET_EXHAUSTED"
  | "RATE_LIMITED"
  | "AUTH_INVALID"
  | "MODEL_UNAVAILABLE"
  | "TIMEOUT"
  | "PROVIDER_DOWN"
  | "VALIDATION_ERROR"
  | "UNKNOWN";

type NormalizedProviderError = {
  provider: string;
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  status: number;
  retryAfterSeconds?: number;
};
```

## 15.3 HTTP Preservation

```ts
if (providerResponse.status === 402) {
  return NextResponse.json(
    {
      success: false,
      error: {
        code: "PROVIDER_BUDGET_EXHAUSTED",
        provider: "pollinations",
        message: "The configured image provider has no remaining budget.",
        retryable: false,
      },
    },
    { status: 402 },
  );
}
```

## 15.4 Request Serialization

```ts
const payload = {
  prompt: prompt.trim(),
  width,
  height,
  model,
  ...(negativePrompt?.trim()
    ? { negative_prompt: negativePrompt.trim() }
    : {}),
};
```

Never send the literal string `"undefined"` for optional fields. Validate prompt, dimensions, model, quality, count, safety parameters, and provider-specific limits before the request leaves the server.

## 15.5 Model Selection

- Fetch the provider's current model registry or capability endpoint server-side.
- Cache the registry with an explicit TTL and stale fallback policy.
- Validate that the requested model exists and supports the requested operation.
- Do not hardcode a stale model such as `sana` as the permanent default.
- Choose a verified fallback only when it is present in the current registry.

> **Note:** This stale-model warning is also referenced in §A.5 (Provider-Error Phase Prompt). The two sections intentionally reinforce the same rule from different angles — §15.5 is the normative specification, §A.5 is the copy-ready agent instruction.

## 15.6 Fallback Order

1. Configured primary provider when healthy.
2. Configured platform fallback such as Cloudflare Workers AI when capability matches.
3. User-connected provider or Bring Your Own Provider authorization.
4. Configured premium provider based on plan and permission.
5. Actionable unavailable card when no provider is usable.

## 15.7 Builder Error Card

```
Free image capacity is unavailable
The configured provider has no remaining budget.

[Connect provider] [Try another provider] [Open provider settings]
```

## 15.8 Validation Matrix

| Case | Expected Result |
| --- | --- |
| Funded valid key | Generation succeeds and usage is recorded |
| Zero budget | HTTP 402, no repeated retries, fallback considered |
| Invalid key | Authentication error and reconnect/configure action |
| Unsupported model | Model unavailable; registry refresh or supported option |
| Timeout | Retryable timeout with bounded retry/fallback |
| Fallback succeeds | Result records actual provider and model |
| All providers unavailable | Actionable failure card, no fake 500 |
| Missing negative prompt | Field omitted, not serialized as text |

---

# 16. LiTT Game Cloud and Retro Arcade

> *Artwork-first gaming without breaking local privacy or emulator behavior.*

## 16.1 Current Redesign Objective

The Game Cloud and Retro Arcade must stop feeling like a SaaS dashboard with emoji thumbnails. The experience should be **immersive, artwork-first, responsive, and clearly branded** while preserving browser-local ROM storage, legal confirmation, system detection, emulator routes, search, filters, favorites, delete, launches, and last-played state.

## 16.2 Primary Routes and Protected Behavior

| Route | Purpose | Must Preserve |
| --- | --- | --- |
| `/games` | Premium Game Cloud landing | Links, browser games, emulator discovery, Builder callout |
| `/games/retro` | Local artwork-first ROM library | IndexedDB, import, filtering, favorites, delete, Quick Play |
| `/games/retro/play/[gameId]` | Emulator session | Existing game loading and storage behavior |

> 🎨 **ARTWORK RULE** — Do not hotlink or bundle copyrighted commercial game covers. Imported commercial ROMs receive original LiTT fallback packaging unless the user uploads their own local artwork.

## 16.3 Artwork Resolution Priority

1. User-provided custom artwork stored locally.
2. Bundled Quick Play artwork with valid licensing.
3. Known internal artwork mapping.
4. Automatically rendered LiTT system-themed fallback.

## 16.4 Retro Artwork Component

- Responsive image sizing and correct `sizes` attributes.
- Meaningful alt text and loading skeleton.
- Safe fallback with no broken-image icon.
- System-specific branded treatment, scanline/print textures, and consistent title hierarchy.
- Object URL creation and revocation without leaks for local Blob artwork.

## 16.5 Data Model Extension

| Variant | Ratio | Use |
| --- | --- | --- |
| Cover | 3:4 | Game cards, library shelves, details |
| Hero | 16:9 | Continue Playing, Game Cloud hero, featured shelf |
| Logo / icon | 1:1 | Small badge or fallback — not primary artwork |

```ts
type RetroGameRecord = {
  id: string;
  title: string;
  originalFilename: string;
  system: RetroSystem;
  rom: Blob;
  favorite?: boolean;
  launches?: number;
  lastPlayedAt?: string;
  quickPlayId?: string;
  customCoverArt?: Blob;
  customHeroArt?: Blob;
  artworkKey?: string;
  artworkSource?: "quickplay" | "custom" | "generated";
  dominantColor?: string;
};
```

## 16.6 Title Cleanup

Store the original filename unchanged. The cleaned title is presentation metadata only and should remove region tags, revisions, dump markers, version noise, extensions, and duplicate whitespace.

```ts
cleanRetroTitle("Super Mario Bros 3 (USA) (Rev 1) [!].nes")
// → "Super Mario Bros 3"
```

## 16.7 `/games` Structure

- Cinematic LiTT Game Cloud hero with original arcade artwork.
- Continue Playing when local games exist.
- Quick Play licensed homebrew shelf.
- Emulator Labs.
- Instant browser games.
- Build Your Own Game in Studio callout.
- Compact legal and private-storage explanation.

## 16.8 `/games/retro` Structure

- Compact arcade header.
- Full-width Continue Playing hero with real or fallback game artwork.
- Horizontal system filter chips.
- Quick Play shelf.
- Recently Added shelf.
- Favorites shelf when favorites exist.
- Full Library grid or shelf.
- Compact privacy/legal footer card.

Remove permanent left and right sidebars. Convert collection navigation to horizontal chips, progress to a collapsible achievement drawer, supported systems to import help, and LiTT Companion to a floating expandable assistant that does not cover mobile navigation.

## 16.9 Quick Play Behavior

- Use `coverImage`, optional `heroImage`, `artworkAlt`, `dominantColor`, and only a tiny glyph fallback.
- Show "Add & Play" when absent; "Play" and "Installed" when present.
- Use `quickPlayId` to detect existing installation and prevent duplicates.
- Disable duplicate actions while a download is active.
- Preserve author, license, source, and project links.
- Preserve clear CORS / download error messaging.

## 16.10 Custom Artwork Controls

| Action | Behavior |
| --- | --- |
| Change Cover | PNG/JPG/WEBP, 5 MB limit, local IndexedDB storage, 3:4 guidance |
| Change Hero | PNG/JPG/WEBP, 5 MB limit, local IndexedDB storage, 16:9 guidance |
| Reset Artwork | Remove only custom artwork and return to resolver fallback |
| Remove Game | Delete through existing confirmed local flow |

## 16.11 Known Bug Fix

The favorite toggle must return the updated record for the matching game. Also verify stale state after import/deletion, Quick Play duplicates, object URL cleanup, modal focus/Escape, file-input reset, disabled states, and mobile overflow.

```ts
setGames(current =>
  current.map(item => item.id === updated.id ? updated : item)
);
```

## 16.12 Visual System

| System | Identity |
| --- | --- |
| NES | Red, charcoal, silver, hard rectangular packaging |
| SNES | Soft gray, purple, restrained multicolor accents |
| Game Boy | Olive LCD green, dark gray, dot-matrix texture |
| Game Boy Color | Translucent color treatment with yellow/cyan/magenta accents |
| Game Boy Advance | Indigo, electric blue, rounded shapes |
| Genesis / Mega Drive | Black, red, chrome, sharper typography |

## 16.13 Responsive and Accessibility Targets

- Test 375×667, 390×844, 768×1024, 1366×768, and 1920×1080.
- Card widths approximately 150–175px mobile, 180–210px tablet, 200–230px desktop.
- Horizontal shelves use scroll snapping on mobile; full library may use a responsive grid.
- All actions are keyboard/touch accessible with visible focus and 44px targets.
- Dialogs use `role=dialog`, `aria-modal`, Escape handling, focus management, and reduced-motion support.
- No external artwork API is required at runtime.

---

# 17. Security, Permissions, and Owner Control

> *Defense in depth for projects, tools, settings, and users.*

## 17.1 Authorization Boundaries

| Boundary | Required Check |
| --- | --- |
| API request | Authenticated user and session |
| Project action | Project membership and role |
| Repository action | Installation and selected repository permission |
| Sandbox action | Sandbox owner / project match |
| Terminal reconnect | Session owner, project, sandbox, and expiry |
| Tool action | Tool risk, input schema, plan limit, approval state |
| Settings write | Definition, scope, role, reauthentication |
| Owner operation | Server role, recent auth, reason, confirmation, audit |

## 17.2 Owner Mode Requirements

- Cannot be enabled through client state, localStorage, hidden query parameters, or UI-only checks.
- Requires server-confirmed owner/admin role and a recent authentication threshold.
- High-risk actions may require passkey/password and two-factor confirmation.
- Requires a reason for user, financial, platform, migration, deployment, and impersonation changes.
- Displays a persistent warning banner during impersonation and provides an explicit exit.
- Never sends owner/provider secrets to client JavaScript.

## 17.3 Approval Object

```ts
type ApprovalRequest = {
  id: string;
  projectId?: string;
  missionId?: string;
  action: string;
  risk: "external" | "destructive" | "production" | "financial" | "privileged";
  target: string;
  summary: string;
  exactConsequences: string[];
  requestedBy: string;
  expiresAt: string;
};
```

## 17.4 Audit Log

```ts
type AuditLog = {
  id: string;
  actorId: string;
  actorType: "user" | "agent" | "system";
  action: string;
  targetType: string;
  targetId?: string;
  projectId?: string;
  before?: unknown;
  after?: unknown;
  reason?: string;
  ipHash?: string;
  createdAt: string;
};
```

## 17.5 Secret Handling

- Keep secrets in server-controlled storage and inject only into authorized sandbox processes when necessary.
- Never include secret values in model context, API responses, terminal summaries, screenshots, or audit diffs.
- Redact common token formats and configured secret values from output before persistence.
- Prevent commands that intentionally print complete environment files unless explicitly safe and authorized.
- Use least-privilege provider scopes and rotate credentials after suspected exposure.

## 17.6 Kill Switches

- Global disable for terminal execution, deployment, or a failing provider.
- Per-user and per-project mission suspension.
- Per-sandbox stop and revoke.
- Rate-limit and cost ceiling overrides.
- Feature-flag rollback for new settings or provider adapters.

---

# 18. Persistence, Data Model, and Realtime

> *Durable work across devices and sessions.*
>
> 📋 **`schema.sql` disclaimer:** `supabase/schema.sql` is currently a **legacy hand-paste file**. It has not been regenerated by `supabase db pull` and does not reflect the full target schema below. Do not treat it as authoritative schema ground truth. Authoritative migrations live in `supabase/migrations/`. Once `supabase db pull` is wired, `schema.sql` will be regenerated from the live database.

## 18.1 Authoritative Tables (Target State)

> ⚠️ **These tables represent the target LiTTree data model, not the current database schema.** The current `supabase/schema.sql` contains only the older social/wallet/agent tables. These tables are **not yet migrated** into `schema.sql` or `supabase/migrations/`. Migration is pending.

| Table (target state) | Stores (not yet migrated in `schema.sql`) |
| --- | --- |
| `projects` | Repository linkage, stack metadata, active branch, status |
| `project_members` | Authorization and role |
| `missions` | User request, status, limits, result |
| `builder_blocks` | Ordered durable Builder stream |
| `sandbox_sessions` | Provider sandbox identifiers and lifecycle |
| `terminal_sessions` | PTY identifiers, ownership, reconnect metadata |
| `processes` | Dev servers, tests, workers, command state |
| `run_steps` | Agent/tool operations and timings |
| `artifacts` | Generated files, images, builds, screenshots |
| `approvals` | Pending and completed confirmation records |
| `usage_ledger` | AI, compute, storage, deployment, and credit usage |
| `audit_logs` | Security and privileged action history |
| `settings_*` | Scoped settings, presets, sessions, and audits |

## 18.2 Builder Block Persistence

```ts
type PersistedBuilderBlock = {
  id: string;
  projectId: string;
  missionId?: string;
  position: number;
  type: string;
  payload: unknown;
  status?: string;
  actorId?: string;
  createdAt: string;
  updatedAt: string;
};
```

## 18.3 localStorage Policy

| Allowed | Not Allowed |
| --- | --- |
| Unsent draft text | Authoritative mission history |
| Temporary UI panel state | Project permissions |
| Optimistic cache | Terminal ownership |
| Recent local preference fallback | Approval records |
| Offline queue metadata | Cross-device source of truth |

## 18.4 Realtime Channel Policy

- Private project or mission channels only.
- Authorize subscriptions against project membership and resource ownership.
- Use ordered sequence numbers or positions to recover after disconnection.
- Persist important events before or atomically with broadcast where possible.
- On reconnect, fetch missed durable blocks rather than trusting only transient messages.

## 18.5 Row Level Security

User-scoped settings, projects, blocks, artifacts, and approvals require policies that prevent cross-user access. Owner/system writes require a trusted server path with role verification. **RLS is one layer; application authorization and resource ownership checks are still required.**

---

# 19. Observability, Performance, and Cost Control

> *Measure the system users actually experience.*

## 19.1 Core Telemetry

| Domain | Metrics |
| --- | --- |
| Voice | Speech end → transcript → first token → first audio → playback |
| Terminal | Connect latency, reconnect rate, command duration, exit distribution |
| Missions | Queue time, runtime, steps, approvals, failure stage |
| Preview | Start time, health-check latency, crash frequency |
| Providers | Availability, latency, error code, budget/rate state, fallback rate |
| GitHub | Install success, token generation, clone duration, permission failures |
| Settings | Resolution latency, write failures, audit completeness |
| Games | Artwork load/fallback, import success, IndexedDB failure, launch success |

## 19.2 Structured Trace

```
requestId
  → userId / projectId / missionId
  → API route
  → tool / provider adapter
  → sandbox / process
  → Builder block ids
  → approval id
  → final status and duration
```

## 19.3 User-Visible Status

- Show current operation and elapsed time for long work.
- Provide compact results and expandable technical details.
- Separate provider failure, platform failure, validation failure, and user-cancelled state.
- Expose retry or recovery only when it is safe and likely to work.
- Preserve failure evidence for support without exposing secrets.

## 19.4 Suggested Free-User Controls

| Resource | Suggested Allowance |
| --- | --- |
| Connected projects | 1 |
| Concurrent sandbox | 1 |
| Active session | 15 minutes |
| Idle timeout | 5 minutes then pause |
| Background missions | 1 at a time |
| Daily coding missions | 5 |
| Storage | 500 MB |
| Preview deployments | Limited |
| Production deployment | Explicit approval; plan/policy dependent |

Limits must be visible before the user starts a large mission. Do not surprise them halfway through execution. Billing plans may change allowances, but control modes in Settings remain independent.

## 19.5 Performance Priorities

- Reduce JavaScript and heavy visual effects on the initial Studio and mobile paths.
- Lazy-load editor, terminal, media, and large artwork only when needed.
- Stream AI and mission state instead of polling large payloads.
- Use background resource pause/resume rather than keeping every sandbox alive.
- Cache current provider/model registries and health with safe TTLs.
- Instrument and fix LCP, total blocking time, voice first-audio, terminal connect, and preview-ready latency.

---

# 20. Delivery Roadmap and Definition of Done

> *Build in stable vertical slices.*

## 20.1 Execution Spine Roadmap

| Pass | Scope | Stop Condition |
| --- | --- | --- |
| 1 | GitHub project connection | One repository and branch authorized, stored, and displayed |
| 2 | Sandbox proof | Clone, stack detection, `pwd`, `git status`, tree, package version |
| 3 | Real terminal | Authenticated PTY, input/output, resize, reconnect, honest state |
| 4 | Files and preview | Tree, Monaco, process controls, embedded preview |
| 5 | LiTT execution | Typed tools, patches, tests, structured blocks |
| 6 | Durable missions | Supabase source of truth, queue, retry, cancel, resume |
| 7 | Approval and safety | Checkpoints, diff, secret redaction, limits, audits |
| 8 | Onboarding | New user completes the full value path |

## 20.2 Settings Roadmap

| Pass | Scope |
| --- | --- |
| 1 | Registry and Standard Mode only |
| 2 | Advanced page/device/navigation controls |
| 3 | Pro AI, agents, workflows, integrations, automation |
| 4 | Owner role gate, reauthentication, system/user/financial controls |
| 5 | Presets, export/import, reset, device synchronization |

## 20.3 Retro Roadmap

| Pass | Scope |
| --- | --- |
| 1 | Artwork resolver, original fallbacks, data-model compatibility |
| 2 | Quick Play artwork and duplicate prevention |
| 3 | `/games` hero and shelves |
| 4 | `/games/retro` immersive layout and cards |
| 5 | Custom local artwork controls and cleanup |
| 6 | Responsive, accessibility, and regression validation |

## 20.4 Global Validation Commands

Use the repository's actual script names. If type checking is named `type-check` rather than `typecheck`, report that fact and run the existing script. **Do not claim a command passed unless it was executed and the exit code was zero.**

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

## 20.5 Final Acceptance Test — Execution Spine

1. Sign in.
2. Connect GitHub.
3. Select one repository.
4. Start a workspace.
5. See the detected stack.
6. Open a real terminal.
7. Run `pwd`.
8. Run the development server.
9. Ask LiTT to make one safe change.
10. See command output.
11. See changed files and diff.
12. See the live preview.
13. Approve a commit.
14. Create a pull request.
15. Close the browser and later resume the project.

## 20.6 Completion Report Template

```
Phase:
Starting state / root cause:
Files changed:
Database migrations:
Environment variables:
Commands executed:
Validation results:
Responsive checks:
Security checks:
Known remaining risks:
Next recommended phase:
STOPPED: yes
```

---

# Appendix A. Master Coding-Agent Contract

> *Copy-ready instruction that governs all repository changes.*

## A.1 Master Contract

```
You are working in the LiTTree LabStudios repository.

PRIMARY RULES
- Audit the real repository before editing.
- Preserve the approved Builder UI.
- Studio remains one unified workspace.
- Keep exactly one composer.
- Do not create duplicate Code, Terminal, Preview, Image, Agent, or Settings pages.
- Never claim a connection without verifying backend state.
- Never execute project code on the Vercel host filesystem.
- Never expose secrets or permanent provider tokens to the browser or model.
- Work on a safe feature branch, never directly on main.
- Implement one phase at a time, validate, report, and stop.

PHASE 1 — AUDIT ONLY
Report:
1. Current routes, layouts, and relevant components.
2. Existing persistence and database tables.
3. Auth and role checks.
4. Existing GitHub App flow and installations.
5. Existing sandbox provider integration.
6. Existing xterm component and whether a real PTY exists.
7. Existing API / WebSocket routes.
8. Existing Builder block types.
9. Existing provider adapters and health behavior.
10. Exact files proposed for the next phase.

Do not edit during the audit.

IMPLEMENTATION RULES
- Reuse existing components and state where valid.
- Add typed schemas for tools and APIs.
- Add server-side authorization and ownership checks.
- Add normalized errors and truthful UI states.
- Preserve backward compatibility for stored user data.
- Add or update targeted tests.

VALIDATION
Run the repository's real scripts for type checking, linting, tests, and production build.
For UI changes, verify at approximately 390px and 1440px.

STOP AND REPORT
- root cause / starting state
- files changed
- migrations
- environment variables
- command results and exit codes
- screenshots or responsive verification
- security considerations
- remaining risks

Do not begin the next phase until explicitly authorized.
```

## A.2 Execution-Spine Phase Prompt

```
Build the production execution spine for LiTTree Builder.

PRESERVE THE CURRENT APPROVED BUILDER UI.
Connect existing Terminal, Code, Diff, Preview, Progress, Agent, and Approval blocks to real backend execution. Do not rebuild them.

PHASE ORDER
1. GitHub project connection
2. Sandbox proof
3. Real PTY terminal
4. Files and preview
5. Typed LiTT coding tools
6. Durable missions
7. Safety and approvals
8. First-user onboarding

After each phase:
- run validation
- report results
- stop
```

## A.3 Settings Phase Prompt

```
Implement the LiTTree Settings Control System.

Modes: Standard, Advanced, Pro, Owner.
They are visibility/control modes, not billing plans.
Higher modes reveal additional controls and never reset existing values.
Do not create four separate Settings pages.

Start with:
1. Audit only.
2. Canonical setting-definition registry.
3. Standard Mode only.
4. Validate and stop.

Use precedence:
session → page-device → page → device → user → system.
Owner Mode requires server role, recent reauthentication, audit logging, reason, and confirmation.
```

## A.4 Retro Arcade Phase Prompt

```
Repository: LabsConnected/litlabs-website
Base branch: main
Feature branch: feature/immersive-retro-arcade

Redesign /games and /games/retro into an artwork-first premium arcade while preserving IndexedDB ROM storage, legal confirmation, import, emulator routes, search, filters, favorites, delete, launches, and last played.

Implement in phases:
1. Artwork resolver and original system fallbacks.
2. Backward-compatible IndexedDB metadata.
3. Quick Play artwork and duplicate prevention.
4. /games cinematic hero and shelves.
5. /games/retro wide immersive layout.
6. Local custom cover/hero controls.
7. Responsive, a11y, and regression checks.

No copyrighted commercial box art.
No emoji as primary artwork.
Validate and stop after each phase.
```

## A.5 Provider-Error Phase Prompt

```
Fix image-provider quota and model failures without redesigning Builder.

- Preserve provider HTTP status codes.
- Normalize BUDGET_EXHAUSTED, RATE_LIMITED, AUTH_INVALID, MODEL_UNAVAILABLE, TIMEOUT, PROVIDER_DOWN, VALIDATION_ERROR, UNKNOWN.
- Treat HTTP 402 as non-retryable unless the provider explicitly says otherwise.
- Cache exhausted/unavailable health briefly to prevent repeated slow failures.
- Fetch and cache the current model registry.
- Omit undefined optional fields.
- Add configured fallback providers.
- Show actionable Builder failure cards.
- Never label a provider permanently Free.
- Validate funded, zero-budget, invalid, unsupported-model, timeout, fallback, and all-unavailable cases.
```

---

# Appendix B. Canonical Types and API Contracts

> *Implementation reference.*

## B.1 Command Result

```ts
type CommandResult = {
  commandId: string;
  command: string;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  exitCode: number | null;
  stdoutPreview: string;
  stderrPreview: string;
  outputBytes: number;
  truncated: boolean;
  processId?: string;
};
```

## B.2 Tool Context

```ts
type ToolContext = {
  userId: string;
  projectId: string;
  missionId: string;
  sandboxId: string;
  workspacePath: string;
  activeBranch: string;
  permissions: string[];
  limits: MissionLimits;
};
```

## B.3 Setting Resolution

```ts
type ResolveSettingInput = {
  key: string;
  userId?: string;
  deviceId?: string;
  page?: CustomizablePage;
  sessionId?: string;
};

async function resolveSetting<T>(input: ResolveSettingInput): Promise<T> {
  const values = await loadSettingLayers(input);
  return (
    values.session ??
    values.pageDevice ??
    values.page ??
    values.device ??
    values.user ??
    values.systemDefault
  ) as T;
}
```

## B.4 Navigation Item Settings

```ts
type NavigationItemSettings = {
  itemId: string;
  visible: boolean;
  label?: string;
  position: number;
  pinned?: boolean;
  mobileVisible?: boolean;
};
```

## B.5 Provider Error

```ts
type NormalizedProviderError = {
  provider: string;
  code: ProviderErrorCode;
  message: string;
  retryable: boolean;
  status: number;
  retryAfterSeconds?: number;
  details?: Record<string, unknown>;
};
```

## B.6 Retro Artwork Result

```ts
type ResolvedRetroArtwork = {
  coverSrc: string;
  heroSrc?: string;
  alt: string;
  dominantColor: string;
  source: "custom" | "quickplay" | "mapped" | "generated";
  revoke?: () => void;
};
```

---

# Appendix C. Phase Checklists and Acceptance Tests

> *Operational go/no-go lists.*

## C.1 GitHub Connection Checklist

- [ ] GitHub App installation callback is authenticated and verified.
- [ ] Only granted repositories are listed.
- [ ] Installation token is generated server-side and never persisted.
- [ ] Repository and branch selection are durable.
- [ ] Reconnect and permission-repair flows are visible.
- [ ] Unauthorized repository identifiers are rejected server-side.
- [ ] Project health card reflects real state.

## C.2 Terminal Checklist

- [ ] WebSocket requires an authenticated session.
- [ ] Project and sandbox ownership checked on every connect/reconnect.
- [ ] PTY exists inside isolated sandbox.
- [ ] Prompt handshake verifies cwd.
- [ ] Input, output, resize, interrupt, copy/paste, exit, reconnect work.
- [ ] Collapsing UI preserves process.
- [ ] Refresh reconnects when valid.
- [ ] Disconnected UI never says connected.
- [ ] Output and errors are redacted and bounded.

## C.3 Mission Checklist

- [ ] Plan is visible before broad modification.
- [ ] Branch and checkpoint exist.
- [ ] Every tool input is schema-validated.
- [ ] Every step records duration, status, and safe output.
- [ ] Limits are enforced.
- [ ] Tests match the change.
- [ ] Diff is shown before external actions.
- [ ] Approval is required where policy says so.
- [ ] Cancel works.
- [ ] Resume restores durable state.

## C.4 Settings Checklist

- [ ] Mode switch reveals controls without changing values.
- [ ] Resolver honors session → page-device → page → device → user → system.
- [ ] UI and server use the same setting registry.
- [ ] Page reset removes only page override.
- [ ] Protected navigation remains reachable.
- [ ] Owner controls cannot be enabled client-side.
- [ ] RLS prevents cross-user reads/writes.
- [ ] Privileged changes create complete audit logs.

## C.5 Retro Checklist

- [ ] Existing IndexedDB records still load.
- [ ] Fallback artwork appears for old records.
- [ ] No emoji is primary artwork.
- [ ] Quick Play does not duplicate installs.
- [ ] Favorite state updates instantly.
- [ ] Import/delete refresh local state.
- [ ] Custom artwork persists and object URLs are cleaned up.
- [ ] Game play route still launches.
- [ ] Mobile shelves and dialogs work without overflow.
- [ ] No copyrighted commercial assets are bundled.

## C.6 Provider Checklist

- [ ] 402 remains 402 and is not reported as 500.
- [ ] Non-retryable errors are not retried.
- [ ] Optional undefined fields are omitted.
- [ ] Model is validated against current registry.
- [ ] Fallback records actual provider/model used.
- [ ] All-unavailable state is actionable.
- [ ] Provider secrets never reach client or logs.

---

# Appendix D. Glossary and Decision Log

> *Shared language prevents architectural drift.*

## D.1 Glossary

| Term | Definition |
| --- | --- |
| **Builder** | The ordered Studio canvas containing conversation and structured work blocks. |
| **Control plane** | Authenticated APIs, authorization, policies, mission creation, provider adapters. |
| **Execution plane** | Isolated sandbox, filesystem, PTY, processes, dev server, tests. |
| **Mission** | Durable bounded unit of agent work linked to a project and user request. |
| **PTY** | Pseudo-terminal representing a real interactive shell process. |
| **xterm.js** | Browser terminal renderer; not a remote computer or shell by itself. |
| **Builder block** | Durable ordered representation of a message, command, code, diff, preview, approval, or artifact. |
| **Checkpoint** | Recoverable pre-change state used for diff, undo, or rollback. |
| **Integration health** | Server-verified provider capability and current operating state. |
| **Control mode** | Settings visibility level; independent from billing plan. |
| **Owner Mode** | Privileged server-gated platform control surface. |
| **Quick Play** | Licensed/public-domain homebrew that may be installed locally through the Retro Arcade. |
| **Artwork resolver** | Priority system selecting custom, bundled, mapped, or generated retro artwork. |

## D.2 Locked Decisions

| Decision | Status |
| --- | --- |
| Studio is the single unified workspace | 🔒 Locked |
| Exactly one composer in Studio | 🔒 Locked |
| Terminal must be a verified isolated PTY | 🔒 Locked |
| LiTT and user share one authorized project sandbox | 🔒 Locked |
| GitHub access uses a GitHub App and short-lived installation tokens | 🔒 Locked |
| localStorage is not durable source of truth | 🔒 Locked |
| Settings modes are not billing plans | 🔒 Locked |
| Owner Mode is server-gated and audited | 🔒 Locked |
| Retro ROMs and user artwork remain browser-local by default | 🔒 Locked |
| No bundled copyrighted commercial game covers | 🔒 Locked |
| Provider status codes and errors remain truthful | 🔒 Locked |
| One phase at a time with validation and stop | 🔒 Locked |

## D.3 Open Implementation Choices

| Choice | Decision Criteria |
| --- | --- |
| Sandbox provider | PTY quality, persistence, isolation, cost, regional support, API reliability |
| Durable mission runner | Queue/retry/realtime support, Next.js integration, cost |
| Artifact storage | Existing infrastructure, signed URL control, cost, geographic fit |
| Model router | Provider diversity, health checks, user keys, observability, pricing |
| Realtime transport | Authorization, ordering, reconnect, scale, operational simplicity |

---

## Closing Standard

> *What "get me right" means in production.*

The strongest next move is not another visual overhaul. It is to **complete the execution spine in controlled vertical slices** while preserving the approved Studio shell. Once one repository can be connected, executed, edited, tested, previewed, reviewed, and delivered inside Builder, every other LiTTree capability can build on a real foundation.

> ### THE STANDARD
> LiTTree is ready when the interface, the agent, and the backend all describe the same real state. The user connects a real project, works in one Builder, sees every meaningful action, retains control over risk, and can return later without losing the mission.

---

---

## What's New in v2.1 (Official Polish)

- Elevated executive front matter with scannable tables and authoritative tone (per Gemini recommendations).
- Added explicit **System Lockdown Protocol** and **Master Initialization Prompt** to keep agents and the project strictly aligned.
- Made "Phase-Zero Audit + one phase at a time + validate + STOP" the binding process.
- Updated all references to Version 2.1 and official status.
- Removed duplication and placeholder text for clean, professional flow.
- The full technical chapters (1–20) and Appendices A–D remain the authoritative implementation reference.

**This document + the embedded Master Contracts + project rules (`.clinerules`, `.cursorrules`, `AGENTS.md`) are the single source of truth.**

*End of Official Master Platform Handbook v2.1 — `LabsConnected/litlabs-website` — July 20, 2026.*


