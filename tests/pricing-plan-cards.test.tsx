// @vitest-environment jsdom
/**
 * Pricing page plan-card truth regression.
 *
 * Behavior under test:
 *  - All four public plans render as cards: Starter, Creator Lite, Creator
 *    (featured), Pro Builder.
 *  - Displayed prices come from PLANS config, so a 1999-cent plan shows
 *    "$19.99" and a 999-cent plan shows "$9.99" — never the rounded "$20".
 *  - Paid CTAs use the existing checkout wiring: signed-out visitors save a
 *    pending plan and go to sign-in; signed-in visitors POST the planId to
 *    /api/billing/checkout.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within, waitFor } from "@testing-library/react";
import * as React from "react";

// ─── Mocks (hoisted by vitest) ────────────────────────────────────

const mockUseClerkAuth = vi.fn();
vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: (...args: unknown[]) => mockUseClerkAuth(...args),
  useAppUser: () => ({ user: null }),
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

import PricingClient from "@/app/(marketing)/pricing/PricingClient";

function signedOut() {
  mockUseClerkAuth.mockReturnValue({
    isLoaded: true,
    isSignedIn: false,
    userId: null,
  });
}

function signedIn() {
  mockUseClerkAuth.mockReturnValue({
    isLoaded: true,
    isSignedIn: true,
    userId: "u1",
  });
}

/** The <article> plan card containing a given plan-name heading. */
function cardFor(name: string): HTMLElement {
  const heading = screen.getByRole("heading", { name, level: 2 });
  const article = heading.closest("article");
  expect(article).not.toBeNull();
  return article as HTMLElement;
}

// ─── Tests ────────────────────────────────────────────────────────

describe("PricingClient plan cards", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("renders all four public plans with config-driven prices", () => {
    signedOut();
    render(<PricingClient />);

    const starter = cardFor("Starter");
    within(starter).getByText("Free");

    const lite = cardFor("Creator Lite");
    within(lite).getByText("$9.99");
    within(lite).getByText("/month");
    within(lite).getByText("2,500");
    within(lite).getByText("Choose Creator Lite");

    const creator = cardFor("Creator");
    within(creator).getByText("$19.99");
    within(creator).getByText("Most popular");

    const pro = cardFor("Pro Builder");
    within(pro).getByText("$39");

    // Regression guard: the 1999-cent plan must not render the rounded "$20".
    expect(screen.queryByText("$20")).toBeNull();
  });

  it("routes a signed-out Creator Lite click through the pending-plan sign-in flow", () => {
    signedOut();
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<PricingClient />);

    fireEvent.click(screen.getByText("Choose Creator Lite"));

    // The chosen plan is remembered for post-sign-in checkout resume…
    expect(sessionStorage.getItem("litt:pendingPlanCheckout")).toBe("creator_lite");
    // …and no checkout fetch fires for a guest.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts the existing planId to /api/billing/checkout when signed in", async () => {
    signedIn();
    const fetchMock = vi.fn().mockResolvedValue({
      json: async () => ({ url: "https://checkout.stripe.com/session" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<PricingClient />);
    fireEvent.click(screen.getByText("Choose Creator Lite"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/billing/checkout");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ planId: "creator_lite" });
  });
});
