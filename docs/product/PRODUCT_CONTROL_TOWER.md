# Product Control Tower

> The index of truth. Do not create conflicting status reports elsewhere.

## P0 Progress

| # | System | Status | Spec | Implementation | Tests | Blocker | Next Action |
|---|---|---|---|---|---|---|---|
| 1 | Canonical LiTT runtime | PARTIAL | `LITT_RUNTIME_UNIFICATION.md` | `litt-runtime/execution-engine.ts` (target) + `litt-intelligence/agent-loop-v2.ts` (to absorb) | `v2-integration.test.ts` | Two runtime entry points — `litt-intelligence` has tool calling/build-fix, `litt-runtime` has orchestration/memory/audit. Must merge into one. | Follow 8-step migration in `LITT_RUNTIME_UNIFICATION.md` |
| 2 | Studio text | PARTIAL | — | `messages/route.ts` (657 lines) | `useConversationStore.test.ts` | No activity card UI | Build activity card component |
| 3 | Studio voice | PARTIAL | — | `VoiceSessionContext.tsx` (1121 lines) | — | Two voice abstractions (Inworld vs OpenAI Realtime) | Remove dead voice abstraction |
| 4 | Vapi phone | PARTIAL | `LITT_RUNTIME_UNIFICATION.md` | `voice/v1/chat/completions/route.ts` → `litt-runtime/adapters/vapi-phone.ts` | — | Uses `litt-runtime/runtime.ts` but execution engine lacks tool calling | Upgrade execution engine, then make Vapi a thin adapter |
| 5 | Text ↔ Voice continuity | BROKEN | `LITT_RUNTIME_UNIFICATION.md` | — | — | Two runtimes, no shared conversation test | Unify runtime, then run first milestone test (BLUE42) |
| 6 | Conversation persistence | PROVEN_WORKING | — | `conversation-service.ts` | — | — | Add `parts` column for artifacts |
| 7 | Project context | PARTIAL | — | `project-resolver.ts` | — | Unverified for blank/template projects | Verify non-GitHub projects |
| 8 | Memory | IMPLEMENTED_UNVERIFIED | — | `memory-service.ts` | — | Recall unverified in production | Test memory recall across sessions |
| 9 | Universal artifacts | NOT_STARTED | `UNIVERSAL_ARTIFACTS.md` | — | — | No `parts` column, no MessagePart types | Add schema + types |
| 10 | In-chat image generation | PARTIAL | `UNIVERSAL_ARTIFACTS.md` | `generate/route.ts` | — | Not wired to chat or agent loop | Wire as agent tool, return ImagePart |
| 11 | Activity streaming | PARTIAL | `LITT_ACTIVITY_STATES.md` | `progress-events.ts` | `progress-events.test.ts` | No activity card, no reconnection API | Build activity card + reconnection |
| 12 | PLAN/ACT/AUTO | IMPLEMENTED_UNVERIFIED | `LITT_OPERATOR.md` | `permission-engine.ts` | `permission-engine.test.ts` | V1 fallback has no enforcement | Verify in production or remove V1 |
| 13 | Workspace | PARTIAL | — | `workspace-transport.ts` | — | External terminal server dependency | Verify provisioning for new users |
| 14 | Terminal | PARTIAL | — | `StudioTerminalDrawer.tsx` | `StudioTerminalDrawer.test.tsx` | PTY connection fragile | Test reliability |
| 15 | GitHub | PARTIAL | — | `GitHubProjectConnection.tsx` | — | Not all users have GitHub | Verify non-GitHub paths work |
| 16 | Files | IMPLEMENTED_UNVERIFIED | — | `StudioProjectFiles.tsx` | `StudioProjectFiles.test.tsx` | — | Verify in production |
| 17 | Code editor | IMPLEMENTED_UNVERIFIED | — | `code/CodeWorkspace.tsx` (502 lines) | — | — | Verify save/refresh cycle |
| 18 | Canvas | PARTIAL | — | `canvas/CanvasPanel.tsx` (363 lines) | — | Not connected to code or agent loop | Wire canvas to agent tools |
| 19 | Preview | PARTIAL | — | `PreviewWorkspace.tsx` (834 lines) | `StudioPreviewPanel.test.tsx` | Unverified for Quick Build | Test time-to-preview |
| 20 | Quick Build | NOT_STARTED | `QUICK_BUILD.md` | — | — | No onboarding, no build route | Build entire Quick Build flow |
| 21 | Truth Layer | NOT_STARTED | `TRUTH_LAYER.md` | — | — | No evidence collection | Add evidence after agent runs |
| 22 | Verification receipts | NOT_STARTED | `TRUTH_LAYER.md` | — | — | No receipt UI | Build receipt card component |
| 23 | Checkpoints | PARTIAL | `TRUTH_LAYER.md` | `workspace-checkpoint.ts` | — | No user-facing rollback UI | Build rollback UI + API |
| 24 | Rollback | NOT_STARTED | `TRUTH_LAYER.md` | — | — | No rollback API | Build rollback endpoint |
| 25 | BYOK | PARTIAL | `PROVIDER_BYOK.md` | `llm.ts` (BYOK params) | — | No UI, no storage, no encryption | Build BYOK settings + storage |
| 26 | Model routing | PARTIAL | `PROVIDER_BYOK.md` | `llm.ts` (919 lines), `useStudioModelStore.ts` | `useStudioModelStore.test.ts` | Health not surfaced in UI | Surface provider health |
| 27 | Deployment approval | PARTIAL | — | `deployments.ts` (304 lines) | — | Not wired to agent loop | Wire deploy with ORANGE risk |
| 28 | Publish | PARTIAL | — | `DeploymentsPageClient.tsx` | — | No Studio publish flow | Build publish from Studio |
| 29 | Glass OS | PARTIAL (~60%) | `DESIGN_SYSTEM.md` | `globals.css` + components | — | Bottom drawer, preview, canvas not converted | Finish remaining components |
| 30 | Onboarding | NOT_STARTED | `QUICK_BUILD.md` | — | — | No onboarding route | Build `/onboarding` route |
| 31 | First-user journey | NOT_VERIFIED | `FIRST_USER_JOURNEY.md` | — | — | 4 steps not started, 6 partial | Build missing steps, verify end-to-end |

## Status counts

| Status | Count |
|---|---|
| PROVEN_WORKING | 1 |
| IMPLEMENTED_UNVERIFIED | 3 |
| PARTIAL | 17 |
| BROKEN | 1 |
| NOT_STARTED | 6 |
| NOT_VERIFIED | 1 |
| **Total** | **31** (some overlap with P0 items) |

## Critical path (what unblocks the most)

```
1. Unify runtime paths — make litt-runtime/execution-engine.ts canonical
   → absorb agent-loop-v2 capabilities (tool calling, build-fix, checkpoints, permissions)
   → route Studio text through execution engine
   → route Vapi phone through execution engine
   → prove with BLUE42 milestone test (text → phone → tools → state → text)
   → See: LITT_RUNTIME_UNIFICATION.md (8-step migration)

2. Build Quick Build flow (onboarding → describe → plan → build → preview)
   → unblocks first-user journey
   → unblocks private beta

3. Build activity card UI
   → makes LiTT feel alive during builds
   → streams real operations, not fake progress

4. Build verification receipts
   → proves what happened
   → builds trust

5. Build rollback
   → safety net for agent actions
   → trust + recovery
```

## What we are NOT building (frozen)

- Game Studio expansion
- Arcade 2.0
- PC takeover
- Browser Operator
- VS Code extension
- Complex learning curriculum
- Additional marketplace agents
- Major mobile expansion
- Community gamification
- Theme marketplace

Specs are kept. Implementation is frozen until P0 proves the product.
