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
| Provider/endpoint fallback, live (Devin, HEAD `68e71e26b`) | `litt ask --jsonl` with `LITT_OLLAMA_URL` unset, `OLLAMA_LOCAL_URL=http://127.0.0.1:9` (dead), `OLLAMA_LAN_URL=http://127.0.0.1:11434` (live Ollama), `OLLAMA_HOST=http://127.0.0.1:9` (dead — proves the serving endpoint came from the probe winner, not static env resolution) | `run.result` termination `complete`, exit 0, 212 ms. Local tier failed, LAN tier served — multi-route fallback works end to end. |
| All-routes-down honesty, live (same run set) | Same invocation with `OLLAMA_LOCAL_URL`/`OLLAMA_LAN_URL`/`OLLAMA_HOST` all dead | `run.result` termination `error`, exit 1, ~instant: "Ollama unreachable on every configured route — LOCAL OLLAMA … fetch failed; LAN OLLAMA … fetch failed. Set OLLAMA_TAILSCALE_URL …". Names every tier tried; no hang, no fabricated success. |

## Traceability and outstanding live checks

| Behavior | Repository evidence | Outstanding end-to-end observation |
|---|---|---|
| Intent and bounded project retrieval | `packages/litt-cli/src/lib/intent.ts`, `lib/context-resolver.ts` and the corresponding `intent.test.ts` and `context-resolver.test.ts` under CLI tests | Record chosen intent and files read for a real multi-file task. |
| Session restoration and gateway rejection | CLI `src/__tests__/session-persistence.test.tsx` and `approval-policy.test.ts`, core `src/__tests__/sec6-execution-gateway.test.ts` | Relaunch two actual clients and compare restored context and denial records. |
| Cancellation and recovery | Core `src/__tests__/shell-executor.test.ts`, CLI `src/__tests__/terminal-teardown.test.ts` and `phase3c-reconnect.test.ts` | Inspect child and grandchild PIDs after cancellation, interrupt a local HTTP stream mid-response and verify one terminal outcome. |
| Provider failure and fallback | `terminal-server/litt-operator.ts` wraps `streamLiTTCode`. CLI model truth tests and repair incident fixtures cover model selection and failure states. | Exercise two configured providers with controlled loss of the primary. Capture the selected provider and emitted deltas. |
| Weekly or webhook automation, media, sandbox and device execution | Existing mission step adapters, product tool registry and `src/lib/terminal-v1/sandbox-provider.ts` | Run scoped jobs through the common host. External services and device coverage remain open. |

Verification of a handler, registry entry or fixture establishes only its tested boundary. Green suite totals cannot establish live browser, paid provider, cross-client memory or device support.

## Final qualification recorded on November 27, 2026

### Revision and environment

Qualification ran from `codex/cli-final-qualification-20261127` at
`a1c2dd3cce7d01be45e584588ce7ad286b1e64a1` before the documentation-only
handoff commit. That revision contains the accepted P0 merge plus the CLI-next
closeout commits that remove the unused `CliAgentLoop`, protect persisted
browser cookies, and make the TUI scroll proof deterministic. The host was
Windows `10.0.26300.10075`, Node `26.13.0`, and pnpm `10.33.4`.

### User-defined closeout P1-P4 qualification ledger

The P1-P4 labels in this section refer to the November 27 final-closeout
request (unified architecture, structured execution, provider fallback, final
qualification). They do **not** redefine the older delivery-priority P1-P4 in
`roadmap.md`.

| Requirement | Fresh observation | Result and boundary |
|---|---|---|
| Closeout P1 — authoritative architecture | Source search found the exported runtime at `packages/litt-agent-core/src/agent-loop.ts#runAgentLoop`; CLI headless and Ink entry points import it. Commit `56d2d2bf3` removed the unused `packages/litt-cli/src/lib/agent-loop.ts` and its duplicate test. | **PASS.** No runtime replacement or new execution path was added. |
| Closeout P2 — structured output | Strict-local `litt ask --json` emitted one valid `run.result` with `JSON_OK`, exit 0. Strict-local `--jsonl` emitted 68 individually valid, sequential events with native deltas before one terminal result, exit 0. | **PASS** on live Windows/Ollama. The local model's longer prose differed from the requested wording, but serialization and termination were truthful. |
| Closeout P2 — genuine remote path | Focused CLI tests ran a real in-process Socket.IO transport into `runAgentLoop`, executed native project evidence, preserved canonical tool identity, and failed closed on remote/auth errors. Focused result: 138 passed, 1 environment-gated skip. | **PASS** for genuine transport execution without a hosted paid-provider call. Hosted account/billing behavior was intentionally not invoked. |
| Closeout P2 — streaming and cancellation | `verify-phase1-cancellation.mjs` cancelled a live HTTP stream and a process with a grandchild. Both exited 130 with one final `run.result`; the socket closed in 17 ms and both fixture PIDs were gone in 179 ms. Core focused result: 64 passed. | **PASS** on Windows. |
| Closeout P2 — interactive output | `tui-interactive-proof.mjs` drove the real Ink cockpit in ConPTY. All 11 assertions passed (PTY boot plus 10 interaction assertions): LOCAL header, signed-out `/local` execution, paging, live return, and truthful no-remote-contact status. | **PASS** on Windows. |
| Closeout P3 — provider fallback and cost safety | Provider/browser group: 115 passed. PC-first Ollama routing: 20 passed. Strict-local live route test made the local tier fail, selected the configured PC/LAN tier, emitted seven sequential JSONL events, returned `PC_BACKED_OK`, and exited 0. Provider policy keeps 402 as a hard stop by default and requires explicit opt-in for retry. | **PASS.** The live qualification set `LITT_LOCAL_ONLY=1`; no cloud or paid provider was contacted. |
| Closeout P3 — context and grants | Full agent-core suite exercised prior messages, escalation tracking, execution-gateway grants, and canonical tool dispatch through `runAgentLoop`. | **PASS** within the tested contracts. |
| Closeout P4 — browser acceptance | Final run used local `litt-hermes:16k`, real Chrome/CDP, the controlled public `httpbin.org/forms/post` fixture, and interactive approvals. Navigation, snapshot, type, click, screenshot, extract, report, and clean termination passed: 11/11. | **PASS.** The slower local model required the supported `LITT_ASK_TIMEOUT_MS=210000` override; the harness retained its four-minute cap. |
| Closeout P4 — persistent credentials | `auth.test.ts`: 110 passed, including Windows keychain selection, Termux file mode `0600`, directory mode `0700`, atomic writes, CSRF, and no-token-leakage checks. A read-only nonexistent-entry probe returned `KEYRING_AVAILABLE_EMPTY`, confirming Windows Credential Manager availability without reading a real secret. | **PASS** on this Windows host; Termux file permissions are test-proven but not device-observed. |
| Closeout P4 — Windows and PocketOS PC-backed | Windows structured, TUI, cancellation, browser, build, and full suites passed. Termux/portable surface group: 168 passed. The live PC/LAN Ollama fallback completed as above. | **PASS** for the Windows PC host and PC-backed route contract. |
| Closeout P4 — unavailable platforms | `adb` was unavailable. WSL enumeration returned `E_ACCESSDENIED`. No macOS, native-Linux, or physical Termux host was attached. | **BLOCKED**, not passed: physical PocketOS/Android, WSL execution, native Linux, and macOS. |

### Reproduction commands

Run from `C:\LiTT\Worktrees\cli-final-qualification-20261127` after
`pnpm install --frozen-lockfile` and the documented models/core build order.
Full-suite logs and browser/TUI transcripts remain in the worktree's ignored
execution ledger. The focused, live, and final commands were:

```powershell
cd packages/litt-cli
pnpm exec vitest run src/__tests__/ask-entry-wiring.test.ts src/__tests__/ask-mode-enforcement.test.ts src/__tests__/ask-deadline.test.ts src/__tests__/approval-cancel-wiring.test.ts src/__tests__/live-provider-stream.test.ts src/__tests__/remote-evidence-regression.test.ts src/__tests__/remote-transport.test.ts src/__tests__/remote-model-provider.test.ts src/__tests__/remote-fail-closed.test.ts src/__tests__/tool-call-stream.test.ts src/__tests__/tool-call-stream-regression.test.ts src/__tests__/chat-transcript-streaming-visibility.test.tsx
pnpm exec vitest run src/__tests__/provider-policy.test.ts src/__tests__/provider-routing.test.ts src/__tests__/latency-routing.test.ts src/__tests__/local-provider-pin.test.ts src/__tests__/capability-gate-local-provider.test.ts src/__tests__/ask-model-selection.test.ts src/__tests__/p0-doctor-effective-provider.test.ts src/__tests__/browser-tools.test.ts src/__tests__/no-key-session-persistence.test.ts
pnpm exec vitest run src/__tests__/active-project.test.ts src/__tests__/workspace-context-fix.test.ts src/__tests__/which.test.ts src/__tests__/submit-transcript-regression.test.ts src/__tests__/state-home-resolution.test.ts src/__tests__/p0-composer-acceptance.test.ts src/__tests__/reduced-motion.test.tsx src/__tests__/auth-gate-local-mode.test.ts
node scripts/verify-phase1-cancellation.mjs
node scripts/tui-interactive-proof.mjs
$env:LITT_LOCAL_ONLY='1'; $env:LITT_MODEL='litt-coder:8k'; node dist/index.js ask --json 'Reply with exactly JSON_OK and nothing else.'
$env:LITT_LOCAL_ONLY='1'; $env:LITT_MODEL='litt-coder:8k'; node dist/index.js ask --jsonl 'Write three short lines labeled ONE, TWO, and THREE, then stop.'
$env:LITT_ASK_TIMEOUT_MS='210000'; node scripts/browser-task-proof.mjs --model litt-hermes:16k
pnpm exec vitest run src/__tests__/auth.test.ts

cd ../litt-models
node --test --import tsx src/__tests__/ollama-route.test.ts

cd ../litt-agent-core
node --test --import tsx src/__tests__/realtime.test.ts src/__tests__/stdin-plumbing.test.ts src/__tests__/shell-executor.test.ts src/__tests__/agent-loop-stagnation.test.ts src/__tests__/agent-loop-search-result-visibility.test.ts src/__tests__/agent-loop-empty-visible-response.test.ts
pnpm typecheck
pnpm test

cd ../litt-cli
pnpm exec tsc --noEmit
pnpm exec vitest run
pnpm build
```

For the live PC-backed fallback, the `ask --jsonl` process additionally used
`OLLAMA_LOCAL_URL=http://127.0.0.1:9`,
`OLLAMA_LAN_URL=http://127.0.0.1:11434`, and
`OLLAMA_HOST=http://127.0.0.1:9`. The local-only lock remained enabled.

### Final regression

| Package | Command | Result |
|---|---|---|
| `packages/litt-agent-core` | `pnpm typecheck` then `pnpm test` | Typecheck passed; 1,081 passed, 0 failed, 0 skipped. |
| `packages/litt-cli` | `pnpm exec tsc --noEmit`, `pnpm exec vitest run`, `pnpm build` | Typecheck and build passed; 3,312 passed, 0 failed, 6 skipped. |

Final full-suite total: **4,393 passed, 0 failed, 6 skipped**. Focused and
live acceptance counts above overlap the full suites where noted and are not
added to that total.

### Confirmed remaining defects

None were reproduced within the qualified Windows and PC-backed scope. The
`BLOCKED` platform rows are evidence gaps, not defect claims. The default
120-second ask deadline was insufficient for the cold/slower 16k browser run;
the documented per-run timeout override completed the same bounded workflow.
