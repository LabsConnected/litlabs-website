// @vitest-environment node
import { describe, expect, it } from "vitest";
import { computeStarterRemainder } from "./wallet-ledger";

// ACC-01 F6 (labeling half): the one-time 1,500-bit Starter grant lands
// in the monthly bucket, so a new Creator Lite subscriber's billing page
// showed "4,000 MONTHLY" (1,500 starter + 2,500 plan). The remainder rule
// splits the starter portion back out for display: the monthly bucket
// drains oldest-first and the starter grant precedes any plan grant, so
// monthly debits after the starter grant consume it first.
describe("computeStarterRemainder (ACC-01 F6)", () => {
  it("reports the full grant when nothing was spent (the ACC-01 display case)", () => {
    // 1,500 starter + 2,500 Creator Lite in the monthly bucket, 0 debits:
    // starter remainder 1,500 → Monthly tile shows 2,500, Starter tile 1,500.
    expect(
      computeStarterRemainder({
        starterGrantedTotal: 1500,
        monthlyDebitsAfterStarterGrant: 0,
        monthlyBalance: 4000,
      }),
    ).toBe(1500);
  });

  it("shrinks as monthly debits consume the oldest (starter) credits first", () => {
    expect(
      computeStarterRemainder({
        starterGrantedTotal: 1500,
        monthlyDebitsAfterStarterGrant: 400,
        monthlyBalance: 3600,
      }),
    ).toBe(1100);
  });

  it("reaches zero once debits exceed the grant, never negative", () => {
    expect(
      computeStarterRemainder({
        starterGrantedTotal: 1500,
        monthlyDebitsAfterStarterGrant: 2600,
        monthlyBalance: 1400,
      }),
    ).toBe(0);
  });

  it("is capped by the actual monthly balance (refunds/expiry cannot inflate it)", () => {
    expect(
      computeStarterRemainder({
        starterGrantedTotal: 1500,
        monthlyDebitsAfterStarterGrant: 0,
        monthlyBalance: 900,
      }),
    ).toBe(900);
  });

  it("is zero when there was never a starter grant", () => {
    expect(
      computeStarterRemainder({
        starterGrantedTotal: 0,
        monthlyDebitsAfterStarterGrant: 0,
        monthlyBalance: 2500,
      }),
    ).toBe(0);
  });
});
