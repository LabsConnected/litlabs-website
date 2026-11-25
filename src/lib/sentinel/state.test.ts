import { describe, expect, it } from "vitest";
import {
  evaluateTransition,
  initialServiceState,
  mapAiProviderProbe,
} from "./state";
import type { ProbeResult, ServiceState } from "./types";

const NOW = "2026-11-25T12:00:00.000Z";
const LATER = "2026-11-25T12:01:00.000Z";

const ok: ProbeResult = { ok: true, latencyMs: 10, detail: "ok" };
const fail: ProbeResult = { ok: false, latencyMs: 10, detail: "boom" };
const failWarn: ProbeResult = { ok: false, latencyMs: 10, detail: "rate limited", severity: "warning" };
const notApplicable: ProbeResult = { ok: true, latencyMs: null, detail: "not configured", applicable: false };

function stateAfter(
  prev: ServiceState | null,
  probe: ProbeResult,
  times: number,
): { state: ServiceState; events: ReturnType<typeof evaluateTransition>["events"] } {
  let s = prev;
  let events: ReturnType<typeof evaluateTransition>["events"] = [];
  for (let i = 0; i < times; i++) {
    const t = evaluateTransition("database", s, probe, i === 0 ? NOW : LATER);
    s = t.state;
    events = events.concat(t.events);
  }
  return { state: s!, events };
}

describe("evaluateTransition", () => {
  it("starts unknown and goes operational on first healthy probe", () => {
    const { state, events } = stateAfter(null, ok, 1);
    expect(state.level).toBe("operational");
    expect(events).toHaveLength(0);
    expect(state.lastCheckedAt).toBe(NOW);
  });

  it("opens a degraded incident on first failure", () => {
    const { state, events } = stateAfter(null, fail, 1);
    // First probe is healthy path? No — null prev is 'unknown', failure → degraded + opened.
    expect(state.level).toBe("degraded");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("opened");
    if (events[0].type === "opened") expect(events[0].severity).toBe("critical");
  });

  it("escalates degraded → down on second consecutive critical failure", () => {
    const first = stateAfter(null, ok, 1).state; // operational
    const { state, events } = stateAfter(first, fail, 2);
    expect(state.level).toBe("down");
    expect(events.map((e) => e.type)).toEqual(["opened", "escalated"]);
  });

  it("never escalates warning-severity failures to down", () => {
    const first = stateAfter(null, ok, 1).state;
    const { state, events } = stateAfter(first, failWarn, 5);
    expect(state.level).toBe("degraded");
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("opened");
  });

  it("recovers degraded → operational after 2 consecutive successes", () => {
    const degraded = stateAfter(null, fail, 1).state;
    const one = stateAfter(degraded, ok, 1);
    expect(one.state.level).toBe("degraded");
    expect(one.events).toHaveLength(0);
    const two = stateAfter(one.state, ok, 1);
    expect(two.state.level).toBe("operational");
    expect(two.events[0]?.type).toBe("recovered");
  });

  it("requires 3 consecutive successes to recover from down", () => {
    const down = stateAfter(stateAfter(null, ok, 1).state, fail, 2).state;
    expect(down.level).toBe("down");
    const s1 = stateAfter(down, ok, 1);
    expect(s1.state.level).toBe("down");
    const s2 = stateAfter(s1.state, ok, 1);
    expect(s2.state.level).toBe("down");
    const s3 = stateAfter(s2.state, ok, 1);
    expect(s3.state.level).toBe("operational");
    expect(s3.events[0]?.type).toBe("recovered");
  });

  it("a single success does not flap a down service", () => {
    const down = stateAfter(stateAfter(null, ok, 1).state, fail, 2).state;
    const { state } = stateAfter(down, ok, 1);
    expect(state.level).toBe("down");
    expect(state.consecutiveSuccesses).toBe(1);
  });

  it("resets failure streak on success", () => {
    const degraded = stateAfter(null, fail, 1).state;
    const okOnce = stateAfter(degraded, ok, 1).state;
    expect(okOnce.consecutiveFailures).toBe(0);
    // fail again → degraded stays degraded, no new 'opened' event
    const again = stateAfter(okOnce, fail, 1);
    expect(again.state.level).toBe("degraded");
    expect(again.events).toHaveLength(0);
  });

  it("inapplicable probes report unknown and never open incidents", () => {
    const { state, events } = stateAfter(null, notApplicable, 1);
    expect(state.level).toBe("unknown");
    expect(events).toHaveLength(0);
    // even repeated inapplicable probes stay quiet
    const { state: s2, events: e2 } = stateAfter(state, notApplicable, 3);
    expect(s2.level).toBe("unknown");
    expect(e2).toHaveLength(0);
  });

  it("failure after unknown opens degraded (first-seen outage)", () => {
    const unknown = initialServiceState("stripe");
    const { state, events } = stateAfter(unknown, fail, 1);
    expect(state.level).toBe("degraded");
    expect(events[0]?.type).toBe("opened");
  });
});

describe("mapAiProviderProbe", () => {
  it("maps healthy → ok", () => {
    expect(mapAiProviderProbe("healthy", "fine", 5).ok).toBe(true);
  });
  it("maps missing → inapplicable (no key configured)", () => {
    const r = mapAiProviderProbe("missing", "no key", null);
    expect(r.applicable).toBe(false);
    expect(r.ok).toBe(true);
  });
  it("maps rate_limited/degraded → warning failure", () => {
    for (const s of ["rate_limited", "degraded"]) {
      const r = mapAiProviderProbe(s, "soft", 5);
      expect(r.ok).toBe(false);
      expect(r.severity).toBe("warning");
    }
  });
  it("maps unavailable/unauthorized → critical failure", () => {
    for (const s of ["unavailable", "unauthorized"]) {
      const r = mapAiProviderProbe(s, "hard", 5);
      expect(r.ok).toBe(false);
      expect(r.severity).toBe("critical");
    }
  });
});
