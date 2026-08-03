# Canonical Architecture Rules — LiTTree LabStudios

> Source: Ultra Blueprint v7.0 (`docs/ULTRA_BLUEPRINT_v7.md`)
> These rules govern all AI agents working on this codebase.

## North Star

LiTT is the OS for turning ideas into reality. The Mission is the primary object.

## Agents

- Exactly two user-facing agents: **LiTT** (operating) and **Spark** (creative).
- All others are internal services LiTT invokes.
- Retired names: LiTT-Code, LiTTle-Bit, Jarvis. Do not use them.

## Mission Lifecycle

Created → Inspecting → Planning → Awaiting Approval → Ready → Executing → Verifying → Review → Deploying → Completed

Additional states: Blocked, Paused, Cancelled, Failed, Rolled Back.

## Studio Layout

- **Desktop:** 72px rail + flexible workspace + 360–440px chat panel.
- **Mobile:** 100dvh, one active workspace, one scroll container, sticky composer, terminal as bottom sheet.
- One unified workspace — no separate "Builder" product.

## Composer

Exactly `[+] [Message LiTT or Spark…] [Send] [Mic]`. No duplicate mic.

## Chat

- Single canonical route: `POST /api/chat/unified` with `handleUnifiedChat()`.
- SSE events: start, status, text-delta, tool-start, tool-result, artifact, mission, usage, error, done.

## Model Routing

Agent and model are independent. Persistence key: `litt-selected-model-v2`.

## Terminal

Browser shell is NOT a PTY. Must show real connection status. If disconnected, say so.

## Settings

- 4 control modes: Standard / Advanced / Pro / Owner — not tied to billing.
- 18 sections.
- Setting precedence: system defaults → user global → device → page → session.

## Truth Rules

Never fake: connection state, terminal access, repo contents, or deployment state.
Always verify before claiming ready/connected/live.

## Validation

Run `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build` before claiming completion.

## Build Order

Phase 1 (Truthful Foundation) → Phase 2 (Mission Core) → Phase 3 (Connected Intelligence) → Phase 4 (Experience) → Phase 5 (Advanced OS).

## Next Milestone

Fully verified vertical slice: Choose project → Initialize → Runtime Ready → Workspace Loaded → Terminal Connected → Files Visible → Preview Running → Logs Streaming → Ask LiTT → Review diff → Approve → Run tests → See result.

## Marketplace

Full Beta. BILLING_ENABLED=false. Beta LiTBits only.

## Data Model

Canonical tables: conversations, conversation_messages, memories, agents, agent_tasks, task_events, artifacts, missions, mission_steps, mission_events, mission_approvals, mission_checkpoints, integration_accounts, projects, project_files, usage_events.
