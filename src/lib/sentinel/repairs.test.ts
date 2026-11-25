import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createFakeSupabase } from "./fake-supabase.testkit";
import {
  loadRepairCandidates,
  proposeRepairCandidate,
  repairSignature,
  REPAIR_COOLDOWN_MS,
  sanitizeDiagnosticText,
  transitionRepairCandidate,
} from "./repairs";

const TABLE = "sentinel_repair_candidates";

function asClient(fake: ReturnType<typeof createFakeSupabase>) {
  return fake.client as unknown as SupabaseClient;
}

const baseInput = {
  incidentId: "inc-1",
  serviceId: "database" as const,
  severity: "critical" as const,
  summary: "Database unreachable",
  detail: "connection refused after 3000ms",
};

describe("repairSignature / sanitizeDiagnosticText", () => {
  it("is deterministic and service-scoped", () => {
    const a = repairSignature("database", "Connection Refused!");
    const b = repairSignature("database", "connection refused");
    const c = repairSignature("stripe", "connection refused");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("redacts credential-shaped strings", () => {
    expect(sanitizeDiagnosticText("Bearer abc123 token=xyz")).not.toContain("abc123");
    expect(sanitizeDiagnosticText("api_key=sk-live-999")).toContain("[redacted]");
  });
});

describe("proposeRepairCandidate", () => {
  it("creates a proposed candidate for critical incidents", async () => {
    const fake = createFakeSupabase();
    const id = await proposeRepairCandidate(asClient(fake), baseInput);
    expect(id).toBeTruthy();
    const rows = fake.tables[TABLE];
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("proposed");
    expect(rows[0].diagnostics.untrusted).toBe(true);
    expect(rows[0].audit[0]).toMatchObject({ to: "proposed", actor: "sentinel" });
  });

  it("suppresses warnings and missing clients", async () => {
    const fake = createFakeSupabase();
    expect(await proposeRepairCandidate(asClient(fake), { ...baseInput, severity: "warning" })).toBeNull();
    expect(await proposeRepairCandidate(null, baseInput)).toBeNull();
    expect(fake.tables[TABLE] ?? []).toHaveLength(0);
  });

  it("deduplicates in-flight candidates by signature", async () => {
    const fake = createFakeSupabase();
    const first = await proposeRepairCandidate(asClient(fake), baseInput);
    // Same incident class (identical detail → identical signature),
    // different incident id — must not create a second candidate.
    const dupe = await proposeRepairCandidate(asClient(fake), { ...baseInput, incidentId: "inc-3" });
    expect(first).toBeTruthy();
    expect(dupe).toBeNull();
    expect(fake.tables[TABLE]).toHaveLength(1);
  });

  it("respects cooldown after failure", async () => {
    const fake = createFakeSupabase();
    const id = (await proposeRepairCandidate(asClient(fake), baseInput))!;
    await transitionRepairCandidate(asClient(fake), id, "approved", "owner:test");
    await transitionRepairCandidate(asClient(fake), id, "running", "agent:test");
    await transitionRepairCandidate(asClient(fake), id, "failed", "agent:test");

    const again = await proposeRepairCandidate(asClient(fake), { ...baseInput, incidentId: "inc-9" });
    expect(again).toBeNull();
    expect(fake.tables[TABLE][0].cooldown_until).toBeTruthy();
  });

  it("blocks re-proposal after max attempts", async () => {
    const fake = createFakeSupabase();
    const id = (await proposeRepairCandidate(asClient(fake), baseInput))!;
    // Drive attempt_count to max via running→failed cycles is capped by
    // cooldown; instead seed a candidate directly at the cap.
    fake.tables[TABLE][0].attempt_count = 3;
    fake.tables[TABLE][0].state = "failed";
    fake.tables[TABLE][0].cooldown_until = null;
    const again = await proposeRepairCandidate(asClient(fake), baseInput);
    expect(again).toBeNull();
    void id;
  });
});

describe("transitionRepairCandidate", () => {
  async function proposed(fake: ReturnType<typeof createFakeSupabase>) {
    const id = (await proposeRepairCandidate(asClient(fake), baseInput))!;
    return id;
  }

  it("walks the happy path proposed→approved→running→pr_open→resolved", async () => {
    const fake = createFakeSupabase();
    const id = await proposed(fake);
    const c = asClient(fake);
    expect(await transitionRepairCandidate(c, id, "approved", "owner:u")).toBe("approved");
    expect(await transitionRepairCandidate(c, id, "running", "agent:a")).toBe("running");
    expect(await transitionRepairCandidate(c, id, "pr_open", "agent:a")).toBe("pr_open");
    expect(await transitionRepairCandidate(c, id, "resolved", "owner:u")).toBe("resolved");
    const row = fake.tables[TABLE][0];
    expect(row.attempt_count).toBe(2); // running + pr_open
    expect(row.budget_units).toBe(4);
    expect(row.audit.map((a: { to: string }) => a.to)).toEqual([
      "proposed", "approved", "running", "pr_open", "resolved",
    ]);
  });

  it("rejects illegal transitions and terminal states", async () => {
    const fake = createFakeSupabase();
    const id = await proposed(fake);
    const c = asClient(fake);
    expect(await transitionRepairCandidate(c, id, "running", "agent:a")).toBeNull(); // skip approve
    expect(await transitionRepairCandidate(c, id, "resolved", "owner:u")).toBeNull();
    await transitionRepairCandidate(c, id, "cancelled", "owner:u");
    expect(await transitionRepairCandidate(c, id, "approved", "owner:u")).toBeNull(); // terminal
  });

  it("cancel is always allowed and sets cooldown", async () => {
    const fake = createFakeSupabase();
    const id = await proposed(fake);
    expect(await transitionRepairCandidate(asClient(fake), id, "cancelled", "owner:u")).toBe("cancelled");
    const row = fake.tables[TABLE][0];
    expect(Date.parse(row.cooldown_until)).toBeGreaterThan(Date.now());
    expect(Date.parse(row.cooldown_until)).toBeLessThanOrEqual(Date.now() + REPAIR_COOLDOWN_MS + 1000);
  });

  it("enforces the budget cap", async () => {
    const fake = createFakeSupabase();
    const id = await proposed(fake);
    fake.tables[TABLE][0].budget_units = 10; // max_budget_units
    fake.tables[TABLE][0].max_budget_units = 10;
    expect(await transitionRepairCandidate(asClient(fake), id, "approved", "owner:u")).toBeNull();
    // cancel still allowed at cap
    expect(await transitionRepairCandidate(asClient(fake), id, "cancelled", "owner:u")).toBe("cancelled");
  });
});

describe("loadRepairCandidates", () => {
  it("returns [] when the table is empty or client is null", async () => {
    const fake = createFakeSupabase();
    expect(await loadRepairCandidates(asClient(fake))).toEqual([]);
    expect(await loadRepairCandidates(null)).toEqual([]);
  });
});
