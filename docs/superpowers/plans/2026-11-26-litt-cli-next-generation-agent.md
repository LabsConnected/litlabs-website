# LiTT CLI Next-Generation Agent Implementation Plan

**Goal** — Let CLI, Chat, Studio and PocketOS submit and observe one authorized agent run on the local host.

**Architecture and stack** — TypeScript, Node 22, `@litt/agent-core`, existing provider adapters, the CLI's Ink controller and terminal-server transports. [Architecture specification](../../litt-cli-next/architecture.md)

**Constraints** — Keep policy, auth, approval, provider selection and execution-target behavior under their existing owners. Scope each change to an isolated CLI lane and coordinate Studio-side migrations with its release owner. Use local fixtures for verification.

## Work sequence

1. **Capture one real run.** Instrument `packages/litt-cli/src/commands/ask.ts` at the existing `runAgentLoop` callback. Record a read-only fixture with model text, one tool result, verification and a terminal outcome. Repeat with cancellation. Use the traces to map existing event types to the smallest versioned wire format.
2. **Fix the provider boundary.** In `terminal-server/litt-agent.ts` and `litt-operator.ts`, characterize first-delta timing, message shape and abort propagation. Adapt the buffered provider to native streaming where the backend supports it. Report buffered delivery truthfully for other backends. Run A1 and A2 before exposing this path to additional surfaces.
3. **Expose headless results.** Extend CLI argument handling and the existing ask event subscriber with JSON and JSONL renderers. Exercise shell pipes, stderr separation and cancellation using A3. Inventory callers of `packages/litt-cli/src/lib/agent-loop.ts` before retiring its unsupported conversation entry.
4. **Improve the cockpit.** In `packages/litt-cli/src/ink/`, connect the activity stream and status display to the same ordered events. Implement multiline editing, bounded file/folder context and syntax rendering. Extend existing rendering and session tests with A4.
5. **Bind browser sessions.** Adapt `src/lib/litt-intelligence/browser-tool-handlers.ts` and the session manager to capability-scoped tool dispatch. Start with navigate/snapshot/close. Add artifacts, extraction, takeover and download only after the real browser fixture yields attributable evidence. Run A5 through LiTT.
6. **Generalize verified jobs.** Use the CLI repair and mission stores as references for checkpoint, resume and rollback. Exercise the A6 two-file regression and failed validation before adding application-control or delegation adapters.
7. **Unify product execution.** Implement and characterize the workspace executor adapter at `src/lib/litt-intelligence/workspace-transport.ts`. Route one read-only Studio action through the gateway, then a scoped mutation with grant and approval parity. Replace affected characterization assertions in `tests/execution-authority.test.ts` with behavioral parity checks. Migrate clients one at a time and pass A7 before retiring any prior route.
8. **Connect durable memory and automation.** Map `packages/litt-cli/src/lib/session-store.ts` and Studio memory to explicit conversation and workspace identities. Map authorized scheduler/webhook deliveries to mission/job IDs. Run A8 with duplicate delivery and interrupted persistence.
9. **Qualify each platform.** Run A9, retain measurements and mark unavailable platforms explicitly. Tune lazy imports, retrieval limits and bounded concurrency against the measured resource budget.

For each change, run the narrow failing fixture first, apply the smallest adapter change, repeat the fixture and run the relevant package checks. Record the behavioral result, scope and commit before advancing. The numbered gates and their exact passing observations are in the [acceptance criteria](../../litt-cli-next/acceptance-criteria.md).
