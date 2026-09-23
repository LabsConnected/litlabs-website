import { describe, it, expect, beforeEach } from "vitest";

import {
  checkDemoBurst,
  getDemoMessageCount,
  incrementDemoMessageCount,
  resetDemoStore,
} from "./rate-limit";

describe("demo rate limiting (in-memory fallback)", () => {
  beforeEach(() => {
    resetDemoStore();
  });

  it("allows up to the per-minute limit, then trips", async () => {
    const opts = { sessionPerMinute: 2, ipPerMinute: 100 };
    expect((await checkDemoBurst("session", "s1", opts)).success).toBe(true);
    expect((await checkDemoBurst("session", "s1", opts)).success).toBe(true);
    const third = await checkDemoBurst("session", "s1", opts);
    expect(third.success).toBe(false);
    expect(third.remaining).toBe(0);
  });

  it("tracks session and IP limits independently", async () => {
    const opts = { sessionPerMinute: 100, ipPerMinute: 1 };
    expect((await checkDemoBurst("ip", "1.2.3.4", opts)).success).toBe(true);
    expect((await checkDemoBurst("ip", "1.2.3.4", opts)).success).toBe(false);
    // Session limiter is untouched by the IP trip.
    expect((await checkDemoBurst("session", "s9", opts)).success).toBe(true);
  });

  it("counts demo messages with expiry", async () => {
    expect(await getDemoMessageCount("sess-a")).toBe(0);
    expect(await incrementDemoMessageCount("sess-a", 3600)).toBe(1);
    expect(await incrementDemoMessageCount("sess-a", 3600)).toBe(2);
    expect(await getDemoMessageCount("sess-a")).toBe(2);
    // A different session is independent.
    expect(await getDemoMessageCount("sess-b")).toBe(0);
  });

  it("resets cleanly", async () => {
    await incrementDemoMessageCount("sess-a", 3600);
    await checkDemoBurst("session", "s1", { sessionPerMinute: 1, ipPerMinute: 1 });
    resetDemoStore();
    expect(await getDemoMessageCount("sess-a")).toBe(0);
    expect(
      (await checkDemoBurst("session", "s1", { sessionPerMinute: 1, ipPerMinute: 1 })).success,
    ).toBe(true);
  });
});
