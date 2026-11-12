/**
 * /agent (singular) route-level redirect regression — PR #934, issue #627.
 *
 * The /agent page is a pure server-side redirect. Owner ruling 2026-11-12:
 * there is no separate Agents tab — Agents lives inside Studio only. So
 * /agent must land directly on /studio?tool=agents and must NOT bounce
 * through the standalone /agents page (its pre-#934 target).
 *
 * Follows the route-level redirect pattern of tests/dashboard-redirect.test.ts
 * and tests/hire-redirect.test.ts: mock next/navigation's redirect() with a
 * hoisted spy that throws NEXT_REDIRECT:<url>, invoke the real page
 * component, and assert the exact target it produced.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const redirectMock = vi.hoisted(() => vi.fn((url: string) => {
  // next/navigation redirect() throws to stop rendering; mirror that.
  throw new Error(`NEXT_REDIRECT:${url}`);
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("/agent → /studio?tool=agents redirect (route level)", () => {
  beforeEach(() => {
    redirectMock.mockClear();
    vi.resetModules();
  });

  it("redirects /agent straight into Studio with the agents tool selected", async () => {
    const { default: AgentPage } = await import("@/app/(app)/agent/page");
    expect(() => AgentPage()).toThrow("NEXT_REDIRECT:/studio?tool=agents");
    expect(redirectMock).toHaveBeenCalledTimes(1);
    expect(redirectMock).toHaveBeenCalledWith("/studio?tool=agents");
  });

  it("does not bounce through the standalone /agents page (pre-#934 target)", async () => {
    const { default: AgentPage } = await import("@/app/(app)/agent/page");
    expect(() => AgentPage()).toThrow(/^NEXT_REDIRECT:/);
    expect(redirectMock).not.toHaveBeenCalledWith("/agents");
    const target = redirectMock.mock.calls[0]?.[0] as string;
    expect(target.startsWith("/studio")).toBe(true);
  });
});
