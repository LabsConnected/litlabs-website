# LiTTree Canonical Entities

> **Architecture contract.** For every entity, this document defines the
> canonical database table, repository/service, API, UI consumers, ownership
> boundary, current status, known gaps, and forbidden duplicate
> implementations. All new code must use the canonical implementation. If
> you need to create a new table, service, or API for an entity that already
> has a canonical home, you must update this document first and get approval.

## Status legend

| Label | Meaning |
|---|---|
| IMPLEMENTED | Verified in current production code |
| PARTIAL | Infrastructure exists, but the journey is incomplete |
| PLANNED | Approved product direction, not yet implemented |
| LATER | Intentionally outside the near-term release |

---

## User

| Field | Value |
|---|---|
| **Purpose** | Represents a signed-in person. Created via Clerk webhook. |
| **Canonical table** | `public.users` (migration: `20260711000000_foundation_users_and_installed_agents.sql`) |
| **Canonical repository** | `src/lib/user-db.ts` |
| **Canonical API** | `POST /api/webhooks/clerk` (user creation), `GET /api/user` (profile) |
| **Primary UI consumers** | `src/components/UserSync.tsx`, `src/context/AuthContext.tsx` |
| **Ownership boundary** | A user owns all projects, conversations, missions, and agents in their account. |
| **Current status** | IMPLEMENTED |
| **Known gaps** | No user preferences UI beyond `user_preferences` table |
| **Forbidden duplicates** | Do not create a `profiles` table. Do not use `auth.users` (Supabase auth) — Clerk is the identity provider. |

## Workspace

| Field | Value |
|---|---|
| **Purpose** | A logical grouping of projects, agents, and settings for a user or team. |
| **Canonical table** | None yet — PLANNED |
| **Canonical repository** | None yet |
| **Canonical API** | None yet |
| **Primary UI consumers** | None yet |
| **Ownership boundary** | A workspace contains projects. A user can own or be a member of workspaces. |
| **Current status** | PLANNED |
| **Known gaps** | No workspace table, service, or API exists. All projects are currently user-scoped, not workspace-scoped. |
| **Forbidden duplicates** | Do not create a workspace table without updating this document. |

## Project

| Field | Value |
|---|---|
| **Purpose** | The primary container for a user's work — files, missions, memory, checkpoints. |
| **Canonical table** | `public.studio_projects` (migration: `20260720000000_studio_projects_github.sql`) |
| **Canonical repository** | `src/lib/projects/project-repository.ts` |
| **Canonical types** | `src/lib/projects/types.ts` |
| **Canonical API** | `/api/studio-projects` (list, create), `/api/studio-projects/[projectId]` (get, update, delete), `/api/studio-projects/[projectId]/files`, `/api/studio-projects/[projectId]/workspace`, `/api/studio-projects/[projectId]/preview` |
| **Primary UI consumers** | `src/app/studio/components/CommandStudio.tsx`, `src/app/studio/page.tsx`, Dashboard |
| **Ownership boundary** | `user_id` column enforces ownership. All queries must filter by `user_id`. |
| **Current status** | PARTIAL |
| **Known gaps** | Goal-based onboarding, ZIP upload, Git URL import, GitHub export, draft/paused/archived states, soft-delete |
| **Forbidden duplicates** | Do not use the legacy `projects` table for new code. Do not create a third project table. See `LEGACY_DECOMMISSION_MAP.md`. |

## Conversation

| Field | Value |
|---|---|
| **Purpose** | A project-scoped conversation between the user and LiTT (or agents). |
| **Canonical table** | `public.studio_conversations` (migration: `20260728200000_command_studio_v12_conversations_memory.sql`) |
| **Canonical repository** | `src/lib/studio/conversation-service.ts` |
| **Canonical types** | `src/lib/studio/types.ts` |
| **Canonical API** | `/api/studio/conversations/[conversationId]/regenerate` (and other studio conversation routes) |
| **Primary UI consumers** | `src/app/studio/components/CommandStudio.tsx` |
| **Ownership boundary** | `owner_id` + `project_id` columns. All queries must filter by `owner_id`. |
| **Current status** | PARTIAL |
| **Known gaps** | Not all conversation routes use the canonical service. Legacy `/api/conversations` routes still use the old `conversations` table. |
| **Forbidden duplicates** | Do not use the legacy `conversations` table for new code. Do not use `builder_chat_sessions`. See `LEGACY_DECOMMISSION_MAP.md`. |

## Message

| Field | Value |
|---|---|
| **Purpose** | A single message in a conversation (user, assistant, or agent). |
| **Canonical table** | `public.studio_conversation_messages` (migration: `20260728200000_command_studio_v12_conversations_memory.sql`) |
| **Canonical repository** | `src/lib/studio/conversation-service.ts` |
| **Canonical API** | `/api/studio/conversations/[conversationId]/regenerate` |
| **Primary UI consumers** | `src/app/studio/components/CommandStudio.tsx` |
| **Ownership boundary** | `owner_id` + `conversation_id` + `project_id` columns. |
| **Current status** | PARTIAL |
| **Known gaps** | Legacy message routes still use `conversation_messages` table. |
| **Forbidden duplicates** | Do not use the legacy `conversation_messages` table for new code. See `LEGACY_DECOMMISSION_MAP.md`. |

## Mission

| Field | Value |
|---|---|
| **Purpose** | A goal-directed unit of work within a project — plan, execution, result. |
| **Canonical table** | `public.missions` (migration: `20260726240000_mission_checkpoint_schema.sql`) |
| **Canonical repository** | `src/lib/missions/mission-repository.ts` |
| **Canonical executor** | `src/lib/missions/mission-executor.ts` |
| **Canonical API** | `/api/missions` (create, list), `/api/missions/[missionId]/run` (start), `/api/missions/[missionId]/cancel` (cancel), `/api/missions/[missionId]/events` (SSE) |
| **Primary UI consumers** | `src/app/studio/tools/MissionForge.tsx`, `src/app/studio/components/CommandStudio.tsx` |
| **Ownership boundary** | `user_id` + `project_id` columns. |
| **Current status** | PARTIAL |
| **Known gaps** | Planning state, awaiting_approval state, credit estimates, plan visualization, full failure recovery |
| **Forbidden duplicates** | Do not create a separate mission system. Do not simulate mission progress in the UI without server state. |

## MissionStep

| Field | Value |
|---|---|
| **Purpose** | A single step in a mission run — tracks execution progress. |
| **Canonical table** | `public.mission_steps` (migration: `20260726240000_mission_checkpoint_schema.sql`) |
| **Canonical repository** | `src/lib/missions/mission-repository.ts` |
| **Canonical API** | Via `/api/missions/[missionId]/events` (SSE stream) |
| **Primary UI consumers** | `src/app/studio/tools/MissionForge.tsx` |
| **Ownership boundary** | `mission_id` + `run_id`. Inherits ownership from parent mission. |
| **Current status** | IMPLEMENTED |
| **Known gaps** | Retry from failed step |
| **Forbidden duplicates** | None — single implementation. |

## Approval

| Field | Value |
|---|---|
| **Purpose** | A request for user approval before a sensitive action is executed. |
| **Canonical table** | `public.mission_approvals` (migration: `20260726240000_mission_checkpoint_schema.sql`) |
| **Canonical repository** | `src/lib/missions/mission-repository.ts` |
| **Canonical API** | `/api/missions/[missionId]/approvals/[approvalId]` (resolve) |
| **Primary UI consumers** | `src/app/studio/tools/MissionForge.tsx` |
| **Ownership boundary** | `user_id` + `mission_id` + `project_id`. |
| **Current status** | IMPLEMENTED |
| **Known gaps** | Superseded state, expiration enforcement, approval center UI |
| **Forbidden duplicates** | Do not use `agent_approvals` table for mission approvals. That is a separate legacy system. |

## Checkpoint

| Field | Value |
|---|---|
| **Purpose** | A saved project state that can be restored (rollback). |
| **Canonical table** | `public.project_checkpoints` (migration: `20260726240000_mission_checkpoint_schema.sql`) |
| **Canonical repository** | `src/lib/missions/mission-repository.ts` (checkpoint functions) |
| **Canonical API** | `/api/studio-projects/[projectId]/checkpoints` (list, create), `/api/studio-projects/[projectId]/checkpoints/[checkpointId]` (restore) |
| **Primary UI consumers** | Studio checkpoint UI |
| **Ownership boundary** | `user_id` + `project_id`. |
| **Current status** | PARTIAL |
| **Known gaps** | Auto-create before major changes, file snapshot (only `git_sha` stored), rollback restoration of memory and mission state |
| **Forbidden duplicates** | None — single implementation. |

## Artifact

| Field | Value |
|---|---|
| **Purpose** | A tangible output produced by a mission (preview, image, file, deployment). |
| **Canonical table** | `public.mission_artifacts` (migration: `20260726240000_mission_checkpoint_schema.sql`) |
| **Canonical repository** | None yet — PLANNED |
| **Canonical API** | None yet — PLANNED |
| **Primary UI consumers** | None yet |
| **Ownership boundary** | `user_id` + `project_id` + `mission_id`. |
| **Current status** | PARTIAL (table exists, no repository or API) |
| **Known gaps** | No artifact repository, no artifact API, no artifact viewer, no result delivery |
| **Forbidden duplicates** | Do not use `project_assets`, `preview_captures`, or `visual_builds` as the artifact system. Those are subsystem-specific tables. The canonical artifact record is `mission_artifacts`. |

## Memory

| Field | Value |
|---|---|
| **Purpose** | Project-scoped memory that persists context across sessions. |
| **Canonical table** | `public.memories` (migration: `20250712020000_litt_agent_memory.sql`) |
| **Canonical repository** | `src/lib/studio/memory-service.ts` |
| **Canonical API** | Via conversation service (memory is loaded into context) |
| **Primary UI consumers** | `src/app/studio/components/CommandStudio.tsx` |
| **Ownership boundary** | `owner_id` + `project_id` + optional `agent_slug`. |
| **Current status** | PARTIAL |
| **Known gaps** | Memory management UI, memory types beyond current schema, memory permissions enforcement |
| **Forbidden duplicates** | None — single implementation. |

## Agent

| Field | Value |
|---|---|
| **Purpose** | A installable agent from the marketplace with capabilities and entitlements. |
| **Canonical table** | `public.agents` (migration: `20240613000000_initial_schema.sql`, updated in `20260702120000_platform_tables_unified.sql`) |
| **Canonical repository** | `src/lib/agents.ts`, `src/lib/agent-entitlements.ts` |
| **Canonical API** | `/api/marketplace` (browse), `/api/marketplace/install` (install) |
| **Primary UI consumers** | Marketplace pages, Studio agent selector |
| **Ownership boundary** | Agents are global (marketplace). `agent_entitlements` links agents to users. |
| **Current status** | IMPLEMENTED |
| **Known gaps** | Agent version history surfacing, outcome-focused listings |
| **Forbidden duplicates** | Do not create a separate agent registry. The `agents` table is canonical. |

## AgentRun

| Field | Value |
|---|---|
| **Purpose** | A single execution of an agent within a mission or conversation. |
| **Canonical table** | `public.agent_runs` (migration: `20250712020000_litt_agent_memory.sql`) |
| **Canonical repository** | `src/lib/agent-worker.ts` |
| **Canonical API** | Via mission executor |
| **Primary UI consumers** | Studio |
| **Ownership boundary** | Inherits from mission/project. |
| **Current status** | PARTIAL |
| **Known gaps** | Timeout handling, full lifecycle management, cancellation |
| **Forbidden duplicates** | `active_tasks` table is legacy. Do not use it for new code. |

## Entitlement

| Field | Value |
|---|---|
| **Purpose** | A user's right to use an agent or feature (purchased, subscribed, or free). |
| **Canonical table** | `public.agent_entitlements` (migration: `20260730000000_premium_agents_v1_port.sql`) |
| **Canonical repository** | `src/lib/agent-entitlements.ts`, `src/lib/entitlements.ts` |
| **Canonical API** | Checked during agent install and execution |
| **Primary UI consumers** | Marketplace, Studio |
| **Ownership boundary** | `user_id` (via Clerk ID) + `agent_id`. |
| **Current status** | PARTIAL |
| **Known gaps** | Subscription cancellation, suspension, refund handling |
| **Forbidden duplicates** | `subscriptions` table is used for plan entitlements. `agent_entitlements` is for agent-specific entitlements. Do not conflate them. |

## UsageLedger

| Field | Value |
|---|---|
| **Purpose** | Tracks credit consumption and purchases. |
| **Canonical table** | `public.credit_ledger` (migration: `20260725000000_credit_ledger_beta_pricing.sql`) |
| **Canonical repository** | `src/lib/wallet-ledger.ts` |
| **Canonical API** | Internal (checked during agent execution) |
| **Primary UI consumers** | Wallet/billing UI |
| **Ownership boundary** | `user_id` (via Clerk ID). |
| **Current status** | PARTIAL |
| **Known gaps** | Full settlement, refund handling, credit estimate before mission |
| **Forbidden duplicates** | None — single implementation. |

## ActivityEvent

| Field | Value |
|---|---|
| **Purpose** | A durable record of what happened in a project (audit log). |
| **Canonical table** | `public.project_activity` (migration: `20260723160000_integration_platform.sql`) |
| **Canonical repository** | None yet — PLANNED |
| **Canonical API** | None yet — PLANNED |
| **Primary UI consumers** | None yet — PLANNED (project timeline) |
| **Ownership boundary** | `project_id` + `user_id`. |
| **Current status** | PARTIAL (table exists, no repository or API) |
| **Known gaps** | No activity repository, no activity API, no timeline UI |
| **Forbidden duplicates** | `agent_analytics` and `agent_logs` are agent-specific logs, not project activity. Do not conflate them. |

## Integration

| Field | Value |
|---|---|
| **Purpose** | External service connections (GitHub, Stripe, etc.). |
| **Canonical table** | `public.integration_accounts`, `public.integration_projects`, `public.integration_credentials`, `public.integration_sync_runs`, `public.integration_events` (migration: `20260723160000_integration_platform.sql`) |
| **Canonical repository** | `src/lib/integrations/status.ts`, `src/lib/integrations/types.ts` |
| **Canonical API** | `/api/connections`, `/api/integrations` |
| **Primary UI consumers** | Studio integration UI |
| **Ownership boundary** | `user_id` on `integration_accounts`. |
| **Current status** | PARTIAL |
| **Known gaps** | Sync run execution, credential rotation, event surfacing |
| **Forbidden duplicates** | `github_installations` table is GitHub-specific. The `integration_*` tables are the canonical general-purpose integration system. |

## Deployment

| Field | Value |
|---|---|
| **Purpose** | A deployment of a project to a public URL. |
| **Canonical table** | `public.deployments` (migration: `20250618_add_deployments_table.sql`) and `public.project_deployments` (migration: `20260723160000_integration_platform.sql`) |
| **Canonical repository** | `src/lib/deployments.ts` |
| **Canonical API** | Via integration platform |
| **Primary UI consumers** | Studio deployment UI |
| **Ownership boundary** | `project_id` + `user_id`. |
| **Current status** | PARTIAL |
| **Known gaps** | One-click deploy from Studio, deployment history UI, environment management |
| **Forbidden duplicates** | Two deployment tables exist (`deployments` and `project_deployments`). `deployments` is the older table used by `src/lib/deployments.ts`. `project_deployments` is the newer integration-platform table. Consolidation is needed. See `LEGACY_DECOMMISSION_MAP.md`. |
