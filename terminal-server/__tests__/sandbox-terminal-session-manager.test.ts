/**
 * SandboxTerminalSessionManager tests (terminal bridge,
 * TERMINAL-BRIDGE-SPEC-2026-11-17 §2.5/§5.2).
 *
 * Provider and executor are faked at the manager's dependency
 * boundary — no E2B, no network. What is proven here is the session
 * lifecycle the Studio Terminal panel depends on: the ready payload,
 * the per-user cap of 2, the 15-minute idle kill, detach/reattach
 * within the grace window (same session, same sandbox), the resume
 * misses, the throttled sandbox-clock re-arm, and the sync-back
 * triggers (kill, exit, 5-minute tick — and their loud failure
 * surface).
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  SandboxTerminalSessionManager,
  SANDBOX_TERMINAL_IDLE_TIMEOUT_MS,
  SANDBOX_TERMINAL_SYNC_INTERVAL_MS,
  type SandboxTerminalExecutor,
  type SandboxTerminalProvider,
} from "../sandbox-terminal-session-manager";
import type {
  SandboxInstance,
  TerminalConnectOptions,
  TerminalTransport,
} from "../sandbox/provider";
import type { WorkspaceDescriptor } from "../workspace/WorkspaceManager";

const DESCRIPTOR: WorkspaceDescriptor = {
  workspaceId: "ws-1",
  userId: "user-1",
  projectId: "proj-1",
  root: "/tmp/ws-1",
  branch: "main",
  commitSha: "",
  ready: true,
};

class FakeTransport implements TerminalTransport {
  readonly sessionId: string;
  readonly writes: string[] = [];
  readonly resizes: Array<{ cols: number; rows: number }> = [];
  killed = false;
  disconnected = false;
  private readonly outputCbs = new Set<(d: string) => void>();
  private readonly exitCbs = new Set<
    (i: { exitCode: number; signal?: string }) => void
  >();

  constructor(sessionId: string) {
    this.sessionId = sessionId;
  }

  write = (d: string): void => {
    this.writes.push(d);
  };
  resize = (cols: number, rows: number): void => {
    this.resizes.push({ cols, rows });
  };
  onOutput = (cb: (d: string) => void): void => {
    this.outputCbs.add(cb);
  };
  onExit = (cb: (i: { exitCode: number; signal?: string }) => void): void => {
    this.exitCbs.add(cb);
  };
  kill = (): void => {
    this.killed = true;
    this.end(137);
  };
  disconnect = (): void => {
    this.disconnected = true;
  };

  pushOutput(d: string): void {
    for (const cb of this.outputCbs) cb(d);
  }
  end(exitCode: number): void {
    for (const cb of this.exitCbs) cb({ exitCode });
  }
}

class FakeProvider implements SandboxTerminalProvider {
  readonly name = "fake";
  readonly transports: FakeTransport[] = [];
  readonly connectCalls: Array<{ sandboxId: string; options: TerminalConnectOptions }> = [];
  readonly reattachCalls: Array<{ sandboxId: string; sessionId: string }> = [];
  readonly extendCalls: Array<{ sandboxId: string; timeoutMs: number }> = [];
  readonly alive = new Set<string>(["sbx-1"]);
  reattachError: Error | null = null;
  private pidSeq = 500;

  async create(): Promise<SandboxInstance> {
    throw new Error("unused");
  }
  async get(sandboxId: string): Promise<SandboxInstance | null> {
    return this.alive.has(sandboxId)
      ? ({ sandboxId } as SandboxInstance)
      : null;
  }
  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async destroy(sandboxId: string): Promise<void> {
    this.alive.delete(sandboxId);
  }
  async connectTerminal(
    sandboxId: string,
    options: TerminalConnectOptions,
  ): Promise<TerminalTransport> {
    this.connectCalls.push({ sandboxId, options });
    const t = new FakeTransport(`${sandboxId}:${++this.pidSeq}`);
    this.transports.push(t);
    return t;
  }
  async reattachTerminal(
    sandboxId: string,
    sessionId: string,
  ): Promise<TerminalTransport> {
    this.reattachCalls.push({ sandboxId, sessionId });
    if (this.reattachError) throw this.reattachError;
    const t = new FakeTransport(sessionId);
    this.transports.push(t);
    return t;
  }
  async execute(): Promise<never> {
    throw new Error("unused");
  }
  async exposePort(): Promise<never> {
    throw new Error("unused");
  }
  async health(): Promise<{ healthy: boolean }> {
    return { healthy: true };
  }
  extendTimeout = async (sandboxId: string, timeoutMs: number): Promise<void> => {
    this.extendCalls.push({ sandboxId, timeoutMs });
  };
}

class FakeExecutor implements SandboxTerminalExecutor {
  gateOpen = true;
  readonly ensureCalls: WorkspaceDescriptor[] = [];
  readonly syncCalls: WorkspaceDescriptor[] = [];
  syncError: Error | null = null;

  async ensureSandboxForTerminal(
    descriptor: WorkspaceDescriptor,
  ): Promise<{ sandboxId: string } | null> {
    this.ensureCalls.push(descriptor);
    return this.gateOpen ? { sandboxId: "sbx-1" } : null;
  }
  async syncBackForTerminal(descriptor: WorkspaceDescriptor): Promise<void> {
    this.syncCalls.push(descriptor);
    if (this.syncError) throw this.syncError;
  }
}

function makeManager() {
  const provider = new FakeProvider();
  const executor = new FakeExecutor();
  const logs: string[] = [];
  const errors: string[] = [];
  const manager = new SandboxTerminalSessionManager({
    provider,
    executor,
    log: (m) => logs.push(m),
    logError: (m) => errors.push(m),
  });
  return { manager, provider, executor, logs, errors };
}

function openOpts(
  overrides: Partial<Parameters<SandboxTerminalSessionManager["create"]>[0]> = {},
) {
  return {
    userId: "user-1",
    projectId: "proj-1",
    workspaceId: "ws-1",
    descriptor: DESCRIPTOR,
    onData: () => {},
    onExit: () => {},
    ...overrides,
  };
}

/** Flush pending microtasks (settleExit's provider.get probe etc.). */
async function flushMicrotasks(rounds = 10): Promise<void> {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
});

describe("SandboxTerminalSessionManager — open", () => {
  it("opens through the executor ensure and returns the ready payload", async () => {
    const { manager, provider, executor } = makeManager();
    const snapshot = await manager.create(openOpts());

    expect(executor.ensureCalls).toEqual([DESCRIPTOR]);
    expect(provider.connectCalls).toHaveLength(1);
    expect(provider.connectCalls[0].sandboxId).toBe("sbx-1");
    expect(provider.connectCalls[0].options.shell).toBe("bash");
    // The HOME pin rides the contract's caller-env channel (spec §2.3
    // env discipline — caches/git config stay out of the synced tree).
    expect(provider.connectCalls[0].options.env).toEqual({ HOME: "/home/litt" });

    expect(snapshot.cwd).toBe("/workspace");
    expect(snapshot.shell).toBe("bash");
    expect(snapshot.workspaceId).toBe("ws-1");
    expect(snapshot.projectId).toBe("proj-1");
    expect(snapshot.exited).toBe(false);
    // Client-facing session ids are UUIDs (the handshake's resume
    // validation expects that shape, exactly like host session ids).
    expect(snapshot.sessionId).toMatch(/^[0-9a-f-]{36}$/i);
    expect(manager.size).toBe(1);
  });

  it("fails closed when the gate declines the ensure — no PTY is attached", async () => {
    const { manager, provider, executor } = makeManager();
    executor.gateOpen = false;
    await expect(manager.create(openOpts())).rejects.toThrow(
      "Terminal unavailable: isolation not verified",
    );
    expect(provider.connectCalls).toHaveLength(0);
    expect(manager.size).toBe(0);
  });

  it("enforces the per-user cap of 2 sandbox shells", async () => {
    const { manager } = makeManager();
    await manager.create(openOpts());
    await manager.create(openOpts());
    await expect(manager.create(openOpts())).rejects.toThrow(
      /Max concurrent sandbox terminal sessions reached \(2 per user\)/,
    );
    // A different user is unaffected.
    const other = await manager.create(openOpts({ userId: "user-2" }));
    expect(other.userId).toBe("user-2");
  });

  it("streams output to the socket callback and input to the transport", async () => {
    const { manager, provider } = makeManager();
    const seen: string[] = [];
    const snapshot = await manager.create(openOpts({ onData: (d) => seen.push(d) }));

    provider.transports[0].pushOutput("hello\r\n");
    expect(seen).toEqual(["hello\r\n"]);

    expect(manager.input(snapshot.sessionId, "ls\r", "user-1")).toBe(true);
    expect(provider.transports[0].writes).toEqual(["ls\r"]);
  });
});

describe("SandboxTerminalSessionManager — ownership and bounds", () => {
  it("refuses input/resize/kill from a non-owner (negative proof)", async () => {
    const { manager, provider } = makeManager();
    const snapshot = await manager.create(openOpts());

    expect(manager.input(snapshot.sessionId, "rm -rf /\r", "user-2")).toBe(false);
    expect(manager.resize(snapshot.sessionId, 80, 24, "user-2")).toBe(false);
    expect(manager.kill(snapshot.sessionId, "nope", "user-2")).toBe(false);
    expect(provider.transports[0].writes).toEqual([]);
    expect(provider.transports[0].killed).toBe(false);
    expect(manager.get(snapshot.sessionId, "user-2")).toBeNull();
    expect(manager.size).toBe(1);
  });

  it("rejects oversized input and out-of-bounds resizes", async () => {
    const { manager, provider } = makeManager();
    const snapshot = await manager.create(openOpts());

    expect(manager.input(snapshot.sessionId, "x".repeat(64 * 1024 + 1), "user-1")).toBe(false);
    expect(manager.resize(snapshot.sessionId, 501, 24, "user-1")).toBe(false);
    expect(manager.resize(snapshot.sessionId, 80, 201, "user-1")).toBe(false);
    expect(manager.resize(snapshot.sessionId, 120, 40, "user-1")).toBe(true);
    expect(provider.transports[0].resizes).toEqual([{ cols: 120, rows: 40 }]);
  });
});

describe("SandboxTerminalSessionManager — idle, detach, resume", () => {
  it("kills the PTY after 15 minutes without input and syncs back", async () => {
    vi.useFakeTimers();
    const { manager, provider, executor } = makeManager();
    const snapshot = await manager.create(openOpts());

    await vi.advanceTimersByTimeAsync(SANDBOX_TERMINAL_IDLE_TIMEOUT_MS - 1);
    expect(provider.transports[0].killed).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    expect(provider.transports[0].killed).toBe(true);
    expect(manager.size).toBe(0);
    // Sync-back fired (kill trigger) — plus any periodic ticks.
    expect(executor.syncCalls.length).toBeGreaterThanOrEqual(1);
    expect(snapshot.exited).toBe(false); // snapshot is a copy; the record is gone
  });

  it("input resets the idle clock", async () => {
    vi.useFakeTimers();
    const { manager, provider } = makeManager();
    const snapshot = await manager.create(openOpts());

    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(manager.input(snapshot.sessionId, "ls\r", "user-1")).toBe(true);
    await vi.advanceTimersByTimeAsync(14 * 60_000);
    expect(provider.transports[0].killed).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.transports[0].killed).toBe(true);
  });

  it("detach → reattach within grace returns the same session in the same sandbox", async () => {
    vi.useFakeTimers();
    const { manager, provider } = makeManager();
    const snapshot = await manager.create(openOpts());
    const firstTransport = provider.transports[0];

    expect(manager.detach(snapshot.sessionId, "user-1", 120_000)).toBe(true);
    expect(manager.isDetached(snapshot.sessionId, "user-1")).toBe(true);

    const resumedData: string[] = [];
    const resumed = await manager.reattach(snapshot.sessionId, "user-1", { workspaceId: "ws-1" }, {
      onData: (d) => resumedData.push(d),
      onExit: () => {},
    });
    expect(resumed).not.toBeNull();
    expect(resumed!.sessionId).toBe(snapshot.sessionId);
    // Reattach went through the provider's pty.connect path with the
    // SAME transport session id (same pid, same sandbox).
    expect(provider.reattachCalls).toEqual([
      { sandboxId: "sbx-1", sessionId: firstTransport.sessionId },
    ]);
    // The old stream was disconnected so output has exactly one path.
    expect(firstTransport.disconnected).toBe(true);
    // Output on the new stream reaches the new socket.
    provider.transports[1].pushOutput("back again\r\n");
    expect(resumedData).toEqual(["back again\r\n"]);
    expect(manager.isDetached(snapshot.sessionId, "user-1")).toBe(false);
  });

  it("after the grace expires the PTY is killed, sync-back fires, and reattach misses", async () => {
    vi.useFakeTimers();
    const { manager, provider, executor } = makeManager();
    const snapshot = await manager.create(openOpts());

    manager.detach(snapshot.sessionId, "user-1", 120_000);
    await vi.advanceTimersByTimeAsync(120_000);

    expect(provider.transports[0].killed).toBe(true);
    expect(executor.syncCalls.length).toBeGreaterThanOrEqual(1);
    expect(manager.size).toBe(0);
    const resumed = await manager.reattach(snapshot.sessionId, "user-1", { workspaceId: "ws-1" }, {
      onData: () => {},
      onExit: () => {},
    });
    expect(resumed).toBeNull();
  });

  it("reattach refuses a different owner and a different workspace scope", async () => {
    const { manager } = makeManager();
    const snapshot = await manager.create(openOpts());
    manager.detach(snapshot.sessionId, "user-1", 120_000);

    await expect(
      manager.reattach(snapshot.sessionId, "user-2", { workspaceId: "ws-1" }, {
        onData: () => {},
        onExit: () => {},
      }),
    ).resolves.toBeNull();
    await expect(
      manager.reattach(snapshot.sessionId, "user-1", { workspaceId: "ws-other" }, {
        onData: () => {},
        onExit: () => {},
      }),
    ).resolves.toBeNull();
    // Still parked for the real owner.
    expect(manager.isDetached(snapshot.sessionId, "user-1")).toBe(true);
  });

  it("a provider reattach failure is a resume miss, not an error", async () => {
    const { manager, provider } = makeManager();
    const snapshot = await manager.create(openOpts());
    manager.detach(snapshot.sessionId, "user-1", 120_000);
    provider.reattachError = new Error("no such pty");

    const resumed = await manager.reattach(snapshot.sessionId, "user-1", { workspaceId: "ws-1" }, {
      onData: () => {},
      onExit: () => {},
    });
    expect(resumed).toBeNull();
    // The session record survives the miss (the caller opens fresh).
    expect(manager.isDetached(snapshot.sessionId, "user-1")).toBe(true);
  });
});

describe("SandboxTerminalSessionManager — sandbox clock re-arm", () => {
  it("re-arms at most once a minute, with the clamped session lifetime", async () => {
    vi.useFakeTimers();
    const { manager, provider } = makeManager();
    const snapshot = await manager.create(openOpts());

    // Create already re-armed (provider-side); input inside the
    // first minute must not re-arm again.
    manager.input(snapshot.sessionId, "a", "user-1");
    expect(provider.extendCalls).toEqual([]);

    await vi.advanceTimersByTimeAsync(61_000);
    manager.input(snapshot.sessionId, "b", "user-1");
    expect(provider.extendCalls).toEqual([{ sandboxId: "sbx-1", timeoutMs: 3_600_000 }]);

    manager.input(snapshot.sessionId, "c", "user-1");
    manager.input(snapshot.sessionId, "d", "user-1");
    expect(provider.extendCalls).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(61_000);
    manager.input(snapshot.sessionId, "e", "user-1");
    expect(provider.extendCalls).toHaveLength(2);
  });
});

describe("SandboxTerminalSessionManager — sync-back and exit", () => {
  it("syncs back every 5 minutes while attached, and not while detached", async () => {
    vi.useFakeTimers();
    const { manager, executor } = makeManager();
    const snapshot = await manager.create(openOpts());

    await vi.advanceTimersByTimeAsync(SANDBOX_TERMINAL_SYNC_INTERVAL_MS);
    expect(executor.syncCalls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(SANDBOX_TERMINAL_SYNC_INTERVAL_MS);
    expect(executor.syncCalls).toHaveLength(2);

    // Keep the session inside its idle budget, then park it: the
    // periodic trigger must stay quiet while detached (the grace
    // expiry and idle paths own sync-back for parked sessions).
    expect(manager.input(snapshot.sessionId, "ls\r", "user-1")).toBe(true);
    manager.detach(snapshot.sessionId, "user-1", 3_600_000);
    await vi.advanceTimersByTimeAsync(SANDBOX_TERMINAL_SYNC_INTERVAL_MS);
    expect(executor.syncCalls).toHaveLength(2);
  });

  it("a natural exit notifies once, frees the session, and syncs back", async () => {
    const { manager, provider, executor } = makeManager();
    const exits: Array<{ exitCode: number | null; sandboxEnded?: boolean }> = [];
    const snapshot = await manager.create(
      openOpts({ onExit: (info) => exits.push(info) }),
    );

    provider.transports[0].end(0);
    await flushMicrotasks();

    expect(exits).toEqual([{ sessionId: snapshot.sessionId, exitCode: 0 }]);
    expect(manager.size).toBe(0);
    expect(executor.syncCalls).toHaveLength(1);
    // Input after exit is refused.
    expect(manager.input(snapshot.sessionId, "ls\r", "user-1")).toBe(false);
  });

  it("sandbox death surfaces sandboxEnded and skips the pointless sync-back", async () => {
    const { manager, provider, executor } = makeManager();
    const exits: Array<{ exitCode: number | null; sandboxEnded?: boolean }> = [];
    await manager.create(openOpts({ onExit: (info) => exits.push(info) }));

    // The microVM is gone (1-hour cap) AND the PTY stream ends.
    provider.alive.delete("sbx-1");
    provider.transports[0].end(-1);
    await flushMicrotasks();

    expect(exits).toHaveLength(1);
    expect(exits[0].sandboxEnded).toBe(true);
    expect(executor.syncCalls).toHaveLength(0);
  });

  it("a sync-back failure is loud: error log + the session's onLog channel", async () => {
    vi.useFakeTimers();
    const { manager, executor, errors } = makeManager();
    const onLogMessages: string[] = [];
    await manager.create(openOpts({ onLog: (m) => onLogMessages.push(m) }));
    executor.syncError = new Error("volume is gone");

    await vi.advanceTimersByTimeAsync(SANDBOX_TERMINAL_SYNC_INTERVAL_MS);
    await flushMicrotasks();

    expect(errors.some((m) => m.includes("SYNC-BACK FAILED"))).toBe(true);
    expect(errors.some((m) => m.includes("volume is gone"))).toBe(true);
    expect(onLogMessages.some((m) => m.includes("SYNC-BACK FAILED"))).toBe(true);
  });

  it("kill() by the owner kills the PTY (never the sandbox) and syncs back", async () => {
    const { manager, provider, executor } = makeManager();
    const snapshot = await manager.create(openOpts());

    expect(manager.kill(snapshot.sessionId, "user_closed", "user-1")).toBe(true);
    expect(provider.transports[0].killed).toBe(true);
    expect(provider.alive.has("sbx-1")).toBe(true);
    await flushMicrotasks();
    expect(executor.syncCalls.length).toBeGreaterThanOrEqual(1);
    expect(manager.size).toBe(0);
  });
});
