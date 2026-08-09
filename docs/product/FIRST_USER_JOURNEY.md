# First User Journey — The Killer Path

> If this path is badass, you have something worth showing people.

## The frozen journey

```
LAND
 ↓
SIGN UP
 ↓
"What do you want to make?"
 ↓
Website
 ↓
Describe it normally
 ↓
LiTT creates a short plan
 ↓
BUILD IT
 ↓
LiTT visibly works
 ↓
REAL preview in minutes
 ↓
Talk / type changes
 ↓
Canvas if wanted
 ↓
Verification receipt
 ↓
Publish
 ↓
Come back tomorrow
 ↓
LiTT remembers everything
```

## Step-by-step specification

### Step 1: Landing

| Field | Value |
|---|---|
| **Screen** | Landing page (`/`) |
| **What user sees** | Hero, "Build with LiTT" CTA, features, testimonials |
| **Backend dependency** | None (static/marketing) |
| **Success condition** | User clicks "Get Started" or "Sign Up" |
| **Error/recovery** | N/A |
| **Analytics event** | `landing_view`, `landing_cta_click` |
| **Current state** | ✅ Landing page exists at `src/app/landing/` |

### Step 2: Sign Up

| Field | Value |
|---|---|
| **Screen** | Sign-up page (`/sign-up`) |
| **What user sees** | Clerk sign-up form (email, OAuth) |
| **Backend dependency** | Clerk authentication |
| **Success condition** | User creates account, redirected to onboarding or studio |
| **Error/recovery** | Clerk handles auth errors (invalid email, existing account) |
| **Analytics event** | `signup_start`, `signup_complete` |
| **Current state** | ✅ Sign-up layout exists at `src/app/sign-up/` |

### Step 3: "What do you want to make?"

| Field | Value |
|---|---|
| **Screen** | Onboarding route (`/onboarding`) — **NOT BUILT** |
| **What user sees** | Persona/category selection: Website, App, Game, Image, Music, Video, "Just explore" |
| **Backend dependency** | None (selection stored client-side or as user metadata) |
| **Success condition** | User selects "Website" |
| **Error/recovery** | User can skip onboarding → goes to Studio with blank project |
| **Analytics event** | `onboarding_start`, `onboarding_select_category`, `onboarding_complete` |
| **Current state** | ❌ NOT STARTED — no onboarding route |

### Step 4: Describe it normally

| Field | Value |
|---|---|
| **Screen** | Quick Build describe screen (`/build`) — **NOT BUILT** |
| **What user sees** | Large text input: "Describe what you want to make" + examples + voice option |
| **Backend dependency** | None (description is just text) |
| **Success condition** | User types description and clicks "Build" |
| **Error/recovery** | Empty description → disable button. Too long → truncate with warning. |
| **Analytics event** | `quickbuild_describe_start`, `quickbuild_describe_submit` |
| **Current state** | ❌ NOT STARTED |

### Step 5: LiTT creates a short plan

| Field | Value |
|---|---|
| **Screen** | Quick Build plan screen |
| **What user sees** | LiTT presents a concise plan: "I'll build a [type] website with [pages], [style]. Estimated time: X minutes." + "Build It" button |
| **Backend dependency** | LLM call to generate plan from description. No workspace needed yet. |
| **Success condition** | Plan appears in < 10 seconds. User clicks "Build It" |
| **Error/recovery** | LLM failure → retry with fallback provider. Plan too generic → user can edit before building. |
| **Analytics event** | `quickbuild_plan_generated`, `quickbuild_plan_accepted`, `quickbuild_plan_edited` |
| **Current state** | ❌ NOT STARTED |

### Step 6: BUILD IT — LiTT visibly works

| Field | Value |
|---|---|
| **Screen** | Quick Build progress screen |
| **What user sees** | LiTT mascot + live activity timeline: "Creating project → Writing files → Installing dependencies → Starting preview" |
| **Backend dependency** | Project creation, workspace provisioning, agent loop V2, workspace transport, tool registry |
| **Success condition** | Activity events stream in real-time. Each step completes visibly. No blank/loading dead time. |
| **Error/recovery** | Workspace provisioning failure → retry. Tool failure → error shown with context. Build failure → build-fix loop attempts repair. |
| **Analytics event** | `quickbuild_start`, `quickbuild_step_complete`, `quickbuild_build_complete`, `quickbuild_build_failed` |
| **Current state** | ❌ NOT STARTED — activity events exist in V2 but no Quick Build flow or activity card UI |

### Step 7: REAL preview in minutes

| Field | Value |
|---|---|
| **Screen** | Studio with Preview panel active |
| **What user sees** | Live website preview in iframe. Device toggle (desktop/tablet/mobile). Refresh button. |
| **Backend dependency** | Workspace dev server running. Preview URL accessible. |
| **Success condition** | Preview loads in < 5 minutes from "Build It" click. Website is interactive. |
| **Error/recovery** | Preview won't start → show error + retry. Preview blank → check dev server logs. |
| **Analytics event** | `preview_start`, `preview_ready`, `preview_failed` |
| **Current state** | ⚠️ PARTIAL — PreviewWorkspace exists but not verified for Quick Build flow |

### Step 8: Talk / type changes

| Field | Value |
|---|---|
| **Screen** | Studio chat (transcript + composer) |
| **What user sees** | Chat with LiTT about the website. Type or speak changes. LiTT responds and makes edits. |
| **Backend dependency** | Messages API, agent loop V2, workspace transport, tool registry |
| **Success condition** | User requests change → LiTT understands → applies edit via tools → preview updates |
| **Error/recovery** | LiTT misundertands → user clarifies. Tool failure → error shown. |
| **Analytics event** | `chat_message_sent`, `chat_edit_applied`, `chat_edit_failed` |
| **Current state** | ⚠️ PARTIAL — chat works but V2 path unverified, activity events not rendered as activity card |

### Step 9: Canvas if wanted

| Field | Value |
|---|---|
| **Screen** | Studio with Canvas panel |
| **What user sees** | Visual representation of website blocks. Can drag, edit, rearrange. |
| **Backend dependency** | Canvas API, canvas store, block renderer |
| **Success condition** | User opens canvas, sees visual representation, can make changes |
| **Error/recovery** | Canvas empty → prompt user to ask LiTT to populate. Blocks don't match code → known gap. |
| **Analytics event** | `canvas_open`, `canvas_block_edit`, `canvas_promote` |
| **Current state** | ⚠️ PARTIAL — Canvas exists but not connected to source code or agent loop |

### Step 10: Verification receipt

| Field | Value |
|---|---|
| **Screen** | Receipt card in transcript after LiTT completes work |
| **What user sees** | "✓ Build passed, ✓ Typecheck clean, ✓ Preview running, ✓ No console errors" |
| **Backend dependency** | Build-fix loop results, evidence collection, receipt rendering |
| **Success condition** | Receipt appears after every significant LiTT action. Claims are verified, not assumed. |
| **Error/recovery** | Check fails → show failure with details. No evidence → mark as unverified. |
| **Analytics event** | `receipt_generated`, `receipt_check_passed`, `receipt_check_failed` |
| **Current state** | ❌ NOT STARTED — build-fix loop runs but results not rendered as receipts |

### Step 11: Publish

| Field | Value |
|---|---|
| **Screen** | Publish dialog from Studio |
| **What user sees** | "Publish to [URL]" + deploy status + domain options |
| **Backend dependency** | Deployment system, deploy status tracking |
| **Success condition** | User clicks Publish → deployment runs → live URL provided |
| **Error/recovery** | Deploy fails → show error + retry. Domain unavailable → suggest alternatives. |
| **Analytics event** | `publish_start`, `publish_complete`, `publish_failed` |
| **Current state** | ⚠️ PARTIAL — deployment infrastructure exists but no guided publish from Studio |

### Step 12: Come back tomorrow

| Field | Value |
|---|---|
| **Screen** | Studio (same project, same conversation) |
| **What user sees** | LiTT greets user, references prior work. Conversation history intact. Project files preserved. |
| **Backend dependency** | Conversation persistence, memory service, project persistence |
| **Success condition** | User opens Studio → sees their project → conversation history loads → LiTT remembers context |
| **Error/recovery** | Session expired → re-auth. Project missing → show project list. |
| **Analytics event** | `return_visit`, `project_reopened`, `conversation_loaded` |
| **Current state** | ⚠️ PARTIAL — persistence exists but memory recall unverified |

## Journey status summary

| Step | Status | Blocker |
|---|---|---|
| 1. Landing | ✅ Ready | — |
| 2. Sign Up | ✅ Ready | — |
| 3. Onboarding | ❌ NOT STARTED | No onboarding route |
| 4. Describe | ❌ NOT STARTED | No Quick Build route |
| 5. Plan | ❌ NOT STARTED | No plan generation flow |
| 6. Build visibly | ❌ NOT STARTED | No Quick Build + no activity card UI |
| 7. Preview | ⚠️ PARTIAL | Preview exists but unverified in Quick Build context |
| 8. Talk/type changes | ⚠️ PARTIAL | Chat works but V2 unverified, no activity card |
| 9. Canvas | ⚠️ PARTIAL | Canvas not connected to code or agent |
| 10. Receipt | ❌ NOT STARTED | No receipt UI |
| 11. Publish | ⚠️ PARTIAL | Deploy infra exists, no Studio publish flow |
| 12. Return | ⚠️ PARTIAL | Persistence works, memory unverified |

**4 steps are NOT STARTED. 6 are PARTIAL. Only 2 are READY.**
