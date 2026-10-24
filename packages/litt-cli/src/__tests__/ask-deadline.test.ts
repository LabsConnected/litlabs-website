/**
 * Regression: `litt ask` must terminate on a never-responding endpoint.
 *
 * The agent loop's totalTimeoutMs only checks between rounds — a hung
 * fetch never reaches that check. withAskDeadline bounds the whole wait
 * and fires a cancel callback so the in-flight request is torn down.
 */
import { describe, it } from "vitest";
import { withAskDeadline } from "../commands/ask.js";

describe("withAskDeadline", () => {
  it("resolves with the work result before the deadline", async () => {
    const v = await withAskDeadline(Promise.resolve("ok"), 50);
    expect(v).toBe("ok");
  });

  it("rejects a never-settling promise at the deadline and cancels", async () => {
    let cancelled = false;
    const t0 = Date.now();
    await expect(
      withAskDeadline(new Promise(() => {}), 30, () => { cancelled = true; }),
    ).rejects.toThrow(/timed out after 30ms/);
    expect(Date.now() - t0).toBeLessThan(1500);
    expect(cancelled).toBe(true);
  });

  it("still rejects at the deadline even if the cancel callback throws", async () => {
    await expect(
      withAskDeadline(new Promise(() => {}), 20, () => { throw new Error("x"); }),
    ).rejects.toThrow(/timed out/);
  });

  it("propagates the work rejection instead of waiting for the deadline", async () => {
    const t0 = Date.now();
    await expect(
      withAskDeadline(Promise.reject(new Error("boom")), 60_000),
    ).rejects.toThrow("boom");
    expect(Date.now() - t0).toBeLessThan(2000);
  });
});
