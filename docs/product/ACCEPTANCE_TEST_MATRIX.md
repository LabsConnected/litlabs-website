# Acceptance Test Matrix

> One canonical table covering every P0 requirement. No duplicate tests.

## Test matrix

### LiTT Core

| ID | Feature | Test | Expected result | Type | Environment | Status | Evidence |
|---|---|---|---|---|---|---|---|
| L-01 | Canonical LiTT runtime | Send text message in Studio | Agent loop V2 executes with workspace tools | Manual | Production | UNVERIFIED | — |
| L-02 | Canonical LiTT runtime | Send text message without workspace | V1 fallback executes, read-only tools only | Manual | Production | UNVERIFIED | — |
| L-03 | V2 multi-step tool calling | Ask LiTT to edit a file and run typecheck | Multiple tool calls execute in sequence, results streamed | Manual | Production | UNVERIFIED | — |
| L-04 | Loop detection | Trigger 3 identical tool calls | Loop cancels with reason | Automated | Unit | PASS | `loop-detection.test.ts` |
| L-05 | Permission engine — PLAN | Switch to PLAN mode, ask LiTT to edit file | Tool call blocked, read-only only | Automated | Unit | PASS | `permission-engine.test.ts` |
| L-06 | Permission engine — ACT | Switch to ACT mode, LiTT edits file | Mutation allowed, sensitive ops require approval | Automated | Unit | PASS | `permission-engine.test.ts` |
| L-07 | Permission engine — AUTO | Switch to AUTO mode | Safe ops auto-approved, sensitive ops still require approval | Automated | Unit | PASS | `permission-engine.test.ts` |
| L-08 | Approval pause/resume | LiTT hits approval gate in ACT mode | Run pauses, approval event sent, resume after approval | Automated | Unit | PASS | `approval-resume.test.ts` |
| L-09 | Build-fix loop | Run build after edits, introduce type error | Build-fix detects error, feeds back for repair | Manual | Production | UNVERIFIED | — |
| L-10 | Progress events | Run V2 agent loop | Events emitted: tool_start, tool_result, phase, build_start, build_result | Automated | Unit | PASS | `progress-events.test.ts` |

### Text ↔ Voice Continuity

| ID | Feature | Test | Expected result | Type | Environment | Status | Evidence |
|---|---|---|---|---|---|---|---|
| V-01 | Text → voice | Send text message, then switch to voice | Voice uses same conversation, same context | Manual | Production | UNVERIFIED | — |
| V-02 | Voice → text | Send voice message, then type | Text continues same conversation | Manual | Production | UNVERIFIED | — |
| V-03 | Voice transcript | Speak into mic, stop | Transcript appears as editable draft | Manual | Production | UNVERIFIED | — |
| V-04 | Voice TTS | LiTT responds after voice input | Response spoken via Inworld TTS | Manual | Production | UNVERIFIED | — |
| V-05 | Voice health | Check voice health endpoint | Returns configured/available status | Manual | Production | UNVERIFIED | — |
| V-06 | Vapi phone | Call LiTT phone number | Call connects, LiTT responds, message in conversation | Manual | Production | UNVERIFIED | — |
| V-07 | Phone → web continuity | Call LiTT, then open Studio | Conversation history includes phone messages | Manual | Production | UNVERIFIED | — |

### Build & Preview

| ID | Feature | Test | Expected result | Type | Environment | Status | Evidence |
|---|---|---|---|---|---|---|---|
| B-01 | Quick Build onboarding | New user signs up, selects Website | Onboarding flow appears | Manual | Production | NOT_STARTED | — |
| B-02 | Quick Build describe | User enters description | Description accepted, plan generated | Manual | Production | NOT_STARTED | — |
| B-03 | Quick Build plan | LiTT generates plan | Concise plan in < 10s, user can accept/edit | Manual | Production | NOT_STARTED | — |
| B-04 | Quick Build execution | User clicks "Build It" | Project created, files written, preview starts | Manual | Production | NOT_STARTED | — |
| B-05 | Time to first preview | Measure from "Build It" to preview ready | < 5 minutes for simple website | Manual | Production | NOT_STARTED | — |
| B-06 | Preview reliability | Start preview for blank project | Preview starts and shows content | Manual | Production | UNVERIFIED | — |
| B-07 | Preview device toggle | Switch between desktop/tablet/mobile | Preview resizes correctly | Manual | Production | UNVERIFIED | — |
| B-08 | Preview refresh | Click refresh button | Preview reloads with latest changes | Manual | Production | UNVERIFIED | — |
| B-09 | LiTT revision | Ask LiTT to change generated website | LiTT edits files, preview updates | Manual | Production | UNVERIFIED | — |

### Trust & Verification

| ID | Feature | Test | Expected result | Type | Environment | Status | Evidence |
|---|---|---|---|---|---|---|---|
| T-01 | Activity UI | LiTT runs tools | Activity events visible in transcript as timeline | Manual | Production | PARTIAL | Events stream but no activity card |
| T-02 | Activity card collapse | After LiTT completes | Activity card collapses, expandable for full log | Manual | Production | NOT_STARTED | — |
| T-03 | Verification receipt | LiTT completes build | Receipt shows verified/unverified checks | Manual | Production | NOT_STARTED | — |
| T-04 | No false claims | LiTT says "build passed" | Build actually passed (evidence exists) | Manual | Production | NOT_STARTED | — |
| T-05 | Checkpoint | LiTT makes significant changes | Checkpoint created with git SHA | Manual | Production | UNVERIFIED | — |
| T-06 | Rollback | User clicks "Undo" | Project reverts to checkpoint state | Manual | Production | NOT_STARTED | — |
| T-07 | Failed build recovery | Build fails during agent run | Build-fix loop attempts repair, error shown if unfixable | Manual | Production | UNVERIFIED | — |
| T-08 | Browser refresh | Refresh during long-running LiTT turn | Work not lost, state recovered | Manual | Production | UNVERIFIED | — |

### Studio Tools

| ID | Feature | Test | Expected result | Type | Environment | Status | Evidence |
|---|---|---|---|---|---|---|---|
| S-01 | Canvas | Open canvas, add blocks | Blocks render, can be edited | Manual | Production | UNVERIFIED | — |
| S-02 | Canvas promote | Promote canvas to project | Project created from canvas blocks | Manual | Production | UNVERIFIED | — |
| S-03 | Code editor | Open code tool, edit file | Monaco editor loads, file saves to workspace | Manual | Production | UNVERIFIED | — |
| S-04 | Code split view | Switch to split view | Code + preview visible side by side | Manual | Production | UNVERIFIED | — |
| S-05 | Files | Browse file tree | Files listed, can open/read | Manual | Production | UNVERIFIED | — |
| S-06 | Terminal | Open terminal drawer | PTY connects, commands execute | Manual | Production | UNVERIFIED | — |
| S-07 | PLAN/ACT/AUTO enforcement | Switch modes | Tools respect mode restrictions | Manual | Production | UNVERIFIED | — |

### Account & Provider

| ID | Feature | Test | Expected result | Type | Environment | Status | Evidence |
|---|---|---|---|---|---|---|---|
| A-01 | BYOK UI | Open settings, enter API key | Key stored encrypted, model selector updates | Manual | Production | NOT_STARTED | — |
| A-02 | BYOK usage | Select BYOK model, send message | LLM call uses user's API key | Manual | Production | NOT_STARTED | — |
| A-03 | Managed credits | Check credit balance | Balance displayed, usage tracked | Manual | Production | UNVERIFIED | — |
| A-04 | Provider health | Check model store | Provider health visible (available/degraded/unavailable) | Manual | Production | UNVERIFIED | — |
| A-05 | Provider fallback | Primary provider fails | Fallback provider used, user notified | Manual | Production | UNVERIFIED | — |
| A-06 | Missing config error | No API keys configured | Actionable error message shown | Manual | Production | UNVERIFIED | — |

### Glass OS

| ID | Feature | Test | Expected result | Type | Environment | Status | Evidence |
|---|---|---|---|---|---|---|---|
| G-01 | Glass tokens | Inspect CSS variables | All glass tokens defined in globals.css | Automated | CI | PASS | Visual inspection |
| G-02 | Header glass | View Studio header | Glass effect visible | Manual | Production | PASS | — |
| G-03 | Sidebar glass | View Studio sidebar | Glass effect visible | Manual | Production | PASS | — |
| G-04 | Transcript glass | View message bubbles | Glass surfaces on user/assistant messages | Manual | Production | PASS | — |
| G-05 | Bottom drawer glass | Open terminal drawer | Glass effect visible | Manual | Production | NOT_STARTED | — |
| G-06 | Preview glass | View preview toolbar | Glass effect visible | Manual | Production | NOT_STARTED | — |

## Status summary

| Status | Count |
|---|---|
| PASS | 7 |
| UNVERIFIED | 28 |
| PARTIAL | 1 |
| NOT_STARTED | 14 |
| **Total** | **50** |

**Only 7 tests pass. 28 are unverified. 14 features don't exist yet.**

## Priority test order

1. **L-01 through L-03** — Verify V2 agent loop works in production
2. **V-01 through V-03** — Verify text/voice continuity
3. **B-06 through B-09** — Verify preview and revision work
4. **T-01, T-07, T-08** — Verify activity UI and recovery
5. **S-03, S-05, S-06** — Verify code, files, terminal
6. **A-03, A-04, A-06** — Verify account/provider
