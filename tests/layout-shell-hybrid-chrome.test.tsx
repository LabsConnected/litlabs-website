// @vitest-environment jsdom
/**
 * Hybrid public page chrome regression.
 *
 * /marketplace and /discover are public, indexed pages (HYBRID_PUBLIC_PATHS
 * in LayoutShell.tsx) that render bare — no AppShell sidebar — for
 * signed-out visitors. That branch used to render literally zero site
 * chrome: no logo, no nav, no way back to "/" or /pricing short of the
 * browser back button. Fixed the same way /docs was (shared
 * MarketingHeader/MarketingFooter) — see tests/docs-marketing-chrome.test.tsx
 * for the analogous /docs regression test.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import * as React from "react";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(() => "/marketplace"),
}));

let mockIsSignedIn = false;
vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: vi.fn(() => ({ isSignedIn: mockIsSignedIn, isLoaded: true })),
}));

// LayoutShell pulls in a lot of app-wide chrome unrelated to this
// regression (background FX, companion widget, YouTube shell, etc.) —
// stub them out so this test isolates the hybrid-public branch only.
vi.mock("@/components/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => children,
}));
vi.mock("@/components/FooterWrapper", () => ({ default: () => null }));
vi.mock("@/components/CookieConsent", () => ({ default: () => null }));
vi.mock("@/components/UserSync", () => ({ default: () => null }));
vi.mock("@/components/AnimatedBackgroundWrapper", () => ({ default: () => null }));
vi.mock("@/components/ServiceWorkerRegistration", () => ({ default: () => null }));
vi.mock("@/components/companion/GlobalCompanion", () => ({ GlobalCompanion: () => null }));
vi.mock("@/components/youtube/YouTubePlayerShell", () => ({ YouTubePlayerShell: () => null }));

describe("LayoutShell hybrid-public chrome (signed-out /marketplace, /discover)", () => {
  it("renders the shared MarketingHeader and MarketingFooter, not a bare page", async () => {
    mockIsSignedIn = false;
    const { default: LayoutShell } = await import("@/components/LayoutShell");

    render(
      React.createElement(
        LayoutShell,
        {},
        React.createElement("div", { "data-testid": "hybrid-page-content" }, "marketplace content"),
      ),
    );

    // Header: brand link home + primary nav landmark — the way back to
    // "/" that was previously missing entirely.
    expect(screen.getByRole("link", { name: /LiTTree LabStudios home/i })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeTruthy();

    // Page content still renders, between header and footer.
    expect(screen.getByTestId("hybrid-page-content")).toBeTruthy();

    // Footer present too.
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toBeTruthy();
  });

  it("does NOT render the marketing header for signed-in visitors on the same route (AppShell owns nav)", async () => {
    mockIsSignedIn = true;
    const { default: LayoutShell } = await import("@/components/LayoutShell");

    render(
      React.createElement(
        LayoutShell,
        {},
        React.createElement("div", { "data-testid": "hybrid-page-content" }, "marketplace content"),
      ),
    );

    expect(screen.queryByRole("link", { name: /LiTTree LabStudios home/i })).toBeNull();
    expect(screen.getByTestId("hybrid-page-content")).toBeTruthy();
  });
});
