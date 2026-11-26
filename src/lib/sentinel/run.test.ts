import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("@/lib/alerts", () => ({
  alertLog: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/system-health", () => ({
  _clearAiHealthCache: vi.fn(),
}));
vi.mock("@/lib/litt", () => ({
  litt: { notify: vi.fn().mockResolvedValue(true) },
}));
vi.mock("@/lib/sentinel/store", () => ({
  loadServiceStates: vi.fn().mockResolvedValue(new Map()),
  loadRecentIncidents: vi.fn().mockResolvedValue([]),
  saveServiceState: vi.fn().mockResolvedValue(undefined),
  findOpenIncidentId: vi.fn().mockResolvedValue(null),
  openIncident: vi.fn().mockResolvedValue("inc-1"),
  resolveIncident: vi.fn().mockResolvedValue(undefined),
  recordHeartbeat: vi.fn().mockResolvedValue(undefined),
  readHeartbeat: vi.fn().mockResolvedValue(null),
}));

import { alertLog } from "@/lib/alerts";
import { _clearAiHealthCache } from "@/lib/system-health";
import {
  findOpenIncidentId,
  openIncident,
  resolveIncident,
} from "@/lib/sentinel/store";
import { planRemediation, runSentinelPass, _resetSentinelForTests } from "./run";
import { SENTINEL_SERVICE_IDS } from "./state";
import type { ProbeResult, SentinelServiceId } from "./types";

const ok: ProbeResult = { ok: true, latencyMs: 5, detail: "ok" };
const fail: ProbeResult = { ok: false, latencyMs: 5, detail: "down" };

const client = {} as SupabaseClient;

function probesFor(results: Partial<Record<SentinelServiceId, ProbeResult>>) {
  const map = {} as Record<SentinelServiceId, () => Promise<ProbeResult>>;
  for (const id of SENTINEL_SERVICE_IDS) {
    const r = results[id] ?? ok;
    map[id] = async () => r;
  }
  return map;
}

beforeEach(() => {
  vi.clearAllMocks();
  _resetSentinelForTests();
});

describe("runSentinelPass", () => {
  it("opens an incident when a critical service fails twice", async () => {
    const probes = probesFor({ database: fail });
    // Pass 1: operational → degraded (opened)
    const p1 = await runSentinelPass(client, probes);
    const db1 = p1.states.find((s) => s.serviceId === "database")!;
    expect(db1.level).toBe("degraded");
    expect(openIncident).toHaveBeenCalledTimes(1);
    expect(alertLog).toHaveBeenCalledWith(
      "sentinel.incident.opened.database",
      expect.objectContaining({ service: "database" }),
    );

    // Pass 2: degraded → down (escalated)
    const p2 = await runSentinelPass(client, probes);
    const db2 = p2.states.find((s) => s.serviceId === "database")!;
    expect(db2.level).toBe("down");
    expect(alertLog).toHaveBeenCalledWith(
      "sentinel.incident.escalated.database",
      expect.anything(),
    );
    // Still one incident — escalation reuses the open one.
    expect(openIncident).toHaveBeenCalledTimes(1);
  });

  it("resolves the incident after sustained recovery", async () => {
    const failProbes = probesFor({ "ai-gemini": fail });
    await runSentinelPass(client, failProbes); // degraded
    await runSentinelPass(client, failProbes); // down (critical)

    const okProbes = probesFor({ "ai-gemini": ok });
    await runSentinelPass(client, okProbes); // success 1 — still down
    const p4 = await runSentinelPass(client, okProbes); // success 2 — still down
    const p5 = await runSentinelPass(client, okProbes); // success 3 → recovered

    const mid = p4.states.find((s) => s.serviceId === "ai-gemini")!;
    expect(mid.level).toBe("down");
    const gemini = p5.states.find((s) => s.serviceId === "ai-gemini")!;
    expect(gemini.level).toBe("operational");
    expect(resolveIncident).toHaveBeenCalledWith(client, "inc-1");
    expect(_clearAiHealthCache).toHaveBeenCalled();
    expect(alertLog).toHaveBeenCalledWith(
      "sentinel.incident.recovered.ai-gemini",
      expect.anything(),
    );
  });

  it("inapplicable services stay unknown and open no incidents", async () => {
    const na: ProbeResult = { ok: true, latencyMs: null, detail: "no key", applicable: false };
    const probes = probesFor({ stripe: na, deployment: na });
    const result = await runSentinelPass(client, probes);
    const stripe = result.states.find((s) => s.serviceId === "stripe")!;
    expect(stripe.level).toBe("unknown");
    expect(openIncident).not.toHaveBeenCalled();
  });

  it("a throwing probe degrades gracefully into a failure result", async () => {
    const probes = probesFor({});
    probes.database = async () => {
      throw new Error("kaboom");
    };
    const result = await runSentinelPass(client, probes);
    const db = result.states.find((s) => s.serviceId === "database")!;
    expect(db.level).toBe("degraded");
    expect(db.detail).toContain("kaboom");
  });

  it("reuses an existing open incident id instead of duplicating", async () => {
    vi.mocked(findOpenIncidentId).mockResolvedValueOnce("existing-inc");
    const probes = probesFor({ database: fail });
    const result = await runSentinelPass(client, probes);
    const db = result.states.find((s) => s.serviceId === "database")!;
    expect(db.openIncidentId).toBe("existing-inc");
    expect(openIncident).not.toHaveBeenCalled();
  });
});

describe("planRemediation", () => {
  it("always alerts the owner on open/escalate", () => {
    for (const event of [
      { type: "opened" as const, level: "degraded" as const, severity: "critical" as const, summary: "s" },
      { type: "escalated" as const, to: "down" as const, summary: "s" },
    ]) {
      const actions = planRemediation("database", event);
      expect(actions).toContain("alert-owner");
    }
  });

  it("clears AI health cache only on AI provider recovery", () => {
    const recovered = { type: "recovered" as const, summary: "s" };
    expect(planRemediation("ai-gemini", recovered)).toContain("clear-ai-health-cache");
    expect(planRemediation("database", recovered)).not.toContain("clear-ai-health-cache");
    expect(planRemediation("database", { type: "opened", level: "down", severity: "critical", summary: "s" }))
      .not.toContain("clear-ai-health-cache");
  });
});
