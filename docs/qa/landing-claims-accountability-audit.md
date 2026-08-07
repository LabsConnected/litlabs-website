# LiTTree LabStudios — Landing Claims Accountability Audit

**Audit date:** 2026-08-07
**Auditor:** Devin (supervised)
**Source of truth for production blockers and route evidence:** [`docs/qa/production-readiness-report.md`](./production-readiness-report.md) (hereafter "QA Report")
**Scope:** Every capability claim on the home page (`/`) and landing page (`/landing`) is registered below with a test a stranger could run, the route(s) that implement it, and its current testability status.

> **Important distinction:** Route existence in the Next.js build manifest and verified end-to-end functionality are different claims. A route being registered means the code exists and is wired into the router. It does NOT prove the feature works end-to-end in production. Conversely, the P0 blockers described in QA Report §2 prevent clean production-mode runtime **in the tested local environment** — they do not prove the deployed Vercel site cannot execute these routes. The QA report explicitly states the Vercel environment was **not verified** (QA Report §9).

---

## 1. Registered Claims

### 1.1 "Bring the idea. LiTT helps you build the rest." (Hero headline)

- **Location:** `src/app/page.tsx` → `HomePageClient.tsx` hero section
- **Test:** Visit `https://litlabs.net/` — headline renders above the fold.
- **Route:** `/` (200 in dev, 206 static pages build successfully — QA Report §6.1)
- **Status:** ✅ Renders in dev. P0-2 (proxy.ts FATAL throw) has been remediated; a clean production-mode smoke test is required before claims can be upgraded (QA Report §2).

### 1.2 "Free to join" / "No credit card"

- **Location:** `HomePageClient.tsx` hero badges
- **Test:** Visit `/` — badges visible. Click sign-up — no payment prompt.
- **Route:** `/sign-up` (200 in dev — QA Report §6.2)
- **Status:** ✅ Renders in dev. P0-2 has been remediated; a clean production-mode smoke test is required before claims can be upgraded.

### 1.3 "from prompt to deployment"

- **Location:** `HomePageClient.tsx` workflow section heading
- **Test:** Visit `/` — workflow section describes the prompt-to-deploy pipeline.
- **Routes:** `/api/deploy/trigger`, `/api/deployments`, `/api/deployments/digest`, `/deployments` (all registered in build manifest — QA Report §6.1)
- **Status:** ✅ Routes exist and are registered. The original QA run could not validate production functionality because P0-1/P0-2/P0-3 were present at test time. P0-2/P0-3 have since been remediated; a new clean production-mode smoke test is required before capability claims can be upgraded (QA Report §2).
- **Verdict:** Route infrastructure exists. End-to-end deploy flow not independently tested. **Rewrite "deploy directly" to "deploy when configured" until a verified deploy is demonstrated.**

### 1.4 "asks for your approval, and ships the work"

- **Location:** `HomePageClient.tsx` "Why LiTTree is different" section
- **Test:** Trigger a mission that requires a sensitive action → approval prompt appears.
- **Routes:** `/api/approvals`, `/api/approvals/[approvalId]`, `/api/missions/approvals`, `/api/projects/[projectId]/visual-builds/[buildId]/approve` (all registered in build manifest)
- **Status:** ✅ Routes exist and are registered. The original QA run could not validate production functionality because P0-2/P0-3 were present at test time. Both have since been remediated; a clean production-mode smoke test is required before claims can be upgraded (QA Report §2).
- **Verdict:** Approval infrastructure exists; enforcement on specific critical actions (deploy, delete) requires verification. E2E approval flow not independently tested. **Rewrite "asks for your approval" to "LiTT is designed to ask for your approval before critical actions" — do not claim enforcement is proven.**

### 1.5 "Requires approval before critical actions" (LandingComparison)

- **Location:** `src/app/landing/_components/LandingComparison.tsx` — LITT_PROS array
- **Test:** Trigger a critical action (deploy, delete) → approval required.
- **Routes:** Same as §1.4 — `/api/approvals`, `/api/approvals/[approvalId]`, `/api/missions/approvals`
- **Status:** ✅ Routes exist and are registered. Production functionality not verified in the original QA run (P0-2/P0-3 present at test time, now remediated; clean smoke test required — QA Report §2).
- **Verdict:** Same as §1.4. Approval infrastructure exists; enforcement on specific critical actions requires verification. Not yet independently tested.

### 1.6 "Maintains persistent project memory"

- **Location:** `LandingComparison.tsx` — LITT_PROS array
- **Test:** Start a project, make decisions, close session, reopen → previous context preserved.
- **Routes:** `/api/studio-projects/[projectId]/checkpoints`, `/api/media/history`, `/api/terminal/history` (all registered)
- **Status:** ⚠️ Routes exist. `/api/system-health` reported `{"error":"System health unavailable — database not configured"}` during the original QA run (QA Report §6.2). Database connectivity is a prerequisite for persistence.
- **Verdict:** Route infrastructure exists. The original local QA environment lacked working database configuration at test time. Vercel production environment variables have since been verified present and encrypted; production database connectivity and persistent-memory behavior still require a clean smoke/E2E test. Defensible rewrite: "LiTT is designed to maintain persistent project memory" — but do not claim it as a tested capability until production database connectivity is verified.

### 1.7 "Project memory, version history, and human approvals keep the work moving forward"

- **Location:** `HomePageClient.tsx` "Preserve context" feature card
- **Test:** Open a project → see version history and approval records.
- **Routes:** `/api/canvases/[canvasId]/revisions`, `/api/studio-projects/[projectId]/checkpoints`, `/api/approvals` (all registered)
- **Status:** ✅ Routes exist and are registered. Production functionality not verified in the original QA run (P0-2/P0-3 present at test time, now remediated; clean smoke test required — QA Report §2). "Checkpoints are in beta" is already disclosed — good.
- **Verdict:** Route infrastructure exists. The "beta" qualifier on checkpoints is appropriate, but production database connectivity and persistent-memory behavior have not been verified yet. Keep the claim qualified until a clean smoke/E2E test confirms Supabase connectivity and persistence.

### 1.8 "deployed with one click"

- **Location:** `HomePageClient.tsx` "Build working products" feature card
- **Test:** Complete a project → click deploy → site goes live.
- **Routes:** `/api/deploy/trigger`, `/api/deployments` (registered)
- **Status:** ✅ Routes exist and are registered. Production functionality not verified in the original QA run (P0-2/P0-3 present at test time, now remediated; clean smoke test required — QA Report §2).
- **Verdict:** "One click" is a strong claim. **Rewrite to "deploy when ready"** until a verified one-click deploy is demonstrated. The apparent deploy flow includes approval infrastructure, but enforcement has not been independently verified (per §1.4), so "one click" may be inaccurate by design.

### 1.9 "Opens pull requests or deploys directly" (LandingComparison)

- **Location:** `LandingComparison.tsx` — LITT_PROS array
- **Test:** Complete a mission → choose PR or direct deploy → result appears on GitHub/Vercel.
- **Routes:** `/api/deploy/trigger`, `/api/deployments` (registered). GitHub integration via `GITHUB_APP_ID`, `GITHUB_PRIVATE_KEY` env vars.
- **Status:** ✅ Routes exist and are registered. GitHub env vars are present and encrypted in Vercel production (local `.env.local` had empty placeholders at original QA time — QA Report §2, P0-1). Production functionality not verified in the original QA run (P0-2/P0-3 present at test time, now remediated; clean smoke test required — QA Report §2).
- **Verdict:** Route infrastructure exists. **Defensible if GitHub app is configured.** Not independently tested.

### 1.10 "Tests and verifies the result automatically"

- **Location:** `LandingComparison.tsx` — LITT_PROS array
- **Test:** Run a mission → LiTT executes checks → results shown.
- **Routes:** Check execution is handled within agent orchestration (`src/lib/AgentOrchestrator.ts`, `src/lib/agents.ts`). No dedicated `/api/test` route — checks run inline during missions.
- **Status:** ⚠️ No standalone verification route. Functionality is embedded in the agent orchestration layer. Not independently testable via a URL.
- **Verdict:** **Cannot be independently verified by a stranger.** Defensible rewrite: "LiTT is designed to run checks and verify results" — avoid claiming it as a tested capability.

### 1.11 "Approval checkpoints" (LandingFeatures)

- **Location:** `LandingFeatures.tsx` — "AI Project Director" feature bullets
- **Test:** Run a mission → approval checkpoint appears at the right stage.
- **Routes:** `/api/approvals`, `/api/missions/approvals` (registered)
- **Status:** ✅ Routes exist and are registered. Production functionality not verified in the original QA run (P0-2/P0-3 present at test time, now remediated; clean smoke test required — QA Report §2).
- **Verdict:** Route infrastructure exists. Defensible with the same caveat as §1.4.

### 1.12 "Persistent across sessions" (LandingFeatures — Project Memory)

- **Location:** `LandingFeatures.tsx` — "Project Memory" feature bullets
- **Test:** Close session, reopen → project context preserved.
- **Routes:** `/api/studio-projects/[projectId]/checkpoints` (registered)
- **Status:** ⚠️ Route exists. The original local QA environment lacked working database configuration at test time (`/api/system-health` returned 503 — QA Report §6.2). Vercel production env vars have since been verified present and encrypted; production database connectivity still requires a clean smoke test.
- **Verdict:** Same as §1.6. Production database connectivity and persistent-memory behavior have not been verified yet.

### 1.13 "Vercel deployments" / "GitHub PRs" (LandingFeatures — Deployment Control)

- **Location:** `LandingFeatures.tsx` — "Deployment Control" feature bullets
- **Test:** Connect Vercel/GitHub → deploy → result visible.
- **Routes:** `/api/deploy/trigger`, `/api/deployments` (registered). Vercel project ID `prj_EnE4JStJUENM89PWov574Y9q7mTy` is configured.
- **Status:** ✅ Routes exist and are registered. Production functionality not verified in the original QA run (P0-2/P0-3 present at test time, now remediated; clean smoke test required — QA Report §2).
- **Verdict:** Route infrastructure exists. Defensible if Vercel/GitHub integration is configured.

### 1.14 "Export anytime" (implied by "Real Project Changes")

- **Location:** `HomePageClient.tsx` "Real Project Changes" feature card — "File creation & edits"
- **Test:** Export project files as a downloadable archive.
- **Route:** `/api/account/export` (registered in build manifest)
- **Status:** ✅ Route exists and is registered. Production functionality not verified in the original QA run (P0-2/P0-3 present at test time, now remediated; clean smoke test required — QA Report §2).
- **Verdict:** This is **account export infrastructure**, not necessarily project-file archive export. The route name (`/api/account/export`) suggests account-level data export, not a downloadable project-file archive. **Do not claim project-file export is proven.** Rewrite to "export your account data" until the route implementation is confirmed to produce a project-file archive.

### 1.15 "Collaborate" (implied by "collaborate and ship real work")

- **Location:** `HomePageClient.tsx` hero description, `landing/page.tsx` metadata
- **Test:** Invite a collaborator → they can see/edit the project.
- **Routes:** `/api/invites/create`, `/api/invites/list`, `/api/invites/redeem`, `/api/invites/validate`, `/api/gallery/[id]/share`, `/api/follows` (all registered)
- **Status:** ✅ Routes exist and are registered. Production functionality not verified in the original QA run (P0-2/P0-3 present at test time, now remediated; clean smoke test required — QA Report §2).
- **Verdict:** Social/share/invite infrastructure exists. However, invites/share/follows do not prove collaborators can **see or edit projects** — that would require verified project-level permission enforcement. Real project collaboration is unverified. **Rewrite "collaborate" to "share and invite" until project-level collaboration is verified.**

### 1.16 "Roll back if needed" (HomePageClient — Preserve context steps)

- **Location:** `HomePageClient.tsx` "Preserve context" steps array
- **Test:** Make changes → checkpoint → roll back to previous state.
- **Routes:** `/api/studio-projects/[projectId]/checkpoints`, `/api/canvases/[canvasId]/revisions` (registered). No explicit `/api/rollback` route.
- **Status:** ⚠️ Checkpoint/revision routes exist. No dedicated rollback route. Rollback may be implemented as "restore to checkpoint" within the checkpoint route, but this is not verified.
- **Verdict:** **No dedicated rollback route exists.** Checkpoint infrastructure exists. Defensible rewrite: "Review checkpoints and restore previous states" — avoid "roll back" as a specific action label until a rollback endpoint is confirmed.

### 1.17 Security headers claim (implied by production-readiness)

- **Location:** Not a landing page claim, but a verifiable production capability.
- **Test:** `curl -sI https://litlabs.net/ | grep -i 'content-security-policy\|strict-transport\|x-frame'`
- **Routes:** Set by `src/proxy.ts` `setCacheHeaders()` + Next.js default security headers.
- **Status:** ✅ **Security headers configured and verified in dev** (QA Report §6.2). Full CSP scoped to Clerk/Stripe/Supabase, HSTS with preload, X-Frame-Options: DENY, COOP: same-origin-allow-popups.
- **Verdict:** Security headers are configured and verified in dev. **Production verification still needed** — headers on the deployed Vercel site were not tested (QA Report §9). Do not call this a substantiated production capability until `curl -sI https://litlabs.net/` confirms the same headers on the live site.

### 1.18 "9,999+ LBC in circulation" / "99.9% Platform uptime" (LandingStats)

- **Location:** `LandingStats.tsx`
- **Test:** Verify LBC token supply on-chain. Verify uptime via status page.
- **Routes:** No on-chain token route. No status page route.
- **Status:** ⚠️ These are hardcoded marketing numbers, not dynamic data.
- **Verdict:** **Hardcoded stats.** "99.9% uptime" is not substantiated — no monitoring history or status page data was produced to verify it. A single degraded `/api/health` check in a local test environment does not calculate uptime and is not evidence against a historical claim. **Remove or mark as "target" metrics** until monitoring infrastructure exists.

### 1.19 "<300ms P95 agent latency" (LandingStats)

- **Location:** `LandingStats.tsx`
- **Test:** Measure agent response time via `/api/llm/health` or a real agent call.
- **Routes:** `/api/llm/health` (200 in dev — QA Report §6.2)
- **Status:** ⚠️ Hardcoded number. Not measured.
- **Verdict:** **Remove or mark as "target."** Not independently verifiable.

### 1.20 "Always-on crew" (LandingStats)

- **Location:** `LandingStats.tsx`
- **Test:** Check if agents are available 24/7.
- **Routes:** `/api/llm/health` confirms Gemini, Groq, OpenRouter available (QA Report §6.2).
- **Status:** ✅ AI providers are configured and healthy in dev.
- **Verdict:** Multi-provider AI availability is configured (Gemini, Groq, OpenRouter). However, one healthy `/api/llm/health` snapshot does not prove 24/7 or "always-on" availability. **Rewrite to "multi-provider AI availability"** — do not claim "always-on" without uptime monitoring data.

---

## 2. Summary Table

| # | Claim | Route(s) Exist? | Independently Testable? | Action |
| --- | --- | --- | --- | --- |
| 1.1 | "Bring the idea" headline | ✅ `/` | ✅ Renders | No change |
| 1.2 | "Free to join" / "No credit card" | ✅ `/sign-up` | ❌ Signup not completed | Sign-up renders; flow not verified |
| 1.3 | "from prompt to deployment" | ✅ `/api/deploy/*` | ❌ Not E2E tested | Soften "deploy directly" |
| 1.4 | "asks for your approval" | ✅ `/api/approvals` | ❌ Not E2E tested | Enforcement not proven; rewrite to "designed to" |
| 1.5 | "Requires approval before critical actions" | ✅ `/api/approvals` | ❌ Not E2E tested | Enforcement not proven |
| 1.6 | "Maintains persistent project memory" | ✅ `/api/checkpoints` | ❌ Production persistence not E2E verified | Add "designed to" |
| 1.7 | "Project memory, version history, approvals" | ✅ Multiple | ❌ Not E2E tested | Keep qualified until DB + E2E pass |
| 1.8 | "deployed with one click" | ✅ `/api/deploy/*` | ❌ Not E2E tested | Rewrite to "deploy when ready" |
| 1.9 | "Opens PRs or deploys directly" | ✅ `/api/deploy/*` | ❌ Not E2E tested | Defensible if GitHub configured |
| 1.10 | "Tests and verifies automatically" | ⚠️ Embedded | ❌ No standalone route | Rewrite to "designed to" |
| 1.11 | "Approval checkpoints" | ✅ `/api/approvals` | ❌ Not E2E tested | Enforcement not proven |
| 1.12 | "Persistent across sessions" | ✅ `/api/checkpoints` | ❌ Production persistence not E2E verified | Add "designed to" |
| 1.13 | "Vercel deployments" / "GitHub PRs" | ✅ `/api/deploy/*` | ❌ Not E2E tested | Defensible if configured |
| 1.14 | "Export anytime" | ✅ `/api/account/export` | ❌ Not E2E tested | Account export infra, not project-file export |
| 1.15 | "Collaborate" | ✅ `/api/invites/*` | ❌ Not E2E tested | Social/share infra exists; collaboration unverified |
| 1.16 | "Roll back if needed" | ⚠️ Checkpoints exist, no rollback route | ❌ Not E2E tested | Rewrite to "restore previous states" |
| 1.17 | Security headers | ✅ `src/proxy.ts` | ✅ Verified in dev | Production verification still needed |
| 1.18 | "9,999+ LBC" / "99.9% uptime" | ⚠️ Hardcoded | ❌ No monitoring data | Remove or mark as target |
| 1.19 | "<300ms P95 latency" | ⚠️ Hardcoded | ❌ Not measured | Remove or mark as target |
| 1.20 | "Always-on crew" | ✅ `/api/llm/health` | ✅ Providers healthy in dev | Rewrite to "multi-provider AI availability" |

---

## 3. Routes That Exist But Cannot Be Verified in the Tested Environment

The following routes are **implemented and registered** in the application build manifest (206 static pages, QA Report §6.1). The original QA run could not validate their production functionality because P0-1/P0-2/P0-3 were present at test time. **P0-2 and P0-3 have since been remediated; Vercel production env vars are present and encrypted.** A new clean production-mode smoke test is required before the capability claims can be upgraded.

> **Critical nuance:** The QA report explicitly states the Vercel environment was **not verified** (QA Report §9). The blanket 500 behavior was reproduced under local `next start` without Clerk configuration. These routes may function correctly on a deployed Vercel instance with real env vars — this was not tested and cannot be claimed either way.

### Approval / Audit Routes

- `/api/approvals` — list/create approvals
- `/api/approvals/[approvalId]` — get/update specific approval
- `/api/missions/approvals` — mission-level approvals
- `/api/projects/[projectId]/visual-builds/[buildId]/approve` — visual build approval

### History / Checkpoint / Revision Routes

- `/api/media/history` — media history
- `/api/terminal/history` — terminal history
- `/api/studio-projects/[projectId]/checkpoints` — project checkpoints
- `/api/canvases/[canvasId]/revisions` — canvas revisions

### Export Route

- `/api/account/export` — account data export

### Invite / Sharing / Follow Routes

- `/api/invites/create` — create invite
- `/api/invites/list` — list invites
- `/api/invites/redeem` — redeem invite
- `/api/invites/validate` — validate invite code
- `/api/gallery/[id]/share` — share gallery item
- `/api/follows` — follow/unfollow

### Deployment Routes

- `/api/deploy/trigger` — trigger deployment
- `/api/deployments` — list deployments
- `/api/deployments/digest` — deployment digest
- `/deployments` — deployments page

### Routes That Genuinely Do Not Exist

- **No `/api/audit` route** — audit logging is embedded in `src/lib/agent-logger.ts`, not exposed as a standalone API.
- **No `/api/rollback` route** — rollback is not implemented as a dedicated endpoint. Checkpoint/revision routes exist, but explicit rollback is not confirmed.

---

## 4. Defensible Rewrites

| Original Claim | Rewrite | Reason |
| --- | --- | --- |
| "asks for your approval, and ships the work" | "LiTT is designed to ask for your approval before critical actions" | Enforcement not proven; avoid absolute claims |
| "deployed with one click" | "deploy when ready" | Approval infrastructure exists, but enforcement has not been independently verified; "one click" remains unsubstantiated |
| "Maintains persistent project memory" | "LiTT is designed to maintain persistent project memory" | Original local QA environment lacked DB configuration; production persistence remains unverified |
| "Tests and verifies the result automatically" | "LiTT is designed to run checks and verify results" | No standalone verification route |
| "Export anytime" | "Export your account data" | Route is account export infra, not project-file archive export |
| "Collaborate" | "Share and invite" | Social/share infra exists; project collaboration unverified |
| "Roll back if needed" | "Review checkpoints and restore previous states" | No dedicated rollback route |
| "99.9% Platform uptime" | Remove or mark as "Target: 99.9%" | No monitoring history to substantiate |
| "<300ms P95 agent latency" | Remove or mark as "Target: <300ms" | Not measured |
| "Always-on crew" | "Multi-provider AI availability" | One health snapshot does not prove 24/7 availability |

---

## 5. What Is Genuinely Earned

**Security headers** (QA Report §6.2 — configured and verified in dev):

- CSP scoped to Clerk/Stripe/Supabase/AI providers
- HSTS with `max-age=63072000; includeSubDomains; preload`
- X-Frame-Options: DENY
- X-Content-Type-Options: nosniff
- COOP: same-origin-allow-popups
- Permissions-Policy: scoped (geolocation, microphone, camera, payment, usb)

Security headers are configured and verified in dev. **Production verification still needed** — headers on the deployed Vercel site were not tested (QA Report §9).

**AI provider health** (QA Report §6.2 — verified in dev):

- Gemini, Groq, OpenRouter all available via `/api/llm/health`
- Multi-provider AI availability is configured (not "always-on" — one snapshot does not prove 24/7)

**Build quality** (QA Report §6.1 — verified):

- `pnpm build` passes (exit 0)
- TypeScript passes
- 206 static pages build successfully

---

## 6. Cross-References

- **Production blockers (P0-1/P0-2/P0-3):** QA Report §2 — P0-2 and P0-3 have been remediated; P0-1 (Vercel env vars) verified present and encrypted. Clean production-mode smoke test remains outstanding.
- **Runtime/route evidence (dev server tests):** QA Report §6.2
- **Build verification:** QA Report §6.1
- **Security headers verification:** QA Report §6.2
- **API health endpoint results:** QA Report §6.2
- **What was NOT tested (including Vercel):** QA Report §9
- **Security/backup cleanup (legacy `.env.*` files):** QA Report §5, item #2

- **WAF Custom Rules Tuning Pack:** [`docs/qa/waf-custom-rules-tuning-pack.md`](./waf-custom-rules-tuning-pack.md)

---

## 7. Security Remediation — Legacy Backup

> **Do not print or inspect secret values.** This section recommends remediation only.

The directory `E:\LiTTreeLabStudio-legacy-backup-2026-07-30` contained seven+ `.env.*` files including `.env.vercel-prod` (QA Report §5, item #2). These have been moved to a `.env-secured/` subdirectory with permissions restricted to the current user.

**Recommended order of operations:**

1. **Assess exposure first** — determine whether the backup files were ever committed to git, uploaded, shared, or otherwise exposed. The QA process did not inspect the values and did not establish that the files were exposed.
2. **Rotate immediately if exposure is confirmed or uncertain** — Supabase service-role key, Stripe secret key, Clerk secret key. If the files were committed, uploaded, shared, or their handling is uncertain, treat the secrets as potentially compromised and rotate.
3. **If exposure is ruled out** — secure/delete the files (already done — moved to `.env-secured/`) and assess whether rotation is still warranted as a precaution.
4. **Verify rotation** by confirming the old keys no longer work.

**Note:** The Supabase CLI does not support service-role key rotation — this must be done via the Supabase Dashboard (Database Settings → API keys → Rotate).

---

*Audit generated by Devin. No app code was modified. No production configuration was changed.*
