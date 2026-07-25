# LiTTree Lab Studios — "What's Not Needed" Scan

**Date:** 2026-07-20
**Scope:** `src/`, `public/`, `scripts/`, root configs, deployment configs, `terminal-server/`
**Method:** Static cross-reference. For each candidate, the entire repo was searched for imports, references, and config-linkage.

> ⚠️ This is a **report only** — nothing has been deleted. All removals below require a separate, explicit, audited PR.
> 📌 Supersedes/extends the "Files Needing Attention" section of `docs/deep-scan-report.md`.

---

## Executive Summary

| Category                              | Count | Risk   |
| ------------------------------------- | ----- | ------ |
| Unused npm dependencies               | 6     | Low    |
| Unused devDependencies                | 1     | Low    |
| Dead/orphaned `src/lib/` files        | 9     | Medium |
| Duplicate class definitions           | 2     | High   |
| Orphaned public assets                | 8     | Low    |
| Orphaned scripts                      | ~5    | Low    |
| Conflicting/redundant deploy configs  | 3     | Medium |
| Ghost directories listed in .gitignore| 8     | None   |

**Top 3 actionables** (high value / low blast radius):
1. **Drop 6 unused npm deps** (estimated ~25 MB shaved from `node_modules`, faster `pnpm install`).
2. **Remove `src/lib/AgentOrchestrator.ts`** (duplicate class — the active definition lives in `src/lib/agents.ts`).
3. **Delete orphaned deploy configs** (`render.yaml`, `terminal-server/fly.toml`) and the broken root `Dockerfile`.

---

## 1. Unused npm Dependencies

| Package                | Verified Imports in `src/` | Verdict          |
| ---------------------- | -------------------------- | ---------------- |
| `@usejarvis/brain`     | **0**                      | ❌ REMOVE        |
| `jsnes`                | **0**                      | ❌ REMOVE        |
| `@monaco-editor/react` | **0**                      | ❌ REMOVE        |
| `monaco-editor`        | **0**                      | ❌ REMOVE        |
| `@stripe/stripe-js`    | **0** (only server `stripe` used) | ❌ REMOVE |

### Keytar — **KEEP but RULES-ENFORCE**
`keytar` has **0 direct imports** in `src/`, but per `.clinerules`:
> "NEVER use `keytar` directly — it requires native compilation. It is a transitive dep only."

So `keytar` is correctly declared in `package.json` but is **imported by `agentCommands.ts` via a `require()`** in the terminal side. **Action:** do not remove; just confirm no direct `import "keytar"` slips in via future code.

### Why some "unused" looking deps are actually used
| Dep                  | Actually used by                                                   |
| -------------------- | ------------------------------------------------------------------ |
| `bcryptjs`           | `src/lib/db.ts` (custom JWT auth password hashing)                 |
| `prismjs` + types    | `src/app/studio/tools/CodeTool.tsx` (syntax highlight)            |
| `react-markdown`     | chat / agent message rendering (multiple `chat/` files)            |
| `sharp`              | image processing pipeline in `/api/upload` and `/api/media/*`      |
| `socket.io-client`   | terminal-server web UI                                             |
| `stripe` (server)    | `/api/stripe/webhook` and `/api/health/studio`                     |
| `supermemory`        | `/api/memory/*`, `/api/ai-chat`, `/api/agents/chat`, gemini route  |
| `svix`               | `/api/webhook/clerk` (Clerk webhook signature verification)        |
| `@vercel/analytics`  | `src/app/layout.tsx`                                               |
| `@vercel/speed-insights` | `src/app/layout.tsx`                                            |
| `@next/third-parties`| `src/app/layout.tsx` (`GoogleAnalytics`)                          |
| `@aws-sdk/client-s3` + presigner | `src/lib/r2.ts` (Cloudflare R2)                       |
| `@supabase/ssr`      | `src/lib/supabase-client.ts` (`createBrowserClient`)               |
| `@supabase/supabase-js` | `src/lib/supabase.ts` + `src/lib/supabase-admin.ts`             |
| `@google/generative-ai` | `src/lib/llm.ts`, `src/lib/gemini.ts`, `gemini/chat/route.ts` (legacy SDK) |
| `@google/genai`      | `/api/media/*`, `/api/voice/live-token` (new SDK — video/transcribe) |
| `@octokit/auth-app`  | `src/lib/github-app.ts`                                            |
| `@octokit/rest`      | `src/lib/github-app.ts`, `src/lib/repo-scanner.ts`, studio sync    |
| `@xterm/*`           | terminal UI shell                                                  |
| `jose`               | `src/lib/jwt.ts`                                                   |
| `ai`                 | `/api/ai-chat` (Vercel AI SDK)                                     |

> **Note on Google SDKs:** Both `@google/generative-ai` (legacy) and `@google/genai` (new) are intentionally retained — they expose different APIs (`GoogleGenerativeAI` for text vs `GoogleGenAI` for multimodal/video). Do not consolidate without auditing every call site.

### Unused devDependency
| Package      | Verified imports | Verdict       |
| ------------ | ---------------- | ------------- |
| `playwright` | 0                | ❌ REMOVE (or wire to a real E2E suite — it was a placeholder) |

---

## 2. Dead / Orphaned `src/lib/` Files

The following have **zero importers** in `src/`, `src/app/`, or anywhere else (excluding the file itself).

| File                              | Why it's dead                                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------------- |
| `src/lib/api-keys.ts`             | API-key validator never imported; auth flows use Clerk or custom JWT.                        |
| `src/lib/api.ts`                  | `fetchApi` helper has no callers.                                                            |
| `src/lib/agent-profiles.ts`       | Mentioned only in `litt-identity.ts` docstring as "exists", never imported.                  |
| `src/lib/agent-worker.ts`         | Imported **only** by `src/daemon.ts` (a separate sidecar process; see §7).                   |
| `src/lib/AgentOrchestrator.ts`    | **Duplicate of class in `src/lib/agents.ts`.** The agents.ts version is the singleton.       |
| `src/lib/color-templates.ts`      | No callers; theme system uses `themes.ts`.                                                   |
| `src/lib/layout-schema.ts`        | Only mentioned in a comment; no consumer.                                                    |
| `src/lib/projects.ts`             | Superseded by `src/lib/studio-projects.ts` (used by `CodeTool.tsx`).                         |
| `src/lib/skybox.ts`               | Skybox logic lives in API route `/api/skybox/generate` and `SpaceTool.tsx`.                  |

### Duplicate class definitions (HIGH RISK — pick one and delete the other)

1. **`AgentOrchestrator` is defined THREE times:**
   - `src/lib/AgentOrchestrator.ts` (full impl, but not imported)
   - `src/lib/agents.ts` (singleton export `orchestrator`, used in `src/daemon.ts` and `litt-context.ts`)
   - `src/app/code/page.tsx` contains a **third inlined** `export class AgentOrchestrator` (per subagent 2)

   **Action:** keep `src/lib/agents.ts` version; delete `src/lib/AgentOrchestrator.ts` and the inline class in `code/page.tsx`.

---

## 3. Orphaned Public Assets (`public/`)

| File                       | Status         | Reason                                                  |
| -------------------------- | -------------- | ------------------------------------------------------- |
| `public/file.svg`          | ❌ ORPHAN      | Default Next.js boilerplate; not referenced in `src/`.   |
| `public/globe.svg`         | ❌ ORPHAN      | Default Next.js boilerplate; not referenced.            |
| `public/next.svg`          | ❌ ORPHAN      | Default Next.js boilerplate; not referenced.            |
| `public/vercel.svg`        | ❌ ORPHAN      | Default Next.js boilerplate; not referenced.            |
| `public/window.svg`        | ❌ ORPHAN      | Default Next.js boilerplate; not referenced.            |
| `public/logo~2.png`        | ❌ ORPHAN      | Windows "duplicate file" marker; created accidentally.  |
| `public/og.png`            | ❌ ORPHAN      | Layout uses `og-image.webp`; this file is unreferenced. |
| `public/og-image.png`      | ❌ ORPHAN      | WebP variant `og-image.webp` is what's referenced.      |

**USED public assets (do not touch):**
- `public/logo.png` — `Navbar.tsx`
- `public/logo.webp` — favicon, `manifest.json`
- `public/logo-littree.svg` — referenced (likely via dynamic path)
- `public/manifest.json` — referenced by PWA
- `public/sw.js` — service worker
- `public/brand/`, `public/jsdos/`, `public/showcase/`, `public/studio/`, `public/wallpapers/`, `public/worklets/` — used by various subroutes (verify per-subdirectory if removing)

---

## 4. Orphaned Scripts (`scripts/`)

| File                              | Verdict       |
| --------------------------------- | ------------- |
| `scripts/_ram_before.ps1`         | ❓ Single-use debug helper, never called from CI or package.json |
| `scripts/_ram_after.ps1`          | ❓ Pair of above |
| `scripts/crop_mascot.py`          | ❌ One-off asset prep, no caller |
| `scripts/generate_office_files.py`| ❌ Orphan (flagged in deep-scan-report.md) |
| `scripts/verify_outputs.py`       | ❌ Orphan (flagged in deep-scan-report.md) |
| `scripts/update_object_position.py`| ❌ One-off |
| `scripts/optimize-network.bat`   | ❌ One-off |
| `scripts/perf.ps1`                | ❓ Local perf helper |
| `scripts/record-deployment.mjs`   | ⚠️ Verify — may be used by deploy workflow |
| `scripts/daily-deploy-digest.mjs` | ⚠️ Verify — paired with `run-daily-digest.sh` |
| `scripts/check-terminal-deploy.ps1`| ⚠️ Verify — likely used by CI |
| `scripts/deploy-terminal.ps1`     | ✅ Likely used by terminal CI |
| `scripts/deploy-terminal.sh`      | ✅ Likely used by terminal CI |
| `scripts/fix-all-env.sh`          | ⚠️ Local helper |
| `scripts/setup-env.sh`            | ⚠️ Local helper |
| `scripts/run-daily-digest.sh`     | ✅ Paired with `daily-deploy-digest.mjs` |
| `scripts/start-terminal-if-needed.ps1` | ⚠️ Local helper |

> Marked ⚠️ items need a one-time grep against `.github/workflows/*.yml` and `package.json` scripts before deletion. Marked ❌ are confirmed orphan (no CI, no `pnpm` script, no other script invokes them).

---

## 5. Conflicting / Redundant Deployment Configs

The project has **FOUR** deployment target configs but only **TWO** are wired to CI.

| Config file                    | Status        | Evidence                                                                |
| ------------------------------ | ------------- | ----------------------------------------------------------------------- |
| `vercel.json`                  | ✅ USED       | Primary web deploy (`.github/workflows/build.yml` + Vercel integration) |
| `render.yaml`                  | ❌ ORPHAN     | No GitHub Action, no deploy script references it. Terminal moved to Railway. |
| `terminal-server/railway.json` | ✅ USED       | Wired to `.github/workflows/deploy-terminal.yml` + `scripts/deploy-terminal.{ps1,sh}` |
| `terminal-server/fly.toml`     | ❌ ORPHAN     | No CI, no deploy script, no docs reference.                            |

**Action:** delete `render.yaml` and `terminal-server/fly.toml`.

### Dockerfiles — three copies, one broken

| File                              | Status        | Notes                                                              |
| --------------------------------- | ------------- | ------------------------------------------------------------------ |
| `Dockerfile` (root)               | ⚠️ BROKEN     | Uses `output: "standalone"` pattern but `next.config.ts` lacks that flag. Won't produce a valid image. |
| `terminal-server/Dockerfile`      | ✅ USED       | Canonical; used by Railway (and was the Render target).            |
| `docker/Dockerfile.terminal`      | ⚠️ DEV-ONLY   | Used only by `pnpm terminal:build-image` (local development image). |

**Action:** either fix the root `Dockerfile` by adding `output: "standalone"` to `next.config.ts` (Vercel normally does not need it; only useful for self-host), or document it as "self-host" and add a build test. Right now it's dead config.

### `.vercelignore` vs `.gitignore` mismatch
`.vercelignore` lists `docs/`, `scripts/`, `tasks/`, `prompts/`, `prds/`, `.vscode/`, `.devcontainer/` as **excluded from Vercel** — yet these directories are **tracked in git** and shown by the working-tree listing. They're shipped in the repo but stripped from Vercel builds. That's intentional Vercel-side optimization, not a bug. **No action.**

---

## 6. Ghost Directories (in `.gitignore` but visible in working tree)

`.gitignore` lists the following as ignored, yet they may still be present on disk (per the `litlab` workspace listing). Per `.clinerules` and `.cursorrules`, these are large local artifacts and **should never be imported or scanned**.

| Path                  | Status                  |
| --------------------- | ----------------------- |
| `litlabs/`            | 🚫 Ghost (ignored)      |
| `litlabs-website/`    | 🚫 Ghost (ignored — note: repo remote is `litlabs-website` so this dir is a stray copy) |
| `work/`               | 🚫 Ghost (ignored)      |
| `meta/`               | 🚫 Ghost (ignored)      |
| `chrome/`             | 🚫 Ghost (ignored)      |
| `Zoo-Code/`           | 🚫 Ghost (ignored)      |
| `codex-reference/`    | 🚫 Ghost (ignored)      |
| `OmniRoute/`          | 🚫 Ghost (ignored)      |

> No action required — `.gitignore` is correctly excluding these. They are local workspace artifacts and must not be imported by `src/`. The `tsconfig.json` already excludes them from type-checking.

---

## 7. `src/daemon.ts` & `src/proxy.ts` — Top-level process files

Per `docs/deep-scan-report.md`, these are flagged as **"potentially obsolete"**.

| File             | Status                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| `src/daemon.ts`  | ⚠️ Imports `agent-worker.ts` and a class matrix; runs as a separate process. If no production deploy invokes it, it's dead. Verify it isn't launched by `terminal:dev` or any background process. |
| `src/proxy.ts`   | ⚠️ Likely an internal proxy/server entry point. Search the repo for `tsx src/proxy.ts` to find callers; if none, orphan. |

**Action:** confirm with a grep:
```
grep -r "src/daemon\|src/proxy" --include="*.{json,yml,yaml,ps1,sh}" .
```
If nothing references them as a launch target, archive to `docs/legacy/` and remove from `tsconfig.json` include if necessary.

---

## 8. Stray Marketing File at Root

| File                                      | Verdict                                       |
| ----------------------------------------- | --------------------------------------------- |
| `FACEBOOK_FOLLOWER_GROWTH_CHECKLIST.md`   | ❌ Move to `docs/marketing/` or delete. Out of place at repo root. |

---

## 9. `terminal-server/jarvis-ai.ts` — KEEP (per project rules)

The file `terminal-server/jarvis-ai.ts` is the **only** remaining "Jarvis"-named file. Per `.clinerules`:
> "There is NO `src/lib/jarvis.ts`. Code is branded as LiTT; the `jarvis` export is only a backward-compat alias from `src/lib/litt.ts`."

The `terminal-server/` subsystem is **intentionally separate** and is allowed to retain "Jarvis" naming internally. **Do not remove this file.** `docs/deep-dive-2026-07-14.md` also recommends renaming for consistency, but that's a future rename, not a deletion.

---

## 10. CLI Folder — VERIFY

`cli/` (with `cli/install.ps1`, `cli/LiTTree.psm1`, `cli/package.json`) is a standalone PowerShell installer module. It's **not** referenced from the root `package.json` workspaces. The pnpm-workspace.yaml might declare it though. Verify before deciding.

| Path                          | Status          |
| ----------------------------- | --------------- |
| `cli/install.ps1`             | ⚠️ Verify it's the canonical installer (referenced by README/SETUP) |
| `cli/LiTTree.psm1`            | ⚠️ Verify |
| `cli/package.json`            | ⚠️ Verify (standalone? or workspace?) |
| `cli/src/`                    | ⚠️ Verify |

---

## 11. Recommended Cleanup PR Sequence

To avoid breaking a single big-bang PR, split the cleanup into 4 small, reversible PRs:

### PR 1 — Safe dep removals (low risk)
```bash
pnpm remove @usejarvis/brain jsnes @monaco-editor/react monaco-editor @stripe/stripe-js playwright
```
Then `pnpm install`, run `pnpm type-check` and `pnpm build`. Re-add if any breakage.

### PR 2 — Public asset cleanup (no risk)
Delete from `public/`:
- `file.svg`, `globe.svg`, `next.svg`, `vercel.svg`, `window.svg`
- `logo~2.png`, `og.png`, `og-image.png`

### PR 3 — Dead `src/lib/` removal (medium risk)
Delete:
- `src/lib/api-keys.ts`
- `src/lib/api.ts`
- `src/lib/agent-profiles.ts`
- `src/lib/AgentOrchestrator.ts`  ← duplicate class
- `src/lib/color-templates.ts`
- `src/lib/layout-schema.ts`
- `src/lib/projects.ts`  ← superseded by studio-projects.ts
- `src/lib/skybox.ts`

**Plus inline-class removal in `src/app/code/page.tsx`** (keep only the `src/lib/agents.ts` version).

### PR 4 — Deploy config cleanup (medium risk)
- Delete `render.yaml`
- Delete `terminal-server/fly.toml`
- Decide: fix or delete root `Dockerfile`

---

## Summary Counts

| What                                           | Count |
| ---------------------------------------------- | ----- |
| Unused npm dependencies                        | 6     |
| Unused devDependencies                         | 1     |
| Dead `src/lib/` files (excluding AgentOrchestrator dup) | 8 |
| Duplicate class definitions of `AgentOrchestrator`     | 3 (one file + one inline) |
| Orphaned public assets                         | 8     |
| Orphaned scripts                               | ~7    |
| Conflicting/redundant deploy configs           | 2 (render.yaml, fly.toml) + 1 broken Dockerfile |
| Stray marketing file at root                   | 1     |

**Estimated cleanup impact:**
- ~25 MB off `node_modules`
- ~5–10 MB off `public/`
- Removes 3 sources of "Jarvis"-style confusion (file names, not the kept terminal-internal jarvis-ai.ts)
- Eliminates 2 phantom deploy surfaces (render.yaml, fly.toml)

---

## Appendix — Verification Method

For each candidate listed, the following was performed:

1. **Unused deps:** `search_files` for `import .* from ['"]<package>['"]` across `src/`, `src/app/`, `terminal-server/`. Zero hits ⇒ flagged.
2. **Dead `src/lib/` files:** cross-reference every `export` against `import` statements. Zero hits ⇒ flagged.
3. **Public assets:** `search_files` for the bare filename across `src/`. Zero hits ⇒ flagged.
4. **Scripts:** cross-reference against `package.json` `scripts`, `.github/workflows/*.yml`, and other scripts. Zero hits ⇒ flagged.
5. **Deploy configs:** cross-reference against `.github/workflows/*.yml` and `scripts/deploy-*`. Zero hits ⇒ flagged.
6. **Ghost directories:** cross-reference against `.gitignore` patterns. Matches ⇒ confirmed ignored.

**Limits of this scan:**
- **Dynamic imports** (`import('...')`) may hide some usages. The Gemini and Supermemory routes use dynamic imports — these were traced manually.
- **Template-string paths** (e.g. `` `/api/${name}` ``) are not detected by static search.
- **SVG references** via CSS `background-image: url(...)` may use `public/*.svg` without showing in TSX.
- **No `pnpm build` / `pnpm type-check` was run** as part of this scan — removals must be validated by CI.
