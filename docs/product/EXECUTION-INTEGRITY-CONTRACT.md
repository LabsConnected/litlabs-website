# Execution Integrity Contract — Shared Across LiTT Chat, Studio, CLI, and PocketOS

**Status:** Permanent contract, established by the founder 2026-11-26. Governs every agent execution in every LiTT product. Companion to `UNIFIED-OPERATING-ENVIRONMENT.md` and the P0 Agent Execution Integrity program.
**Ownership:** LiTT conveyor owns the execution core and this contract's Studio implementation. Codex owns CLI alignment and the shared execution-contract interfaces. Devin owns the infrastructure the contract depends on (persistence, billing ledger) and independently verifies compliance.

## The rule

There is ONE execution-integrity contract for all of LiTT. No product — Chat, Studio, CLI, PocketOS — creates its own separate checkpoint, recovery, or execution system. Products may store the record in their own backend, but the fields, meanings, and lifecycle below are identical everywhere, so a run can be audited, resumed, and handed off across surfaces.

## Every execution must have

1. **A unique run ID.** Assigned at creation, never reused, present in every log line, approval, checkpoint, artifact record, and billing entry the run produces.
2. **Persisted execution state.** Task intent, project/surface context, completed steps, pending steps, and current position — written to durable storage as the run progresses, not held only in memory. A run whose state is not persisted is not resumable and must not claim to be.
3. **Authorized scope.** The exact scope the user approved (what the run may do, what it must not do), recorded before execution begins and carried unchanged across pauses, resumes, and provider switches. Scope expansion requires a new approval.
4. **Provider and model history.** Every provider/model that touched the run, in order, with the reason for each transition (initial selection, fallback + cause). Silent provider switches are prohibited.
5. **Tool invocation results.** Every tool call the run makes: name, inputs (redacted for secrets), result or error, and timestamp. A run's claims about its own work must be traceable to these records.
6. **Verified artifact references.** Every file or asset the run's output references must be verified to exist (local artifacts) or be accessible (remote artifacts) before the run may report completion. Referencing a nonexistent artifact is a defect, discovered at verification time — never first at publish or by the customer.
7. **Recoverable checkpoints where applicable.** For any run that can pause (approval, interruption, long execution): a checkpoint capturing items 2–6 is persisted BEFORE the pause point, and its persistence is verified before the run reports itself resumable. Resume from a nonexistent or invalid checkpoint is prohibited — the run restarts safely or returns an explicit recoverable failure. Resumes are idempotent: no duplicate writes, no duplicate billing.
8. **Explicit final status.** Every run ends in exactly one of: completed, failed, or cancelled — with the reason recorded. A run that cannot verify its own completion reports failed, never a soft success.
9. **Auditable billing settlement where applicable.** Reservation, settlement, and release events recorded against the run ID in the billing ledger. A failed or cancelled run's reservation release must be confirmable from ledger records, not inferred from a displayed balance. Resume and fallback paths must not create duplicate charges.

## Lifecycle

planned → state persisted → executing ⇄ (checkpoint persisted → paused → resumed) → verifying (artifacts + deliverables) → completed / failed / cancelled → billing settled or released (where applicable) → evidence retained.

## Compliance

- The P0 audit inventories the current implementation against each of the nine requirements per surface: satisfied / partial / absent, with source evidence.
- No repair is proposed, and no execution-core code is modified, until confirmed root causes, affected files, proposed repairs, and acceptance criteria have been presented to the founder.
- Every repaired capability requires actual runtime evidence, and independent verification (Devin's lane) before release acceptance restarts.
