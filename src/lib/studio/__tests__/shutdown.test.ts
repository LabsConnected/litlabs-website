import { describe, it, expect, vi, beforeEach } from "vitest";

import {
  registerExecution,
  getActiveExecution,
  resetExecutionRegistryForTests,
} from "../execution-registry";
import {
  shutdownActiveExecutions,
  SHUTDOWN_NOTE,
  type ShutdownPersistFn,
} from "../shutdown";

function registerFake(index: number) {
  const controller = new AbortController();
  registerExecution({
    conversationId: `conv_${index}`,
    userId: `user_${index}`,
    clientRequestId: `req_${index}`,
    assistantMessageId: `msg_${index}`,
    controller,
  });
  return { controller, index };
}

describe("shutdownActiveExecutions", () => {
  beforeEach(() => {
    resetExecutionRegistryForTests();
    vi.restoreAllMocks();
  });

  it("aborts every active controller and persists cancelled with the truthful note", async () => {
    const runs = [registerFake(1), registerFake(2)];
    const persist: ShutdownPersistFn = vi.fn(async () => true);

    const result = await shutdownActiveExecutions("Received SIGTERM", {
      persist,
    });

    expect(result).toEqual({ shutdown: 2, persisted: 2 });
    for (const run of runs) {
      expect(run.controller.signal.aborted).toBe(true);
    }
    expect(persist).toHaveBeenCalledTimes(2);
    expect(persist).toHaveBeenCalledWith(
      "msg_1",
      "user_1",
      "cancelled",
      SHUTDOWN_NOTE,
    );
    expect(persist).toHaveBeenCalledWith(
      "msg_2",
      "user_2",
      "cancelled",
      SHUTDOWN_NOTE,
    );
    // Registry must be emptied so nothing is left dangling.
    expect(getActiveExecution("conv_1")).toBeNull();
    expect(getActiveExecution("conv_2")).toBeNull();
  });

  it("keeps going when one persist throws, and still unregisters that run", async () => {
    registerFake(1);
    registerFake(2);
    const persist: ShutdownPersistFn = vi
      .fn()
      .mockRejectedValueOnce(new Error("db gone"))
      .mockResolvedValueOnce(true);

    const result = await shutdownActiveExecutions("Received SIGTERM", {
      persist,
    });

    expect(result).toEqual({ shutdown: 2, persisted: 1 });
    expect(getActiveExecution("conv_1")).toBeNull();
    expect(getActiveExecution("conv_2")).toBeNull();
  });

  it("resolves promptly via the timeout when persist hangs", async () => {
    registerFake(1);
    const hanging: ShutdownPersistFn = () => new Promise(() => {});

    const start = Date.now();
    const result = await shutdownActiveExecutions("Received SIGTERM", {
      persist: hanging,
      timeoutMs: 50,
    });
    const elapsed = Date.now() - start;

    expect(result).toEqual({ shutdown: 1, persisted: 0 });
    // The timeout must fire well before any multi-second hang.
    expect(elapsed).toBeLessThan(5_000);
  });

  it("does nothing when no executions are active", async () => {
    const persist: ShutdownPersistFn = vi.fn(async () => true);

    const result = await shutdownActiveExecutions("Received SIGTERM", {
      persist,
    });

    expect(result).toEqual({ shutdown: 0, persisted: 0 });
    expect(persist).not.toHaveBeenCalled();
  });

  it("aborts already-aborted controllers without throwing", async () => {
    const run = registerFake(1);
    run.controller.abort(new Error("user stopped it earlier"));
    const persist: ShutdownPersistFn = vi.fn(async () => true);

    const result = await shutdownActiveExecutions("Received SIGTERM", {
      persist,
    });

    expect(result).toEqual({ shutdown: 1, persisted: 1 });
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
