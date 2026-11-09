## Summary
Mission Controller Stage 1 for `litt mission`: durable mission queue, idempotent step execution, bounded retries, owner-gate parking, restart-safe resume — built on existing LiTT primitives (repair discipline, atomic stores, gh CLI, staging workflows).

- `src/lib/missions/`: contracts (zod), atomic `.litt/missions/<id>/` store, adapters (gh-pr-checks, gh-workflow-dispatch, gh-run-watch, http-check, run-check, staging-verify-sha, owner-gate, report), `runMission` loop.
- `litt mission create|start|resume|status|list`; exit codes mirror `litt repair` (0/1/2/3).
- Idempotency: probe-before-execute; crashed in-flight steps complete by end-state probe — never re-dispatched.
- `docs/mission-controller/`: architecture audit + paid-beta readiness mission.

## Evidence
- 8/8 vitest green incl. crash-mid-flight recovery without duplicate ops; tsc clean; `pnpm build` ok.
- Live run: `mission start` probed PR #805 via real `gh` → "all 10 checks green" (idempotent), then PARKED (exit 3) on the RAILWAY_TOKEN owner-gate; `mission resume` re-entered with no duplicate work.

#### Test plan
- [x] `pnpm exec vitest run src/lib/missions` — 8/8
- [x] `pnpm exec tsc --noEmit` — clean
- [x] live mission create/start/resume — parked correctly at owner gate

Generated with [Devin](https://devin.ai)
