# LitLabs Workspace Deep Dive

**Date:** 2026-07-14  
**Scope:** opened workspace, project checkouts, Devin/Cline/Cursor instructions, source/configuration, dependencies, database artifacts, CI, tests, lint, type-check, and production build.

## Executive conclusion

The application builds successfully and strict TypeScript is clean. This remediation pass fixed the failing Settings smoke test, reconciled the main agent guidance, replaced the boilerplate README, and added lint/test CI gates. Remaining risks are operational drift between two project checkouts, incomplete environment documentation, and unrelated concurrent changes in the working tree.

The earlier Cline report is useful but incomplete. Its corrected claims about the Google SDKs and `.env.example` are valid, while several important issues below were not covered.

## Repository topology

- The opened folder is `C:\Users\litbi\CascadeProjects\litlabs`.
- That folder is not a usable Git repository; its `.git` directory is empty.
- The audited Git checkout inside it is `reference-repo`, remote `LabsConnected/litlabs-website`.
- A second checkout exists at `C:\Users\litbi\CascadeProjects\litlab`.
- During this audit, `reference-repo` advanced from `4d7013e` to `13a0d46`, showing that another process or agent was committing concurrently.
- The `reference-repo` working tree continued changing during the audit (additional API-route edits and `src/lib/authz.ts` appeared); the sibling `litlab` checkout had modified VS Code files and two untracked reports. Treat exact dirty-file counts as a moving snapshot until concurrent work stops.

This topology is the first thing to fix. Humans and agents can inspect, test, or commit the wrong clone while believing they are working on the same project.

## Verification results

| Gate | Result | Evidence |
| --- | --- | --- |
| Production build | PASS | Next.js 16.2.10 compiled, type-checked, and generated 94 static pages |
| Strict TypeScript | PASS | `tsc --noEmit --incremental false`, Node 22.22.3 |
| ESLint | PASS with warnings | 0 errors, 9 warnings |
| Tests | PASS | 1 smoke test passed after Settings persistence wiring |
| Test depth | INADEQUATE | One source-text smoke test; no behavioral/unit/integration coverage |

The production build also warned that a custom `Cache-Control` header targets `/_next/static/(.*)`. Next owns caching for this path, so the custom header should be removed unless there is a demonstrated need.

## Highest-priority work

### P0 — choose one canonical local checkout

Decide whether `litlab` or `litlabs\reference-repo` is the writable source of truth. Then:

1. Open that directory directly as the IDE workspace.
2. Archive or clearly mark the other checkout read-only.
3. Remove or repair the empty outer `.git` directory.
4. Update every local path in `.devin-config.json`, `devin.config.json`, `.clinerules`, `.cursorrules`, launch settings, and task scripts.

Do not merge or delete either checkout until their uncommitted work has been reviewed.

### P0 — finish Settings preference persistence (fixed in this pass)

`src/app/settings/page.tsx` now loads and saves notification/workspace values through `/api/settings/preferences`. It retains localStorage as an offline fallback and surfaces API errors in the UI.

Required behavior:

- Load server preferences for signed-in users.
- Save notification and workspace changes through the API.
- Define a deliberate local fallback/offline policy.
- Avoid storing sensitive webhook URLs or BYOK secrets in plain browser storage unless that is an explicit product decision.
- Replace source-string assertions with behavioral tests of load/save/error flows.

### P0 — make CI enforce the real quality gates (fixed in this pass)

`.github/workflows/build.yml` now runs TypeScript, lint, tests, and the production build.

Add separate CI steps/jobs for:

- lint;
- tests;
- production build;
- terminal-server type/build checks where applicable.

### P1 — reconcile AI-agent instructions

Current instruction sources disagree:

- `.devin-config.json` says test `/jarvis`; `devin.config.json` says `/litt`.
- `.cursorrules` names nonexistent `src/lib/jarvis.ts`.
- `.cursorrules` references removed `src/app/(dashboard)/layout.tsx`.
- `.clinerules` calls `litt.ts` the main brain, but it is primarily a notification dispatcher exporting a legacy-named `jarvis` singleton.
- `AGENTS.md` says there is only one workflow and no build CI, while three workflows exist.
- Rules say certain directories are excluded by TypeScript when `tsconfig.json` does not include all of those exclusions.

Choose one canonical project facts document and generate or validate the tool-specific copies from it.

### P1 — replace misleading onboarding docs

- `README.md` is still create-next-app boilerplate and lists unsupported package managers.
- `docs/deep-scan-report.md` contains resolved or false claims, including strict mode being disabled and key tables being absent.
- `docs/page-audit-report.md` is stale.
- The sibling checkout's new Cline deep-dive report is untracked and is not present in `reference-repo`.

The README should cover product purpose, pnpm/Node requirements, canonical checkout, environment setup, architecture, commands, test status, deployment, and links to current docs.

### P1 — complete `.env.example`

The source references roughly 99 environment-variable names while `.env.example` declares 14. Some source references are system/internal variables, but important application variables are absent, including Clerk, Supabase, R2, GitHub App, terminal server, media providers, Spotify, VAPID, and public site/terminal URLs.

Build an intentionally grouped environment contract with `required`, `optional`, `server-only`, and `NEXT_PUBLIC_` sections. Never place real values in it. For local Stripe guidance, default to test-mode keys rather than `sk_live_...`.

### P1 — audit migration ordering and schema truth

Two migration files are dated `20261215`, five months in the future relative to this audit. If migrations are ordered lexically, normally dated migrations created in the meantime will run before them. Determine whether these files have been applied anywhere before renaming or replacing them.

Also, `supabase/schema.sql` contains the tables checked by the old report, but it is not a complete inventory of tables present across migrations. Document whether migrations or the schema snapshot are authoritative and add a schema verification workflow.

### P2 — dependency and dead-code cleanup

- `@usejarvis/brain` has zero source/test/script imports and is a removal candidate after checking runtime/config-based loading.
- Both Google SDKs are live: `@google/genai` is used by media routes and `@google/generative-ai` by the legacy Gemini/LLM layer. Do not remove either without a migration.
- `src/lib/TaskRepository.ts` has no importers and is a deletion or implementation candidate.
- Package name `frontend` is generic and does not match the repository/product.

### P2 — repository hygiene

- Root `query` contains only `state=all` and should be removed if no script consumes it.
- Root diagnostic files should be ignored or moved to an artifacts directory.
- `src/app/og-image.png/route.tsx` and `public/og-image.png` compete for the same conceptual asset. Confirm which response is served, then keep one documented mechanism.
- Large js-dos binaries should be checked for licensing, provenance, and whether Git LFS or an external asset/CDN is more appropriate.

### P2 — fix lint warnings

There are nine warnings: six unused suppression directives, two unoptimized images, and one image without an `alt` attribute. The missing alt text is the only direct accessibility defect and should be fixed first.

## Corrections to the pasted Cline summary

- Correct: strict TypeScript is enabled.
- Correct: the previously named core DB tables exist.
- Correct: `@usejarvis/brain` appears unused.
- Correct: `TaskRepository.ts` appears unused.
- Incorrect first-pass claim: both Google SDKs have zero imports. They are actively used by 11 files in the audited checkout.
- Incorrect first-pass claim: no `.env.example`. It exists, but is substantially incomplete.
- Missing from the summary: the only test fails.
- Missing from the summary: Settings persistence is half-implemented.
- Missing from the summary: CI does not run tests or lint.
- Missing from the summary: the opened workspace contains two diverging checkouts and an empty outer `.git` directory.
- Too broad: “all critical issues are resolved.” Build health is good, but the failing test and workspace/CI drift remain release-process blockers.

## Recommended execution order

1. Freeze concurrent changes briefly and choose the canonical checkout.
2. Reconcile and validate all agent/workspace paths and instructions.
3. Review the Settings persistence remediation and replace its source-text smoke assertion with a behavioral test.
4. Replace README and mark old audits superseded.
6. Complete the environment-variable contract.
7. Audit future-dated migrations and schema verification.
8. Clean dead dependency/code and stray artifacts.
9. Expand tests around auth, wallet/credits, Settings, Stripe webhooks, GitHub webhooks, and agent execution.

## Commands used for final verification

The final checks were run in `reference-repo` with PowerShell profiles disabled and Node 22.22.3 so the shell could not silently switch to the sibling checkout.

- `next build` — pass
- `tsc --noEmit --incremental false` — pass
- `eslint .` — pass with nine warnings
- `vitest run tests\smoke.test.ts` — pass
