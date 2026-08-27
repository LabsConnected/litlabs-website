# Studio Phase 2 Capability Status

**Branch:** `studio/phase-2`
**Date:** 2026-08-26 (updated after acceptance audit)
**Principle:** If LiTT advertises it, the user can actually use it.

## Acceptance Audit Results

- **Branch integrity:** 9 commits, clean working tree, no contamination
- **Typecheck:** 3 pre-existing errors in `packages/litt-cli` (NOT in Studio code)
- **Lint:** 0 errors, 82 warnings (all pre-existing unused vars / `<img>`)
- **Tests:** 3211 passed, 6 failed (all 6 pre-existing on origin/main), 52 skipped
- **Build:** Production build passes (exit 0)
- **E2E smoke tests:** NOT RUN — missing Clerk, Supabase, R2 env vars + Gemini quota exhausted

## GREEN — Functional (code + unit/integration tests pass)

| Capability | Implementation | Evidence |
|---|---|---|
| Chat | CommandComposer + StudioTranscript | Routing tests pass |
| Plan | StudioWorkSurface + destination routing | Routing tests pass |
| Act | agent-loop-v2 + tool registry | 65 agent-loop tests pass |
| Agents | Agent registry + execution store | Tests pass |
| Preview | StudioPreviewPanel + preview API | 3 preview tests pass |
| Terminal | terminal-server + isBlockedCommand | Regression tests pass (pre-existing failures unrelated) |
| Files | Files API + ContextDrawer | Routing tests pass |
| Inspector | StudioInspector embedded in ContextDrawer | Routing tests pass |
| Activity | LiTTLiveActivity (single instance) + LiTTWorkSummary (real exec store) | Routing tests verify exactly 1 instance |
| Image generation | `/api/media/generate` | Code path verified; E2E blocked by Gemini quota |
| Video generation | `/api/media/generate` | Code path verified |
| Music generation | `/api/media/generate-music` | Code path verified |
| Asset management | Asset Lake + generation_jobs | Code path verified |
| Use in project | `/api/studio-projects/[id]/assets/insert` | Code path verified |

## YELLOW — Implemented but needs operator E2E verification

### Image editing
- **Status:** YELLOW
- **What exists:** `/api/media/edit-image` route, AssetsPanel edit UI
- **What's needed:** Real E2E with valid Gemini quota — generate image, edit it, verify persisted variant
- **Cannot verify now:** Gemini API quota exhausted (free tier limit: 0)

### Audio persistence
- **Status:** YELLOW
- **What exists:** `/api/media/generate-audio` with R2 persistence, AudioTool with durable URL handling
- **What's needed:** Real E2E — generate audio, verify R2/Supabase persistence, reload, playback
- **Cannot verify now:** No R2 env vars, no Supabase env vars, Gemini quota exhausted
- **Unit test:** audio-lab.test.ts passes (verifies no base64 in localStorage, durable URL handling)

### Voice (LiveKit)
- **Status:** YELLOW
- **What exists:** Token route, LiveKitAudioTransport, settings page with LiveKit status
- **Configuration:** `LIVEKIT_URL` NOT SET, `LIVEKIT_API_KEY` NOT SET, `LIVEKIT_API_SECRET` NOT SET
- **What's needed:** Operator must configure LiveKit env vars and run E2E

### Game/app creation
- **Status:** YELLOW
- **What exists:** All required tools functional — file write, terminal, image generation, asset insertion, build, preview, iteration
- **What's needed:** Real E2E smoke test with valid API quota
- **Cannot verify now:** Gemini quota exhausted, no Clerk/Supabase for Studio API auth
- **Integration tests:** agent-loop-v2 integration tests prove file editing, checkpointing, shell execution, build-fix loops work

### Missions (multi-step)
- **Status:** YELLOW (multi-step), GREEN (single-file)
- Single-file vertical slice: inspect → propose → approval → apply → validate → checkpoint
- Multi-step graph execution is NOT implemented

### Deployment (for ordinary users)
- **Status:** YELLOW
- Admin-only manual trigger (`/api/deploy/trigger` requires `isAdmin()`)
- Owner git-push is the standard path
- `RAILWAY_API_TOKEN` NOT SET, `RAILWAY_SERVICE_ID` NOT SET

## RED — Not functional (truthfully absent)

### Workflows / graph execution
- **Status:** RED
- No graph interpreter/executor exists. No WorkflowBuilder UI is rendered.
- Workflows are NOT advertised as functional anywhere in the Studio.

## Environment Configuration Status

| Variable | Status |
|---|---|
| `GEMINI_API_KEY` | SET (quota exhausted — free tier limit: 0 for image generation) |
| `GOOGLE_API_KEY` | SET |
| `OPENAI_API_KEY` | SET |
| `CLERK_SECRET_KEY` | NOT SET |
| `NEXT_PUBLIC_SUPABASE_URL` | NOT SET |
| `SUPABASE_SERVICE_ROLE_KEY` | NOT SET |
| `R2_ACCOUNT_ID` | NOT SET |
| `R2_ACCESS_KEY_ID` | NOT SET |
| `LIVEKIT_URL` | NOT SET |
| `LIVEKIT_API_KEY` | NOT SET |
| `LIVEKIT_API_SECRET` | NOT SET |
| `RAILWAY_API_TOKEN` | NOT SET |

## What Must Happen Before E2E GREEN

1. **Operator configures Clerk, Supabase, R2 env vars** in production deployment
2. **Gemini API quota restored** (paid tier or quota reset)
3. **Run real E2E smoke tests:**
   - Game creation: prompt → agent-loop → files → image gen → asset insert → build → preview
   - Image editing: existing asset → edit endpoint → persisted variant
   - Audio persistence: generate → R2 → reload → playback
   - Voice: configure LiveKit → token → connect → speak
4. **Verify Preview behavior** in browser: device modes, resize, refresh, runtime status

## Architecture Notes

- **Asset Lake** is the canonical asset facade. Maps `generation_jobs` → `StudioAsset`.
- **R2** is primary binary storage. Supabase Storage is fallback.
- **agent-loop-v2** emits `ProgressEvent`s via `ProgressEmitter` → SSE → `useExecutionStore` → `LiTTLiveActivity`. No fabricated activity.
- **LiTTWorkSummary** in ContextDrawer Work tab pulls REAL execution state from `useExecutionStore` (phase, events, tool calls, approvals, checkpoints, changes). Does NOT duplicate `LiTTLiveActivity`.
- **Terminal server** is the authoritative security boundary. `isBlockedCommand()` is never bypassed.
- **Deployment** is admin-only. Ordinary owners push code via git; admins trigger Railway deployments.

## Commits on studio/phase-2

1. `7b913601` feat(studio): Phase 1 — shell geometry reorientation
2. `0f37f459` fix(audio): persist generated audio to durable storage + Asset Lake
3. `b5f41905` feat(assets): Use in project — insert assets into workspace
4. `b06054b5` feat(preview): improve permanent Live Preview workspace
5. `bb67937c` feat(studio): expose real agent loop in Work tab
6. `cea22b1b` feat(voice): add LiveKit status to voice health + settings
7. `59b7d64d` feat(image): edit existing Asset Lake images with AI
8. `5055b5d5` docs: Studio Phase 2 capability status inventory
9. `97a2064e` fix(studio): repair 4 test regressions from Phase 2 changes
