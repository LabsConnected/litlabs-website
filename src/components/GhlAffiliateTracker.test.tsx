/**
 * GhlAffiliateSignupTracker — regression coverage for the 2026-11-11
 * production console noise: on every sign-in the tracker POSTed to
 * /api/affiliate/track-lead, the dead GHL affiliate endpoint answered
 * 404 upstream, and the client logged "[ghl] Lead tracking failed …"
 * as a warning — forever, because the server only marks the user
 * tracked on success. While the upstream integration is dead, the
 * tracker must not fire the call at all.
 */
import { describe, expect, it, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { render, waitFor } from "@testing-library/react";

vi.mock("next/script", () => ({ default: () => null }));
vi.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: "user_test123",
      primaryEmailAddress: { emailAddress: "owner@example.com" },
      firstName: "Test",
      lastName: "Owner",
    },
  }),
}));

import { GhlAffiliateSignupTracker } from "./GhlAffiliateTracker";

describe("GhlAffiliateSignupTracker", () => {
  let fetchSpy: MockInstance<typeof fetch>;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ tracked: false, reason: "GHL returned 404" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("does not call the dead track-lead endpoint on sign-in", async () => {
    render(<GhlAffiliateSignupTracker />);
    // Give the effect every chance to fire.
    await waitFor(() => new Promise((resolve) => setTimeout(resolve, 50)));
    const trackLeadCalls = fetchSpy.mock.calls.filter(([input]) =>
      String(input instanceof Request ? input.url : input).includes("/api/affiliate/track-lead"),
    );
    expect(trackLeadCalls).toHaveLength(0);
  });
});
