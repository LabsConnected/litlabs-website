# LiTT — ULTRA MASTER BUILD BLUEPRINT

## Mission

Build LiTT into a complete AI software-building operating environment.

LiTT is NOT:

* another chatbot with coding tools
* a terminal wrapper
* a collection of disconnected generators
* a fake browser cursor
* a dashboard full of links to Railway, Cloudflare, Supabase, GitHub, etc.
* an agent that says “complete” because source code was written

LiTT IS:

A visual AI operator that understands a software project, edits it, runs it, controls the real application/browser, observes the result, diagnoses failures, repairs them, verifies the result, manages infrastructure behind the scenes, and gives the user visible proof that the requested work actually succeeded.

The user should experience LiTT as:

> “I told LiTT what I wanted, then watched LiTT actually build, run, use, debug, verify, and ship it.”

---

# PART 1 — ESTABLISH ONE AUTHORITATIVE CODE LINE

Before building anything else, stabilize the repository.

The historical repository state contains many stale worktrees and partially integrated branches.

Known previous state:

* More than 30 Git worktrees existed.
* Nine contained unsaved source work.
* Old Dashboard v2 branches existed while main contained Dashboard v3.
* An OAuth worktree contained unresolved conflicts.
* Safety snapshots were created under:

`safety/20260827-150547/*`

* A consolidation attempt was interrupted.
* A cleanup command accidentally targeted the active checkout.
* The valid work was preserved, but the active integration checkout was no longer trustworthy.
* A later production hotfix for malformed free-model `tool_call` fences was reportedly committed as:

`66df4043`

Do not assume any historical integration checkout is authoritative.

## Required recovery architecture

Use:

`origin/main`

as the source of truth.

Fetch current remote state first.

Confirm the actual current `origin/main` commit.

Verify whether `66df4043` exists on current main.

Create a completely new recovery branch from CURRENT `origin/main`:

`integration/recovery-20260827`

Do NOT base the recovery branch on:

`chore/dashboard-cleanup`

Do NOT merge the old OAuth worktree.

Do NOT merge any safety branch wholesale.

Do NOT merge entire stale worktrees.

Safety branches are forensic/recovery references only.

## Recover only genuinely missing valid changes

Previously identified legitimate changes included:

Windows doctor command resolution.

Gemini native OpenAI-compatible transport.

Guaranteed remote output/token cap.

Transcript concurrency fix.

Only port these if current main does not already contain equivalent or superior implementations.

Compare behavior, not merely filenames or commit hashes.

## Features already considered authoritative

Do not regress:

Dashboard v3.

Studio Phase 2.

Security P0 work.

Workspace ownership/claim enforcement.

Fail-closed remote execution behavior.

Approval policy.

Current routing/fallback architecture.

Current Dashboard media architecture.

Current agent/runtime implementation.

Current `tool_call` sanitization fix.

Anything newer on main supersedes stale worktree implementations unless the old implementation clearly contains functionality missing from main.

---

# PART 2 — CLEAN UP THE DEVELOPMENT MODEL

LiTT should not continue operating with dozens of semi-active worktrees.

Once recovery is complete and every preserved branch has been audited:

Maintain only a small number of active worktrees.

Recommended model:

| Workspace     | Purpose                               |
| ------------- | ------------------------------------- |
| `main`        | Production-ready authoritative source |
| `integration` | Multi-feature integration/recovery    |
| `studio`      | Studio/browser/operator work          |
| `runtime`     | CLI/operator/runtime work             |
| `hotfix`      | Emergency production fixes            |

Anything else should normally exist as a Git branch without a permanent worktree.

Never allow an agent to blindly run cleanup commands across worktrees.

Every destructive Git/worktree operation must first resolve and display:

absolute workspace path

branch

HEAD

dirty state

target operation

before executing.

---

# PART 3 — PRODUCT ARCHITECTURE

LiTT should be organized into several major layers.

## LiTT Core

The core owns intent and task execution.

Responsibilities:

user request

task plan

execution state

tool selection

provider routing

workspace selection

permissions

verification policy

artifact history

pause/cancel/resume

completion status

The UI must not be the source of truth for task state.

Task state belongs in the runtime/orchestrator.

---

# PART 4 — THE EXECUTION SPINE

Every LiTT task should flow through one state machine.

Required stages:

REQUESTED

PLANNING

READY

EDITING

RUNNING

RENDERING

INSPECTING

REPAIRING

VERIFYING

COMPLETED

BLOCKED

FAILED

CANCELLED

The normal successful sequence is:

User request

→ understand intent

→ inspect project

→ create execution plan

→ edit smallest relevant change

→ run/reload application

→ render in real preview

→ inspect browser/runtime result

→ discover problems

→ repair

→ rerun

→ verify

→ capture evidence

→ complete

LiTT must NOT skip from:

EDITING

directly to:

COMPLETED

for user-facing work.

---

# PART 5 — STUDIO IS THE MAIN OPERATING ENVIRONMENT

Studio should not feel primarily like ChatGPT.

Studio should feel like an AI IDE/operator console.

## Desktop layout

Default:

Approximately 35–40% workspace/operator area.

Approximately 60–65% live application preview.

The live preview stays visible.

The user should not constantly switch tabs to understand what LiTT is doing.

## Left/operator area

Contains:

conversation

current objective

compact plan

meaningful execution events

files changed

errors discovered

verification state

questions requiring user decisions

Do not flood this area with raw terminal output.

## Right/preview area

Contains the actual running application.

This is the center of trust.

LiTT must visually operate this application through a real browser-control runtime.

---

# PART 6 — REAL BROWSER CONTROL

Use Playwright or an equivalent real browser automation engine.

This must NOT be simulated.

LiTT needs real capabilities for:

navigation

clicking

typing

form submission

scrolling

hovering

responsive resizing

URL inspection

DOM inspection

accessibility-role inspection

console inspection

network failure inspection

page error inspection

screenshots

browser assertions

session state

authenticated flows where permitted

The user should actually see the application respond while LiTT operates it.

## Browser event examples

Navigated to `/dashboard`.

Clicked “Create project”.

Entered project name.

Submitted form.

Detected HTTP 500.

Opened console error.

Changed component.

Reloaded preview.

Retried form.

Success toast detected.

Screenshot captured.

Verification passed.

Every one of these displayed events must correspond to a real runtime event.

---

# PART 7 — MANUAL TAKEOVER

The user must always remain above the agent.

Studio needs:

Pause LiTT.

Resume LiTT.

Stop run.

Step mode.

Manual browser takeover.

Return control to LiTT.

When the user manually interacts with the browser:

LiTT must recognize it.

LiTT should pause browser manipulation or enter observation mode.

LiTT must not fight the user for control.

---

# PART 8 — EXECUTION SPEED

Provide:

NORMAL

FAST

TURBO

NORMAL:

Human-readable sequence of major actions.

FAST:

Reduced delay and grouped low-risk actions.

TURBO:

Run as quickly as practical while preserving full execution evidence.

Speed affects presentation/execution pacing.

It must NEVER weaken verification.

---

# PART 9 — TRUTHFUL EVENT SYSTEM

Build a structured event stream.

Use WebSocket or SSE where appropriate.

Every meaningful runtime action should emit a structured event.

Suggested event schema:

`runId`

`eventId`

`timestamp`

`phase`

`source`

`action`

`status`

`summary`

`payload`

`artifactIds`

`duration`

`error`

Sources may include:

agent

filesystem

terminal

browser

test

deployment

database

provider

infrastructure

Events should be persisted.

Studio renders events.

Studio should NOT invent execution state independently.

---

# PART 10 — FILE OPERATIONS

Every file mutation should produce:

file path

operation type

before hash/version

after hash/version

diff

reason

run ID

timestamp

File change cards should show:

filename

purpose

additions/deletions

expandable diff

Open file action

Do not bury source changes inside terminal text.

---

# PART 11 — TERMINAL / PROCESS EXECUTION

Terminal is an implementation layer, not the primary UI.

A controlled process executor should capture:

command

working directory

environment classification

stdout

stderr

exit code

duration

cancel state

run ID

Secret values must never appear in logs.

Terminal cards should default to compact output.

Raw output remains expandable.

Failures must remain visible.

Never convert:

exit code 1

into:

“Continuing…”

without exposing the failure.

---

# PART 12 — PREVIEW RUNTIME

LiTT must know what application it is rendering.

Create a runtime/preview manager capable of identifying:

local development server

local production build

Railway preview

Railway production

Cloudflare-hosted endpoint

custom deployment URL

The preview must visibly identify:

LOCAL

STAGING

PRODUCTION

CUSTOM

Never allow the user to mistake local results for production.

Provide:

URL bar

reload

hard reload

external open

desktop viewport

tablet viewport

mobile viewport

custom width

zoom

screenshot

console badge

network badge

runtime-health indicator

---

# PART 13 — VERIFICATION ENGINE

LiTT's most important behavioral rule:

“Complete” means verified.

Final states:

VERIFIED

PARTIALLY VERIFIED

BLOCKED

FAILED

CANCELLED

VERIFIED means there is direct evidence.

PARTIALLY VERIFIED means the agent clearly identifies what was not checked.

BLOCKED means a prerequisite prevented verification.

FAILED means the attempted implementation/check remains broken.

## UI work verification

Require appropriate combination of:

actual rendered page

exact route

screenshot

responsive check

Playwright assertion

console status

browser error status

## Functional change verification

Require:

relevant automated test

browser flow when user-facing

persistence/network result when applicable

## Bug fix verification

Require:

original reproduction when feasible

actual code diff

rerun of failing flow

success evidence

## Deployment verification

Require:

deployment target

deployment status

deployed commit

live URL

post-deploy request

browser smoke test

environment clearly labeled

Never call production verified based solely on local testing.

---

# PART 14 — COMPLETION RECEIPT

Every completed task should generate a verification receipt.

Example:

VERIFIED

Task:
Fix dashboard media player.

Changed:
`MediaDock.tsx`
`useMediaHub.ts`

Runtime:
Local development server.

Tests:
Media Hub tests 18/18.

Browser:
`/dashboard`

Viewport:
1440×900
390×844

Browser checks:
Playback button visible.
Track loaded.
Play triggered.
Pause triggered.
Next track triggered.

Console:
0 new errors.

Evidence:
Desktop screenshot.
Mobile screenshot.
Playwright result.

Deployment:
Not performed.

Remaining risk:
Streaming provider availability not tested.

This is far better than:

“Done! Everything looks good.”

---

# PART 15 — PROVIDER ARCHITECTURE

Model routing needs a strict provider abstraction.

Do not let UI labels determine runtime transport.

A model definition should clearly contain:

internal model ID

display name

provider

provider model ID

transport

capabilities

pricing metadata

free/paid classification

tool capability

context window

output limit

fallback policy

availability status

## Critical routing rule

OpenAI should remain the primary/default provider where the product contract says OpenAI is the default.

OpenRouter is a transport/provider option.

OpenRouter must NOT silently become the default because:

remote mode is enabled

a provider field is missing

a UI model label was selected incorrectly

a fallback route accidentally catches the request

## Model registry validation

At startup/build/test time, validate:

provider exists

provider model ID exists syntactically

transport supports provider

model ID is not malformed

free model is correctly classified

tool-support capability is declared

output limits are sane

fallback configuration is valid

Do not hardcode guessed model IDs.

The recent failure:

`zai/glm-5.3-flash`

shows why display-name/provider-ID synchronization must be enforced.

A UI label such as:

`GLM-5.3-Flash`

must never be enough to construct an OpenRouter model ID by string concatenation.

Use explicit registry metadata.

---

# PART 16 — FREE MODEL COMPATIBILITY

Some free/small models do not implement structured tool calling correctly.

They may emit raw textual structures such as:

```tool_call

instead of real structured `tool_calls`.

Therefore LiTT requires a compatibility layer.

Responsibilities:

detect structured tool calls

detect textual tool-call envelopes

prevent protocol text from leaking to users

attempt safe parsing when supported

strip malformed protocol fragments

never expose internal runtime syntax

The recent unclosed-fence case must remain covered.

A malformed opener with no closing fence must not leak.

Add regression fixtures for:

closed tool_call fence

unclosed tool_call fence

multiple tool blocks

tool text mixed with user prose

partial streamed fence

JSON fragment

valid structured tool call

No user-facing output should contain raw internal tool protocol unless explicitly requested for debugging.

---

# PART 17 — CONTEXT AND TOKEN CONTROL

Remote execution needs a guaranteed output limit.

Do not blindly request huge token counts.

Normalize requested output based on:

provider maximum

model maximum

user/task policy

account limits when known

runtime safety ceiling

The backend must retain final authority over token caps.

Never rely solely on the client.

---

# PART 18 — APPROVAL SYSTEM

Actions should be classified.

## Safe autonomous actions

Read project files.

Search project.

Edit local code.

Run local tests.

Start local preview.

Interact with local preview.

Take screenshots.

Inspect browser/console.

## Confirmation-required actions

Production deployment.

Production database mutation.

Destructive migration.

Deleting data.

Deleting branches containing unique work.

Changing billing.

Publishing external content.

Sending messages.

Rotating secrets.

Production infrastructure destruction.

Potentially expensive external jobs.

Permissions should be policy-driven, not ad hoc prompts scattered throughout components.

---

# PART 19 — INFRASTRUCTURE ABSTRACTION

LiTT is the control plane.

Railway, Cloudflare, Supabase, Clerk, GitHub, Stripe, R2, LiveKit, model providers, etc. are infrastructure adapters.

Users should not have to wire everything manually unless they deliberately choose advanced configuration.

Desired conceptual structure:

LiTT

→ Runtime

→ Compute adapter

→ Database adapter

→ Storage adapter

→ Authentication adapter

→ AI provider adapter

→ Deployment adapter

→ DNS/CDN adapter

Default providers may exist.

But product architecture must not hard-depend on one vendor.

Example:

Compute adapter:
Railway default.

DNS/CDN:
Cloudflare default.

Database:
Supabase/Postgres default.

Authentication:
Clerk.

Storage:
Cloudflare R2 / Supabase depending workload.

AI:
OpenAI primary plus explicit provider routing/fallback architecture.

Realtime:
appropriate current LiTT infrastructure.

LiTT orchestrates these behind the scenes.

---

# PART 20 — DEPLOYMENT MODEL

A deployment should become a LiTT operation.

User says:

“Deploy this.”

LiTT should determine:

repository state

target service

branch

build status

required environment configuration

deployment command/API operation

deployment status

live URL

Then verify the deployed application.

The user should see a clean operation such as:

Preparing build.

Build passed.

Deploying web service.

Railway deployment active.

Cloudflare route healthy.

Opening production URL.

Running smoke test.

Production verification passed.

Infrastructure detail should remain available in an expandable advanced view.

---

# PART 21 — DASHBOARD

Dashboard v3 remains the authoritative direction.

Do not restore old Dashboard v2 work.

Dashboard should be the user's home operating surface.

It should answer:

What was I working on?

What is LiTT doing?

What should I continue?

What media/project activity happened recently?

What requires my attention?

What can I start quickly?

The dashboard should remain polished and simple.

Do not turn it into infrastructure Mission Control.

Technical infrastructure belongs behind the product unless surfaced contextually.

The existing Media Hub architecture should remain centralized.

Do not create duplicate playback contexts.

Dashboard media controls should consume the shared media provider.

---

# PART 22 — STUDIO

Studio is where the serious building happens.

Studio should contain:

LiTT conversation/operator panel

live browser preview

files

focused diff

terminal

activity

browser inspection

runtime state

verification evidence

optional advanced tools

Secondary creative capabilities can include:

image

video

audio

music

canvas-like workflows where applicable

agents

missions

workflows

But these should integrate into the same run/event/artifact model.

Do not build them as unrelated mini-apps.

---

# PART 23 — ARTIFACT SYSTEM

Every run should persist useful artifacts.

Possible artifacts:

screenshots

before/after images

Playwright traces

browser video

DOM snapshots

test results

coverage reports

file diffs

command logs

deployment receipts

verification receipts

generated assets

Users should be able to reopen a historical run and understand:

what they asked

what LiTT planned

what files changed

what commands ran

what browser actions happened

what failed

what was repaired

what verification succeeded

what was deployed

---

# PART 24 — OBSERVABILITY

LiTT needs internal observability without dumping noise on users.

Capture:

run timings

provider latency

tool latency

browser failures

process failures

token consumption

fallback activation

model routing

deployment timing

verification failures

agent retries

runtime exceptions

User-facing interface shows only meaningful information.

Developer Drawer exposes deeper telemetry.

---

# PART 25 — SECURITY

Maintain strict boundaries.

Never leak API secrets to:

PTY sessions

browser bundles

logs

screenshots

event payloads

model context unnecessarily

frontend source

Use allowlists for PTY environment variables.

Use server-side provider credentials.

Require authenticated access for protected runtime operations.

Maintain workspace ownership boundaries.

Use Supabase RLS where applicable.

Fail closed where authorization cannot be proven.

Audit destructive or externally visible operations.

---

# PART 26 — MOBILE

The experience must remain responsive.

On smaller screens, do not attempt to preserve a tiny 40/60 desktop split.

Use deliberate mobile modes.

Possible mobile navigation:

Operator

Preview

Activity

Files

Terminal

The active run must continue when switching views.

Provide a quick Preview/Operator toggle.

Browser control and verification must remain visible and understandable.

---

# PART 27 — TEST STRATEGY

Testing must be layered.

## Unit

provider registry

routing

token caps

tool-call parser

event reducers

verification state machine

permission policy

workspace resolution

## Integration

agent → file editor

agent → terminal

agent → preview

agent → provider

browser → event stream

browser → verification engine

runtime → completion receipt

## End-to-end

User requests UI change.

LiTT edits actual file.

Server rebuilds.

Preview updates.

LiTT opens affected route.

LiTT interacts with element.

LiTT verifies expected state.

LiTT captures evidence.

LiTT marks run VERIFIED.

This should become the golden LiTT E2E test.

---

# PART 28 — CURRENT TEST DEBT

The previous integration work exposed approximately:

7 provider-registry failures.

4 remote billing/error classification failures.

Do not label them “pre-existing” and ignore them forever.

Resolve them against the intended current runtime contract.

Determine whether each represents:

stale test

runtime bug

provider regression

routing regression

fallback regression

billing classification bug

error parsing bug

Update tests only if current intended behavior proves the old expectation is wrong.

OpenAI-default behavior must receive explicit regression coverage.

---

# PART 29 — BUILD GATES

Before integration to main:

Repository state known.

No unresolved merge.

No unintended dirty worktree.

Recovered code reviewed.

TypeScript passes.

Relevant unit tests pass.

CLI tests pass.

Terminal-server tests pass.

App tests pass.

Production build passes.

Browser E2E passes.

Dashboard v3 visually verified.

Studio visually verified.

Provider routing verified.

No new console errors.

Verification receipts generated correctly.

Only then should the integration branch be eligible for main.

---

# PART 30 — PRODUCTION GATES

After deployment:

Verify exact deployed commit.

Verify health endpoints.

Open production site.

Authenticate if appropriate.

Open Dashboard.

Open Studio.

Run representative browser interaction.

Inspect console.

Inspect failed network requests.

Verify model routing.

Verify tool-call sanitization.

Verify terminal/runtime connectivity.

Verify voice path when touched by the release.

Verify mobile viewport when relevant.

Production is not VERIFIED until these checks happen against production.

---

# PART 31 — HERMES IMPLEMENTATION ORDER

Do not attempt everything simultaneously.

Build/fix in this order:

PHASE 0 — Repository recovery

Create one clean authoritative integration branch.

Recover only valid missing work.

Resolve the 11 known failures.

Confirm current main features remain intact.

PHASE 1 — Execution/event spine

Implement durable runs.

Implement structured events.

Implement statuses.

Implement cancellation.

Make all existing tools emit events.

PHASE 2 — Permanent Studio preview

Make the real runtime preview central.

Implement environment indicator.

Responsive viewport.

Reload.

Screenshot.

Health/error state.

PHASE 3 — Playwright operator

Navigate.

Click.

Fill.

Scroll.

Inspect.

Screenshot.

Console.

Page error.

Network failure.

Assertions.

PHASE 4 — Visible execution

Render real events.

File diff cards.

Command cards.

Browser action cards.

Error cards.

Verification cards.

PHASE 5 — Verification state machine

Prevent false completion.

Generate receipts.

Require evidence.

PHASE 6 — User control

Pause.

Resume.

Stop.

Step.

Manual takeover.

Normal/Fast/Turbo.

PHASE 7 — Provider stabilization

Normalize registry.

Fix bad model IDs.

OpenAI-default tests.

Free-model compatibility.

Token caps.

Fallback rules.

PHASE 8 — Infrastructure control plane

Deployment adapters.

Environment health.

Database/storage/provider abstractions.

Deployment receipts.

PHASE 9 — Artifact persistence

Screenshots.

Traces.

Diffs.

Logs.

Historical runs.

PHASE 10 — Full production proof

Local E2E.

Staging E2E.

Production E2E.

Desktop.

Mobile.

---

# PART 32 — UX RULE

At every moment the user should be able to answer:

What is LiTT doing?

Why is it doing that?

What changed?

Where is it operating?

Did it succeed?

What evidence proves that?

Can I stop it?

Can I take control?

If the UI cannot answer those questions, the execution experience is incomplete.

---

# PART 33 — DO NOT FAKE THE MOUSE

A visible pointer is optional presentation.

A real browser session is mandatory.

Never create cursor animations disconnected from Playwright.

If showing a LiTT pointer, its coordinates/actions must originate from actual browser actions.

The point is not:

“Watch an animated mouse.”

The point is:

“Watch LiTT operate the real application.”

---

# PART 34 — FINAL DEFINITION OF LiTT

LiTT should behave like this:

User:

“Make my dashboard media player better. It doesn't work on mobile.”

LiTT:

Inspects project.

Identifies shared Media Hub.

Creates short execution plan.

Opens dashboard locally.

Reproduces mobile problem.

Captures before state.

Edits relevant files.

Reloads application.

Switches preview to mobile.

Clicks Play.

Detects failure.

Inspects console.

Repairs issue.

Reloads.

Clicks Play.

Seeks.

Pauses.

Changes track.

Checks volume.

Checks desktop.

Runs tests.

Runs build.

Captures after screenshots.

Produces verification receipt.

Then says:

VERIFIED.

That is LiTT.

Not:

“I changed the player. Let me know if you need anything else.”

---

# PART 35 — HERMES OPERATING RULES

Hermes must work incrementally.

Do not make giant blind rewrites.

Do not resurrect stale architecture.

Do not merge old branches wholesale.

Do not delete safety branches until final reconciliation is proven.

Do not deploy merely because build succeeds.

Do not change tests simply to get green output.

Do not silently change the default AI provider.

Do not invent model IDs.

Do not duplicate working providers/contexts/services.

Do not declare completion without runtime evidence.

Prefer:

inspect

→ smallest correct change

→ run

→ observe

→ repair

→ verify

→ continue

For every phase Hermes completes, provide:

Current branch.

HEAD.

Files changed.

Architecture affected.

Tests run.

Tests passing/failing.

Browser evidence.

Remaining risks.

Next phase.

---

# ULTIMATE ACCEPTANCE TEST

LiTT is ready when this works end-to-end:

The user opens Studio.

The application preview is visible immediately.

The user says:

“Change this button and make sure it works on mobile.”

LiTT understands the request.

LiTT identifies the correct project.

LiTT creates a visible plan.

LiTT changes the correct file.

The user sees the change event.

The application rebuilds.

The preview refreshes.

LiTT switches to mobile.

The user watches LiTT navigate the actual application.

LiTT clicks the actual button.

If it fails, the user watches LiTT discover the failure.

LiTT changes the implementation.

The preview refreshes.

LiTT retries the exact interaction.

The browser behavior succeeds.

LiTT checks the console.

LiTT runs the relevant test.

LiTT captures a screenshot.

LiTT stores the diff and evidence.

LiTT marks the task:

VERIFIED.

The entire run can later be reopened and audited.

That is the architecture Hermes should build toward.

Do not optimize LiTT around making AI responses look impressive.

Optimize LiTT around making AI work visible, controllable, recoverable, and provably correct.
