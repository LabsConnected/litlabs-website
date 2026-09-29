# Canonical execution identity — source mapping (Item 3)

**Doctrine:** `action_runs` + ordered `action_events` is the ONE authority for
execution state. The paused run's `run_*` fields are claim/fencing
bookkeeping — never outcome truth. Every outcome write goes through the
single atomic settle (`settleResumedRunOutcome` → the
`action_runtime_transition_event_activity` RPC: row lock + terminal guard +
transition validation + status update + event insert + optional activity
insert, one transaction). Every read goes through
`getRunOutcomeForPausedRun` in
`src/lib/litt-intelligence/paused-run-store.ts`.

**Consistency note:** this is the same doctrine as the LiTT Runtime
Constitution (commissioned 2026-09-28): UI and narration are projections,
not truth — durable events determine truth; unknown is never rendered as
success.

## Source map

| # | Source | What it holds | Mapping onto the canonical run ID | Status |
|---|--------|----------------|-----------------------------------|--------|
| 1 | `action_runs` | Status, timestamps, failure message, current activity | **The authority.** `paused_runs.action_run_id` is a foreign-key-shaped pointer to exactly one action_run per attempt. Retry mints a fresh action_run (`createActionRun`) and repoints the gate (`updatePausedRunActionRun`) — one run = one attempt. | Enforced by the atomic RPC's terminal guard (`ACTION_RUN_TERMINAL_IMMUTABLE`). |
| 2 | `action_events` (ordered) | Outcome-bearing events (`run.completed` / `run.failed` / `run.cancelled` / `approval.required` with `payload.result`) | **The outcome record.** `getRunOutcomeForPausedRun` scans the ordered event log for the latest outcome-bearing event and derives `{ runStatus, runResult, runError, timestamps }`. The `RunResult` (final text, tool calls, `pendingApproval`) rides `payload.result` — no new event type, no migration. | Implemented. Nested-gate handoff (`approval.required` + `payload.result.pendingApproval`) derives `completed` + nested gate ID, so the outer attempt shows honest history instead of "processing". |
| 3 | `mission_runs` | Per-mission launcher orchestration state (a separate product concept) | **Excluded by boundary, documented.** `mission_runs` tracks mission-level lifecycle, not per-execution attempts. It does not write or read execution outcomes; no mapping needed. | Boundary documented — not a second source of execution truth. |
| 4 | `litt_execution_runs` | Legacy execution runs table | **Dead.** The only writer (`SupabaseExecutionStore`) is never instantiated anywhere in the codebase. No writes, no readers — retirement candidate, untouched by this change. | No mapping needed; flagged for retirement. |
| 5 | `agent_paused_runs` (`paused_runs`) | Approval gate: decision, claim/lease/fencing fields, `action_run_id` | **Mapped as claim holder, not outcome holder.** `run_status` keeps only claim lifecycle (`processing` = a token owns the lease; `completed`/`failed` = claim released). Outcome fields (`run_result`, `run_error`, `run_completed_at`) are write-once mirrors of the canonical settle for legacy rows; new writes go to the action_run. `markRunCompleted`/`markRunFailed` (the parallel outcome writers) were removed. | Done. Read path `getRunOutcomeForPausedRun` prefers the action_run; falls back to row fields only for legacy rows with no `action_run_id`. |
| 6 | Activity feed | `activity` inserts alongside events | **Atomic with the outcome write.** The RPC takes an optional `activity` payload in the same transaction as the status update + event insert — the feed can never show a different outcome than the run ledger. | Implemented (RPC parameter). |
| 7 | Approvals UI | Polls `GET /approvals/[pausedRunId]` | **Reads the derivation, shape unchanged.** GET returns `{ runStatus, runResult, runError, runStartedAt, runCompletedAt }` computed by `getRunOutcomeForPausedRun`. A stale claim saying `processing` never masks a completed canonical run. No client changes. | Implemented. Consumers: `approval-polling.ts`, `CommandStudio.tsx`, the resume route. |
| 8 | Studio execution state | SSE projection / `useExecutionStore` / browser session route | **Projection, not truth.** The browser session route already reads `actionRun.status` directly. `useExecutionStore` holds no localStorage — pure SSE projection. Studio shows what the canonical ledger says; it never persists its own outcome. | Verified — no changes needed. |
| 9 | `agent_runs` (legacy) | Legacy agent task queue (`/api/agents/run`, `/api/litt/runs/*`): agentName/task/status/logs/steps | **Marked legacy, excluded by boundary — NOT resurrected.** Separate product surface from the Studio execution path; it records its own queue entries, not Studio execution outcomes, so it is not a parallel authority for the runs this lane consolidates. No mapping, no migration, no new readers. | Boundary documented 2026-09-28. |

## Naming and schema notes (scope fence, 2026-09-28)

- **Explicit FK names:** all NEW references use `action_run_id` (→ `action_runs.id`)
  and `mission_run_id` (→ `mission_runs.id`). No new bare `run_id` is introduced
  by this lane.
- **Grandfathered bare `run_id`:** `action_events.run_id` (→ `action_runs.id`) predates
  this work and is referenced by the atomic RPCs, `run-store.ts`, and every event
  query. It is NOT renamed: a column rename on this hot table is migration risk
  with zero functional benefit (no disagreement bug is fixed by a rename).
- **Type mismatch — no brittle cross-table FKs:** `action_runs.project_id` is TEXT
  while `mission_runs.project_id` is UUID (`20260726240000_mission_checkpoint_schema.sql`).
  No join or foreign key is built across these columns; correlation is by explicit
  id, never by project_id equality.
- **Verification-mission boundary:** the separate "verification foundation" mission
  owns `verification_*` tables, the verdict engine, executors, and the evidence
  ledger. This lane creates none of those. This mapping doc is that mission's
  prerequisite input; if its PASS 2 branch lands, the mapping stays compatible
  and does not duplicate its tables.

## Constitution / bridge alignment

- **Run machine:** `action_runs` terminal states (`completed`/`failed`/`cancelled`)
  are exitless in `state-machine.ts` — semantically identical to the constitution's
  `succeeded`/`failed`/`cancelled`. (Label differs: `completed` vs `succeeded`;
  semantics match; renaming the enum is deferred churn, not a truth fix.)
- **INV-010 (recovery via new run):** retry mints a FRESH `action_run` and repoints
  the gate — one run = one attempt. **Lineage implemented (2026-09-28, third
  pass):** the retry-mint path in the approvals route emits a `run.retry_of` event
  on the NEW run with `payload.causation_action_run_id` = the failed attempt's
  `action_runs.id`, via the existing `appendActionEvent` path BEFORE the gate
  repoint — the causal link is a durable ordered event, not a schema column.
  Chained retries form a predecessor linked list. Legacy rows with no
  `action_run_id` emit no lineage event (no causal predecessor in the ledger).
  This satisfies the constitution's `causation_id` requirement at run granularity
  (the failed run's id durably identifies the attempt; its terminal event is
  derivable from the ordered log). No migration, no new run model, no
  `verification_*` tables.
- **Bridge:** the Station Control Bridge's `executeStationAction` is only invoked
  via `advertise.ts` → `toolRegistry.execute` with `actionContext.actionRunId`,
  so bridge execution flows through the same canonical run ledger. The bridge's
  own `emitEvent` is telemetry (console default), never outcome truth — no
  conflict with INV-013.
- **No constitution/bridge conflicts found.** Where the constitution is stricter
  than the implementation (event envelope fields, causation_id), the gaps are
  documented above, not silently resolved.

## Divergence vectors fixed in this lane

1. **Swallowed settle errors** — `settleParentActionRun` returned `false` on
   failure; the executor continued as if the write landed. Now
   `settleResumedRunOutcome` throws (fail loud), except
   `ACTION_RUN_TERMINAL_IMMUTABLE` which means "a racing settler already
   recorded the truth" — that is the honest outcome, not a failure.
2. **Reaper leaving the run non-terminal** — `recoverStaleRun` failed the
   paused-run claim but never touched the action_run, so the terminal said
   idle. Now it also settles the canonical action_run as failed
   (best-effort, errors swallowed — it runs on read paths).
3. **Retry 503 on terminal immutability** — retrying a failed run re-used the
   terminal action_run and the RPC refused the transition. Now retry mints a
   fresh action_run after the claim and repoints the gate; the terminal
   parent check exempts the legitimate failed→retry case (`isFailedRetry`).
   Cancelled parents still 409 — Stop's decision is final.
4. **`markRunCompleted`-vs-settle status disagreement** — two parallel
   outcome writers could record different statuses. Removed; the atomic RPC
   is the only writer. Claim fencing is verified (`verifyRunClaim`) before
   the write and released (`releaseRunClaim`) after, with error propagation.

## Invariants (for the constitution's invariant registry)

- INV: one action_run = one attempt. A retry never re-enters a terminal run.
- INV: the canonical write happens exactly once per settle, through the
  atomic RPC, in the order: verify claim → write → release claim.
- INV: terminal action_run state is immutable; a racing second writer gets
  `ACTION_RUN_TERMINAL_IMMUTABLE` and treats it as success, never as a
  failure to retry.
- INV: unknown is never rendered as success — a settle that throws for any
  other reason fails the execution loudly, and the claim is released as
  failed so the gate never wedges in `processing`.
