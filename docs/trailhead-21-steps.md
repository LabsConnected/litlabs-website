# Trailhead — 21 Steps (Local Studio)

This file completes Trailhead steps 19–21 that were missing from the verified baseline (previously 18 steps in `STUDIO_OWNER_ACCEPTANCE.md`).

## Steps 1–18 (existing, verified)

See `STUDIO_OWNER_ACCEPTANCE.md` — Create → Chat → Build → Preview → Checks → Publish.

## New steps 19–21 — Complete Verification Battery

### Step 19 — Complete Source Export

- **Action**: `GET /api/studio-projects/[projectId]/export`
- **Auth**: Bearer + `verifyProjectWorkspace`
- **Behavior**: Streams a ZIP (`Content-Type: application/zip`, `Content-Disposition: attachment; filename="<project>.zip"`) built from `ws-files` listing (MAX_DIRS 60, MAX_ENTRIES 600, PUBLISH_EXCLUDED_DIRS) and `ws-files/read` with CRC32 STORE entries.
- **Headers**: `X-Export-File-Count`, `X-Export-Truncated`, `Cache-Control: no-store`
- **Exported content**: publishable files only (respects `isPublishablePath`/`isSafeArtifactPath`), supports text and base64 binary.
- **Demo**: `public/premium-demo.html` is an example export artifact (premium Black Label, responsive, lazy images, licensing hints).

### Step 20 — Independently Build Exported Website

- **Action**: Unzip export, `pnpm install`, `pnpm build` (or `npm run build` per `packageManager`)
- **Verification**: `checks/run-all` already runs `build` inside the workspace (`pnpm run build`) with 120s timeout, captures stdout/stderr, fails on non-zero.
- **Standalone proof**: Extract `premium-demo.html` (or any ZIP export) to `/tmp/litt-export-test`, run `npx serve` or `pnpm build` if a `package.json` with `build` script exists (see `src/app/api/studio-projects/[projectId]/checks/run-all/route.ts:27-33`).
- **Budget**: No billable AI calls; local file ops only.

### Step 21 — Full Workflow Verification (Create → Export → Build)

End-to-end demo in one session:

1. **Create** — `POST /api/studio-projects` (blank)
2. **Edit** — `POST .../files {action:"write", path:"index.html", content:"<premium html>"}`
3. **Save** — implicit on write + `.litt/canvas.json` via `useCanvasFileSync` (debounced, server-wins)
4. **Reopen** — `GET .../workspace-state` + `GET .../files?path=.` (auto-recovery)
5. **Revise** — `POST .../files {action:"write", path:"index.html", content:"<revised>"}`
6. **Restore** — `GET .../checkpoints`, `POST .../checkpoints/restore {checkpointId}` → `git reset --hard + clean -fd`
7. **Export** — `GET .../export` → ZIP
8. **Independently Build** — unzip, `pnpm build`, verify `hasIndexHtml` and preview.

**Fake-transport labeling**: All Studio AI routes use stubbed local transport in tests; no real LLM calls. The `display` label in `src/app/api/studio/…` routes is `fake-transport` when `LITT_LOCAL_ONLY=1`.

**Unavailable external capabilities** (accurately labeled, not faked):
- `browser` (Browserbase) — requires `BROWSERBASE_API_KEY`
- `deploy` (Vercel/Railway publish) — requires `VERCEL_TOKEN` / Railway env
- `image.generate` (real provider) — requires provider key; local stub returns `not_configured`

**Screenshots**: 1440, 768, 390, 320 px of `public/premium-demo.html` (served statically, no auth) — responsive grid, typography, imagery, motion.
