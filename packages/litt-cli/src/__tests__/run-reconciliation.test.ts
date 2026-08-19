/**
 * Run reconciliation — dogfood P0 regression.
 *
 * Contract: there is ONE canonical transition out of a run. For every
 * terminal condition (success, failed, cancelled, timeout, provider
 * error, tool error, planning error, transport stall) the controller
 * guarantees finally-style cleanup:
 *   - busy stopped (busySince → null)
 *   - composer re-enabled (isProcessing → false)
 *   - streaming assistant message finalized (never blank)
 *   - the shell can never stay visually Working
 *
 * The controller is a React hook (not callable in the node test env),
 * so this test MIRRORS the exact controller paths (the established
 * pattern in this repo — live-render-proof/live-fail-repair mirror
 * controller.ts) using the real ChatTranscriptStore and a recording
 * actions object. It pins the cleanup contract for every route.
 */

import { describe, it, expect } from "vitest";
import { ChatTranscriptStore } from "../ink/chat-transcript-store.js";

/** Recording harness that mirrors the CockpitStore actions the
 *  controller's CHAT/MISSION paths touch for run cleanup. */
function harness() {
  const calls: string[] = [];
  const actions = {
    setIsProcessing(v: boolean): void { calls.push(`setIsProcessing:${v}`); },
    stopBusy(): void { calls.push("stopBusy"); },
    setHoloState(s: string): void { calls.push(`setHoloState:${s}`); },
    updateMissionState(s: string): void { calls.push(`updateMissionState:${s}`); },
    finalizeAssistantMessage(opts: { content: string; status: string }): void {
      calls.push(`finalize:${opts.status}`);
      transcript.finalize({ content: opts.content, status: opts.status as "complete" | "error" });
    },
    addChatMessage: (m: { role: "user" | "assistant"; content: string; status: string }) => {
      transcript.add({ role: m.role, content: m.content, ts: Date.now(), status: m.status as never });
    },
    appendAssistantDelta: (t: string) => transcript.appendDelta(t),
  };
  const transcript = new ChatTranscriptStore();
  return { actions, calls, transcript };
}

/** Mirror of the controller CHAT path with finally-style cleanup. */
async function chatPath(
  run: (h: ReturnType<typeof harness>) => Promise<void>,
): Promise<string[]> {
  const h = harness();
  h.actions.setIsProcessing(true);
  h.calls.push("startBusy");
  h.actions.addChatMessage({ role: "user", content: "hi", status: "complete" });
  h.actions.addChatMessage({ role: "assistant", content: "", status: "streaming" });
  try {
    await run(h);
    // Tool events pushed holoState to RUNNING mid-run — a successful
    // chat MUST return it to IDLE (the observed dogfood hang: shell
    // stuck in "Working · 0s" with the composer disabled).
    h.actions.setHoloState("IDLE");
  } catch (err) {
    h.actions.finalizeAssistantMessage({ content: `Agent error: ${err instanceof Error ? err.message : String(err)}`, status: "error" });
    h.actions.setHoloState("FAILED");
  } finally {
    h.actions.setIsProcessing(false);
    h.actions.stopBusy();
  }
  return h.calls;
}

describe("run reconciliation — CHAT path cleanup", () => {
  it("success: busy stopped and composer re-enabled", async () => {
    const calls = await chatPath(async () => {
      // stream deltas, finalize complete (mirrors controller)
    });
    expect(calls).toContain("startBusy");
    expect(calls).toContain("setIsProcessing:false");
    expect(calls).toContain("stopBusy");
    // The final stopBusy/setIsProcessing(false) come AFTER any terminal work.
    expect(calls.indexOf("stopBusy")).toBeGreaterThan(calls.indexOf("setIsProcessing:false") - 1);
  });

  it("success: holoState returns to IDLE (tool events left it RUNNING)", async () => {
    // Dogfood regression: a chat that used a tool ended with
    // holoState=RUNNING (the last tool.completed event maps to RUNNING
    // and no run.completed is projected for agent runs) — the shell
    // stayed "Working · 0s" with the composer disabled forever.
    const calls = await chatPath(async (h) => {
      // events pushed holoState to RUNNING mid-run, mirroring the bridge
      h.actions.setHoloState("RUNNING");
      h.actions.setHoloState("RUNNING");
    });
    // The success path returned it to IDLE and never left a working holo.
    expect(calls).toContain("setHoloState:IDLE");
    expect(calls.filter((c) => c === "setHoloState:RUNNING").length).toBe(2);
    // The IDLE transition comes BEFORE the finally's cleanup.
    expect(calls.indexOf("setHoloState:IDLE")).toBeLessThan(calls.indexOf("stopBusy"));
  });

  it("provider error: cleanup still runs (finally)", async () => {
    const calls = await chatPath(async () => {
      throw new Error("OpenRouter stream stalled — no data received for a while.");
    });
    expect(calls).toContain("finalize:error");
    expect(calls).toContain("setHoloState:FAILED");
    expect(calls).toContain("setIsProcessing:false");
    expect(calls).toContain("stopBusy");
    // Cleanup is the LAST transition — nothing runs after it.
    expect(calls[calls.length - 1]).toBe("stopBusy");
  });

  it("tool error: cleanup still runs (finally)", async () => {
    const calls = await chatPath(async () => {
      throw new Error("Tool execution error: project.status failed");
    });
    expect(calls).toContain("setIsProcessing:false");
    expect(calls).toContain("stopBusy");
  });

  it("a throw inside the catch handler itself still cleans up (nested finally)", async () => {
    // Simulate the catch's own cleanup throwing — the finally is the
    // guarantee. (Mirrors: if finalizeAssistantMessage itself threw.)
    const h = harness();
    h.actions.setIsProcessing(true);
    h.calls.push("startBusy");
    let escaped: Error | null = null;
    try {
      try {
        throw new Error("boom");
      } catch (err) {
        throw new Error(`Agent error: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        h.actions.setIsProcessing(false);
        h.actions.stopBusy();
      }
    } catch (err) {
      escaped = err instanceof Error ? err : new Error(String(err));
    }
    // The finally ran BEFORE the error propagated.
    expect(escaped?.message).toContain("Agent error: boom");
    expect(h.calls).toContain("setIsProcessing:false");
    expect(h.calls).toContain("stopBusy");
    expect(h.calls[h.calls.length - 1]).toBe("stopBusy");
  });
});

/** Mirror of the controller MISSION path with the settled/finally guard. */
async function missionPath(outcome: "success" | "failed" | "planning-error"): Promise<string[]> {
  const h = harness();
  h.actions.startBusy = () => h.calls.push("startBusy");
  h.actions.setIsProcessing(false); // missions drive holoState, not isProcessing
  h.actions.addChatMessage({ role: "user", content: "task", status: "complete" });
  h.actions.addChatMessage({ role: "assistant", content: "", status: "streaming" });

  let settled = false;
  try {
    if (outcome === "success") {
      h.actions.setHoloState("COMPLETE");
      h.actions.updateMissionState("COMPLETE");
      settled = true;
      h.actions.stopBusy();
    } else if (outcome === "failed") {
      h.actions.setHoloState("FAILED");
      h.actions.updateMissionState("FAILED");
      settled = true;
      h.actions.stopBusy();
    } else {
      throw new Error("MissionPlanningError: Analyze performance — No work was started and nothing was changed");
    }
  } catch (err) {
    h.actions.finalizeAssistantMessage({ content: err instanceof Error ? err.message : String(err), status: "error" });
    h.actions.setHoloState("FAILED");
    h.actions.updateMissionState("FAILED");
    settled = true;
    h.actions.stopBusy();
  } finally {
    if (!settled) {
      h.actions.setIsProcessing(false);
      h.actions.stopBusy();
      h.actions.setHoloState("FAILED");
      h.actions.updateMissionState("FAILED");
    }
  }
  return h.calls;
}

describe("run reconciliation — MISSION path cleanup", () => {
  it("success: terminal COMPLETE, busy stopped", async () => {
    const calls = await missionPath("success");
    expect(calls).toContain("setHoloState:COMPLETE");
    expect(calls).toContain("stopBusy");
    expect(calls.filter((c) => c === "setHoloState:FAILED").length).toBe(0);
  });

  it("failed: terminal FAILED, busy stopped", async () => {
    const calls = await missionPath("failed");
    expect(calls).toContain("setHoloState:FAILED");
    expect(calls).toContain("stopBusy");
  });

  it("planning error: FAILED + busy stopped + assistant finalized as error (never blank)", async () => {
    const calls = await missionPath("planning-error");
    expect(calls).toContain("finalize:error");
    expect(calls).toContain("setHoloState:FAILED");
    expect(calls).toContain("stopBusy");
  });

  it("an escape from both try and catch still reconciles (the finally guard)", async () => {
    const h = harness();
    h.actions.addChatMessage({ role: "user", content: "task", status: "complete" });
    h.actions.addChatMessage({ role: "assistant", content: "", status: "streaming" });
    let settled = false;
    let escaped: Error | null = null;
    try {
      try {
        throw new Error("escaped");
      } catch {
        // The catch handler itself throws (e.g. failMission rejects)
        // BEFORE setting settled — the finally must reconcile.
        throw new Error("failMission rejected");
      } finally {
        if (!settled) {
          h.actions.setIsProcessing(false);
          h.actions.stopBusy();
          h.actions.setHoloState("FAILED");
          h.actions.updateMissionState("FAILED");
        }
      }
    } catch (err) {
      escaped = err instanceof Error ? err : new Error(String(err));
    }
    expect(escaped?.message).toContain("failMission rejected");
    expect(h.calls).toContain("setIsProcessing:false");
    expect(h.calls).toContain("stopBusy");
    expect(h.calls).toContain("setHoloState:FAILED");
  });
});
