# Image Approval Repro — Evidence (staging `7e0863855`, 2026-11-08)

## Verdict: approval loop FIXED — one approval → one image.generate → saved asset

Project `c3de8415-2809-4727-906d-283809d156e7`, conversation `40ddc8c7-2481-49df-94c2-cd4e11db84b3`,
actionRun `173ad0f9-fe2b-4a0e-ad5a-bcec2a65398c`, test user `user_3KiOL3ALBdLMxWAwDlhR9Rbc4fS`.

## Sanitized event timeline (action-run projection, sequence order)

| seq | type | toolId | pausedRunId | note |
|---|---|---|---|---|
| 7333 | approval.required | image.generate | — | "Mutation requires approval in ACT mode" |
| 7334 | approval.required | image.generate | e30cf760-cd26-419d-b454-bad7e1af7b3f | waiting_for_user |
| 7336 | approval.approved | image.generate | e30cf760 | granted once via API (202) |
| 7338 | tool.started | image.generate | — | "(approved)" |
| 7341 | tool.completed | image.generate | — | outcome=completed |
| 7343 | tool.completed | image.generate | — | **success=true, summary="Image generated and saved to project", durationMs=3546** |
| 7344 | approval.required | project.deploy | — | "Sensitive action — requires explicit approval" |
| 7345 | approval.required | project.deploy | e29a2347-5fb0-436d-a489-689f863fe648 | run parked awaiting_approval |

## Railway log correlation

- `[provider-router] attempt_success provider=gemini model=gemini-2.5-flash` emitted `image_generate` tool call
- `[image-service] OK provider=cloudflare requestId=approval:e30cf760-cd26-419d-b454-bad7e1af7b3f duration=2996ms` — **executed exactly once, requestId = approval ID**
- `approval:nested_handoff_settled` + `paused_run:approval_handoff_derived` for e30cf760 → nestedPausedRunId=e29a2347 (project.deploy)

## Workspace verification (read-only spec, post-run)

```
[entries:raw] [{"name":"assets","type":"folder"},{"name":"index.html","type":"file"}]
[files] assets, assets/images, assets/images/a-coffee-cup-on-a-wooden-table-modern-wa-mw8gqup0.jpeg, index.html
```

- Image persisted as **`.jpeg`** — byte-sniff MIME fix working (pre-fix: mislabeled PNG → "truncated or corrupt" rejection)
- Preview: `runtimeStatus=not_started` — expected; run parked at project.deploy gate (not approved, per instructions)

## Pending gate (NOT approved)

`project.deploy` pausedRunId `e29a2347-5fb0-436d-a489-689f863fe648`, run `waiting_for_user`.
Deploy target: LiTT Hosting static tier on Railway (publishes workspace files to a public Railway domain via `deployUserProject` → `railway-backend.ts`; publish gates run first; URL verified before reporting success). Side effects: creates/updates a public deployment + deployment record. No per-deploy charge; infra is environment-provisioned.

## Specs added (uncommitted, for review)

- `e2e-live/image-approval-repro.spec.ts` — bounded one-approval repro; stops on repeat/second gate
- `e2e-live/image-repro-verify.spec.ts` — read-only asset/preview verifier
- `e2e-live/gate-inspect.spec.ts` — read-only action-run/gate dump
- `e2e-live/playwright.live.config.ts` — testMatch extended
