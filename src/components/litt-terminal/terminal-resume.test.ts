import { describe, it, expect } from "vitest";
import {
  RECONNECT_MAX_MS,
  clearResumeSessionId,
  createSocketAuth,
  loadResumeSessionId,
  needsManualReconnect,
  reconnectDelayMs,
  saveResumeSessionId,
} from "./terminal-resume";

const SID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe("reconnectDelayMs", () => {
  it("grows exponentially and never exceeds the cap", () => {
    const mid = () => 0.5; // zero jitter
    expect(reconnectDelayMs(1, mid)).toBe(1000);
    expect(reconnectDelayMs(2, mid)).toBe(2000);
    expect(reconnectDelayMs(3, mid)).toBe(4000);
    for (let attempt = 1; attempt < 60; attempt++) {
      expect(reconnectDelayMs(attempt, () => 1)).toBeLessThanOrEqual(RECONNECT_MAX_MS);
      expect(reconnectDelayMs(attempt, () => 0)).toBeGreaterThan(0);
    }
  });
});

describe("needsManualReconnect", () => {
  it("only retries server-initiated disconnects manually", () => {
    expect(needsManualReconnect("io server disconnect")).toBe(true);
    expect(needsManualReconnect("transport close")).toBe(false);
    expect(needsManualReconnect("ping timeout")).toBe(false);
    expect(needsManualReconnect("io client disconnect")).toBe(false);
  });
});

describe("resume session storage", () => {
  it("round-trips per project and rejects junk", () => {
    const s = memoryStorage();
    expect(loadResumeSessionId("p1", s)).toBeNull();
    saveResumeSessionId("p1", SID, s);
    expect(loadResumeSessionId("p1", s)).toBe(SID);
    expect(loadResumeSessionId("p2", s)).toBeNull();
    saveResumeSessionId("p2", "not-a-uuid", s);
    expect(loadResumeSessionId("p2", s)).toBeNull();
    clearResumeSessionId("p1", s);
    expect(loadResumeSessionId("p1", s)).toBeNull();
  });

  it("never throws when storage is unavailable", () => {
    const broken = {
      getItem: () => { throw new Error("denied"); },
      setItem: () => { throw new Error("denied"); },
      removeItem: () => { throw new Error("denied"); },
    };
    expect(loadResumeSessionId("p1", broken)).toBeNull();
    saveResumeSessionId("p1", SID, broken);
    clearResumeSessionId("p1", broken);
  });
});

describe("createSocketAuth", () => {
  it("uses the initial token first, then a fresh token on every reconnect", async () => {
    let n = 0;
    const auth = createSocketAuth({
      initialToken: "t0",
      fetchToken: async () => `t${++n}`,
      resumeSessionId: () => SID,
    });
    const calls: unknown[] = [];
    await new Promise<void>((r) => auth((d) => { calls.push(d); r(); }));
    await new Promise<void>((r) => auth((d) => { calls.push(d); r(); }));
    await new Promise<void>((r) => auth((d) => { calls.push(d); r(); }));
    expect(calls).toEqual([
      { token: "t0", resumeSessionId: SID },
      { token: "t1", resumeSessionId: SID },
      { token: "t2", resumeSessionId: SID },
    ]);
  });

  it("falls back to the last good token when a refresh fails", async () => {
    const auth = createSocketAuth({
      initialToken: "t0",
      fetchToken: async () => { throw new Error("offline"); },
      resumeSessionId: () => null,
    });
    await new Promise<void>((r) => auth(() => r()));
    const second = await new Promise((r) => auth(r));
    expect(second).toEqual({ token: "t0" });
  });
});
