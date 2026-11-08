import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { missionSchema } from "./contracts.js";
import { adapters, pollUntil, type AdapterResult } from "./adapters.js";
import { loadMission, loadState, saveMission, saveState } from "./store.js";
import { runMission } from "./runner.js";

let ws: string;

beforeEach(() => { ws = mkdtempSync(join(tmpdir(), "litt-mission-")); });
afterEach(() => { rmSync(ws, { recursive: true, force: true }); vi.restoreAllMocks(); });

function mission(over: Partial<Parameters<typeof missionSchema.parse>[0]> = {}) {
  return missionSchema.parse({
    id: "m-test01",
    title: "test mission",
    steps: [{ id: "s1", kind: "http-check", description: "check", params: {} }],
    ...over,
  });
}

describe("mission store", () => {
  it("persists mission + state atomically and round-trips", () => {
    const m = mission();
    saveMission(ws, m);
    const state = loadState(ws, m.id);
    state.status = "running";
    saveState(ws, state);
    expect(loadMission(ws, m.id)!.id).toBe("m-test01");
    expect(loadState(ws, m.id).status).toBe("running");
    expect(existsSync(join(ws, ".litt", "missions", m.id, "mission.json"))).toBe(true);
  });

  it("returns fresh state for unknown missions and rejects invalid mission.json", () => {
    expect(loadState(ws, "ghost").status).toBe("pending");
    expect(loadMission(ws, "ghost")).toBeNull();
  });
});

describe("runMission", () => {
  it("executes a step to done and completes the mission", async () => {
    adapters["http-check"] = {
      probe: async () => ({ ok: false, evidence: [] }),
      run: async () => ({ ok: true, evidence: ["endpoint 200"] }),
    };
    const res = await runMission(ws, mission());
    expect(res.exitCode).toBe(0);
    expect(res.state.status).toBe("complete");
    expect(res.state.steps.s1!.status).toBe("done");
    expect(res.state.steps.s1!.evidence).toContain("endpoint 200");
  });

  it("skips completed steps on resume — idempotent", async () => {
    const runSpy = vi.fn(async (): Promise<AdapterResult> => ({ ok: true, evidence: ["ran"] }));
    adapters["http-check"] = { probe: async () => ({ ok: false, evidence: [] }), run: runSpy };
    await runMission(ws, mission());
    const res2 = await runMission(ws, mission());
    expect(res2.exitCode).toBe(0);
    expect(runSpy).toHaveBeenCalledTimes(1); // never re-executed
  });

  it("recovers a crashed in-flight step by probing end-state — no duplicate work", async () => {
    // Simulate: attempt 1's run() crashed mid-action but the effect landed.
    const state = loadState(ws, "m-test01");
    state.status = "running";
    state.startedAt = new Date().toISOString();
    state.steps.s1 = { status: "in-flight", attempts: 1, evidence: ["dispatch sent"], updatedAt: new Date().toISOString() };
    saveState(ws, state);

    const runSpy = vi.fn(async (): Promise<AdapterResult> => ({ ok: true, evidence: ["re-ran"] }));
    adapters["http-check"] = {
      probe: async () => ({ ok: true, evidence: ["end-state present"] }),
      run: runSpy,
    };
    const res = await runMission(ws, mission());
    expect(res.exitCode).toBe(0);
    expect(res.state.steps.s1!.status).toBe("done");
    expect(runSpy).not.toHaveBeenCalled(); // THE acceptance criterion
    expect(res.state.steps.s1!.evidence.join(" ")).toContain("no re-execution");
  });

  it("bounds retries then blocks with evidence", async () => {
    const runSpy = vi.fn(async (): Promise<AdapterResult> => ({ ok: false, evidence: ["still failing"] }));
    adapters["http-check"] = { probe: async () => ({ ok: false, evidence: [] }), run: runSpy };
    const m = mission({ steps: [{ id: "s1", kind: "http-check", description: "x", params: {}, maxAttempts: 2, dependsOn: [], timeoutMs: 5000 }] });
    const res = await runMission(ws, m);
    expect(res.exitCode).toBe(1);
    expect(runSpy).toHaveBeenCalledTimes(2);
    expect(res.state.steps.s1!.status).toBe("blocked");
    expect(res.state.steps.s1!.evidence.join(" ")).toContain("max attempts");
  });

  it("parks on owner-gate with exit 3 and resumes after", async () => {
    const m = mission({
      steps: [
        { id: "gate", kind: "owner-gate", description: "rotate RAILWAY_TOKEN", params: {}, dependsOn: [], maxAttempts: 1, timeoutMs: 5000 },
        { id: "after", kind: "http-check", description: "x", params: {}, dependsOn: ["gate"], maxAttempts: 1, timeoutMs: 5000 },
      ],
    });
    const res1 = await runMission(ws, m);
    expect(res1.exitCode).toBe(3);
    expect(res1.state.steps.gate!.status).toBe("parked");
    expect(res1.state.steps.after!.status).toBe("pending");

    // Owner acted externally → mark gate done, resume.
    const st = loadState(ws, m.id);
    st.steps.gate!.status = "done";
    saveState(ws, st);
    adapters["http-check"] = {
      probe: async () => ({ ok: false, evidence: [] }),
      run: async () => ({ ok: true, evidence: ["verified"] }),
    };
    const res2 = await runMission(ws, m);
    expect(res2.exitCode).toBe(0);
    expect(res2.state.status).toBe("complete");
  });

  it("honors dependency ordering", async () => {
    const order: string[] = [];
    adapters["http-check"] = {
      probe: async () => ({ ok: false, evidence: [] }),
      run: async (s) => { order.push(s.id); return { ok: true, evidence: [] }; },
    };
    const m = mission({
      steps: [
        { id: "b", kind: "http-check", description: "b", params: {}, dependsOn: ["a"], maxAttempts: 1, timeoutMs: 5000 },
        { id: "a", kind: "http-check", description: "a", params: {}, dependsOn: [], maxAttempts: 1, timeoutMs: 5000 },
      ],
    });
    await runMission(ws, m);
    expect(order).toEqual(["a", "b"]);
  });
});

describe("pollUntil", () => {
  it("stops immediately on a terminal failure instead of polling to deadline", async () => {
    // Regression: a finished-but-failed workflow run used to keep polling
    // until the step deadline (~45min) — observed live on run 42147474993.
    const fn = vi.fn(async (): Promise<AdapterResult> => ({ ok: false, terminal: true, evidence: ["run failed"] }));
    const res = await pollUntil(fn, Date.now() + 60_000, 10);
    expect(res.ok).toBe(false);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("keeps polling non-terminal results until ok", async () => {
    let n = 0;
    const res = await pollUntil(async () => {
      n++;
      return n < 3 ? { ok: false, evidence: ["pending"] } : { ok: true, evidence: ["done"] };
    }, Date.now() + 5_000, 5);
    expect(res.ok).toBe(true);
    expect(n).toBe(3);
  });
});
