# Studio Phase 2 Capability Status

**Branch:** `studio/phase-2`
**Date:** 2026-08-27 (final acceptance audit)
**Principle:** If LiTT advertises it, the user can actually use it.

## Acceptance Audit Results

- **Branch integrity:** 10 commits, clean working tree, no contamination
- **Typecheck:** 3 pre-existing errors in `packages/litt-cli` (NOT in Studio code)
- **Lint:** 0 errors, 82 warnings (all pre-existing)
- **Tests:** 3211 passed, 6 failed (all 6 pre-existing on origin/main), 52 skipped
- **Build:** Production build passes (exit 0)
- **Production health:** `https://litlabs.net/api/health` → status ok, database ok, terminal ok, storage ok (R2)
- **E2E smoke tests:** NOT RUN — Studio API routes require Clerk auth; browser E2E requires authenticated session

## Production Environment Configuration (Railway + Vercel)

Verified via Railway CLI and production health endpoints. No secret values reported.

### Clerk (Authentication)
| Variable | Status |
|---|---|
| `CLERK_SECRET_KEY` | SET |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | SET |
| `CLERK_PUBLISHABLE_KEY` | SET |

### Supabase (Database + Storage Fallback)
| Variable | Status |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | SET |
| `SUPABASE_SERVICE_ROLE_KEY` | SET |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | SET |

### R2 (Primary Binary Storage)
| Variable | Railway | Vercel (inferred) |
|---|---|---|
| `R2_ACCOUNT_ID` | NOT SET (empty) | SET (health confirms R2) |
| `R2_ACCESS_KEY_ID` | NOT SET (empty) | SET |
| `R2_SECRET_ACCESS_KEY` | NOT SET (empty) | SET |
| `R2_BUCKET_NAME` | NOT SET (empty) | SET |

> Note: R2 is configured on the Vercel production deployment (confirmed by `/api/health` reporting `storage: ok, detail: R2`). Railway services do not have R2 vars. The Studio API routes run on Vercel, so R2 IS available in production.

### LiveKit (Voice)
| Variable | Status |
|---|---|
| `LIVEKIT_URL` | SET |
| `LIVEKIT_API_KEY` | SET |
| `LIVEKIT_API_SECRET` | SET |

### Railway Deploy Integration
| Variable | Status |
|---|---|
| `RAILWAY_API_TOKEN` | NOT SET |
| `RAILWAY_SERVICE_ID` | SET (on Railway web service) |

### Generation Providers
| Variable | Status |
|---|---|
| `GEMINI_API_KEY` | SET |
| `OPENAI_API_KEY` | SET |
| `MINIMAX_API_KEY` | SET |
| `INWORLD_API_KEY` | SET (voice proxy) |
| `ELEVENLABS_API_KEY` | NOT SET (empty) |
| `FAL_KEY` | NOT SET (empty) |
| `TOGETHER_API_KEY` | NOT SET (empty) |

## Provider Health / Quota (tested directly)

| Provider | Capability | Status |
|---|---|---|
| Gemini | Text generation | CONFIGURED + HEALTHY |
| Gemini | TTS (audio) | CONFIGURED + HEALTHY (161KB PCM returned) |
| Gemini | Image generation | CONFIGURED + QUOTA BLOCKED (free tier limit: 0) |
| OpenAI | Text/models | CONFIGURED + HEALTHY |
| LiveKit | Voice rooms | CONFIGURED (not E2E tested) |
| Inworld | Voice proxy | CONFIGURED + HEALTHY (voice-proxy health ok) |
| Minimax | Music/video | CONFIGURED (not directly tested) |

> Image generation quota exhaustion is specific to Gemini image models. Gemini TTS and text generation are healthy. Do not generalize the image quota error to other Gemini capabilities.

## E2E Test Results

### Studio Live Runtime (C)
- **Dev server:** Started locally with Railway env vars, health OK
- **Clerk auth:** Configured in production; local dev server loads but Studio routes require authenticated session
- **Browser preview:** Opened; Studio requires login
- **Result:** BLOCKED — cannot complete authenticated E2E without a Clerk session token

### Live Preview Acceptance (D)
- **Routing tests:** 3/3 StudioPreviewPanel tests pass
- **Browser E2E:** NOT RUN — requires authenticated Studio session
- **Result:** YELLOW — code and unit tests pass, but browser-based resize/device/refresh verification not completed

### Audio Persistence E2E (E)
- **Gemini TTS:** HEALTHY (direct API test returned 161KB audio)
- **R2 storage:** Configured in production (Vercel)
- **Full chain E2E:** NOT RUN — requires authenticated Studio session
- **Unit test:** audio-lab.test.ts passes (verifies no base64 in localStorage, durable URL handling)
- **Result:** YELLOW

### Image Edit E2E (F)
- **Gemini image generation:** QUOTA BLOCKED
- **Full chain E2E:** NOT RUN — requires both auth and Gemini image quota
- **Result:** YELLOW

### Use-in-Project E2E (G)
- **Full chain E2E:** NOT RUN — requires authenticated Studio session
- **Result:** YELLOW

### Game Creation E2E (H)
- **Prerequisites:** Image generation (QUOTA BLOCKED), auth (no session)
- **Full chain E2E:** NOT RUN
- **Agent-loop integration tests:** 65/65 pass (file editing, checkpointing, shell execution, build-fix loops with mock transports)
- **Result:** YELLOW

### Voice E2E (I)
- **LiveKit:** CONFIGURED (all 3 vars SET)
- **Voice proxy:** HEALTHY (Inworld configured, auth configured)
- **Full voice E2E:** NOT RUN — requires authenticated Studio session + LiveKit room connection
- **Result:** YELLOW

## Final Capability Classification

### GREEN — Proven via tests or mature production capability

| Capability | Evidence |
|---|---|
| Chat | Routing tests pass; Gemini text HEALTHY |
| Plan | Routing tests pass |
| Act | 65 agent-loop tests pass |
| Agents | Agent registry tests pass |
| Files | Routing tests pass |
| Inspector | Routing tests pass |
| Activity | Routing tests verify single LiTTLiveActivity + real exec store in WorkSummary |
| Terminal | Terminal-server health OK in production; 2 pre-existing test failures disclosed below |
| Single-file Missions | Executor implemented and tested |

> **Terminal disclosure:** `tests/terminal-server-regression.test.ts` has 2 pre-existing failures (confirmed on `origin/main`): `/ask` toolIds exposure and identity-aware approval security. These are NOT introduced by `studio/phase-2`. The production terminal-server health endpoint reports `status: ok, authConfigured: true, readiness: ready`.

### YELLOW — Code exists, unit tests pass, but real E2E not completed

| Capability | Code exists | Unit tests | E2E run | Blocker |
|---|---|---|---|---|
| Preview | Yes | 3/3 pass | NO | Browser E2E needs auth session |
| Image generation | Yes | — | NO | Gemini image quota BLOCKED |
| Image editing | Yes | — | NO | Gemini image quota BLOCKED |
| Video | Yes | — | NO | E2E not run |
| Audio | Yes | 19/19 pass | NO | Auth session needed for full chain |
| Music | Yes | — | NO | E2E not run |
| Assets | Yes | — | NO | Auth session needed |
| Use in project | Yes | — | NO | Auth session needed |
| Game/App creation | Yes | 65 agent-loop | NO | Image quota + auth session |
| Voice | Yes | — | NO | Auth session + LiveKit room |
| Multi-step Missions | Partial | — | NO | Graph executor not implemented |
| Deployment (ordinary users) | Partial | — | NO | RAILWAY_API_TOKEN NOT SET |

### RED — Not functional

| Capability | Reason |
|---|---|
| Workflows / graph execution | No graph interpreter/executor exists. Not advertised. |

## What Must Happen Before YELLOW → GREEN

1. **Obtain a Clerk session token** for E2E testing (operator-assisted login or test token)
2. **Restore Gemini image generation quota** (paid tier or quota reset)
3. **Run real E2E smoke tests** in this order:
   - Preview: browser test with auth (resize, device modes, refresh, runtime status)
   - Audio: generate → R2 → reload → playback → use-in-project
   - Image editing: existing asset → edit endpoint → persisted variant → use-in-project
   - Game creation: prompt → agent-loop → files → image gen → asset insert → build → preview → iterate
   - Voice: LiveKit token → room → STT → LiTT → TTS → response
4. **Configure RAILWAY_API_TOKEN** for ordinary-user deployment

## Architecture Notes

- **Asset Lake** is the canonical asset facade. Maps `generation_jobs` → `StudioAsset`.
- **R2** is primary binary storage (Vercel production). Supabase Storage is fallback.
- **agent-loop-v2** emits `ProgressEvent`s via `ProgressEmitter` → SSE → `useExecutionStore` → `LiTTLiveActivity`. No fabricated activity.
- **LiTTWorkSummary** in ContextDrawer Work tab pulls REAL execution state from `useExecutionStore`. Does NOT duplicate `LiTTLiveActivity`.
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
10. `5244cca9` docs: update capability status after acceptance audit
