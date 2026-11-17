import { describe, it, expect } from "vitest";
import { ProgressEmitter, isSubstantiveProgressEvent, type ProgressEvent } from "@/lib/litt-intelligence/progress-events";

describe("ProgressEmitter", () => {
  it("emits events to subscribers", () => {
    const events: ProgressEvent[] = [];
    const emitter = new ProgressEmitter((e) => events.push(e));

    emitter.emit({ type: "phase", phase: "call_llm", step: 1 });
    emitter.emit({ type: "tool_start", toolId: "files.read", summary: "reading" });
    emitter.emit({ type: "tool_result", toolId: "files.read", success: true, summary: "ok", durationMs: 50 });

    expect(events).toHaveLength(3);
    expect(events[0].type).toBe("phase");
    expect(events[1].type).toBe("tool_start");
    expect(events[2].type).toBe("tool_result");
  });

  it("classifies substantive progress events (round 14)", () => {
    // State-advancing events count as progress for stall detection.
    const substantive: ProgressEvent[] = [
      { type: "phase", phase: "execute", step: 2 },
      { type: "tool_start", toolId: "files.write", summary: "writing" },
      { type: "tool_result", toolId: "files.write", success: true, summary: "ok", durationMs: 10 },
      { type: "workspace_change", status: "changed", files: ["a.ts"] },
      { type: "checkpoint", label: "after", gitSha: "abc", kind: "after" },
      { type: "build_result", check: "typecheck", passed: true },
      { type: "quality_verdict", passed: true, missing: [], reason: "", designPasses: 1 },
      { type: "finished", totalSteps: 3, totalDurationMs: 100 },
    ];
    for (const event of substantive) {
      expect(isSubstantiveProgressEvent(event), event.type).toBe(true);
    }
  });

  it("a route-retry storm is NOT progress (round 14)", () => {
    // The wrap-up failure signature from the 2026-11-17 lion proof:
    // routing bookkeeping and failure notices, repeated — the loop
    // is going nowhere and the stall clock must keep running.
    const storm: ProgressEvent[] = [
      { type: "route_plan", routes: [{ provider: "gemini", models: ["m"] }], excluded: [] },
      { type: "model_routing", model: "m", provider: "gemini" },
      { type: "model_failed", model: "m", category: "quota", message: "429" },
      { type: "model_response", provider: "gemini", model: "m", finishReason: "error", contentType: "text", contentLength: 0, messageKeys: [], toolCalls: [] },
      { type: "step_timing", step: 4, stepDurationMs: 100, elapsedMs: 500 },
      { type: "reasoning", summary: "retrying" },
      { type: "status", summary: "All AI routes unavailable" },
      { type: "build_model_incompatible", canonicalId: "m", provider: "gemini", stepsObserved: 1, zeroWriteSteps: 1, reason: "no writes" },
    ];
    for (const event of storm) {
      expect(isSubstantiveProgressEvent(event), event.type).toBe(false);
    }
  });

  it("supports on() listener pattern", () => {
    const emitter = new ProgressEmitter();
    const received: ProgressEvent[] = [];
    emitter.on((e: ProgressEvent) => received.push(e));

    emitter.emit({ type: "phase", phase: "execute", step: 1 });
    expect(received).toHaveLength(1);

    // Emitter does not support unsubscribe — listeners are permanent for the emitter's lifetime
    emitter.emit({ type: "phase", phase: "execute", step: 2 });
    expect(received).toHaveLength(2);
  });
});
