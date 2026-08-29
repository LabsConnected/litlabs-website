/**
 * WorkstreamStore — pure-state invariant tests.
 *
 * Runs in the CLI `node` env (no React, no renderer). Every documented
 * invariant from workstream-store.ts is exercised here, plus the renderer's
 * pure height estimator (estimateWorkstreamRows) so the viewport-budget
 * contract is pinned against regressions.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  WorkstreamStore,
  MAX_ACTIVITIES,
  PHASE_LABELS,
  type WorkstreamKind,
} from "../ink/workstream-store.js";
import { estimateWorkstreamRows } from "../ink/workstream.js";

describe("WorkstreamStore — invariants", () => {
  let store: WorkstreamStore;

  beforeEach(() => {
    store = new WorkstreamStore();
  });

  // ── 1. Append-only, insertion-ordered ──
  describe("Invariant 1: append-only ordering by insertion", () => {
    it("preserves insertion order; snapshot ids are monotonic", () => {
      const a = store.begin("tool", "EXECUTING", "first");
      const b = store.begin("edit", "EDITING", "second");
      const c = store.begin("test", "TESTING", "third");
      const snap = store.snapshot();
      expect(snap.activities.map((x) => x.label)).toEqual(["first", "second", "third"]);
      expect(snap.activities.map((x) => x.id)).toEqual([a, b, c]);
    });

    it("snapshot is a copy (mutating it does not affect the store)", () => {
      store.begin("tool", "EXECUTING", "x");
      const snap = store.snapshot();
      snap.activities.push({} as never);
      expect(store.snapshot().activities).toHaveLength(1);
    });
  });

  // ── 2 & 3. begin/complete/fail terminalization ──
  describe("Invariants 2 & 3: terminalization", () => {
    it("begin() yields status running; complete() marks complete", () => {
      const id = store.begin("tool", "EXECUTING", "lint");
      expect(store.byId(id)?.status).toBe("running");
      store.complete(id, { elapsedMs: 120, success: true });
      expect(store.byId(id)?.status).toBe("complete");
      expect(store.byId(id)?.elapsedMs).toBe(120);
      expect(store.byId(id)?.success).toBe(true);
    });

    it("fail() marks failed and records the reason", () => {
      const id = store.begin("edit", "EDITING", "utils.ts");
      store.fail(id, "Expected text was not found.");
      expect(store.byId(id)?.status).toBe("failed");
      expect(store.byId(id)?.reason).toBe("Expected text was not found.");
      expect(store.snapshot().hasRunning).toBe(false);
    });

    it("complete/fail are no-ops on an already-terminal activity", () => {
      const id = store.begin("tool", "EXECUTING", "lint");
      store.complete(id, { elapsedMs: 10, success: true });
      store.complete(id, { elapsedMs: 999, success: false });
      expect(store.byId(id)?.elapsedMs).toBe(10);
      expect(store.byId(id)?.success).toBe(true);
      expect(store.byId(id)?.status).toBe("complete");
      store.fail(id, "no-op");
      expect(store.byId(id)?.status).toBe("complete");
      expect(store.byId(id)?.reason).toBeUndefined();
    });

    it("fail after already-failed is a no-op (failure stays visible)", () => {
      const id = store.begin("edit", "EDITING", "a.ts");
      store.fail(id, "first failure");
      store.fail(id, "second failure");
      expect(store.byId(id)?.reason).toBe("first failure");
      expect(store.snapshot().activities.filter((a) => a.status === "failed")).toHaveLength(1);
    });

    it("unknown id complete/fail silently no-op", () => {
      expect(() => store.complete("nope", { elapsedMs: 1 })).not.toThrow();
      expect(() => store.fail("nope", "x")).not.toThrow();
      expect(store.length()).toBe(0);
    });
  });

  // ── 4. edit records carry counts + diff ──
  describe("Invariant 4: edit records", () => {
    it("addEdit stores added/removed and diff, status complete", () => {
      const diff = ["--- a", "+++ b", "@@ -1,3 +1,3 @@", "-old", "+new"];
      const id = store.addEdit("src/x.ts", 5, 3, diff);
      const a = store.byId(id)!;
      expect(a.kind).toBe("edit");
      expect(a.added).toBe(5);
      expect(a.removed).toBe(3);
      expect(a.diff).toEqual(diff);
      expect(a.status).toBe("complete");
      expect(a.subject).toBe("src/x.ts");
    });

    it("failEdit records a failed edit with reason (remains visible)", () => {
      const id = store.failEdit("src/x.ts", "Expected text was not found.");
      const a = store.byId(id)!;
      expect(a.status).toBe("failed");
      expect(a.reason).toBe("Expected text was not found.");
    });
  });

  // ── 5. retry links to parent ──
  describe("Invariant 5: retry records", () => {
    it("addRetry links retriesOf to a parent and keeps parent visible", () => {
      const parent = store.begin("edit", "EDITING", "a.ts");
      store.fail(parent, "patch too wide");
      const retry = store.addRetry(parent, "Retrying with a smaller patch.");
      const r = store.byId(retry)!;
      expect(r.kind).toBe("retry");
      expect(r.retriesOf).toBe(parent);
      expect(r.reason).toBe("Retrying with a smaller patch.");
      expect(r.phase).toBe("RETRYING");
      expect(store.byId(parent)?.status).toBe("failed");
    });

    it("addRetry on unknown parent still records (phase falls back)", () => {
      const retry = store.addRetry("missing", "retry");
      expect(store.byId(retry)?.retriesOf).toBe("missing");
    });
  });

  // ── 6. Bounded to MAX_ACTIVITIES ──
  describe("Invariant 6: bounded store", () => {
    it("drops oldest when exceeding MAX_ACTIVITIES", () => {
      for (let i = 0; i < MAX_ACTIVITIES + 50; i++) {
        store.begin("reason", "WORKING", `step ${i}`);
      }
      expect(store.length()).toBe(MAX_ACTIVITIES);
      const snap = store.snapshot();
      expect(snap.activities[0].label).toBe("step 50");
      expect(snap.activities.at(-1)?.label).toBe(`step ${MAX_ACTIVITIES + 49}`);
    });
  });

  // ── 7. Phase labels ──
  describe("Invariant 7: phase labels", () => {
    it("begin() sets phase from PHASE_LABELS by default", () => {
      const kinds = Object.keys(PHASE_LABELS) as WorkstreamKind[];
      for (const k of kinds) {
        const id = store.begin(k, null, k);
        expect(store.byId(id)?.phase).toBe(PHASE_LABELS[k]);
      }
    });

    it("addEdit/addTool/addCommand/addTest/addVerify carry correct phases", () => {
      const e = store.addEdit("f.ts", 1, 1);
      const t = store.addTool("lint", "pnpm lint", 42, true);
      const c = store.addCommand("pnpm build", 10, true);
      const ts = store.addTest("x.test.ts", 3, 0, 0);
      const v = store.addVerify("typecheck", true, 500);
      expect(store.byId(e)?.phase).toBe("EDITING");
      expect(store.byId(t)?.phase).toBe("EXECUTING");
      expect(store.byId(c)?.phase).toBe("EXECUTING");
      expect(store.byId(ts)?.phase).toBe("TESTING");
      expect(store.byId(v)?.phase).toBe("VERIFYING");
    });

    it("test with failures gets status failed and phase TESTING", () => {
      const id = store.addTest("x.test.ts", 2, 1, 0);
      const a = store.byId(id)!;
      expect(a.phase).toBe("TESTING");
      expect(a.status).toBe("failed");
      expect(a.passed).toBe(2);
      expect(a.failed).toBe(1);
    });
  });

  // ── 8. clear() resets ──
  describe("Invariant 8: clear()", () => {
    it("empties activities and resets phase + hasRunning", () => {
      store.addReason("something");
      store.begin("tool", "EXECUTING", "x");
      expect(store.length()).toBe(2);
      store.clear();
      expect(store.length()).toBe(0);
      const snap = store.snapshot();
      expect(snap.activities).toEqual([]);
      expect(snap.currentPhase).toBe("IDLE");
      expect(snap.hasRunning).toBe(false);
    });

    it("ids start fresh after clear (no leaked counter state)", () => {
      store.begin("tool", "EXECUTING", "first");
      const before = store.length();
      store.clear();
      store.begin("tool", "EXECUTING", "after");
      expect(store.length()).toBe(1);
      expect(store.snapshot().activities[0].label).toBe("after");
      expect(before).toBe(1);
    });
  });

  // ── Snapshot shape / derived ──
  describe("snapshot derived state", () => {
    it("hasRunning is true while any activity is running", () => {
      expect(store.snapshot().hasRunning).toBe(false);
      store.begin("tool", "EXECUTING", "lint");
      expect(store.snapshot().hasRunning).toBe(true);
      const id = store.snapshot().activities[0].id;
      const a = store.byId(id)!;
      store.complete(a.id, { elapsedMs: 5, success: true });
      expect(store.snapshot().hasRunning).toBe(false);
    });

    it("snapshot.activities is ordered (oldest..newest)", () => {
      store.addReason("a");
      store.addReason("b");
      store.addReason("c");
      expect(store.snapshot().activities.map((x) => x.label)).toEqual(["a", "b", "c"]);
    });
  });
});

describe("estimateWorkstreamRows (renderer budget contract)", () => {
  it("returns 0 for an empty stream", () => {
    const snap = new WorkstreamStore().snapshot();
    expect(estimateWorkstreamRows(snap)).toBe(0);
  });

  it("counts one row per collapsed activity", () => {
    const s = new WorkstreamStore();
    s.addReason("a");
    s.addReason("b");
    s.addTool("lint", "pnpm lint", 42, true);
    expect(estimateWorkstreamRows(s.snapshot())).toBe(3);
  });

  it("adds a row for a failed activity's reason line", () => {
    const s = new WorkstreamStore();
    const id = s.begin("edit", "EDITING", "a.ts");
    s.fail(id, "not found");
    expect(estimateWorkstreamRows(s.snapshot())).toBe(2);
  });

  it("counts expanded diff lines (capped at 24 + overflow marker)", () => {
    const s = new WorkstreamStore();
    const diff: string[] = [];
    for (let i = 0; i < 30; i++) diff.push(`-line ${i}`);
    s.addEdit("big.ts", 1, 30, diff);
    const snap = s.snapshot();
    s.toggleExpand(snap.activities[0].id);
    expect(estimateWorkstreamRows(s.snapshot())).toBe(1 + 24 + 1);
  });

  it("respects maxRows (oldest dropped from the count)", () => {
    const s = new WorkstreamStore();
    for (let i = 0; i < 10; i++) s.addReason(`r${i}`);
    expect(estimateWorkstreamRows(s.snapshot(), 4)).toBe(4);
  });
});
