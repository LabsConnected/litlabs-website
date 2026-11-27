# Evidence recorded on November 26, 2026

## Revisions and environment

Source inspection used the isolated audit branch at `8abb40b91`. The earlier full CLI and core suites used canonical `82b02064`. The diff between those revisions includes `src/lib/litt-intelligence/agent-loop-v2.ts`, its test, and `tests/playwright/site-audit.spec.ts`. The CLI and agent-core trees match. On resumption, canonical HEAD was `8abb40b91` for the focused root suite, browser fixture and resource checks. Windows used Node 22.22.3 and pnpm 10.33.4. Both global LiTT shims resolved to canonical `packages/litt-cli`.

## Execution ledger

| Check | Observed result | Scope of inference |
|---|---|---|
| CLI package, `pnpm exec tsc --noEmit`, `pnpm build`, `pnpm exec vitest run` | Typecheck and build succeeded. 3,206 tests passed, 6 skipped. | Windows package baseline. Skips are excluded from passes. |
| Agent-core package, `pnpm typecheck`, `pnpm test` | Typecheck succeeded, 1,052 tests passed. | Kernel, shell and policy test coverage. |
| Local Ollama streaming request to `litt-coder:8k` | Response contained `STREAM_OK`, 3 events, 337 ms to first token, 383 ms total. | One direct provider request. Measuring terminal paint and cold/warm percentiles requires an instrumented CLI run. |
| CLI package, enable `LITT_RUN_LIVE_OLLAMA=1`, run `pnpm exec vitest run src/__tests__/live-ollama-repair.test.ts` | 2 passed. Real-model solvable incident completed with exit 0. Unfixable incident failed validation with exit 4 and rollback. | Real bounded multi-step diagnosis, patch and verification on fixture workspaces. |
| Root, `pnpm exec vitest run tests/execution-authority.test.ts src/lib/litt-intelligence/tool-registry-browser-runtime.test.ts src/lib/litt-intelligence/browser-url-policy.test.ts src/lib/studio/__tests__/memory-service.test.ts` | 89/89 passed, including both expected browser rejection paths. | Authority tests inspect source. Browser action and memory tests use controlled dependencies. Live cloud account behavior remains open. |
| Installed Playwright Chromium, headless data-URL fixture | Browser navigated, rendered title `LiTT fixture`, changed button text to `42` on click and returned 4,759 screenshot bytes. Browser closed. | Actual local browser operation via Playwright. CLI browser-tool registration, hosted browser, takeover and download require separate integration evidence. |
| Three fresh Windows processes, `node dist/index.js --version` | Wall time 605 / 430 / 361 ms. Sampled peak working set 70.9 / 68.5 / 67.5 MiB. All exited 0. | PowerShell polled the child at roughly 15 ms intervals. Includes launch and observation overhead. Persistent-host idle memory and phone thermal behavior remain unmeasured. |
| WSL Ubuntu, built CLI version, help and local status | Version 0.1.1 and help worked. Status returned authentication required, exit 1, including local-only invocation. | Launch smoke only. A signed-in tool turn and native WSL build remain open. Preserve auth behavior pending diagnosis. |
| Android/Termux and macOS | No device run in this audit. | Record as unverified. |

## Evidence recorded on November 27, 2026 (CLI takeover lane)

Worktree `cli-next-audit-20261126`, branch `codex/cli-next-audit-20261126` at `4a7d61192` plus Codex's uncommitted session-store changes. Windows, Node 22, pnpm 10.33.4, Ollama live with `litt-coder:8k`.

| Check | Observed result | Scope of inference |
|---|---|---|
| `node --test --import tsx src/__tests__/*.test.ts` in `litt-agent-core` after the stdin fix | 1,058/1,058 passed, 0 failed. | Full core suite on Windows. |
| `stdin-plumbing.test.ts` incl. 6 new live Windows cases | 12/12 passed. Bare `date`, `time`, `pause` return promptly (no stdin-pipe hang); `date +%Y` resolves via Git coreutils or aborts honestly; `findstr` explicit-stdin guard passes. | Real spawned processes on this machine, not mocks. |
| `litt ask --jsonl` (local-only, `litt-coder:8k`), trivial prompt | `run.started` → `model.started` → one `model.delta` ("4") → `run.result` termination `complete`, exit 0, ~6.9 s wall (includes cold model load). | One headless turn. Proves native delta events reach the JSONL consumer; multi-delta TTFT percentiles still unmeasured. |
| `litt ask --jsonl`, second prompt | 30 sequenced events: 11 agent rounds, real gateway tool calls (`project.status/log/diff/list_files/check/run`), `project.check` ran `npx tsc --noEmit` exit 0 in 95.3 s, one honest tool-arg validation failure plus identical-retry guard, run terminated `cancelled` exit 130 at the 120 s ask timeout — no fake success. | One real multi-tool turn against this worktree. Shows structured events, truthful termination, and live tool execution; model chose tools over answering (weak-model behavior, expected). |
| Session-store uncommitted diff (Codex) | `vitest run session-store.test.ts` 15/15 passed. | Conversation-ID persistence fix is coherent and green; left uncommitted to preserve Codex's lane state. |
| `litt ask --jsonl` interactive streaming re-verification (Devin, HEAD `59d25af5`) | `node packages/litt-cli/dist/index.js ask --jsonl "Reply with exactly: STREAM_PROOF"` with `LITT_LOCAL_MODE=1`, `LITT_MODEL=litt-coder:8k` | `run.started` → `model.started` → 3 `model.delta` events (~90 ms span) → `run.result` termination `complete`, exit 0, 3.7 s wall. Confirms native deltas reach the JSONL consumer on the current head. Model answered `NO_PROOF` (weak-model literal miss — truthful output, not a plumbing defect). TTFT percentiles still unmeasured. |

## Traceability and outstanding live checks

| Behavior | Repository evidence | Outstanding end-to-end observation |
|---|---|---|
| Intent and bounded project retrieval | `packages/litt-cli/src/lib/intent.ts`, `lib/context-resolver.ts` and the corresponding `intent.test.ts` and `context-resolver.test.ts` under CLI tests | Record chosen intent and files read for a real multi-file task. |
| Session restoration and gateway rejection | CLI `src/__tests__/session-persistence.test.tsx` and `approval-policy.test.ts`, core `src/__tests__/sec6-execution-gateway.test.ts` | Relaunch two actual clients and compare restored context and denial records. |
| Cancellation and recovery | Core `src/__tests__/shell-executor.test.ts`, CLI `src/__tests__/terminal-teardown.test.ts` and `phase3c-reconnect.test.ts` | Inspect child and grandchild PIDs after cancellation, interrupt a local HTTP stream mid-response and verify one terminal outcome. |
| Provider failure and fallback | `terminal-server/litt-operator.ts` wraps `streamLiTTCode`. CLI model truth tests and repair incident fixtures cover model selection and failure states. | Exercise two configured providers with controlled loss of the primary. Capture the selected provider and emitted deltas. |
| Weekly or webhook automation, media, sandbox and device execution | Existing mission step adapters, product tool registry and `src/lib/terminal-v1/sandbox-provider.ts` | Run scoped jobs through the common host. External services and device coverage remain open. |

Verification of a handler, registry entry or fixture establishes only its tested boundary. Green suite totals cannot establish live browser, paid provider, cross-client memory or device support.
