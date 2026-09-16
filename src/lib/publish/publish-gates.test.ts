/**
 * publish-gates tests — the choke point aggregates gates, never crashes
 * on a buggy gate, and ships with the fabrication gate registered.
 */
import { describe, expect, it, beforeEach } from "vitest";

import {
  runPublishGates,
  registerPublishGate,
  unregisterPublishGate,
  listPublishGates,
  type PublishGateInput,
  type PublishGateResult,
} from "./publish-gates";

const CLEAN_INPUT: PublishGateInput = {
  files: [{ path: "index.html", content: "<h1>My real business</h1>" }],
  projectId: "proj_1",
  userId: "user_1",
};

describe("publish-gates", () => {
  beforeEach(() => {
    // Remove any gates registered by other tests; keep the default
    // fabrication gate for tests that expect it.
    for (const name of listPublishGates()) {
      if (name !== "no-fabricated-content") unregisterPublishGate(name);
    }
  });

  it("ships with the fabrication gate registered", () => {
    expect(listPublishGates()).toContain("no-fabricated-content");
  });

  it("passes a clean site", async () => {
    const result = await runPublishGates(CLEAN_INPUT);
    expect(result).toEqual({ ok: true, failedGates: [], message: "" });
  });

  it("fails the fabrication gate on template content with a user-facing message", async () => {
    const result = await runPublishGates({
      ...CLEAN_INPUT,
      files: [
        {
          path: "index.html",
          content: `<h1>Build Something Amazing</h1><p>"Loved it" — Sarah Chen</p>`,
        },
      ],
    });
    expect(result.ok).toBe(false);
    expect(result.failedGates).toEqual(["no-fabricated-content"]);
    expect(result.message).toContain("Hero section");
    expect(result.message).toContain("Testimonials");
    // Non-technical: no stack traces, no jargon.
    expect(result.message).not.toMatch(/stack|exception|TypeError|undefined|null pointer/i);
  });

  it("registers a new gate and runs it", async () => {
    registerPublishGate({
      name: "test-always-pass",
      run: () => ({ ok: true, failedGates: [], message: "" }),
    });
    expect(listPublishGates()).toContain("test-always-pass");
    const result = await runPublishGates(CLEAN_INPUT);
    expect(result.ok).toBe(true);
    unregisterPublishGate("test-always-pass");
  });

  it("re-registering by name replaces the gate", async () => {
    const failGate = {
      name: "test-replaceable",
      run: (): PublishGateResult => ({
        ok: false,
        failedGates: ["test-replaceable"],
        message: "first",
      }),
    };
    registerPublishGate(failGate);
    registerPublishGate({
      name: "test-replaceable",
      run: () => ({ ok: true, failedGates: [], message: "" }),
    });
    const result = await runPublishGates(CLEAN_INPUT);
    expect(result.ok).toBe(true);
    expect(listPublishGates().filter((n) => n === "test-replaceable")).toHaveLength(1);
    unregisterPublishGate("test-replaceable");
  });

  it("aggregates failures from multiple gates with all messages", async () => {
    registerPublishGate({
      name: "test-gate-a",
      run: () => ({ ok: false, failedGates: ["test-gate-a"], message: "Fix the A thing." }),
    });
    registerPublishGate({
      name: "test-gate-b",
      run: () => ({ ok: false, failedGates: ["test-gate-b"], message: "Fix the B thing." }),
    });
    const result = await runPublishGates(CLEAN_INPUT);
    expect(result.ok).toBe(false);
    expect(result.failedGates).toEqual(["test-gate-a", "test-gate-b"]);
    expect(result.message).toContain("Fix the A thing.");
    expect(result.message).toContain("Fix the B thing.");
    unregisterPublishGate("test-gate-a");
    unregisterPublishGate("test-gate-b");
  });

  it("treats a throwing gate as failed, not as a crash", async () => {
    registerPublishGate({
      name: "test-thrower",
      run: () => {
        throw new Error("boom");
      },
    });
    const result = await runPublishGates(CLEAN_INPUT);
    expect(result.ok).toBe(false);
    expect(result.failedGates).toContain("test-thrower");
    expect(result.message).toContain("test-thrower");
    unregisterPublishGate("test-thrower");
  });

  it("rejects registration without a name or run function", () => {
    expect(() => registerPublishGate({ name: "", run: () => ({ ok: true, failedGates: [], message: "" }) })).toThrow();
    expect(() =>
      registerPublishGate({ name: "no-run", run: undefined as never }),
    ).toThrow();
  });
});
