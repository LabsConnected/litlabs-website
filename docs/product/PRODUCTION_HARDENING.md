# Production Hardening Plan

> **Standing order: Audit → fix → verify → polish → document.**
>
> No more designing features. No more specs.
>
> Make what exists: complete → connected → consistent → verified → fast → secure → polished.

## Scope freeze

Nothing new unless it fixes:
- Broken functionality
- Incomplete existing functionality
- UX inconsistency
- Security
- Performance
- Reliability
- Onboarding
- Production observability

Game Studio, Operator, Arcade, IDE extension, etc. stay documented but **parked**.

## Production gate

```
AUTH                     ✅
PROJECT STATE            ✅
LITT CORE                ✅
TEXT / VOICE             ✅
MEMORY                   ✅
TOOLS                    ✅
PLAN / ACT / AUTO        ✅
ACTIVITY STREAMING       ✅
CHAT ARTIFACTS           ✅

CANVAS                   ✅
CODE                     ✅
FILES                    ✅
PREVIEW                  ✅
IMAGES                   ✅

BYOK                     ✅
CREDITS                  ✅
PROVIDER HEALTH          ✅

CHECKPOINT               ✅
ROLLBACK                 ✅
DEPLOY APPROVAL          ✅
DEPLOY                   ✅

ERROR HANDLING           ✅
OBSERVABILITY            ✅
SECURITY                 ✅
PERFORMANCE              ✅
RESPONSIVE               ✅

FIRST USER JOURNEY       ✅
PRODUCTION SMOKE TEST    ✅
```

## Work order (dependency-by-dependency)

### Phase 1: Foundation (Weeks 1-2)

#### 1.1 Unify Canonical LiTT Runtime

**Problem:** Two runtime entry points exist.
- `litt-intelligence/agent-loop-v2.ts` — used by Studio text. Has tool calling, build-fix, checkpoints, permissions, but no orchestration framework.
- `litt-runtime/execution-engine.ts` — used by Vapi phone. Has orchestration (context, memory, audit, verification), but no tool calling (tool plan is `void`ed).

**Fix:** Make `litt-runtime/execution-engine.ts` canonical. Absorb `agent-loop-v2` capabilities into the runtime. Make `agent-loop-v2` a thin adapter or delete it.

**Full spec:** `LITT_RUNTIME_UNIFICATION.md` (8-step migration plan)

**Architecture:**
```
                    ┌─ Studio text
                    ├─ Web microphone / voice
                    ├─ Vapi phone
                    ├─ Mobile app
                    └─ Future API/Slack/etc
                             ↓
                    INPUT ADAPTER LAYER
                             ↓
                ┌─────────────────────────┐
                │ LiTT Execution Engine   │
                │ litt-runtime/           │
                │ execution-engine.ts     │
                └─────────────────────────┘
                             ↓
          ┌──────────────────┼──────────────────┐
          ↓                  ↓                  ↓
       Memory             Tools             Models
          ↓                  ↓                  ↓
       Project          GitHub/PTY/etc      OpenAI/etc
          ↓
                   Verification layer
                             ↓
                         Result
                             ↓
                    OUTPUT ADAPTER
```

**Migration order (8 steps):**
1. Freeze both runtimes — no new features in either
2. Define canonical `LiTTExecutionRequest` / `LiTTExecutionResult` types
3. Upgrade execution engine with tool calling (absorb agent-loop-v2 loop)
4. Route Studio text through execution engine (verify text still works)
5. Migrate capabilities/tools into runtime (tool registry, handlers, permissions, build-fix)
6. Route web voice through execution engine (already uses text route — verify)
7. Clean up Vapi adapter (thin adapter: normalize → execute → format)
8. Delete duplicate behavior (agent-loop-v2, agent-loop, all absorbed files)

**First milestone — prove the foundation:**
```
Studio text: "Remember my test value is BLUE42."
Phone: "What was my test value?" → LiTT: "BLUE42."
Phone: "Create a file called runtime-test.txt containing BLUE42."
Studio text: "What did you just do?" → LiTT: "I created runtime-test.txt..."
Verify: runtime-test.txt exists in workspace
```

This proves: text → phone → tools → state → text through one runtime.

**Verification:**
- [ ] Step 2: Canonical types defined
- [ ] Step 3: Execution engine has tool calling, build-fix, checkpoints, permissions
- [ ] Step 4: Studio text routes through execution engine, all existing tests pass
- [ ] Step 5: All tools in `litt-runtime/tools/registry.ts`
- [ ] Step 6: Web voice routes through execution engine
- [ ] Step 7: Vapi is thin adapter
- [ ] Step 8: No duplicate tool registries, agent loops, approval checks, or context builders
- [ ] BLUE42 milestone test passes
- [ ] Same conversation across text/voice/phone
- [ ] Same project context across all channels
- [ ] Same memory recall across all channels

**Files affected:**
- `src/lib/litt-runtime/execution-engine.ts` (upgrade — add tool calling loop)
- `src/lib/litt-runtime/types.ts` (extend — add channel, capabilities, metadata)
- `src/lib/litt-runtime/runtime.ts` (update — call executionEngine.execute())
- `src/lib/litt-intelligence/agent-loop-v2.ts` (absorb then delete)
- `src/lib/litt-intelligence/agent-loop.ts` (delete)
- `src/lib/litt-intelligence/tool-registry.ts` (absorb into `litt-runtime/tools/`)
- `src/lib/litt-intelligence/tool-handlers-v2.ts` (absorb into `litt-runtime/tools/`)
- `src/lib/litt-intelligence/permission-engine.ts` (absorb into `litt-runtime/permission/`)
- `src/lib/litt-intelligence/build-fix-loop.ts` (absorb into `litt-runtime/verification/`)
- `src/lib/litt-intelligence/workspace-transport.ts` (absorb into `litt-runtime/tools/`)
- `src/lib/litt-intelligence/progress-events.ts` (absorb into `litt-runtime/response-stream.ts`)
- `src/lib/litt-intelligence/paused-run-store.ts` (absorb into `litt-runtime/state/`)
- `src/lib/litt-intelligence/canonical-runtime-context.ts` (absorb into `litt-runtime/context/`)
- `src/lib/litt-intelligence/llm-tool-calling.ts` (absorb into `litt-runtime/execution-engine.ts`)
- `src/lib/voice/voice-runtime.ts` (replace with `litt-runtime/adapters/vapi-phone.ts`)
- `src/app/api/studio/conversations/[conversationId]/messages/route.ts` (update to call executionEngine)
- `src/app/api/litt/voice/v1/chat/completions/route.ts` (update to use thin adapter)

#### 1.2 Remove Dead Voice Abstraction

**Problem:** Two voice systems exist.
- `VoiceSessionContext` (Inworld, 1121 lines) — active
- `ConversationContext.voiceProvider` (OpenAI Realtime) — unclear if active

**Fix:** Remove dead abstraction. Keep Inworld as the active voice system.

**Verification:**
- [ ] Only one voice system active
- [ ] No dead code references
- [ ] Voice works after removal

#### 1.3 Verify Execution Engine in Production

**Problem:** After unification, the execution engine must be verified to handle everything V2 did.

**Fix:** Verify the upgraded execution engine works end-to-end. Ensure it's the default, not the exception.

**Verification:**
- [ ] Execution engine executes multi-step tool calls
- [ ] Loop detection works (3 identical calls = cancel)
- [ ] Build-fix loop runs and feeds errors back
- [ ] Checkpoints created before mutations
- [ ] Approval pause/resume works
- [ ] Progress events stream via SSE
- [ ] Works with workspace available (full tool calling)
- [ ] Works without workspace (graceful degradation)

#### 1.4 Text ↔ Voice ↔ Phone Continuity

**Problem:** No test exists. Two runtimes made continuity impossible.

**Fix:** After runtime unification, verify and test the BLUE42 milestone.

**Verification:**
- [ ] BLUE42 milestone test passes (text → phone → tools → state → text)
- [ ] Text message → voice message → same conversation
- [ ] Voice message → text message → same conversation
- [ ] Phone message → text message → same conversation
- [ ] Memory recall works across all channel switches
- [ ] Project context consistent across all channels
- [ ] Tools execute through canonical engine regardless of channel

#### 1.5 PLAN / ACT / AUTO Server-Enforced

**Problem:** V1 fallback has no permission enforcement. V2 enforcement unverified.

**Fix:** V1 fallback is deleted as part of runtime unification (Step 8). The canonical execution engine enforces permissions for all channels. No fallback path bypasses permission checks.

**Verification:**
- [ ] PLAN blocks all mutations (server-side, not client-side)
- [ ] ACT allows mutations, sensitive ops require approval
- [ ] AUTO auto-approves safe ops, sensitive ops still require approval
- [ ] Enforcement is in execution engine, not in route or client
- [ ] No path bypasses permission checks (V1 deleted)

---

### Phase 2: Activity + Trust (Weeks 2-3)

#### 2.1 Activity Card UI

**Problem:** Progress events stream but render as generic tool activity. No dedicated activity card.

**Fix:** Build activity card component per `LITT_ACTIVITY_STATES.md`.

**Requirements:**
- Inline in chat, updates in place
- Shows canonical states: reading, inspecting, planning, working, testing, verifying, speaking
- Collapses after completion, expandable for full log
- Mascot animation tied to activity state
- No chain-of-thought exposed
- Respects reduced motion

**Verification:**
- [ ] Activity card appears when LiTT starts working
- [ ] Card updates in real-time as events stream
- [ ] Card collapses after completion
- [ ] Card expands to show full activity log
- [ ] No private reasoning exposed

#### 2.2 Verification Receipts

**Problem:** No evidence collection. LiTT can claim success without proof.

**Fix:** Build receipt component per `TRUTH_LAYER.md`.

**Requirements:**
- Shows after every significant LiTT action
- Lists checks: build, typecheck, lint, test, preview, console errors
- Each check: verified ✅ / not verified ⚠️ / failed ❌
- LiTT cannot claim success without evidence

**Verification:**
- [ ] Receipt appears after agent run
- [ ] Checks are factual (not assumed)
- [ ] Failed checks shown with error details
- [ ] Unverified claims marked as such

#### 2.3 Checkpoint UI

**Problem:** Checkpoints created in V2 but no user-facing UI.

**Fix:** Show checkpoints in transcript. Add "Undo" action.

**Verification:**
- [ ] Checkpoint events visible in transcript
- [ ] User can see checkpoint list
- [ ] User can click "Undo" to rollback

---

### Phase 3: Quick Build (Weeks 3-4)

#### 3.1 Onboarding Route

**Fix:** Build `/onboarding` with persona/category selection.

**Verification:**
- [ ] New user sees onboarding after signup
- [ ] User can select "Website"
- [ ] User can skip onboarding

#### 3.2 Quick Build Route

**Fix:** Build `/build` with describe → plan → build → preview flow per `QUICK_BUILD.md`.

**Verification:**
- [ ] User enters description
- [ ] LiTT generates concise plan (< 10s)
- [ ] User clicks "Build It"
- [ ] Activity card shows real operations
- [ ] Preview appears (< 5 min for simple site)
- [ ] Post-build actions: Change / Edit / Teach / Publish

#### 3.3 Time-to-Preview

**Fix:** Verify and optimize.

**Verification:**
- [ ] Simple website: < 5 minutes
- [ ] Landing page: < 5 minutes
- [ ] Blank project: < 3 minutes

---

### Phase 4: Recovery + Account (Weeks 4-5)

#### 4.1 Rollback

**Fix:** Build rollback API + UI.

**Verification:**
- [ ] User can undo to checkpoint
- [ ] Project reverts to checkpoint state
- [ ] Conversation continues after rollback

#### 4.2 BYOK

**Fix:** Build BYOK settings UI + encrypted storage per `PROVIDER_BYOK.md`.

**Requirements:**
- Settings → AI & Providers page
- Add/remove API keys (OpenAI, Anthropic, etc.)
- Keys encrypted server-side, never shown in plaintext
- Billing mode: Managed / My Keys / Hybrid
- Model routing per task type

**Verification:**
- [ ] User can add API key
- [ ] Key stored encrypted
- [ ] Key never returned in plaintext
- [ ] BYOK model selectable
- [ ] LLM call uses user's key when BYOK selected

#### 4.3 Provider Health

**Fix:** Surface provider health in UI.

**Verification:**
- [ ] Provider status visible (available/degraded/unavailable)
- [ ] Fallback notification when primary fails
- [ ] Missing config shows actionable error

#### 4.4 Publish from Studio

**Fix:** Build publish flow from Studio.

**Verification:**
- [ ] User clicks Publish in Studio
- [ ] Deploy runs with approval gate
- [ ] Live URL provided
- [ ] Deploy status tracked

---

### Phase 5: Hardening (Weeks 5-6)

#### 5.1 Error States

**Fix:** No "Something went wrong." Every error is actionable.

**Pattern:**
```
Preview failed because `pnpm dev` exited with code 1.

[Retry] [Ask LiTT to Fix] [Logs] [Terminal]
```

**Verification:**
- [ ] Preview failure shows specific error
- [ ] LLM failure shows provider + error
- [ ] Terminal failure shows command + exit code
- [ ] Voice failure shows specific issue
- [ ] Every error has a recovery action

#### 5.2 Reconnection

**Fix:** Handle disconnects gracefully.

**Verification:**
- [ ] SSE disconnect → reconnect, resume stream
- [ ] Terminal disconnect → reconnect PTY
- [ ] Voice disconnect → reconnect Inworld
- [ ] Preview disconnect → reconnect dev server
- [ ] Browser refresh → state recovered

#### 5.3 Durable Runs

**Fix:** Long AI operations survive browser disconnect.

**Requirements:**
- Run created with `runId`
- Execution continues server-side
- Events streamed to client
- Browser can reconnect via `GET /api/litt/runs/:runId/state`
- Canonical states: queued, planning, running, waiting_for_approval, testing, verifying, completed, failed, cancelled

**Verification:**
- [ ] Run survives browser refresh
- [ ] Run survives SSE disconnect
- [ ] Run state recoverable via API
- [ ] Run can be cancelled via API

#### 5.4 Security Audit

**Fix:** Audit and fix all security surfaces.

**Checklist:**
- [ ] Clerk auth on every API route
- [ ] Project ownership verified server-side
- [ ] Workspace authorization verified
- [ ] Vapi authorization verified
- [ ] BYOK keys encrypted at rest
- [ ] API secrets not in client code
- [ ] Supabase RLS enabled on all tables
- [ ] GitHub permissions scoped correctly
- [ ] Terminal command restrictions enforced (`isBlockedCommand()`)
- [ ] Deployment approvals enforced
- [ ] Rate limiting on all endpoints
- [ ] Upload validation (type, size)
- [ ] Webhooks verify signatures
- [ ] Admin endpoints protected

**Never trust project IDs from the client blindly:**
```
authenticated user
→ authorized project
→ authorized workspace
→ tool permission
→ operation
```

#### 5.5 Observability

**Fix:** Production visibility into all systems.

**Requirements:**
- Error tracking (Sentry or similar)
- API failure logging
- LLM failure logging
- Tool failure logging
- Slow request alerts
- Agent run tracing: runId, userId, projectId, conversationId, model, tools used, duration, result, error
- Preview failure tracking
- Voice failure tracking
- Deployment tracking
- Provider health monitoring

**Verification:**
- [ ] Every LiTT run has traceable runId
- [ ] Errors logged with context
- [ ] Provider health monitored
- [ ] Can trace "LiTT broke my project" to exact actions

---

### Phase 6: Polish (Week 6)

#### 6.1 Finish Glass OS

**Fix:** Complete Glass OS for all remaining components.

**Components still needing conversion:**
- [ ] Terminal drawer (`StudioTerminalDrawer.tsx`)
- [ ] Preview toolbar (`PreviewWorkspace.tsx`)
- [ ] Canvas panels
- [ ] Dashboard
- [ ] Empty states
- [ ] Error states
- [ ] Loading states
- [ ] Modals

**Visual formula:**
- Background: dark branded wallpaper, subtle purple atmosphere, minimal green accents
- Major surfaces: glassmorphism
- Dense work surfaces: mostly solid dark
- Purple: AI / selected / navigation
- Green: healthy / active / success / deploy
- LiTT mascot: subtle floating motion where prominently presented

#### 6.2 Performance Pass

**Fix:** Attack performance issues.

**Targets:**
- [ ] Break up giant components (e.g., 3755-line `ImageTool.tsx`)
- [ ] Reduce unnecessary JS
- [ ] Fix rerenders
- [ ] Image optimization
- [ ] Lazy loading
- [ ] Code splitting
- [ ] Database query count optimization
- [ ] Waterfall request elimination
- [ ] Provider latency monitoring
- [ ] Preview startup optimization
- [ ] Canvas performance
- [ ] Mobile layout performance

#### 6.3 Responsive Validation

**Fix:** Test all breakpoints.

**Breakpoints:**
- [ ] 1920 desktop
- [ ] 1440 desktop
- [ ] 1280 laptop
- [ ] 1024 tablet
- [ ] 768 tablet
- [ ] 430 phone
- [ ] 390 phone
- [ ] 360 phone

**Critical screens:**
- [ ] Onboarding
- [ ] Dashboard
- [ ] Chat
- [ ] Create
- [ ] Pricing
- [ ] Settings
- [ ] Account
- [ ] Public landing pages

Studio progressively collapses advanced panes instead of squeezing them.

#### 6.4 Studio Tool Polish

No tab should feel like a prototype.

| Area | Production requirement | Current |
|---|---|---|
| Chat | canonical LiTT, artifacts, activity, voice | PARTIAL |
| Canvas | real drag/drop, persistence, selection, properties, undo | PARTIAL |
| Code | files, Monaco, changes, terminal, tests | IMPLEMENTED_UNVERIFIED |
| Preview | reliable start/reconnect/device modes/errors | PARTIAL |
| Files | real repo files + assets | IMPLEMENTED_UNVERIFIED |
| Agents | management/catalog only | NOT_STARTED |
| Images | polished generation flow | PARTIAL |
| Voice | same brain as text | PARTIAL |
| BYOK | visible, usable, tested | NOT_STARTED |
| Deploy | approval + evidence + rollback | PARTIAL |

---

### Phase 7: First User E2E (Week 6)

#### 7.1 Complete First User Journey

```
Sign up
↓
Choose website
↓
Explain idea
↓
LiTT understands
↓
Build
↓
See working preview
↓
Ask for a change
↓
See change
↓
Understand what happened
↓
Publish or save
```

**Without founder standing next to them explaining anything.**

**Verification:**
- [ ] All 12 steps pass end-to-end
- [ ] No step requires technical knowledge
- [ ] No step requires terminal/Git/framework settings
- [ ] Test with 5 users who have never seen LiTTree

#### 7.2 Production Smoke Test

Every major capability gets:

```
UNIT → INTEGRATION → E2E → PRODUCTION SMOKE
```

**Test:**
- [ ] Authentication
- [ ] Signup
- [ ] Project creation
- [ ] Studio chat
- [ ] Text → voice → text
- [ ] Image generation
- [ ] File read/write
- [ ] Terminal
- [ ] GitHub
- [ ] Canvas
- [ ] Preview
- [ ] Checkpoints
- [ ] Rollback
- [ ] BYOK
- [ ] Billing/credits
- [ ] Deployment approval
- [ ] Deploy

---

## Release levels

```
INTERNAL → PRIVATE BETA → PUBLIC BETA → PRODUCTION
```

### INTERNAL
- Beat the hell out of it
- All Phase 1-5 complete
- No critical bugs

### PRIVATE BETA
- 5-20 real users
- First-user journey passes
- Release gates pass (see `RELEASE_GATES.md`)
- Feedback capture active

### PUBLIC BETA
- Private beta failures cleaned up
- 50 concurrent users
- Open signup
- Analytics active

### PRODUCTION
- All release gates pass
- Observability active
- Security audit complete
- Performance acceptable

---

## Relationship to existing docs

| Doc | Role in hardening |
|---|---|
| `P0_CURRENT_STATE.md` | Track what's verified vs unverified |
| `CANONICAL_RUNTIME_MAP.md` | Reference for runtime unification |
| `FIRST_USER_JOURNEY.md` | The E2E test spec |
| `ACCEPTANCE_TEST_MATRIX.md` | Track test coverage |
| `RELEASE_GATES.md` | Hard gates for each release level |
| `PRODUCT_CONTROL_TOWER.md` | Weekly progress update |
| `P0_AUDIT_FINAL_REPORT.md` | Blockers, duplications, shortest path |
| `FIRST_100_USERS.md` | Acquisition plan post-private-beta |

This plan is the **execution order**. The other docs are the **reference material**.
