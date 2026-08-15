# Ultra Vision Audit — Actual State vs. Target Architecture

**Date:** 2026-08-12
**Mode:** AUDIT ONLY — no code changes
**Repo:** `C:\Users\litbi\CascadeProjects\litlabs-website`
**Audited against:** User-supplied target table + `PHASE0_ARCHITECTURE_MAP.md` + `architecture.manifest.json` + direct file reads

---

## How to read this report

- **✅ Live** = real implementation, in production code path
- **🟡 Partial** = real code exists but incomplete, disabled, or not wired into the main loop
- **🔴 Missing** = no real implementation found (stubs/comments don't count)
- **⚠️ Hidden gem** = substantial implementation found under a different name than the target doc — **reuse, don't rebuild**

The single most important finding: **several items marked "missing" in the target table have real, substantial implementations under different names.** Reuse these.

---

## A. The Canonical Brain — Already Built

### A1. LiTT Runtime (one brain) — ✅ Live

The "one brain" architecture is **real and live**, not just a proposal.

**Key files:**
- `src/lib/litt-runtime/` — canonical runtime (`runtime.ts`, `prompt-builder.ts`, `execution-engine.ts`, `tool-planner.ts`, `result-verifier.ts`, `request-context.ts`, `provider-router.ts`, `audit-service.ts`, `response-stream.ts`)
- `src/lib/litt-kernel/` — intent router, prompt composer, capability registry, event bus, principles
- `src/lib/project-tools/registry.ts` — shared tool registry (40+ tools, see A3)
- `src/lib/llm-tool-calling.ts` — native function-calling loop
- `src/lib/vapi-tool-definitions.ts` — `LITT_BEHAVIOR_CONTRACT`

**Live entry points (confirmed via grep):**
- `/api/litt/run` → `runLiTT()` (Studio chat)
- `/api/vapi/turn` → `runLiTTForVoice()` (voice)
- `/api/litt/voice/v1/chat/completions` → `runLiTTStream()` (OpenAI-compatible endpoint)
- `/api/gemini/chat` → `runLiTTStream()` (Gemini companion)

**Note:** `litt-kernel` and `litt-runtime` are **two layers, not duplicates** — kernel is the prompt/intent/capability layer; runtime is the execution orchestrator. Both are live. The old `src/lib/litt/` dir is dead code (per Phase 0 map).

### A2. Voice/realtime — ✅ Live (with conditional fallback)

- `terminal-server/livekit-agent.ts` — LiveKit agent worker
- `src/app/api/voice/livekit-token/route.ts` — token issuance
- `src/lib/voice-runtime.ts` — voice adapter with `callLLMWithTools()` (up to 4 tool rounds)
- **Fallback:** if `OPENROUTER_API_KEY` unset, voice falls back to text-only `executeRun()` (no tool dispatch). LiveKit env vars are still listed as missing in AGENTS.md.

### A3. Project-tools registry — ✅ Live (40+ tools, not 23)

`src/lib/project-tools/registry.ts` has **40+ real handlers**, exceeding the claimed 23:
- Original 8 + browser job queue (4) + notifications (2) + git (5) + search/memory (2) + approval (1) + browser test (1) = 23 (the documented set)
- **Plus 17+ more:** `git_diff`, `git_log`, `create_checkpoint`, `restore_checkpoint`, `delete_file`, `create_directory`, `rename_file`, `apply_patch`, `start_preview_server`, `list_projects`, `create_project`, `switch_project`, `memory_search`, `run_command`, `web_search`, `web_fetch`, `github_search_code`, `github_list_pull_requests`, `github_read_file`

All handlers are real (no stubs found). The registry is production-ready.

---

## B. Existing Engines (the "half you already have")

| Area | Status | Key paths |
|------|--------|-----------|
| Image generation | ✅ | `src/app/studio/tools/ImageTool.tsx`, `/api/media/generate` |
| Video generation | ✅ | `src/app/studio/tools/VideoTool.tsx`, `/api/media/generate-video` |
| Music generation | ✅ | `src/app/studio/tools/MusicTool.tsx`, `/api/media/generate-music` |
| Audio/TTS | ✅ | `src/app/studio/tools/AudioTool.tsx`, `/api/media/generate-audio` |
| DesignCanvas | ✅ | `src/app/studio/components/canvas/` |
| 360° / Space | ✅ | (in tools dir) |
| Canvas workspace | ✅ | `src/lib/canvas/` (repository, actions, types) |
| CodeWorkspace | ✅ | Studio Code tab |
| Preview | ✅ | `StudioPreviewPanel.tsx`, `/api/studio-projects/[projectId]/preview/proxy` |
| LiTT chat | ✅ | `StudioTranscript.tsx`, `CommandComposer.tsx`, `/api/studio/conversations/*/messages` (real SSE) |
| Terminal | 🟡 | infra exists, **disabled by flag** (see C6) |
| Clerk auth | ✅ | `ClerkProvider` in layout |
| Provider integrations | ✅ | OpenRouter, Gemini, Together, Fal, MiniMax, Alibaba |
| Upload/gallery/media history | ✅ | `/api/gallery`, `/api/media/*` (22 routes) |

**These are real and should be preserved, not rebuilt.**

---

## C. The Integration Layer — What's Actually Missing vs. Hidden

### C1. Unified Plan → Canvas → Code → Preview shell — 🟡 Partial

- Tabs exist (Canvas, Code, Preview in `CommandStudio.tsx`; Plan, Changes, Files, Preview, Checks, Approvals in `StudioWorkspaceFrame.tsx`)
- **Missing:** no sequential staged pipeline. It's a tab switcher, not a Plan→Canvas→Code→Preview flow.
- **Reuse:** the tab components are the right primitives; the missing piece is the *stage orchestration*, not the surfaces.

### C2. LiTT Chat/Live permanent LEFT panel — 🔴 (it's a right panel, collapsible)

- `LiTTPanel.tsx` is a **right** panel (`border-l`), with Chat + Live tabs, and an `onClose`.
- Left sidebar is `CommandStudioNav.tsx` (nav rail, not chat).
- **Gap:** target wants LiTT chat as a permanent left panel. Current is a closable right panel.

### C3. Shared Asset Lake — 🔴 Missing (fragmented)

- No `/api/assets` facade. Assets are siloed: `/api/media/*` (generation), `/api/gallery/*` (user gallery), `visual-builds/repository.ts` (build artifacts).
- **Hidden gem:** `visual-builds` has an `AssetManifest` system (`types.ts`, `repository.ts`) that tracks assets per build with inspection/checksum/attribution. **This is the seed of an asset lake** — generalize it, don't start from zero.

### C4. Creator cross-handoff — 🔴 Missing

- Creators (image/video/audio/music) are siloed tools. No handoff mechanism (e.g., image → canvas, video → code).
- **Reuse angle:** the Asset Lake (C3) is the prerequisite — once assets are unified, handoff becomes "reference an asset ID from another creator."

### C5. Game Creator — 🔴 Missing (as first-class creator)

- `src/lib/games.ts` = 10-game HTML5 arcade **catalog** (not a creator)
- `VisualCanvasBuilder.tsx` has a "Game Studio Coming in Phase 2" placeholder
- `src/lib/emulator/` (24k lines: control-profiles, rom-validation, runtime-bridge, watchdogs) = **emulator runtime infrastructure, not a creator**
- `src/components/games/` = arcade UI (GameGrid, GameLibrary, GamePreview, Leaderboard)
- **Gap:** no `GameTool.tsx`, no game creator in tool registry, no `/studio/game` route.
- **Reuse:** the emulator + arcade + games.ts are the *runtime* layer; the missing piece is the *creator* surface.

### C6. Production-faithful sandbox — 🟡 Partial (disabled by flag, alpha when enabled)

- `src/lib/terminal-v1/` = full control plane (15 files): `SandboxProvider` interface, `docker-provider.ts` (14k, real: resource limits, read-only rootfs, tmpfs, env allowlist), `disabled-provider.ts`, `workspace-service.ts`, `quota-service.ts`, `secret-broker.ts`, `preview-gateway.ts`, `github-clone.ts`
- `terminal-server/docker-manager.ts` = legacy Docker manager
- **State:** `TERMINAL_PROVIDER` defaults to `disabled`. Docker provider requires `managed-sandbox` to activate. Railway can't run Docker-in-Docker (per `knownFollowUps`).
- **Gap:** not production-faithful by default; needs a Docker-capable host or E2B/Fly.io provider (ADR proposes E2B for public release).

### C7. Mission branches — 🟡 Partial (missions system exists, mission-scoped branching doesn't)

**⚠️ Hidden gem — the missions system is substantial and real.**

- `src/lib/missions/mission-service.ts` (14k) — full persistence: missions, runs, steps, approvals, validation results
- `src/lib/missions/mission-repository.ts` (19k) — DB layer + checkpoints
- `src/lib/missions/mission-executor.ts` (16k) — executor
- `src/lib/missions/workspace-checkpoint.ts` — git-based checkpoint creation
- **What exists:** mission → run → steps (with `waiting_approval` state) → validation gates (typecheck/lint/test/build) → approval resolution. This is a real multi-step task execution system.
- **What's missing:** "mission branches" = auto-creating a git branch per mission (`mission/<id>`). The branch tracking in `mission-control.ts` is standard git branches, not mission-scoped feature branches.
- **Reuse:** the entire missions system is the backbone for Ultra Vision's task/dependency queue. Add branch-per-mission on top; don't rebuild.

### C8. Project checkpoints / time machine — 🟡 Partial (real, no UI)

- `/api/studio-projects/[projectId]/checkpoints` — GET list / POST create
- `mission-repository.ts` — `createCheckpoint()`, `listCheckpoints()`, `getCheckpoint()`
- `/api/studio/rollback` — rollback via `restore_checkpoint` tool (git reset --hard)
- `project_checkpoints` table — git SHA + label + description
- **What's missing:** visual timeline UI, automatic periodic snapshots, diff viewer.
- **Reuse:** the checkpoint + restore mechanism is real. Add the timeline UI + auto-snapshots on top.

### C9. Automated browser verification — 🟡 Partial (suite exists, not wired to agent loop)

- `playwright.config.ts` + `tests/playwright/` = 27 spec files (accessibility, billing, chat, studio, terminal, visual regression)
- `src/lib/litt-intelligence/browser-tool-handlers.ts` = 16 browser tools using **Stagehand** (CDP-based, not Playwright)
- `/studio/visual-test` = seeded UI mock (not real verification)
- **Gap:** Playwright tests run separately, not triggered by agent actions. No agent-driven "run tests → read failures → fix → re-run" loop.
- **Reuse:** both the Playwright suite AND the Stagehand browser tools are reusable. The missing piece is the *wiring* into the LiTT loop.

### C10. Self-healing QA loop — ⚠️ Hidden gem (exists, scoped to visual builds)

**The second subagent missed this — it only checked `useSelfHeal.ts`. The real self-healing loop is in `visual-builds/`.**

- `src/lib/visual-builds/orchestrator.ts` (25k) — full pipeline: plan → acquire assets → build → **capture (Chrome)** → **review (`reviewCaptures`)** → **repair (`applyRepairToSource`)** → re-capture → completion gate (`evaluateCompletionGate`)
- `src/lib/visual-builds/qa.ts` (10k) — `reviewCaptures()` scores captures (overflow, broken images, console errors, missing fonts), `applyRepairToSource()` applies fixes, `evaluateCompletionGate()` decides pass/repair
- `src/lib/visual-builds/capture.ts` (11k) — Chrome preview capture (console errors, page errors, failed requests, horizontal overflow, broken images, missing fonts, layout shifts)
- **What exists:** a real self-healing loop for visual builds, with repair passes and viewport captures (desktop + mobile).
- **What's missing:** generalization beyond visual builds to arbitrary code changes (the "self-healing Playwright loop" for any agent edit).
- **Reuse:** this is the template. Generalize `reviewCaptures` + `applyRepairToSource` into a code-change self-healing loop.

### C11. Full LiTT task/dependency queue — 🟡 Partial

- `src/lib/agent-work-queue.ts` — real queue with claim/complete/retry + cost cap
- `src/lib/agent-worker.ts` — polling worker with basic dependency check
- `src/lib/director-graph.ts` — **hardcoded 4-step planner** (not a real DAG)
- `src/lib/missions/` — the real multi-step execution system (see C7)
- **Gap:** `director-graph.ts` is a simple hardcoded planner, not a dependency-aware DAG. The missions system has steps but not a full dependency scheduler.
- **Reuse:** `agent-work-queue` + `missions` are the foundation. Replace `director-graph` with a real DAG planner.

### C12. Git/GitHub operations — ✅ Exists (basic sync, no Ultra Vision workflow)

- `/api/github/sync`, `/api/github/webhook` (341 lines: push, PR, workflow_run, issues)
- `src/lib/github-app.ts`, `github-install-state.ts`
- Git tools in registry (real): `git_status`, `create_branch`, `commit_changes`, `push_branch`, `create_pull_request`, `git_diff`, `git_log`, `create_checkpoint`, `restore_checkpoint`
- GitHub tools: `github_search_code`, `github_list_pull_requests`, `github_read_file`
- **Gap:** no "Ultra Vision workflow" (e.g., mission → branch → PR → merge → deploy pipeline). Just standard sync.

### C13. Deploy pipeline — 🟡 Manual

- `vercel.json` (standard), `agents/deploy-agent/deploy.sh` (per AGENTS.md, has the `npx` PATH fix)
- `request_deployment_approval` tool = **request-only** (records a row, returns `pending_approval`). No tool performs a deploy.
- **Gap:** no agent-driven deploy. Deploy is manual via Vercel git push.

---

## D. The "Missing" Advanced Layer — Confirmed Missing

These are genuinely absent (no hidden implementations found):

| Item | Status | Note |
|------|--------|------|
| Figma → deterministic design → code | 🔴 | Only a CSS comment + intent keyword. No pipeline. |
| Click UI → exact source mapping | 🔴 | `StudioInspector` is a canvas property inspector, not DOM-to-source. |
| Merkle repo synchronization | 🔴 | No Merkle/content-addressable code. |
| Tree-sitter / AST semantic indexing | 🔴 | `code-scanner.ts` is a **stub with hardcoded mock data**, not real AST parsing. |
| Trigram code-search index | 🔴 | `search_code` tool uses plain `rg` (no `--index`, no trigram). |
| Hybrid WebContainer + cloud microVM | 🔴 | Docker provider exists (C6); no WebContainer, no E2B/Fly.io (ADR-only). |
| Zero-trust automatic server proxying | 🔴 | `scripts/cf-add-ingress.cjs` is for the site's own ingress, not user servers. |
| Automated security/deep scan | 🔴 | `SECURITY_INVENTORY.md` documents P0s but no scanner is wired in. Agent loop has basic auto-inspection only. |
| Natural-language infra provisioning | 🔴 | No Terraform/Pulumi. No "give me a Postgres" flow. |
| Project design-system memory | 🔴 | Static `design-tokens.ts` + generic `remember_project_context`. No token inference/persistence. |
| Production diagnostics correlation | 🔴 | Basic Sentry only. No error-to-source correlation. |

---

## E. Reuse-vs-Build Recommendations

### Reuse / extend (don't rebuild):
1. **LiTT Runtime** (`litt-runtime` + `litt-kernel`) — already the one brain. Ultra Vision flows through it.
2. **Missions system** (`missions/`) — extend with mission-scoped branches + DAG planner. This is the task/dependency queue backbone.
3. **Checkpoints** (`project_checkpoints` + `restore_checkpoint`) — add timeline UI + auto-snapshots.
4. **Visual-builds self-healing loop** (`visual-builds/orchestrator.ts` + `qa.ts`) — generalize to arbitrary code changes.
5. **AssetManifest** (`visual-builds/repository.ts`) — generalize into the unified Asset Lake.
6. **terminal-v1 Docker provider** — enable + migrate to Docker-capable host (or swap to E2B via the `SandboxProvider` interface).
7. **Stagehand browser tools** (16 tools) + **Playwright suite** (27 tests) — wire into the agent loop for self-healing verification.
8. **project-tools registry** (40+ tools) — already production-ready; add new tools as needed.

### Build new:
1. **Game Creator** — first-class Studio tool (the runtime layer exists in `emulator/` + `games.ts`).
2. **`/api/assets` facade** — unified asset API (build on AssetManifest).
3. **Plan→Canvas→Code→Preview stage orchestration** — the tabs exist; the stage flow doesn't.
4. **LiTT permanent left panel** — move/copy `LiTTPanel` to left, make non-closable.
5. **Mission branches** — auto `mission/<id>` branch creation.
6. **DAG planner** — replace hardcoded `director-graph.ts`.
7. **Agent-driven deploy** — beyond the request-only approval tool.
8. **All of Section D** — the advanced indexing/Figma/Merkle/AST/zero-trust/security-scan/NL-infra layer is genuinely greenfield.

---

## F. Bottom Line

You have **~60% of the foundation**, not 50% — because the target table didn't count the missions system, checkpoints, visual-builds self-healing loop, terminal-v1 sandbox, or the 40+ tool registry as existing.

The real gap is the **integration layer** (unified shell, asset lake, cross-handoff, stage orchestration) and the **advanced indexing/provisioning layer** (Section D, all genuinely missing).

**Do not rebuild:** LiTT Runtime, missions, checkpoints, visual-builds QA, terminal-v1, project-tools registry, AssetManifest.
**Do build:** Game Creator, `/api/assets`, stage orchestration, DAG planner, mission branches, and everything in Section D.
