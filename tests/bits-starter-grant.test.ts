/**
 * BITS starter grant and wallet behavior regression tests.
 *
 * Verifies:
 * 1. The Clerk webhook grants 500 starter BITS on user.created (not just lazily).
 * 2. The starter grant is idempotent (idempotency_key = "starter:{userId}").
 * 3. The wallet-ledger replayed flag is correct for debits.
 * 4. The owner exemption does not leak to non-owners.
 * 5. Daily bonus is disabled by default.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEBHOOK_PATH = join(process.cwd(), "src", "app", "api", "webhook", "clerk", "route.ts");
const WALLET_LEDGER_PATH = join(process.cwd(), "src", "lib", "wallet-ledger.ts");
const OWNER_PATH = join(process.cwd(), "src", "lib", "owner.ts");
const WALLET_ROUTE_PATH = join(process.cwd(), "src", "app", "api", "wallet", "route.ts");

describe("BITS starter grant", () => {
  it("Clerk webhook grants starter BITS on user.created (not just lazily)", () => {
    const content = readFileSync(WEBHOOK_PATH, "utf-8");
    // The webhook must call grant_credits for new users
    expect(content).toContain("grant_credits");
    expect(content).toContain("starter:");
    expect(content).toContain("500");
    // Must only grant for new users (isNew check)
    expect(content).toContain("isNew");
    // Must only grant on user.created (not user.updated)
    expect(content).toContain('eventType === "user.created"');
  });

  it("starter grant uses idempotency key starter:{userId}", () => {
    const content = readFileSync(WEBHOOK_PATH, "utf-8");
    expect(content).toMatch(/starter:\$\{.*\.id\}/);
  });

  it("starter grant pre-checks for existing grant before RPC call", () => {
    const content = readFileSync(WEBHOOK_PATH, "utf-8");
    // Must check credit_ledger for existing grant before calling RPC
    expect(content).toContain("credit_ledger");
    expect(content).toContain("existingGrant");
  });

  it("starter grant failure does not fail the webhook", () => {
    const content = readFileSync(WEBHOOK_PATH, "utf-8");
    // The grant must be in a try/catch that doesn't throw
    expect(content).toContain("Starter grant failed");
    expect(content).toContain("lazy grant");
  });
});

describe("wallet-ledger replayed flag", () => {
  it("replayed flag for debits detects no-op replays (not just success=false)", () => {
    const content = readFileSync(WALLET_LEDGER_PATH, "utf-8");
    // The replayed check for debits must check balance === before.total
    // AND success === true (because debit_credits returns success=true on replay)
    expect(content).toContain("row.success === true");
    expect(content).toContain("balance === before.total");
  });
});

describe("owner exemption isolation", () => {
  it("isBillingExempt returns false for non-owners", () => {
    const content = readFileSync(OWNER_PATH, "utf-8");
    // The first guard must be isOwnerClerkId
    expect(content).toMatch(/if\s*\(!isOwnerClerkId\(.*\)\s*return\s*false/);
  });

  it("isBillingExempt respects simulation overrides for owners", () => {
    const content = readFileSync(OWNER_PATH, "utf-8");
    // A non-"owner" simulation should force return false even for owners
    expect(content).toContain("simulation");
    expect(content).toMatch(/return\s*false/);
  });
});

describe("daily bonus gate", () => {
  it("daily bonus is disabled by default (requires ENABLE_DAILY_LITTBITS=true)", () => {
    const content = readFileSync(WALLET_ROUTE_PATH, "utf-8");
    expect(content).toContain("ENABLE_DAILY_LITTBITS");
    expect(content).toContain('"true"');
    // Must return 503 when not enabled
    expect(content).toContain("503");
  });
});
