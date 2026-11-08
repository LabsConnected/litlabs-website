import { describe, it, expect, vi } from "vitest";
import { authorizeOutboundCall, type CallAuthorizationRepo } from "./call-authorization";

function makeRepo(overrides: Partial<CallAuthorizationRepo> = {}): CallAuthorizationRepo {
  return {
    isKillSwitchEngaged: vi.fn().mockResolvedValue(true), // default: calling OFF
    hasConsent: vi.fn().mockResolvedValue(false),
    getSpendCapCents: vi.fn().mockResolvedValue(0),
    getAttemptsToday: vi.fn().mockResolvedValue(0),
    recordAttempt: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("authorizeOutboundCall", () => {
  it("denies when the kill switch is engaged, even with consent and budget", async () => {
    const repo = makeRepo({
      isKillSwitchEngaged: vi.fn().mockResolvedValue(true),
      hasConsent: vi.fn().mockResolvedValue(true),
      getSpendCapCents: vi.fn().mockResolvedValue(1000),
    });
    const result = await authorizeOutboundCall(
      { phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 },
      repo,
    );
    expect(result).toEqual({ allowed: false, reason: "kill_switch_engaged" });
  });

  it("denies when the callee has not consented", async () => {
    const repo = makeRepo({
      isKillSwitchEngaged: vi.fn().mockResolvedValue(false),
      hasConsent: vi.fn().mockResolvedValue(false),
    });
    const result = await authorizeOutboundCall(
      { phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 },
      repo,
    );
    expect(result).toEqual({ allowed: false, reason: "no_consent" });
  });

  it("denies when estimated cost exceeds the spend cap (default cap is 0)", async () => {
    const repo = makeRepo({
      isKillSwitchEngaged: vi.fn().mockResolvedValue(false),
      hasConsent: vi.fn().mockResolvedValue(true),
      getSpendCapCents: vi.fn().mockResolvedValue(0),
    });
    const result = await authorizeOutboundCall(
      { phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 1 },
      repo,
    );
    expect(result).toEqual({ allowed: false, reason: "spend_cap_exceeded" });
  });

  it("denies after the daily retry limit (1/day) is reached", async () => {
    const repo = makeRepo({
      isKillSwitchEngaged: vi.fn().mockResolvedValue(false),
      hasConsent: vi.fn().mockResolvedValue(true),
      getSpendCapCents: vi.fn().mockResolvedValue(0),
      getAttemptsToday: vi.fn().mockResolvedValue(1),
    });
    const result = await authorizeOutboundCall(
      { phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 },
      repo,
    );
    expect(result).toEqual({ allowed: false, reason: "retry_limit_exceeded" });
  });

  it("allows and records an attempt when every check passes", async () => {
    const repo = makeRepo({
      isKillSwitchEngaged: vi.fn().mockResolvedValue(false),
      hasConsent: vi.fn().mockResolvedValue(true),
      getSpendCapCents: vi.fn().mockResolvedValue(0),
      getAttemptsToday: vi.fn().mockResolvedValue(0),
    });
    const result = await authorizeOutboundCall(
      { phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 },
      repo,
    );
    expect(result).toEqual({ allowed: true });
    expect(repo.recordAttempt).toHaveBeenCalledWith("+15551234567");
  });

  it("a negative estimatedCostCents does not bypass the other gates (kill switch still denies)", async () => {
    const repo = makeRepo({ isKillSwitchEngaged: vi.fn().mockResolvedValue(true) });
    const result = await authorizeOutboundCall(
      { phone: "+15551234567", requestedBy: "dex", estimatedCostCents: -999999 },
      repo,
    );
    expect(result).toEqual({ allowed: false, reason: "kill_switch_engaged" });
  });

  it("allows exactly at the spend cap boundary (cost === cap), denies one cent over", async () => {
    const repoAtCap = makeRepo({
      isKillSwitchEngaged: vi.fn().mockResolvedValue(false),
      hasConsent: vi.fn().mockResolvedValue(true),
      getSpendCapCents: vi.fn().mockResolvedValue(500),
    });
    expect(
      await authorizeOutboundCall({ phone: "+1", requestedBy: "dex", estimatedCostCents: 500 }, repoAtCap),
    ).toEqual({ allowed: true });

    const repoOverCap = makeRepo({
      isKillSwitchEngaged: vi.fn().mockResolvedValue(false),
      hasConsent: vi.fn().mockResolvedValue(true),
      getSpendCapCents: vi.fn().mockResolvedValue(500),
    });
    expect(
      await authorizeOutboundCall({ phone: "+1", requestedBy: "dex", estimatedCostCents: 501 }, repoOverCap),
    ).toEqual({ allowed: false, reason: "spend_cap_exceeded" });
  });

  it("checks the kill switch before any other check (fails closed on first gate)", async () => {
    const repo = makeRepo({ isKillSwitchEngaged: vi.fn().mockResolvedValue(true) });
    await authorizeOutboundCall({ phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 }, repo);
    expect(repo.hasConsent).not.toHaveBeenCalled();
    expect(repo.getSpendCapCents).not.toHaveBeenCalled();
    expect(repo.recordAttempt).not.toHaveBeenCalled();
  });

  it("never records an attempt when a check denies the call", async () => {
    const repo = makeRepo({
      isKillSwitchEngaged: vi.fn().mockResolvedValue(false),
      hasConsent: vi.fn().mockResolvedValue(false),
    });
    await authorizeOutboundCall({ phone: "+15551234567", requestedBy: "dex", estimatedCostCents: 0 }, repo);
    expect(repo.recordAttempt).not.toHaveBeenCalled();
  });
});
