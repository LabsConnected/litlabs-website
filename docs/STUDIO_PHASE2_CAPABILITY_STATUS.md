# Studio Phase 2 Capability Status

**Branch:** `studio/phase-2`
**Date:** 2026-08-26
**Principle:** If LiTT advertises it, the user can actually use it.

## GREEN — Functional end-to-end

| Capability | Implementation | Notes |
|---|---|---|
| Project read/write | Terminal server + files API | `/api/studio-projects/[id]/files` |
| Terminal commands | terminal-server | `isBlockedCommand()` is authoritative |
| Current-app inspection | StudioPreviewPanel + preview API | Device modes, refresh, restart |
| File modification | Terminal write + files API | Binary write supported |
| Build/runtime error visibility | Preview status + build-fix loop | Real logs from dev server |
| Error correction | agent-loop-v2 build-fix loop | Auto-repair with retry limit |
| Real Preview control | StudioPreviewPanel | Desktop/tablet/mobile, Ctrl+R, copy URL |
| Image creation | `/api/media/generate` | R2 persistence + generation_jobs |
| Image editing | `/api/media/edit-image` | Gemini reference-image editing, persisted variant |
| Video generation | `/api/media/generate` | Multiple video providers |
| Audio/music generation | `/api/media/generate-audio` | Gemini TTS, R2 persistence |
| Asset management | Asset Lake + generation_jobs | No duplicate asset table |
| Use assets in project | `/api/studio-projects/[id]/assets/insert` | Server-side download + safe path write |
| Agent coordination | agent-loop-v2 + execution store | Real SSE events, no fabrication |
| Project context awareness | StudioContext + workspace APIs | Full project/workspace resolution |
| Live visible feedback | LiTTLiveActivity in Work tab | Real tool calls, builds, approvals |

## YELLOW — Implemented but needs operator verification

### Voice (LiveKit)
- **Status:** YELLOW
- **What exists:** Token route (`/api/voice/livekit-token`), LiveKitAudioTransport, LiTTRealtimeSessionController, voice session context, settings page with LiveKit status
- **What's needed:** Operator must set `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` in production env and run an E2E smoke test
- **Fallback:** Legacy Gemini Live WebSocket if LiveKit is not configured

### Game/app creation
- **Status:** YELLOW
- **What exists:** All required tools are functional — file write, terminal, image generation, asset insertion, build, preview, iteration
- **What's needed:** E2E smoke test with a real "build a playable browser game with generated artwork" request on this branch
- **The capability path is complete** but has not been smoke-tested end-to-end on `studio/phase-2`

## RED — Not functional (truthfully absent)

### Workflows
- **Status:** RED
- **No graph interpreter/executor exists.** No WorkflowBuilder UI is rendered.
- Workflows are NOT advertised as functional anywhere in the Studio.
- A graph executor must be implemented before any workflow UI ships.

### Multi-step Missions
- **Status:** RED (multi-step), GREEN (single-file)
- The mission executor (`lib/missions/mission-executor.ts`) implements a **single-file vertical slice**: inspect → propose → approval → apply → validate → checkpoint
- It does NOT execute arbitrary mission graphs
- Multi-step graph execution is unfinished and not advertised
- The existing single-file Mission flow (MissionForge) is preserved and functional

## Deployment Authorization

| Path | Who | How |
|---|---|---|
| Manual deploy trigger | Admin only | `/api/deploy/trigger` requires `isAdmin()` — 403 for non-admins |
| Git-based deploy | Any owner with push access | Push to connected branch triggers Railway git integration |
| Admin redeploy | Admins | Railway GraphQL API via deploy endpoint |

**Approval boundaries are preserved.** Ordinary project owners cannot bypass deployment authorization. They can push code (standard git workflow), but cannot manually trigger deployments.

## Architecture Notes

- **Asset Lake** is the canonical asset facade. Maps `generation_jobs` → `StudioAsset`.
- **`generation_jobs.user_id`** requires internal `public.users.id` UUID, not Clerk ID. Use `resolveInternalUserId()`.
- **R2** is primary binary storage. Supabase Storage is fallback.
- **agent-loop-v2** emits `ProgressEvent`s via `ProgressEmitter` → SSE → `useExecutionStore` → `LiTTLiveActivity`. No fabricated activity.
- **Terminal server** is the authoritative security boundary. `isBlockedCommand()` is never bypassed.
- **Provider routing** fixes live on `fix/owner-billing-clean`, NOT on this branch. Infrastructure fixes are kept separate from Studio work.

## Commits on studio/phase-2

1. `7b913601` feat(studio): Phase 1 — shell geometry reorientation
2. `0f37f459` fix(audio): persist generated audio to durable storage + Asset Lake
3. `b5f41905` feat(assets): Use in project — insert assets into workspace
4. `b06054b5` feat(preview): improve permanent Live Preview workspace
5. `bb67937c` feat(studio): expose real agent loop in Work tab
6. `cea22b1b` feat(voice): add LiveKit status to voice health + settings
7. `59b7d64d` feat(image): edit existing Asset Lake images with AI
