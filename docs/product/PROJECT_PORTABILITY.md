# Project Portability

## The principle

Users should be able to leave LiTTree without losing everything. This supports the ownership / no-lock-in story.

## Three files per project

```
.litt/project.json    — machine metadata
LITT.md               — human + LiTT project knowledge
AGENTS.md             — instructions for external coding agents
```

### `.litt/project.json`

Machine-readable project metadata. **No secrets.**

```json
{
  "version": 1,
  "projectId": "proj_abc123",
  "name": "LiTTree Website",
  "framework": "nextjs",
  "defaultBranch": "main",
  "instructions": "LITT.md",
  "createdAt": "2026-08-01T00:00:00Z",
  "littVersion": "1.0.0"
}
```

### `LITT.md`

Human + LiTT project knowledge. Repo-safe.

```markdown
# LiTTree Website

## Purpose
The main marketing site and Studio for LiTTree.

## Architecture
- Next.js 15 App Router
- Supabase for database/auth
- Clerk for authentication
- Tailwind CSS + Glass OS design system

## Commands
- `npm run dev` — start dev server
- `npm run build` — production build
- `npm run typecheck` — TypeScript check
- `npm run lint` — ESLint

## Style
- Dark-first, Glass OS design system
- Purple (#8b5cf6) for AI/navigation
- Green (#9eff47) for active/success
- Glass surfaces: glass-1 (shell), glass-2 (panel), glass-3 (chip)

## Rules
- Never claim something is verified without evidence
- Always create checkpoint before file mutations
- Use PLAN mode for read-only exploration

## Deploy notes
- Vercel deployment
- Environment variables in Vercel dashboard

## Important files
- src/app/studio/ — Studio UI
- src/lib/litt/ — LiTT core logic
- src/app/globals.css — Glass OS design tokens
- docs/product/ — Product specs
```

### `AGENTS.md`

Instructions that external coding agents (Windsurf Cascade, Cursor, etc.) understand.

```markdown
# Agent Instructions

## Project
LiTTree Website — Next.js 15 + Supabase + Clerk

## Context
This project is managed by LiTTree Studio. Changes should go through the LiTT conversation when possible.

## Conventions
- Use Glass OS design tokens from globals.css
- Purple = AI/navigation, Green = active/success
- Never claim verification without evidence
- Create checkpoints before mutations

## Commands
- typecheck: npm run typecheck
- build: npm run build
- test: npm run test
- lint: npm run lint
```

## Generation

These files are generated from LiTTree project metadata:

```
LiTTree Project Settings
  → .litt/project.json (machine metadata)
  → LITT.md (human + LiTT knowledge)
  → AGENTS.md (external agent instructions)
```

### When to generate

- Project creation
- Framework change
- Manual "Regenerate project files" action
- Before "Open in Windsurf/VS Code"

## Windsurf compatibility

Windsurf recognizes `AGENTS.md` as a durable workspace instruction source alongside its own rules system. Generating `AGENTS.md` ensures LiTTree projects work well when opened in Windsurf.

## "Open With" flow

```
Project menu → Open in → Windsurf

1. Generate/update .litt/project.json, LITT.md, AGENTS.md
2. Open workspace in Windsurf
3. If LiTT Bridge installed → auto-connects to conversation
4. If not installed → prompt to install
```

## What needs to be built

1. Project file generation logic (from project metadata → 3 files)
2. "Regenerate project files" action in Studio
3. "Open in Windsurf / VS Code" action
4. File sync (keep LITT.md updated when project changes)
5. AGENTS.md template system
