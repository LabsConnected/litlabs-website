# P0 Live End-to-End Validation — Infrastructure Reality Check

**Date:** 2026-10-09
**Branch:** `gate1/static-workspace-no-git`

## What Can Run Real Locally vs. What Stays Mocked

### Clerk Authentication — MOCKED
**Status:** Mocked in all tests. No `.env.local` exists in this environment; no Clerk dev keys configured.

**Why mocked:** Real Clerk auth requires:
1. `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` and `CLERK_SECRET_KEY` in `.env.local`
2. A Clerk development instance (Larry has one: "LiTTree LabStudios → Development")
3. The test runner to simulate a signed-in session (Clerk's testing tokens)

**To unmock:**
1. Add Clerk dev keys to `.env.local`
2. Use Clerk's `testing` token provider in vitest setup
3. Replace `vi.mock("@/lib/auth")` with real `auth()` calls using test sessions

**Risk if not validated:** Auth bypass or session confusion in the publish route. The route code follows the same `auth()` + `getProject()` pattern as 20+ existing routes, so risk is low but non-zero.

### AI Agent Loop (LLM) — MOCKED
**Status:** LLM responses mocked. The real tool dispatch path (`files.write` → handler → transport) is tested with the real handler code.

**Why mocked:** Real LLM calls require:
1. `GROQ_API_KEY` or `OPENAI_API_KEY` in env (none configured locally)
2. Network access to the LLM provider
3. Non-deterministic output makes assertions fragile

**To unmock:**
1. Set `GROQ_API_KEY` in `.env.local`
2. Write an integration test that sends "create an index.html" through `runAgentLoopV2` with a real LLM call
3. Assert the resulting files exist (don't assert exact content)

**Risk if not validated:** The agent might not choose to call `files.write`, or might call it with wrong arguments. The tool is registered and the handler works, but the LLM's tool-calling behavior is unverified.

### Terminal Server (Workspace Storage) — MOCKED
**Status:** In-memory file store behind the real `/ws-files` HTTP contract.

**Why mocked:** The terminal server is a separate Railway service. Running it locally requires:
1. Docker (for the terminal-server container)
2. `TERMINAL_INTERNAL_SERVICE_KEY` configured
3. Network routing between Next.js dev server and terminal server

**To unmock:**
1. Run `terminal-server` locally via Docker Compose (if a compose file exists) or directly with `pnpm dev`
2. Set `TERMINAL_BASE_URL=http://localhost:<port>` and `TERMINAL_INTERNAL_SERVICE_KEY`
3. Replace the in-memory mock with real HTTP calls

**Risk if not validated:** The real terminal server might reject the `sourceType: "static"` (if the deployed version predates commit 47d43a6f), or the `/ws-files` contract might differ. **This is the highest-risk mock** — the static workspace code only exists in the local branch, not in production.

### Hosting Backend (Railway) — MOCKED
**Status:** `isConfigured()` returns false without Railway credentials; deploy tests inject a fake backend.

**Why mocked:** Real publishing requires:
1. `RAILWAY_API_TOKEN`, `RAILWAY_SERVICE_ID`, `RAILWAY_ENVIRONMENT_ID` in env
2. Actually creating Railway deployments (costs money, affects production)

**To unmock:**
1. Set Railway credentials in `.env.local` (dev project, NOT production)
2. Run publish against the dev Railway project
3. Verify the public URL serves over real HTTPS

**Risk if not validated:** The Railway domain resolution might fail, or the deployment might not become publicly accessible. The `deployUserProject` flow was designed against the real Railway API, but hasn't been exercised end-to-end.

### Supabase (Deployment Store) — MOCKED
**Status:** Deployment store mocked in tests. Real Supabase used in production.

**Why mocked:** Tests shouldn't write to the real database.

**To unmock:** Use a Supabase test project or local Supabase (via `supabase start`).

**Risk if not validated:** Low — the store is a thin wrapper around Supabase queries, and the same pattern is used in production by the `/deployments` page.

## Summary: What's Real vs. Mocked

| Component | Test Status | Production Reality |
|-----------|-------------|-------------------|
| Route handlers (publish/unpublish/status) | Real code, mocked deps | Needs real Clerk + Supabase |
| UI components (buttons, states) | Real React, mocked fetch | Needs real API |
| Deploy service logic | Real code, mocked hosting | Needs Railway creds |
| Workspace transport | Real code, mocked terminal | Needs terminal server |
| Agent tool dispatch | Real handler, mocked LLM | Needs LLM API key |
| Gate 1 guards | Real (pure functions) | ✅ Already real |
| Zero-subprocess guarantee | Real (mocked child_process) | ✅ Already real |

## First Blocker to Production Launch

**The terminal server in production doesn't have the static workspace code.** Commits 47d43a6f through the current branch are local-only. Before any user can provision a static workspace in production:

1. The `gate1/static-workspace-no-git` branch must be merged and deployed to the terminal server
2. The web app must be deployed with the `sourceType: "static"` routing
3. A real authenticated user must complete: create → AI writes → preview → publish → public URL

Until then, everything above is validated in isolation but not as a production system.
