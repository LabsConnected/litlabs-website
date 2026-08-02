# LiTTree Legacy Decommission Map

> **Architecture contract.** This document records every duplicate, legacy,
> or older system in the codebase, its canonical replacement, current
> consumers, migration plan, and removal gate. No agent or contributor may
> create a new implementation for an entity that has a canonical home
> listed in `CANONICAL_ENTITIES.md`. If you find yourself writing code that
> queries a legacy table, redirect to the canonical one instead.

## Status legend

| Label | Meaning |
|---|---|
| ACTIVE | Legacy system is still in use |
| MIGRATING | Migration in progress |
| DEPRECATED | Legacy system should not receive new code |
| REMOVED | Legacy system has been removed |

---

## Project tables

### Legacy `projects` table → `studio_projects`

| Field | Value |
|---|---|
| **Legacy system** | `public.projects` table (migration: `20250712010000_github_projects.sql`) |
| **Canonical replacement** | `public.studio_projects` table + `src/lib/projects/project-repository.ts` |
| **Current consumers** | `src/lib/studio/project-resolver.ts`, `src/lib/require-database-user.ts`, `src/lib/projects/resolve-current-project.ts`, `src/lib/integrations/status.ts`, `src/lib/capabilities/studio-context.ts`, `src/app/api/projects/route.ts`, `src/app/api/projects/[projectId]/route.ts`, `src/app/api/github/connection-state/route.ts`, `src/app/api/dashboard/route.ts`, `src/app/api/connections/route.ts`, `src/app/api/galaxy/files/route.ts` |
| **Migration plan** | `project-repository.ts` already falls back to legacy table for reads. New code must use `studio_projects` only. Migrate each consumer to use `project-repository.ts` instead of direct table queries. |
| **Removal gate** | Zero direct queries to `projects` table outside of `project-repository.ts` compatibility fallback. All API routes under `/api/projects/*` either removed or redirected to `/api/studio-projects/*`. |
| **Status** | ACTIVE (legacy still widely used) |

---

## Conversation tables

### Legacy `conversations` + `conversation_messages` → `studio_conversations` + `studio_conversation_messages`

| Field | Value |
|---|---|
| **Legacy system** | `public.conversations` + `public.conversation_messages` tables (migration: `20240613000000_initial_schema.sql`, redefined in `20260116000000_agent_platform_schema.sql`, `20260702120000_platform_tables_unified.sql`) |
| **Canonical replacement** | `public.studio_conversations` + `public.studio_conversation_messages` tables + `src/lib/studio/conversation-service.ts` |
| **Current consumers** | `src/app/api/conversations/route.ts`, `src/app/api/conversations/[id]/messages/route.ts` |
| **Migration plan** | Migrate `/api/conversations/*` routes to use `conversation-service.ts` and `studio_conversations` table. The canonical service already exists and is used by Studio. |
| **Removal gate** | Zero direct queries to `conversations` or `conversation_messages` tables. All conversation routes use `conversation-service.ts`. |
| **Status** | ACTIVE (legacy routes still in use) |

### Legacy `builder_chat_sessions` table

| Field | Value |
|---|---|
| **Legacy system** | `public.builder_chat_sessions` table (migration: `20260719030000_builder_chat_sessions.sql`) |
| **Canonical replacement** | `studio_conversations` + `studio_conversation_messages` |
| **Current consumers** | `src/app/api/builder/sessions/route.ts` |
| **Migration plan** | Migrate builder sessions to use canonical conversation service. |
| **Removal gate** | Zero queries to `builder_chat_sessions`. Builder API removed or redirected. |
| **Status** | DEPRECATED |

---

## Agent task tables

### Legacy `agent_tasks` + `active_tasks` → `mission_steps` + `agent_runs`

| Field | Value |
|---|---|
| **Legacy system** | `public.agent_tasks` (migration: `20250101000000_agent_tasks_schema.sql`), `public.active_tasks` (migration: `20240613000000_initial_schema.sql`) |
| **Canonical replacement** | `public.mission_steps` (for mission-scoped steps) + `public.agent_runs` (for agent execution) |
| **Current consumers** | Unknown — may be referenced by older agent orchestration code |
| **Migration plan** | Audit all references to `agent_tasks` and `active_tasks`. Replace with `mission_steps` or `agent_runs` as appropriate. |
| **Removal gate** | Zero queries to `agent_tasks` or `active_tasks`. |
| **Status** | DEPRECATED |

---

## Approval tables

### Legacy `agent_approvals` → `mission_approvals`

| Field | Value |
|---|---|
| **Legacy system** | `public.agent_approvals` (migration: `20250712020000_litt_agent_memory.sql`) |
| **Canonical replacement** | `public.mission_approvals` (migration: `20260726240000_mission_checkpoint_schema.sql`) |
| **Current consumers** | Older agent memory/approval code |
| **Migration plan** | Audit references to `agent_approvals`. Replace with `mission_approvals` for mission-scoped approvals. |
| **Removal gate** | Zero queries to `agent_approvals` for new code. |
| **Status** | DEPRECATED |

---

## Deployment tables

### Legacy `deployments` vs `project_deployments`

| Field | Value |
|---|---|
| **Legacy system** | `public.deployments` (migration: `20250618_add_deployments_table.sql`) — used by `src/lib/deployments.ts` |
| **Canonical replacement** | `public.project_deployments` (migration: `20260723160000_integration_platform.sql`) — part of integration platform |
| **Current consumers** | `src/lib/deployments.ts` (uses `deployments`), integration platform (uses `project_deployments`) |
| **Migration plan** | Consolidate `deployments.ts` to use `project_deployments`. Or merge the two tables into one canonical schema. |
| **Removal gate** | Single deployment table. Zero queries to the deprecated table. |
| **Status** | ACTIVE (both tables in use) |

---

## localStorage-based systems

### Gallery localStorage history → Canonical artifacts

| Field | Value |
|---|---|
| **Legacy system** | `localStorage` usage in `src/lib/games.ts`, `src/lib/emulator/control-profiles.ts`, `src/lib/music.ts` |
| **Canonical replacement** | `public.mission_artifacts` + `public.project_assets` |
| **Current consumers** | Games, emulator, music components |
| **Migration plan** | Migrate persisted outputs to server-side `project_assets` or `mission_artifacts`. Use localStorage only for ephemeral UI state. |
| **Removal gate** | No user-created content stored only in localStorage. All durable outputs are server-backed. |
| **Status** | ACTIVE (localStorage still used for some user data) |

### `src/lib/user-db.ts` localStorage fallback

| Field | Value |
|---|---|
| **Legacy system** | `src/lib/user-db.ts` has localStorage fallback for user data (lines 233-349) |
| **Canonical replacement** | `public.users` table (server-side only) |
| **Current consumers** | User sync flow |
| **Migration plan** | Remove localStorage fallback. All user data must come from `public.users` table via server. |
| **Removal gate** | Zero localStorage usage in `user-db.ts`. |
| **Status** | ACTIVE (fallback still present) |

---

## Simulated workflows

### Mission Forge simulated state → Server mission runtime

| Field | Value |
|---|---|
| **Legacy system** | `src/app/studio/tools/MissionForge.tsx` may simulate mission progress in the UI without full server state backing |
| **Canonical replacement** | `src/lib/missions/mission-repository.ts` + `src/lib/missions/mission-executor.ts` + `/api/missions/*` routes |
| **Current consumers** | MissionForge UI |
| **Migration plan** | Ensure MissionForge UI reflects server state from `/api/missions/[missionId]/events` SSE stream. Remove any simulated progress indicators. |
| **Removal gate** | No simulated mission success. All mission status comes from the server. |
| **Status** | MIGRATING (server runtime exists, UI may still have simulated elements) |

---

## Orchestration tables

### Legacy `orchestration_jobs` → Mission runtime

| Field | Value |
|---|---|
| **Legacy system** | `public.orchestration_jobs` (migration: `20240613000000_initial_schema.sql`, redefined in `20260702120000_platform_tables_unified.sql`, `20260702000000_orchestration_jobs.sql`) |
| **Canonical replacement** | `public.missions` + `public.mission_runs` + `public.mission_steps` |
| **Current consumers** | Unknown — audit needed |
| **Migration plan** | Audit references to `orchestration_jobs`. Replace with mission runtime tables. |
| **Removal gate** | Zero queries to `orchestration_jobs`. |
| **Status** | DEPRECATED |

---

## Notification tables

### Legacy `notifications` (multiple definitions) → Canonical notification system

| Field | Value |
|---|---|
| **Legacy system** | `public.notifications` defined in `20240614030000_social_graph.sql` AND `20260116000000_agent_platform_schema.sql` (two different schemas) |
| **Canonical replacement** | TBD — needs consolidation. `public.agent_system_notifications` (migration: `20260801000000_create_agent_system_notifications.sql`) is the newest. |
| **Current consumers** | Notification UI |
| **Migration plan** | Consolidate to a single notification table. Remove duplicate definitions. |
| **Removal gate** | Single notification table with a clear schema. Zero references to deprecated notification tables. |
| **Status** | ACTIVE (multiple definitions exist) |

---

## Visual build pipeline

### `visual_builds` + `visual_plans` + `visual_asset_manifests` → Canonical project/artifact system

| Field | Value |
|---|---|
| **Legacy system** | `public.visual_builds`, `public.visual_plans`, `public.visual_asset_manifests`, `public.visual_reviews`, `public.visual_build_logs` (migration: `20260727010000_visual_build_pipeline.sql`) |
| **Canonical replacement** | `public.missions` (for plans) + `public.mission_artifacts` (for outputs) + `public.project_assets` (for assets) |
| **Current consumers** | `src/lib/visual-builds/repository.ts` |
| **Migration plan** | Evaluate whether visual build pipeline should be subsumed into the mission system or remain a specialized subsystem. If subsumed, migrate data and remove tables. |
| **Removal gate** | Decision made. If subsumed: zero queries to `visual_*` tables. |
| **Status** | ACTIVE (subsystem in use, relationship to missions unclear) |

---

## Canvas system

### `canvases` + `canvas_blocks` + `canvas_revisions` → Canonical project system

| Field | Value |
|---|---|
| **Legacy system** | `public.canvases`, `public.canvas_blocks`, `public.canvas_revisions` (migration: `20260728000000_canvas_system.sql`) |
| **Canonical replacement** | TBD — canvas may be a legitimate subsystem, or may be subsumed into the project/artifact system |
| **Current consumers** | `src/lib/canvas/repository.ts`, `src/lib/canvas/actions.ts`, Canvas tool |
| **Migration plan** | Evaluate whether canvas is a subsystem or a duplicate. If it produces artifacts, those should be tracked in `mission_artifacts`. |
| **Removal gate** | Decision made. Clear boundary between canvas subsystem and canonical artifact system. |
| **Status** | ACTIVE (subsystem in use) |

---

## Summary: removal priority

| Priority | Legacy system | Reason |
|---|---|---|
| 1 | `projects` table direct queries | Most consumers; canonical replacement exists |
| 2 | `conversations` + `conversation_messages` | Canonical replacement exists and is used by Studio |
| 3 | `builder_chat_sessions` | Deprecated, no new code should use it |
| 4 | `agent_tasks` + `active_tasks` | Replaced by mission system |
| 5 | `agent_approvals` | Replaced by `mission_approvals` |
| 6 | `orchestration_jobs` | Replaced by mission runtime |
| 7 | `deployments` vs `project_deployments` | Consolidation needed |
| 8 | localStorage user data | Server-side is canonical |
| 9 | Notification table duplicates | Consolidation needed |
| 10 | Visual build / Canvas | Evaluate relationship to canonical systems |

## Rules for agents and contributors

1. **Never create a new table for an entity that has a canonical home.** Check `CANONICAL_ENTITIES.md` first.
2. **Never query a legacy table directly in new code.** Use the canonical repository or API.
3. **If you must read from a legacy table for compatibility, add a comment** explaining why and reference this document.
4. **When migrating a consumer from legacy to canonical, update this document** to move it from "Current consumers" to "Migrated consumers".
5. **When a legacy table has zero consumers, open a PR to remove it** and update this document to mark it REMOVED.
