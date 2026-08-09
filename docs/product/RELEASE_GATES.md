# Release Gates

> Hard conditions that must pass before each stage is declared ready. No exceptions.

## ALPHA — Internal testing only

### LiTT Core

- [ ] V2 agent loop executes multi-step tool calls in production
- [ ] V1 fallback works when workspace unavailable
- [ ] Loop detection cancels after 3 identical calls
- [ ] Build-fix loop runs typecheck/lint/test/build and feeds errors back
- [ ] Progress events stream via SSE

### Build

- [ ] New user can create a website from Studio (manual project creation)
- [ ] Preview starts for a blank/template project
- [ ] LiTT can edit files and preview updates
- [ ] Time to first preview < 10 minutes (alpha threshold)

### Trust

- [ ] Tool executions appear as activity events in transcript
- [ ] Build-fix results visible (pass/fail with error count)
- [ ] LiTT does not claim success without running checks

### Studio

- [ ] Code editor loads files from workspace
- [ ] Files browser shows file tree
- [ ] Terminal connects and executes commands
- [ ] PLAN mode blocks mutations
- [ ] ACT mode allows mutations with approval gates

### Account

- [ ] Model selector works (auto/free/fast/code)
- [ ] Provider fallback chain works
- [ ] Provider health visible in UI

### Recovery

- [ ] Checkpoints created before mutation batches
- [ ] Browser refresh preserves conversation state
- [ ] Failed LLM call shows error, doesn't brick conversation

**ALPHA gate: All items checked. No critical bugs. Internal team can use daily.**

---

## PRIVATE BETA — Invited users (first 5-20)

### LiTT Core

- [ ] Text uses canonical runtime (V2 path)
- [ ] Studio voice uses same runtime (same conversation, same context)
- [ ] Vapi phone uses same user/project memory
- [ ] Text → voice → text continuity passes end-to-end
- [ ] No duplicate runtime paths (unify `litt-intelligence` and `litt-runtime`)

### Build

- [ ] Quick Build flow exists: onboarding → describe → plan → build → preview
- [ ] New user can create a website without touching terminal/Git/framework settings
- [ ] First usable preview < 5 minutes for a normal starter project
- [ ] LiTT can revise the generated result via chat
- [ ] Activity card shows real operations (not fake progress)
- [ ] Activity card collapses after completion, expandable for full log

### Trust

- [ ] Verification receipts distinguish verified / not verified
- [ ] LiTT never claims deployment/build success without evidence
- [ ] Checkpoints visible to user
- [ ] Rollback works (undo to checkpoint)
- [ ] Failed build recovery: build-fix loop attempts repair, shows clear error if unfixable

### Studio

- [ ] Canvas works beyond visual mockup (blocks connected to code or at least promote-to-project works)
- [ ] Code editor reliable (load, edit, save)
- [ ] Preview reliably starts (< 30s from workspace ready)
- [ ] Files work (browse, read, edit via agent)
- [ ] PLAN/ACT/AUTO enforced by tools, not just prompt

### Account

- [ ] BYOK visible in settings
- [ ] Managed credits work (balance, usage, settle)
- [ ] Provider health visible
- [ ] Missing configuration produces actionable errors (not "agent unavailable")

### Recovery

- [ ] Checkpoint before every significant mutation
- [ ] Rollback restores project to checkpoint state
- [ ] Failed build recovery with clear error message
- [ ] Browser refresh does not destroy long-running work (SSE reconnection or state recovery)

### Security

- [ ] No critical auth/security failures
- [ ] All API routes ownership-scoped
- [ ] No API keys/secrets exposed in UI or responses
- [ ] No chain-of-thought exposed in activity events
- [ ] Terminal server enforces `isBlockedCommand()`

### First User Journey

- [ ] Landing → signup → onboarding → describe → plan → build → preview → modify → receipt → publish → return
- [ ] All 12 steps pass end-to-end
- [ ] No step requires technical knowledge
- [ ] User can complete journey without touching terminal, Git, or framework settings

**PRIVATE BETA gate: All items checked. First-user journey passes end-to-end. No critical bugs. Invited users can complete the killer path.**

---

## PUBLIC BETA — Open signup

### All PRIVATE BETA gates pass

### Scale & Reliability

- [ ] 50 concurrent users without degradation
- [ ] Workspace provisioning succeeds > 95% of attempts
- [ ] Preview starts < 95% of attempts
- [ ] LLM provider fallback handles outages gracefully
- [ ] No data loss on server restart

### Onboarding

- [ ] Onboarding route handles all persona types
- [ ] Quick Build handles: website, landing page, portfolio, blog, business site
- [ ] Quick Build plan generation < 10 seconds
- [ ] Quick Build execution < 5 minutes for simple sites

### Voice

- [ ] Studio voice works in Chrome, Edge, Safari
- [ ] Vapi phone calls connect reliably
- [ ] Voice transcript validation prevents ghost transcripts
- [ ] Voice TTS plays without echo/feedback

### Publishing

- [ ] Publish from Studio produces live URL
- [ ] Deploy status tracked (queued → building → deploying → live)
- [ ] Deploy failures show actionable errors
- [ ] Published site accessible at custom or subdomain URL

### Analytics

- [ ] All first-user journey events tracked
- [ ] Time-to-first-preview measured
- [ ] Drop-off points identified
- [ ] User feedback captured (NPS or similar)

**PUBLIC BETA gate: All items checked. 50 concurrent users. First-user journey reliable. Ready for open signup.**

---

## What disqualifies from any gate

- Any data loss (conversation, project, files)
- Any security exposure (API keys, user data, chain-of-thought)
- Any crash that bricks the conversation (requires manual DB intervention)
- Any path where LiTT claims success without evidence
- Any path where user must touch terminal/Git/framework settings to get started
