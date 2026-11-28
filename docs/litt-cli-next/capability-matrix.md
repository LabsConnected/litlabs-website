# LiTT CLI Capability Matrix

This matrix reports repository state at baseline `8abb40b91`. “Verified” means evidence gathered during this audit or a directly relevant repository test—not that every platform and integration is production-proven.

## 1. Agent kernel and inference

| Capability | Status | Implementation evidence | Verification / gap |
|---|---|---|---|
| Canonical model/tool agent loop | **Implemented and verified** | `packages/litt-agent-core/src/agent-loop.ts`; used by CLI ask, Ink controller, and terminal operator | agent-core: 1,052 tests passed; CLI: 3,206 tests passed, 6 skipped |
| CLI conversational inference | **Implemented and verified** | `packages/litt-cli/src/commands/ask.ts`; `packages/litt-cli/src/ink/controller.ts` | Both call `runAgentLoop`; full CLI suite passed |
| Local Ollama inference | **Implemented and verified** | CLI provider selection and Ollama provider path | Real `litt-coder:8k` stream returned `STREAM_OK`; live repair tests passed 2/2 |
| Native token streaming, local provider | **Implemented and verified** | model delta path through core/CLI | Live probe: 337 ms first token, 383 ms total, 3 events |
| Native streaming, Desktop shared provider | **Incomplete** | `terminal-server/litt-agent.ts` wraps `streamLiTTMessagesWithTools` | Source says underlying call is non-streaming single JSON, emitted as one delta |
| Structured multi-message model transport | **Incomplete** | Core accepts messages; `terminal-server/litt-operator.ts` reconstructs a flat prompt | Compatibility path works, but tool/message fidelity and cancellation are not uniform |
| Per-turn model cancellation | **Implemented and verified** | `AbortController` in Ink controller and abort handling in core | CLI cancellation/teardown tests passed; provider-by-provider live proof remains incomplete |
| Provider fallback | **Incomplete** | local/provider resolution and terminal `streamLiTTCode` fallback | Automated provider/fallback tests passed; paid cloud path not invoked during audit |
| Honest no-provider behavior | **Implemented and verified** | `ask.ts` deterministic fallback with warning | Covered by CLI suite; not presented as model inference |
| Context carry-over between turns | **Implemented and verified** | core `priorMessages`; controller `buildPriorMessages`; session restoration | Session persistence and context tests passed |
| Automatic context pruning | **Implemented and verified** | core `pruneMessages`, compact budget defaults to 2,400 tokens for compact/local mode | Core tests passed |
| Semantic context compression | **Missing** | No shared summarization/checkpointed summary contract found | Current behavior truncates/prunes; it does not preserve semantic state by summary |
| Provider/model observability | **Incomplete** | Transcript/status metadata and model events | Provider/model/duration visible; fallback reason, token usage, context utilization, and real cost are not consistently exposed |

## 2. Execution, tools, and safety

| Capability | Status | Implementation evidence | Verification / gap |
|---|---|---|---|
| Canonical CLI execution gateway | **Implemented and verified** | `packages/litt-agent-core/src/execution-gateway.ts` | Execution-authority tests and full suites passed |
| Auth, grants, approvals, command classification | **Implemented and verified** | `ExecutionGateway`, command executor, shell executor | Agent-core and CLI safety tests passed |
| LOCAL/REMOTE target switching | **Implemented and verified** | CLI target selection, `/local`, `/remote`, flags, environment overrides | Automated CLI suite passed; stable semantics explicitly protected |
| Local-only emergency lock | **Implemented and verified** | `LITT_LOCAL_ONLY` / legacy compatibility | Automated tests passed |
| Machine-lane execution | **Implemented and verified** | CLI local command route through gateway | Automated tests passed; no destructive live command run |
| Shell/files/git/build/test tools | **Implemented and verified** | agent-core built-ins and CLI bindings | Full suites exercise allow/deny and execution paths |
| Realtime web search/fetch/weather | **Incomplete** | agent-core realtime tools; web registry delegates shared handlers | Unit/integration tests passed; no paid external search was required |
| Shared tool catalog across CLI and Studio | **Duplicate** | agent-core registry and `src/lib/litt-intelligence/tool-registry.ts` both define overlapping tools | Tool IDs/semantics can drift; only select realtime tools delegate to core |
| One execution authority across CLI and Studio | **Disconnected** | CLI uses `ExecutionGateway`; Studio V2 uses `PermissionEngine` + web registry | `tests/execution-authority.test.ts` explicitly documents the split |
| Workspace transport through gateway | **Missing** | No `WorkspaceTransport -> ShellExecutor` adapter found | Test comments identify this adapter as the convergence requirement |
| Studio transport failure behavior | **Incomplete** | messages route can fall back to V1 read-only inspection | Current behavior silently degrades; target requires an explicit surfaced fallback |
| Legacy `/api/bridge/cli` path | **Duplicate** | `src/app/api/bridge/cli/route.ts` spawns external agents/shells | Admin/prod gates exist, but it is not the shared agent context or canonical gateway path |
| Secondary CLI `CliAgentLoop` | **Duplicate** | `packages/litt-cli/src/lib/agent-loop.ts` | Conversation path intentionally returns failure and directs callers to `runAgentLoop`; do not extend it |
| Direct conversation through secondary loop | **Disconnected** | `CliAgentLoop.executeDirectInference()` produces “must be routed through runAgentLoop” failure | Non-canonical path is deliberately unusable; deprecate/adapt rather than repair as a second loop |
| Credential lease and redaction boundary | **Implemented and verified** | gateway/capsule/credential tests; repair evidence redaction | Core safety tests passed; repair redactor has documented token-format gaps outside its known patterns |
| Process timeout and output caps | **Incomplete** | shell/repair/mission execution controls | Automated timeout/stall tests passed |
| Cancellation across process trees | **Incomplete** | runtime session, signal handler, shell cancellation | Windows-focused suite passed; platform parity remains incomplete |

## 3. TUI and headless operation

| Capability | Status | Implementation evidence | Verification / gap |
|---|---|---|---|
| Interactive Ink cockpit | **Implemented and verified** | `packages/litt-cli/src/ink/` | Render, keyboard, activity, session, cancellation, and narrow-layout tests passed |
| Streaming transcript | **Implemented and verified** | controller appends model deltas as they arrive | Automated tests plus live Ollama streaming evidence |
| Live tool/activity feed | **Implemented and verified** | `activity-stream.tsx`, controller tool events | Expand/collapse and activity tests passed |
| Command palette/autocomplete/history | **Implemented and verified** | composer/palette/controller implementation | Relevant tests passed |
| Session history and restore | **Implemented and verified** | `session-store.ts`; controller restoration | Persistence/restore tests passed |
| Context attachment picker | **Incomplete** | `@` references and file context exist | Folder semantics and unified workspace/context protocol are not complete |
| Markdown rendering | **Incomplete** | headers, emphasis, inline code, code blocks, quotes | Not a full CommonMark renderer |
| Syntax highlighting | **Missing** | No language-aware highlighter found in TUI render path | Diff coloring exists but is not syntax highlighting |
| Diff viewer | **Implemented and verified** | Ink diff views and line coloring | UI tests passed |
| Multiline composer | **Missing** | Enter submits; newline handling normalizes to submit behavior | Composer is grapheme-safe but not multiline |
| Token/context usage indicator | **Missing** | No consistent TUI meter found | Must be supplied by canonical run/model events |
| Actual cost indicator | **Incomplete** | Cost-tier helpers/metadata exist | No consistent actual/estimated spend stream found |
| Responsive terminal layout | **Implemented and verified** | Ink layout logic and narrow-terminal tests | Windows test coverage passed |
| Headless one-shot commands | **Implemented and verified** | ask/run/status/repair/mission command paths and exit codes | CLI suite passed |
| General `--json` / `--jsonl` event output | **Missing** | Remote client parses internal NDJSON; selected utility commands have JSON | No universal machine-readable agent-run stream flag found |
| Stable headless terminal outcomes | **Incomplete** | repair/mission have strong exit contracts | General interactive agent commands lack one documented structured outcome schema |

## 4. Browser, computer use, and autonomy

| Capability | Status | Implementation evidence | Verification / gap |
|---|---|---|---|
| Studio browser session manager | **Incomplete** | `browser-session-manager.ts`; browser handlers and tests | Repository tests cover the feature; live paid browser service not invoked |
| Browser navigation/snapshot/screenshot/actions | **Incomplete** | `browser.*` handlers in web tool registry | Web path only; test evidence, not a live external session in this audit |
| Browser upload/download/takeover controls | **Incomplete** | browser handlers/session controls | Web path only; policy integration with CLI gateway is absent |
| CLI/core browser tools | **Disconnected** | No browser descriptors in agent-core tool set | Existing Studio implementation is not reachable through canonical CLI/core |
| Local browser backend | **Missing** | No canonical local Playwright/browser adapter found for CLI | Optional future backend; not required for initial convergence |
| General desktop computer control | **Missing** | No canonical CLI/core computer-control adapter found | Must be separately capability-gated and takeover-aware |
| Autonomous repair | **Implemented and verified** | CLI `repair` pipeline and hardening suite | Full repair suite passed; live Ollama solvable/unfixable cases passed 2/2 |
| Repair rollback/resume/integrity | **Implemented and verified** | persisted reports, snapshots, manifest, job digest, rollback | Automated hardening/eval tests passed |
| Durable mission controller | **Implemented and verified** | `packages/litt-cli/src/lib/missions/` | Fixed step kinds, resume/idempotence, and exit codes covered by tests |
| General durable job engine | **Incomplete** | Repair and missions prove primitives | No shared generic job contract/scheduler across product surfaces |
| PLAN/ACT/AUTO modes | **Implemented and verified** | core modes and CLI controller policy | Tests passed; presentation emphasizes plan/act more than full autonomous operation |
| Checkpoint support in Studio | **Incomplete** | Studio agent loop/tooling | Disconnected from CLI/core run state |
| Canonical checkpoint protocol | **Missing** | No cross-surface checkpoint/event contract found | Required for resumable general autonomy |
| Specialized agent delegation | **Missing** | No canonical CLI/core delegation contract found | Web agent profiles are not a bounded delegation runtime |
| Unrelated-change detection | **Implemented and verified** | Repair pipeline | Proven for repair, not yet generalized to every coding run |

## 5. Memory, integration, and automation

| Capability | Status | Implementation evidence | Verification / gap |
|---|---|---|---|
| CLI local session persistence | **Implemented and verified** | `~/.litt/sessions.json` through `session-store.ts` | Atomic/locking and restore tests passed; storage is intentionally bounded |
| Studio personal/workspace memory | **Incomplete** | `memory.search`, `memory.store`, web persistence | Repository coverage exists; not consumed by CLI/core |
| Shared persistent memory | **Disconnected** | CLI sessions and Studio memory use separate stores/contracts | No common memory adapter or scoping model found |
| Shared conversation identity | **Missing** | CLI uses local session IDs; web uses product conversation state | No canonical conversation/run mapping across Chat, Studio, PocketOS, CLI |
| LiTT Chat to local host | **Incomplete** | Terminal/bridge infrastructure exists | No single shared request/event/context protocol end to end |
| LiTT Studio to local host | **Incomplete** | Workspace transport executes remotely/local-workspace style | Uses separate loop and authority; not the canonical CLI host contract |
| PocketOS PC-backed inference | **Incomplete** | Ollama LAN/Tailscale discovery and host resolver code/tests | Real Android/Termux device was not available; end-to-end UI/context sharing unproven |
| PocketOS on-device inference | **Incomplete** | No device execution evidence gathered | Must be treated as a separate constrained adapter |
| Scheduled execution | **Missing** | No general CLI scheduler entry point found | Fixed missions can wait/watch but are not a scheduler |
| Webhook-triggered agent jobs | **Missing** | No canonical webhook-to-job contract found in CLI/core | Product routes may exist, but not as the shared local engine |
| Event-driven resume | **Incomplete** | Repair resume and mission watch/owner gates exist | No generic event subscription/resume protocol |
| User-controlled memory retention/deletion | **Incomplete** | Product-specific controls may exist | No unified policy and evidence contract across stores |

## 6. Cross-platform, packaging, and performance

| Capability | Status | Implementation evidence | Verification / gap |
|---|---|---|---|
| Windows build/typecheck/test | **Implemented and verified** | Canonical Windows checkout | CLI typecheck, build, 3,206 tests; core typecheck and 1,052 tests all passed |
| Global CLI link target | **Implemented and verified** | `where.exe litt` plus junction inspection | Both discovered shims resolve to canonical `packages/litt-cli` |
| WSL build/launch smoke | **Incomplete** | WSL Node/pnpm and built CLI | Version/help worked; operational `status` remained auth-gated, so local tool execution was not proven |
| macOS runtime | **Incomplete** | CI configuration exists | Not run locally during this audit |
| Termux/Android runtime | **Incomplete** | Portable argv/path-oriented repair fixtures | No device was available; not a supported claim yet |
| Startup latency budget | **Incomplete** | Three fresh Windows `--version` processes | 361–605 ms, sampled peak 67.5–70.9 MiB. Idle and device budgets remain open |
| TTFT budget | **Incomplete** | One live Ollama measurement gathered | No repeatable benchmark matrix by model/platform |
| Idle memory/CPU budget | **Missing** | No acceptance threshold found | Important for persistent host and PocketOS |
| Thermal/battery policy | **Missing** | No mobile resource governor found | Required before on-device autonomous work |
| Lazy optional integrations | **Incomplete** | Browser handlers use lazy imports; other integrations vary | Needs an enforceable dependency/startup budget |

## Additional requested capabilities

| Capability | Status | Source and verification boundary |
|---|---|---|
| Intent recognition, planning, project-aware tool selection and execution summaries | Incomplete | CLI `src/lib/intent.ts`, `project-state.ts`, `context-resolver.ts` and Ink controller. Intent fixtures passed in the CLI suite. The live repair result covers one bounded planning task. General planning quality and truthful summaries across clients remain unmeasured. |
| Source-backed citations, document extraction and deep research | Disconnected | Web `src/lib/litt-intelligence/research-engine.ts`, `research-providers.ts` and browser handlers. Retrieved source-to-claim accuracy through CLI requires A5. |
| File organization, GitHub operations, dependency management and workspace maintenance | Incomplete | Project tools, CLI `src/lib/git-workflow.ts` and mission adapters cover subsets. Package-manager mutations, multi-file moves and GitHub writes lack a combined live acceptance run. |
| Diagnostics, resource monitoring and process management | Incomplete | CLI PC probes, production doctor and shell executor provide targeted checks. Live measurements cover one Windows launch path. Desktop-wide resource and process control require separate grants and tests. |
| Repository semantics, dependency and architecture analysis, targeted search | Incomplete | Context resolver, project-state and package-inspection tools provide bounded source and manifest input. Semantic retrieval quality on a large repository remains unverified. |
| Multi-file and incremental editing, test generation, debugging and regression verification | Incomplete | Repair manifests, snapshots, incident fixtures and live Ollama tests demonstrate narrow fixes. Generated tests, incremental edits across files and recovery in a general job require A6. |
| Code review and defensive security auditing | Incomplete | Project diff, inspection and test tools supply evidence. Accuracy against known review findings and false-positive rates lack a CLI acceptance dataset. |
| Coding-job worktree isolation | Incomplete | Dedicated Git worktrees are operational. Automatic ownership leases for agent jobs and concurrent-edit conflict handling lack runtime proof. |
| Agent-to-agent communication | Missing | No core delegation message and result protocol identified. Mission step adapters provide narrower orchestration. |
| Media and secure cloud sandboxes | Disconnected | Product implementations include `src/lib/media.ts` and `src/lib/terminal-v1/sandbox-provider.ts`. Shared-host dispatch needs A7. |
| Bounded concurrency, efficient retrieval, resource-aware model selection and memory protection | Incomplete | Compact prompt budgets, project context and provider routing exist. Host-wide concurrency and resource ceilings need measurements under load. |
| PC-first inference, low power, offline degradation and phone daemon startup | Incomplete | CLI local-only policy and PC discovery have test coverage. A9 requires observed offline and low-power behavior and daemon counts on physical Termux. |

No current production CLI defect was established solely by the unsupported secondary conversation branch. Its explicit failure is evidence of a disconnected entry point. The observed WSL auth result remains open pending a test under the intended identity.

## 7. Highest-risk findings

1. **Execution authority is split.** Studio and CLI can make different decisions for the same action.
2. **The repository has more capability than the CLI exposes.** Browser, memory, checkpoints, and broader tools are disconnected rather than absent.
3. **A second CLI loop abstraction is already a dead end.** Extending it would deepen duplication.
4. **Streaming is not uniform.** Local Ollama is genuinely streamed; at least one Desktop provider path buffers a single response.
5. **Headless automation lacks one public event/output contract.** Internal NDJSON does not substitute for documented `--jsonl` behavior.
6. **Platform confidence is asymmetric.** Windows is strong; WSL is smoke-level; macOS/Termux remain evidence gaps.
