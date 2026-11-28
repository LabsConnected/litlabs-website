# LiTT CLI Next-Generation Agent Architecture

## 1. Purpose

LiTT CLI should become the local execution engine behind LiTT Chat, LiTT Studio, PocketOS, and direct terminal use. Every surface should be able to start the same kind of agent run, observe the same event protocol, use the same execution policy, and resume the same durable state without importing a UI-specific controller.

This is a convergence architecture. It preserves working code and introduces adapters around it. It is not a rewrite.

## 2. Audit conclusion

The repository already contains most of a strong foundation:

- `packages/litt-agent-core/src/agent-loop.ts` is a real model/tool loop with streaming, cancellation, tool execution, bounded context, verification, and prior-message support.
- `packages/litt-agent-core/src/execution-gateway.ts` is the canonical security and execution boundary used by CLI flows.
- `packages/litt-cli/src/commands/ask.ts` and `packages/litt-cli/src/ink/controller.ts` route real conversations through `runAgentLoop`.
- `terminal-server/litt-operator.ts` also wraps `runAgentLoop`, giving remote operation the same core.
- `packages/litt-cli/src/lib/missions/` and `packages/litt-cli/src/lib/repair/` prove that resumable, durable, verified local jobs can be implemented safely.
- Studio has a much broader tool catalog, browser automation, memory, checkpoints, and workspace transport.

The foundation is fragmented at the point where it matters most:

- Studio's `src/lib/litt-intelligence/agent-loop-v2.ts` is a separate agent engine.
- `tests/execution-authority.test.ts` explicitly records that the Studio/web path does not use `ExecutionGateway` and requires a `WorkspaceTransport -> ShellExecutor` adapter to converge.
- `src/lib/litt-intelligence/tool-registry.ts` and agent-core own overlapping tool definitions and execution behaviors.
- `packages/litt-cli/src/lib/agent-loop.ts` is a second CLI loop abstraction whose direct conversation path intentionally fails and tells callers to use `runAgentLoop`.
- Browser and memory capabilities exist in Studio but are disconnected from the canonical core.

The next phase should remove those ownership splits before broadening autonomy.

## 3. Architectural decision

### 3.1 Canonical kernel

`@litt/agent-core` is the single platform-neutral agent kernel. It owns:

- agent-run state transitions;
- model stream consumption;
- tool-call normalization;
- cancellation propagation;
- context-budget enforcement;
- approval requests and resumable pauses;
- verification state;
- canonical run events and terminal outcomes.

It must not own Ink, Next.js, Socket.IO, Supabase, Browserbase, Android UI, or a process-global singleton.

### 3.2 LiTT CLI as the local host

LiTT CLI is the default local process host for that kernel. It owns:

- local configuration and provider discovery;
- process lifecycle and signal handling;
- local session/job persistence;
- local shell, filesystem, git, browser, and computer adapters;
- local IPC/service exposure for LiTT surfaces;
- human terminal presentation when invoked interactively;
- machine-readable output when invoked headlessly.

LiTT CLI is a host, not a second agent brain. Ink is one client of the host.

### 3.3 Surface clients

LiTT Chat, Studio, PocketOS, and the terminal each own presentation and user interaction. They submit an `AgentRunRequest`, consume `AgentRunEvent` values, and answer approval/takeover prompts. They do not implement execution policy.

### 3.4 Adapter boundary

Environment-specific behavior is injected behind narrow interfaces:

```text
LiTT Chat / Studio / PocketOS / TUI / headless caller
                         |
                 AgentHostClient
                         |
        AgentRunRequest + AgentRunEvent stream
                         |
              LiTT CLI local agent host
                         |
                  @litt/agent-core
             /          |           \
      ModelStream  ExecutionGateway  StateStore
                         |
                  ToolCatalog/Runner
              /       /       \        \
          shell    files/git  browser  computer
```

Remote execution uses the same contracts through a transport adapter. A remote transport can carry events over Socket.IO or NDJSON, but it cannot define different run semantics.

## 4. Canonical contracts

The first implementation phase should characterize existing behavior in tests, then introduce stable contracts without changing user-visible routing.

### 4.1 `AgentRunRequest`

Minimum fields:

- `runId` and optional `conversationId`;
- ordered prior messages or a context reference;
- current user input;
- execution target: `local | remote`;
- mode: `plan | act | auto`;
- requested model policy, never a hidden model mutation;
- workspace identity and working directory reference;
- allowed tool capabilities;
- approval policy reference;
- context and output budgets;
- optional resume token;
- trace metadata safe for logging.

The request must not contain raw credentials. Credentials remain in the gateway/lease layer.

### 4.2 `AgentRunEvent`

All surfaces should receive the same ordered event envelope:

- `run.started`;
- `model.started`;
- `model.delta`;
- `model.completed`;
- `tool.requested`;
- `approval.required`;
- `tool.started`;
- `tool.output`;
- `tool.completed`;
- `verification.started`;
- `verification.completed`;
- `checkpoint.saved`;
- `run.paused`;
- `run.completed`;
- `run.failed`;
- `run.cancelled`.

Every envelope carries `runId`, monotonic `sequence`, timestamp, version, and a redacted payload. Reconnects resume from a sequence cursor. Exactly one terminal event is allowed.

### 4.3 `ModelStream`

The provider contract accepts structured messages, tool schemas, an `AbortSignal`, and output limits. It yields native deltas and tool-call fragments. Provider wrappers may fall back between configured providers, but must emit the selected provider/model and fallback reason.

Flattening a conversation to one prompt is a compatibility adapter, not the target contract. Returning a single JSON response as one delta is not considered native streaming.

### 4.4 `ShellExecutor`

`ExecutionGateway` remains the only authority that can turn an approved request into a shell execution. Local process spawn and Studio `WorkspaceTransport` both implement the same `ShellExecutor` contract.

The required Studio convergence adapter is:

```text
WorkspaceTransportShellExecutor
  exec(argv, cwd, envLease, signal, limits)
    -> WorkspaceTransport.exec(...)
    -> normalized stdout/stderr/exit/timeout/cancel result
```

The adapter does not authorize. It only executes a decision already made by `ExecutionGateway`.

### 4.5 `ToolCatalog` and `ToolRunner`

Tool metadata and tool execution are separate:

- core tool descriptors define ID, schema, risk class, capabilities, and output contract;
- adapters bind descriptors to local, workspace, browser, or remote implementations;
- `ExecutionGateway` decides whether a mutating tool may run;
- surfaces may filter what is advertised but cannot weaken policy.

Existing web and core registries should be migrated by aliasing/adapting one tool at a time. Tool IDs must not be renamed in bulk.

### 4.6 State contracts

State is layered:

- **Run journal:** append-only events and terminal result for recovery.
- **Conversation state:** user/assistant/tool messages and compacted summaries.
- **Job state:** durable mission/repair/general automation checkpoints.
- **Personal memory:** explicit user-approved facts and preferences.
- **Workspace memory:** project-scoped facts, decisions, and indexed evidence.

The current CLI `sessions.json`, repair reports, mission stores, web conversation data, and Studio memory remain adapters during migration. No big-bang database move is required.

## 5. Execution and safety invariants

The following are non-negotiable:

1. LOCAL remains the default execution target. `localOnly` remains a separate emergency/offline lock.
2. `/local`, `/remote`, `--local`, and `--remote` keep their current meaning.
3. No shell, file mutation, browser side effect, deployment, or credential use bypasses the canonical approval and gateway rules.
4. A transport failure never silently changes authority or execution target.
5. Studio transport creation failure may offer an explicit read-only fallback; it must not silently downgrade.
6. Cancellation reaches the model request, pending tool, child process, browser action, and persistence layer.
7. A cancelled run emits one terminal event and leaves a resumable or explicitly non-resumable journal.
8. Credentials are referenced through leases and redacted before persistence or model exposure.
9. Existing repair rollback, resume integrity, argv-only command policy, and unrelated-change detection remain intact.
10. Remote transports cannot grant more authority than the originating local policy allows.

## 6. Model inference and context

### 6.1 Native streaming

The Windows Ollama probe produced multiple deltas with a measured time-to-first-token, proving the local stack can stream. The target is to preserve provider-native deltas end to end. Each surface must display or emit the first content delta without waiting for run completion.

Desktop's current `SharedLiTTModelProvider` wraps a non-streaming JSON response as one delta. That path is incomplete and should adopt the common `ModelStream` contract.

### 6.2 Context compression

Core currently applies bounded pruning for compact/local runs. That is useful protection but not semantic conversation compression. The target compressor:

- preserves the latest user intent, active plan, approvals, tool results needed for verification, and unresolved errors;
- summarizes older settled turns;
- records which message ranges a summary replaces;
- is deterministic under a fixed summarizer/model policy;
- never summarizes secrets before redaction;
- exposes context utilization to clients.

Compression is an adapter behind the run state contract, not a new loop.

### 6.3 Fallbacks

Fallback behavior must be observable. The event stream records provider, model, reason, attempt number, and whether output was native-streamed. Local provider unavailability may trigger an explicitly configured remote fallback unless `localOnly` is true. Billing, authentication, and offline failures must remain distinct terminal reasons.

## 7. TUI architecture

The Ink application remains a surface client. It should consume canonical events rather than infer activity from controller-local state.

Target TUI modules:

- transcript renderer with CommonMark-compatible blocks;
- syntax-aware code and diff renderer;
- multiline, grapheme-safe composer;
- context attachment picker;
- activity/approval/takeover panel;
- run status bar showing provider, model, target, duration, token/context usage, and estimated cost when available;
- session/job browser;
- stable narrow-terminal layout and non-TTY headless path.

No UI component may execute a tool directly.

## 8. Browser and computer control

Studio already has a substantial browser tool set. The plan should expose it through a browser adapter rather than recreate it in CLI.

The browser contract must support:

- start/reuse/close session;
- navigate and wait;
- accessibility/DOM snapshot;
- screenshot;
- click/type/select/scroll/press;
- upload/download with explicit file boundaries;
- takeover request and return;
- per-action timeout/cancellation;
- artifact references in the run journal.

The first implementation may adapt the current managed browser service. A local Playwright adapter is a separate optional backend and must not be required for convergence.

Computer control follows the same pattern, with stricter capability and takeover gates. Browser and computer tools are never granted merely because the run is in AUTO mode.

## 9. Autonomous coding and delegation

Autonomy is built from durable primitives already demonstrated by repair and missions:

- scoped workspace identity;
- declared mutable paths;
- checkpoint before mutation;
- regression or acceptance command;
- bounded execution time and output;
- explicit approval policy;
- cancellation and rollback semantics;
- unrelated-change scan;
- machine-readable report.

General coding jobs should reuse those primitives rather than weaken `litt repair`.

Specialized agent delegation is a future orchestration layer. A parent run may delegate a bounded task with a capability subset and token/time budget. Delegates return evidence and proposed actions; authority never increases transitively. The parent remains responsible for final verification and one terminal outcome.

## 10. Unified product integration

Migration proceeds by strangler pattern:

1. Characterize both existing paths with contract tests.
2. Add canonical request/event/model/executor interfaces in agent-core.
3. Adapt current CLI/terminal paths without changing behavior.
4. Add `WorkspaceTransportShellExecutor` and route Studio commands through `ExecutionGateway`.
5. Adapt Studio tools to the shared catalog in slices.
6. Move browser, memory, and checkpoint features behind shared contracts.
7. Switch Chat and PocketOS clients to the same host protocol.
8. Remove duplicate loop/policy implementations only after parity evidence.

During migration, a feature can be available through either old or new presentation, but there must be one stated authority for execution.

## 11. Performance and cross-platform design

The host should load only the selected provider and tool adapters. Browser, cloud, deployment, and database integrations remain lazy. Startup, idle memory, time-to-first-token, and cancellation latency become tracked budgets.

Platform responsibilities:

- **Windows:** native process tree cancellation, PowerShell-safe argv handling, ConPTY/Ink behavior.
- **Linux/WSL:** signals, process groups, paths, executable discovery, terminal sizing.
- **macOS:** signals, key handling, arm64 packaging, permissions.
- **Termux/Android:** no assumption of systemd, desktop browser, or unrestricted background work; thermal/battery-aware concurrency and compact local models.

The same contract suite should run against platform adapters. A platform is not “supported” merely because TypeScript builds there.

## 12. Approaches considered

### A. Promote Studio `runAgentLoopV2` to the universal engine

Rejected. It would move web-specific transport, policy, and persistence concerns into every surface and would replace a tested CLI/core gateway with a second authority.

### B. Add all missing features directly to the Ink controller

Rejected. It would make the terminal UI the architecture, deepen controller coupling, and leave Chat/Studio/PocketOS disconnected.

### C. Consolidate on agent-core and adapt existing capabilities

Selected. It preserves working safety systems, gives every surface one protocol, and allows incremental migration with parity tests.

## 13. Removal criteria

Duplicate code is removed only when:

- every consumer is identified;
- a compatibility adapter exists or the consumer migrated;
- parity tests cover success, refusal, approval, cancellation, timeout, and resume;
- telemetry/evidence shows no hidden callers;
- rollback is a branch revert, not a live data migration;
- the replacement has passed the cross-surface acceptance suite.

Specifically, `CliAgentLoop` and Studio execution-policy duplication should be deprecated before deletion. Existing tool IDs and stored run formats receive versioned readers during migration.
