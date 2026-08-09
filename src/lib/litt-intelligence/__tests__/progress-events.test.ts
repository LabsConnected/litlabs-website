import { describe, it, expect } from "vitest";
import { ProgressEmitter, type ProgressEvent } from "@/lib/litt-intelligence/progress-events";

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
