# P0 Current State — Real Audit

> Audit date: Aug 2026. Existing code does not equal working.

## Status legend

```
PROVEN_WORKING         — verified in production, tested, reliable
IMPLEMENTED_UNVERIFIED — code exists but not tested in production
PARTIAL                — some paths work, others broken or incomplete
BROKEN                 — code exists but does not function
NOT_STARTED            — no implementation
```

## Systems audit

### 1. Canonical LiTT Runtime

**Status: PARTIAL**

Two runtime paths exist:
- **V2 path** (`agent-loop-v2.ts`): Multi-step tool-calling loop with native structured tools, loop detection, checkpoints, build-fix. Used when `workspaceExecutionAvailable` is true.
- **V1 fallback** (`agent-loop.ts`): Pre-LLM auto-inspection, enriches prompt with read-only tool results, then single LLM call. Used when no workspace.

| Component | Status | Files |
|---|---|---|
| Agent Loop V2 | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/agent-loop-v2.ts` (930 lines) |
| Agent Loop V1 | PARTIAL (fallback) | `src/lib/litt-intelligence/agent-loop.ts` |
| Tool Registry | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/tool-registry.ts` (1143 lines) |
| Permission Engine | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/permission-engine.ts` |
| Build-Fix Loop | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/build-fix-loop.ts` |
| Progress Events | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/progress-events.ts` |
| Workspace Transport | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/workspace-transport.ts` |
| Canonical Runtime Context | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/canonical-runtime-context.ts` |
| Paused Run Store | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/paused-run-store.ts` |

**Known blockers:**
- V2 only activates when workspace execution is available. Many users hit V1 fallback.
- No production verification of V2 multi-step behavior at scale.
- Tests exist (7 test files) but integration coverage is limited.

**Next required action:** Verify V2 path works end-to-end with a real workspace. Test multi-step tool calling, build-fix, and approval pause/resume in production.

---

### 2. Studio Text Chat

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Messages API route | PROVEN_WORKING | `src/app/api/studio/conversations/[conversationId]/messages/route.ts` (657 lines) |
| SSE streaming | PROVEN_WORKING | Same route, uses ReadableStream + text/event-stream |
| Conversation store | IMPLEMENTED_UNVERIFIED | `src/app/studio/stores/useConversationStore.ts` |
| Studio Transcript | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/StudioTranscript.tsx` |
| Composer | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/CommandComposer.tsx` |
| Revision control | PROVEN_WORKING | RPC `try_increment_conversation_revision` |
| Idempotent messages | PROVEN_WORKING | `clientRequestId` dedup |
| Memory recall/persist | IMPLEMENTED_UNVERIFIED | `src/lib/studio/memory-service.ts` |

**Known blockers:**
- Activity events stream as `tool_execution` and `phase` SSE events but no dedicated activity card UI exists. Events are rendered as generic tool activity.
- No structured artifact parts — messages are still `content: string`.

**Next required action:** Build activity card UI that renders streaming events as a live timeline. Add structured message parts.

---

### 3. Studio Voice

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| VoiceSessionContext | IMPLEMENTED_UNVERIFIED | `src/app/studio/context/VoiceSessionContext.tsx` (1121 lines) |
| Inworld session | IMPLEMENTED_UNVERIFIED | `src/features/voice/hooks/useInworldSession.ts` |
| Voice store | IMPLEMENTED_UNVERIFIED | `src/features/voice/store/useVoiceStore.ts` |
| Voice runtime adapter | IMPLEMENTED_UNVERIFIED | `src/lib/voice/voice-runtime.ts` (217 lines) |
| Voice session service | IMPLEMENTED_UNVERIFIED | `src/lib/voice/voice-session-service.ts` (249 lines) |
| Voice health check | IMPLEMENTED_UNVERIFIED | `src/app/api/litt/voice/health/route.ts` |
| VAD | IMPLEMENTED_UNVERIFIED | `src/features/voice/lib/voice-vad.ts` |
| Transcript validation | IMPLEMENTED_UNVERIFIED | `src/features/voice/lib/transcript-validation.ts` |

**Architecture:** Push-to-talk only. Inworld for STT/TTS. Transcript appears as editable draft → user sends. Voice runtime adapter bridges to canonical LiTT pipeline (same prompt builder, memory, tools).

**Known blockers:**
- Voice uses Inworld, NOT the same SSE streaming as text. Voice goes through `/api/litt/voice/v1/chat/completions` (OpenAI-compatible endpoint).
- Text and voice share the same runtime adapter (`voice-runtime.ts` calls `buildPrompt` + `executeRun`), but the streaming paths are different.
- No text→voice→text continuity test exists.
- Ghost transcription issues were addressed but may recur.

**Next required action:** Verify voice turns produce messages in the same conversation as text. Test text→voice→text continuity. Ensure voice activity events map to canonical activity states.

---

### 4. Vapi Phone

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Voice session service | IMPLEMENTED_UNVERIFIED | `src/lib/voice/voice-session-service.ts` |
| Vapi tool definitions | IMPLEMENTED_UNVERIFIED | `src/lib/vapi-tool-definitions.ts` |
| Vapi tools | IMPLEMENTED_UNVERIFIED | `src/lib/vapi-tools.ts` |
| Voice chat completions | IMPLEMENTED_UNVERIFIED | `src/app/api/litt/voice/v1/chat/completions/route.ts` (263 lines) |

**Architecture:** Phone caller → Vapi → `/api/litt/voice/v1/chat/completions` → LiTT Runtime. Phone number resolved to user via `voice-session-service.ts`. Session maps caller to user/project/conversation.

**Known blockers:**
- Phone-to-user resolution depends on phone number being linked to Clerk account.
- No production verification of phone calls working end-to-end.
- Vapi and Studio voice (Inworld) are different transports — both should use same runtime, but continuity between phone and Studio text is untested.

**Next required action:** Test phone call → LiTT response → message appears in Studio conversation. Verify same user/project/conversation across phone and web.

---

### 5. Conversation Persistence

**Status: PROVEN_WORKING**

| Component | Status | Files |
|---|---|---|
| Conversation service | PROVEN_WORKING | `src/lib/studio/conversation-service.ts` |
| Messages table | PROVEN_WORKING | `studio_conversations`, `studio_conversation_messages` |
| Revision control | PROVEN_WORKING | RPC-based atomic increment |
| Idempotent insert | PROVEN_WORKING | `clientRequestId` dedup |

**Next required action:** Add `parts` JSONB column for universal artifacts.

---

### 6. Project Context

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Project resolver | IMPLEMENTED_UNVERIFIED | `src/lib/studio/project-resolver.ts` |
| Studio context builder | IMPLEMENTED_UNVERIFIED | `buildStudioContext` in messages route |
| Capabilities | IMPLEMENTED_UNVERIFIED | `src/lib/capabilities/translate.ts` |
| Connection summary | IMPLEMENTED_UNVERIFIED | `src/app/studio/hooks/useConnectionSummary.ts` (282 lines) |

**Known blockers:**
- Project context depends on workspace being provisioned. Many users may not have a workspace.
- Connection summary aggregates many states (terminal, voice, GitHub, providers) but is client-side only.

**Next required action:** Verify project context resolution works for blank/template projects (not just GitHub-connected).

---

### 7. Memory

**Status: IMPLEMENTED_UNVERIFIED**

| Component | Status | Files |
|---|---|---|
| Memory service | IMPLEMENTED_UNVERIFIED | `src/lib/studio/memory-service.ts` |
| Recall/persist | IMPLEMENTED_UNVERIFIED | `recallMemories`, `persistMemory`, `formatMemoryContext` |

**Known blockers:**
- Memory is conversation-scoped summaries. No skill graph, no user learning profile.
- No verification that memories are actually recalled and influence responses.

**Next required action:** Verify memory recall works in production. Test that LiTT references prior context across sessions.

---

### 8. Universal Artifacts

**Status: NOT_STARTED**

No `parts` column on messages. No structured message parts. All content is `string`.

**Next required action:** Add `parts` JSONB column. Implement `MessagePart` types. Update transcript rendering.

---

### 9. In-chat Image Generation

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Generate route | IMPLEMENTED_UNVERIFIED | `src/app/api/studio/generate/route.ts` (154 lines) |
| Image Studio | IMPLEMENTED_UNVERIFIED | `src/app/studio/tools/ImageTool.tsx` |
| Providers | PARTIAL | Pollinations (free, no key), Google GenAI (Imagen) |

**Known blockers:**
- Image generation exists as a separate tool, not as in-chat artifact generation.
- No `ImagePart` in messages. Results are URLs returned to Image Studio, not chat.
- fal.ai integration mentioned in previous session but not found in current audit.

**Next required action:** Wire image generation into chat as a tool. Return `ImagePart` in assistant message.

---

### 10. Activity Streaming

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Progress events | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/progress-events.ts` (58 lines) |
| SSE event streaming | IMPLEMENTED_UNVERIFIED | Messages route streams `tool_execution`, `phase`, `build_start`, `build_result`, `checkpoint`, `approval_required` events |
| Activity store | IMPLEMENTED_UNVERIFIED | `src/app/studio/stores/useActivityStore.ts` |

**Known blockers:**
- Events stream but no dedicated activity card UI. Events render as generic tool activity in transcript.
- No `LiTTActivityEvent` canonical type system as specified in `LITT_ACTIVITY_STATES.md`.
- No reconnection API (`GET /api/litt/run/:runId/state`).
- No mascot state binding.
- Progress events are V2-only. V1 path doesn't emit structured events.

**Next required action:** Build activity card component. Map existing progress events to canonical activity states. Add reconnection API.

---

### 11. PLAN / ACT / AUTO Enforcement

**Status: IMPLEMENTED_UNVERIFIED**

| Component | Status | Files |
|---|---|---|
| Permission engine | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/permission-engine.ts` (153 lines) |
| Permission gate | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/permission-gate.ts` |
| Approval flow | IMPLEMENTED_UNVERIFIED | Paused run store + approvals API route |
| Tests | IMPLEMENTED_UNVERIFIED | `permission-engine.test.ts`, `approval-resume.test.ts` |

**Architecture:** PLAN = read-only. ACT = mutations with approval for sensitive ops. AUTO = auto-approve safe ops, same security boundary as ACT. Terminal server's `isBlockedCommand()` remains authoritative.

**Known blockers:**
- Enforcement is in V2 path only. V1 fallback has no permission enforcement.
- No production verification that approvals actually pause/resume correctly.

**Next required action:** Verify approval pause/resume in production. Ensure V1 fallback either enforces permissions or is removed.

---

### 12. Workspace

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Workspace transport | IMPLEMENTED_UNVERIFIED | `src/lib/litt-intelligence/workspace-transport.ts` |
| Terminal server | PARTIAL | External Railway service |
| Terminal drawer | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/StudioTerminalDrawer.tsx` |
| Terminal store | IMPLEMENTED_UNVERIFIED | `src/stores/useTerminalStore.ts` |

**Known blockers:**
- Workspace requires external terminal server (Railway). If server is down, workspace is unavailable.
- V2 only activates when workspace is available. Without workspace, V1 fallback (no tools, no mutations).
- Terminal PTY connection is fragile — many failure stages tracked in `useConnectionSummary`.

**Next required action:** Verify workspace provisioning for new users. Test terminal reliability. Ensure V2 path is the default, not the exception.

---

### 13. GitHub Integration

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| GitHub connection | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/GitHubProjectConnection.tsx` |
| Project source selector | IMPLEMENTED_UNVERIFIED | `src/components/studio/ProjectSourceSelector` |
| Git tools (V2) | IMPLEMENTED_UNVERIFIED | `git.status`, `git.diff`, `git.log`, `git.commit` in tool registry |

**Known blockers:**
- GitHub is one of several project sources (github, blank, template, upload).
- Not all users will have GitHub connected.
- Git push/PR tools not in registry (only status/diff/log/commit).

**Next required action:** Verify GitHub-connected projects work with V2 agent loop. Test git operations through workspace transport.

---

### 14. Files

**Status: IMPLEMENTED_UNVERIFIED**

| Component | Status | Files |
|---|---|---|
| Project files panel | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/StudioProjectFiles.tsx` |
| File tools (V1) | IMPLEMENTED_UNVERIFIED | `files.list`, `files.read`, `files.write` in tool registry |
| File tools (V2) | IMPLEMENTED_UNVERIFIED | `files.delete`, `files.mkdir`, `files.rename`, `apply_patch`, `search_code` |

**Next required action:** Verify file operations work through workspace transport in production.

---

### 15. Code Editor

**Status: IMPLEMENTED_UNVERIFIED**

| Component | Status | Files |
|---|---|---|
| Code workspace | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/code/CodeWorkspace.tsx` (502 lines) |
| Monaco editor | IMPLEMENTED_UNVERIFIED | `@monaco-editor/react` (dynamic import) |
| Split view | IMPLEMENTED_UNVERIFIED | Code + Preview split |
| File tree | IMPLEMENTED_UNVERIFIED | In CodeWorkspace |

**Next required action:** Verify code editing works with workspace files. Test save/refresh cycle.

---

### 16. Canvas

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Canvas panel | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/canvas/CanvasPanel.tsx` (363 lines) |
| Canvas store | IMPLEMENTED_UNVERIFIED | `src/app/studio/stores/useCanvasStore.ts` |
| Visual Canvas Builder | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/canvas/builder/VisualCanvasBuilder.tsx` |
| Canvas API | IMPLEMENTED_UNVERIFIED | `src/app/api/canvases/` (5 route files) |
| Block renderer | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/canvas/BlockRenderer.tsx` |
| Revision history | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/canvas/RevisionHistory.tsx` |

**Known blockers:**
- Canvas has blocks, revisions, and promote-to-project. But it's a visual mockup tool, not a true code-connected visual editor.
- Canvas blocks don't map to actual source code components.
- No AI-driven canvas manipulation from chat (canvas actions exist in store but not wired to agent loop).

**Next required action:** Connect canvas blocks to source code. Wire agent loop to canvas operations. Verify promote-to-project works.

---

### 17. Preview

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Preview workspace | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/PreviewWorkspace.tsx` (834 lines) |
| Preview panel | IMPLEMENTED_UNVERIFIED | `src/app/studio/components/StudioPreviewPanel.tsx` |
| Device presets | IMPLEMENTED_UNVERIFIED | Desktop, Laptop, Tablet, Mobile |
| Start/stop | IMPLEMENTED_UNVERIFIED | Preview state machine: idle → starting → running → failed → offline |

**Known blockers:**
- Preview depends on workspace being provisioned and dev server running.
- Preview start has multiple steps with failure states.
- No verification that preview reliably starts for new users.

**Next required action:** Verify preview starts reliably for blank/template projects. Test mobile preview. Measure time-to-preview.

---

### 18. Quick Build

**Status: NOT_STARTED**

No onboarding route. No `/build` route. No build progress screen. No post-build action bar.

The `BuilderTool.tsx` is a project picker + generation prompt, not a guided Quick Build flow.

**Next required action:** Build the entire Quick Build flow per `QUICK_BUILD.md` spec.

---

### 19. Truth Layer

**Status: NOT_STARTED**

No evidence collection. No verification receipts. No `VerificationPart` in messages.

The build-fix loop (`build-fix-loop.ts`) runs checks (typecheck, lint, test, build) and can feed errors back for repair. But results are not persisted as verification receipts.

**Next required action:** Add evidence collection after agent runs. Render verification receipts in transcript.

---

### 20. Verification Receipts

**Status: NOT_STARTED**

No receipt rendering. No `VerificationCheck` type. No receipt card UI.

**Next required action:** Build receipt card component. Attach to assistant messages after tool execution.

---

### 21. Checkpoints

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Workspace checkpoint | IMPLEMENTED_UNVERIFIED | `src/lib/missions/workspace-checkpoint.ts` (109 lines) |
| Mission checkpoint | IMPLEMENTED_UNVERIFIED | `src/lib/missions/mission-repository.ts` (`createCheckpoint`) |
| V2 checkpoint | IMPLEMENTED_UNVERIFIED | `agent-loop-v2.ts` emits `checkpoint` events |
| Git checkpoint | IMPLEMENTED_UNVERIFIED | Uses terminal server git operations |

**Known blockers:**
- Checkpoints exist in mission context and V2 agent loop, but no user-facing rollback UI.
- No `studio_checkpoints` table (spec'd in `TRUTH_LAYER.md`).
- No rollback API endpoint.

**Next required action:** Add rollback API. Build rollback UI in transcript. Verify checkpoints work with V2 agent loop.

---

### 22. Rollback

**Status: NOT_STARTED**

No rollback API. No rollback UI. No `studio_checkpoints` table.

**Next required action:** Build rollback endpoint. Add "Undo" action to assistant messages.

---

### 23. BYOK (Bring Your Own Key)

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| BYOK in LLM options | IMPLEMENTED_UNVERIFIED | `src/lib/llm.ts` — `userApiKey`, `byokProvider` options |
| BYOK model category | IMPLEMENTED_UNVERIFIED | `"byok"` category in `ModelCategory` |
| BYOK UI | NOT_STARTED | No settings UI for entering API keys |
| BYOK storage | NOT_STARTED | No `studio_user_provider_keys` table |
| BYOK encryption | NOT_STARTED | No encrypted key storage |

**Known blockers:**
- LLM client supports BYOK parameters but there's no UI to set them and no storage for user keys.
- BYOK is functionally unreachable by users.

**Next required action:** Build BYOK settings UI. Add encrypted key storage. Wire to model selector.

---

### 24. Model Routing

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| LLM client | PROVEN_WORKING | `src/lib/llm.ts` (919 lines) — Gemini, Groq, OpenRouter |
| Model store | IMPLEMENTED_UNVERIFIED | `src/app/studio/stores/useStudioModelStore.ts` (100 lines) |
| Model definitions | IMPLEMENTED_UNVERIFIED | `src/lib/studio-models.ts` (`CHAT_MODELS`) |
| Provider health | IMPLEMENTED_UNVERIFIED | `ProviderHealth` type in model store |
| Fallback chain | IMPLEMENTED_UNVERIFIED | Provider order in `llm.ts` |

**Known blockers:**
- Provider health is tracked but not always displayed to users.
- No fallback notification when primary provider fails.
- Model selection persists in localStorage, not server-side.

**Next required action:** Surface provider health in UI. Add fallback notifications. Persist model selection server-side.

---

### 25. Deployment Approval

**Status: PARTIAL**

| Component | Status | Files |
|---|---|---|
| Deployments lib | IMPLEMENTED_UNVERIFIED | `src/lib/deployments.ts` (304 lines) |
| Deployments page | IMPLEMENTED_UNVERIFIED | `src/app/deployments/DeploymentsPageClient.tsx` |
| Deploy button | IMPLEMENTED_UNVERIFIED | `src/components/litt-terminal/DeployButton.tsx` |
| Deploy status tracking | IMPLEMENTED_UNVERIFIED | `DeployStatus` type, `isStatusTransitionValid` |

**Known blockers:**
- Deployment tracking exists but no approval gate in agent loop for deploys.
- No integration between agent loop and deployment system.
- Deploy sources: gitlab, manual, deploy-agent, vercel — but no "LiTT deploys for you" flow.

**Next required action:** Wire deployment into agent loop with ORANGE risk classification. Add deploy approval gate.

---

### 26. Publish

**Status: PARTIAL**

Deployment infrastructure exists but there's no guided publish flow from Studio.

**Known blockers:**
- No "Publish" button in Studio that triggers deployment.
- No domain connection flow.
- No deploy verification in receipts.

**Next required action:** Build publish flow from Studio. Connect to deployment system. Add deploy verification.

---

### 27. Glass OS

**Status: PARTIAL (~60%)**

| Component | Status | Files |
|---|---|---|
| Design tokens | PROVEN_WORKING | `src/app/globals.css` — `--glass-1`, `--glass-2`, `--glass-3`, borders, shadows, radii |
| Utility classes | PROVEN_WORKING | `.glass-shell`, `.glass-panel`, `.glass-chip`, `.glass-active`, `.glass-solid` |
| Header | PROVEN_WORKING | `CommandStudioHeader.tsx` |
| Sidebar | PROVEN_WORKING | `StudioSidebar.tsx` |
| Tab rows | PROVEN_WORKING | `CommandStudio.tsx` |
| Composer | PROVEN_WORKING | `CommandComposer.tsx` |
| Inspector | PROVEN_WORKING | `StudioInspector.tsx` |
| Transcript | PROVEN_WORKING | `StudioTranscript.tsx` |
| Bottom drawer | NOT_STARTED | `StudioTerminalDrawer.tsx` not converted |
| Preview toolbar | NOT_STARTED | `PreviewWorkspace.tsx` not converted |
| Canvas panels | NOT_STARTED | Canvas components not converted |
| Dashboard | NOT_STARTED | Dashboard not converted |

**Next required action:** Finish Glass OS conversion for remaining components.

---

### 28. Onboarding

**Status: NOT_STARTED**

No onboarding route. No persona selection. No "What do you want to make?" screen.

Landing page exists at `src/app/landing/` with hero, features, CTA, testimonials. Sign-up/sign-in layouts exist.

**Next required action:** Build onboarding route (`/onboarding`) with persona selection.

---

### 29. First-User Flow

**Status: NOT_VERIFIED**

No end-to-end test of: signup → create project → chat with LiTT → get preview → modify → publish → return.

**Next required action:** Define and test the first-user journey (see `FIRST_USER_JOURNEY.md`).

---

## Summary counts

| Status | Count |
|---|---|
| PROVEN_WORKING | 5 |
| IMPLEMENTED_UNVERIFIED | 18 |
| PARTIAL | 12 |
| BROKEN | 0 |
| NOT_STARTED | 7 |

**Existing code does not equal working.** Most systems are IMPLEMENTED_UNVERIFIED — code exists but has not been verified in production with real users.
