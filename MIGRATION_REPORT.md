# LiTTreeLabStudio SSD Migration Report

- Migration date: 2026-07-30 (America/New_York)
- Source: `C:\Users\litbi\Documents\Codex\2026-07-15\sites-plugin-sites-openai-bundled-create\litlabs-website`
- Destination: `E:\LiTTreeLabStudio Prod`
- Original deleted: No

## Repository

- Branch: `main`
- Latest commit: `6ebcbd2 feat: replace studio sidebar with navigation drawer`
- Remote: `https://github.com/LabsConnected/litlabs-website.git`
- Upstream state before migration: 4 commits ahead of `origin/main`
- Working tree: Uncommitted modified and untracked files preserved exactly
- Package manager: pnpm (`packageManager: pnpm@9.15.0`; install completed with pnpm 9.15.9)
- Node.js: v26.4.0
- Git history: Preserved
- Tracked files: 589 in both source and destination

## Copy

Robocopy copied the repository with `/E /COPY:DAT /DCOPY:DAT /R:2 /W:2 /XJ`.

Excluded regenerated/disposable directories:

- `node_modules`
- `.next`
- `dist`
- `build`
- `coverage`
- `.turbo`
- `.cache`
- `out`
- `*.log`

The generic `build` exclusion initially skipped the legitimate tracked source path
`src/app/api/gemini/build/route.ts`. That file was copied separately and subsequent
Git status parity matched the source exactly.

SSD free space before copy was approximately 1,782.5 GB. Free space after dependency
installation and verification was approximately 1,781.2 GB.

## Project Features Detected

- pnpm workspace with root and `terminal-server` packages
- Supabase configuration and migrations
- Dockerfile, Docker Compose, and terminal-server Docker configuration
- Git LFS attributes file present; no LFS-managed files were reported
- No Prisma directory
- No local SQLite database files
- No local upload/data directory was detected; API route directories named media,
  storage, and upload are source code, not stored user data
- Junctions/symlinks were excluded from recursive copying with `/XJ`

## Environment and Local Configuration

- `.env.example` is present
- No local `.env`, `.env.local`, `.env.development.local`, or
  `.env.production.local` file existed in the source, so none could be migrated
- Supabase schema and migration files are present
- No secret values were printed or recorded

## Commands and Results

- Git source/destination branch, remote, HEAD, tracked-file count, and working-tree
  status comparison: Pass
- `pnpm install --frozen-lockfile`: Pass
- `pnpm run lint`: Pass with 21 warnings and 0 errors
- `pnpm exec tsc --noEmit`: Pass
- `pnpm test`: Pass (3 files, 14 tests)
- `pnpm run build`: Pass (96 static pages generated)
- `pnpm run dev -- --port 3017`: Pass
- Homepage request from SSD dev server: HTTP 200
- Dev server shutdown: Pass; port 3017 closed

## Production Build Resolution

The terminal now uses `@xterm/addon-web-links` 0.12.0, which is aligned with
`@xterm/xterm` 6.0.0. The import, package manifest, and pnpm lockfile were updated.
Related Studio type inconsistencies were corrected, strict TypeScript passes, and
the production build completes successfully.

## Old Absolute Paths Found

Eight references to earlier `CascadeProjects` paths were found:

- `.cursorrules` (1)
- `.clinerules` (1)
- `.devin-config.json` (2)
- `devin.config.json` (2)
- `docs/deep-dive-2026-07-14.md` (2)
- `docs/LITLABS_WORKSPACE_DEEP_DIVE_2026-07-14.md` (2)

The six active references in `.cursorrules`, `.clinerules`, `.devin-config.json`,
and `devin.config.json` now point to `E:\LiTTreeLabStudio Prod`. Four references
remain only in historical audit documentation and were intentionally preserved.

## Manual Attention

1. Supply the required local environment variables for authenticated and external
   integrations; only `.env.example` currently exists.
2. Open `E:\LiTTreeLabStudio Prod` in Windsurf/Codex and keep the original source
   copy for several days before manually deleting it.
