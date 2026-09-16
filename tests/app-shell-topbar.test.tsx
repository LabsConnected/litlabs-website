// @vitest-environment jsdom
/**
 * AppShell top-bar navigation regression tests.
 *
 * Product direction 2026-09-15: the app nav lives in a top bar
 * everywhere. The left sidebar, mobile drawer, and mobile bottom bar
 * are gone. Verifies:
 *   - No <aside> sidebar renders at any viewport
 *   - Sticky top bar header with logo + primary nav + identity dock
 *   - Required entries render; removed/flag-gated ones do not
 *   - Current page is marked with aria-current="page"
 *   - Studio keeps a single-row bar (its own mobile chrome; no strip)
 *   - Layout overflow guards stay in place
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, within, cleanup } from "@testing-library/react";
import * as React from "react";
import { AppShell } from "@/components/AppShell";

let mockPathname = "/dashboard";
let mockAuthLoaded = true;
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "dark",
    resolvedColors: {
      bgColor: "#0a0a12",
      boxBg: "#14141f",
      borderColor: "#333344",
      textMuted: "#888899",
      textColor: "#ffffff",
      accentColor: "#72f238",
    },
  }),
}));

vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 100 }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({
    isSignedIn: true,
    isLoaded: mockAuthLoaded,
    userId: "u1",
    signOut: vi.fn(),
  }),
  useAppUser: () => ({
    user: { id: "u1", firstName: "Test", username: "test", role: "Member" },
  }),
}));

vi.mock("@/hooks/useLittHealth", () => ({
  useLittHealth: () => ({
    status: "online",
    pulse: true,
    color: "#22c55e",
    label: "LiTT Online",
  }),
}));

vi.mock("@/components/branding/BrandLogo", () => ({
  BrandLogo: () => <div data-testid="brand-logo" />,
}));

function getHeader(): HTMLElement {
  const header = document.querySelector("header");
  expect(header).not.toBeNull();
  return header as HTMLElement;
}

describe("AppShell top bar", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    mockPathname = "/dashboard";
    mockAuthLoaded = true;
  });

  it("renders no left sidebar — navigation lives in a sticky top bar", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    expect(document.querySelector("aside")).toBeNull();
    const header = getHeader();
    expect(header.className).toContain("sticky");
    expect(header.className).toContain("top-0");
    // Logo + identity dock present
    expect(within(header).getByTestId("brand-logo")).toBeTruthy();
    expect(header.querySelector('button[title="Test"]')).not.toBeNull();
  });

  it("shows the primary nav inline with the required entries", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const header = getHeader();
    const scope = within(header);
    for (const label of ["Dashboard", "Studio", "Projects", "Explore", "Marketplace", "Wallet", "Settings"]) {
      expect(scope.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("renders none of the removed entries; Games shows now that the flag is on", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const scope = within(getHeader());
    // Create lived in the old mobile bottom bar; Music/Showcase
    // were removed from nav earlier. Games is back on (retroGameRuntime
    // enabled), so it must appear.
    for (const removed of ["Create", "Music", "Showcase"]) {
      expect(scope.queryByText(removed)).toBeNull();
    }
    expect(scope.getAllByText("Games").length).toBeGreaterThanOrEqual(1);
  });

  it("marks the current page with aria-current on every nav surface", () => {
    mockPathname = "/discover";
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const current = Array.from(
      getHeader().querySelectorAll('[aria-current="page"]'),
    );
    // Desktop inline nav + mobile scroll strip both mark Discover
    expect(current.length).toBeGreaterThanOrEqual(2);
    for (const el of current) {
      expect(el.textContent).toContain("Explore");
    }
  });

  it("keeps a single-row bar on Studio (its own mobile chrome, no strip)", () => {
    mockPathname = "/studio";
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    // Only the desktop inline nav renders; the mobile strip is skipped
    expect(
      getHeader().querySelectorAll('nav[aria-label="Primary"]').length,
    ).toBe(1);
    // Studio fills exactly the space below the bar
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("flex-1");
  });

  it("keeps the Studio global bar in normal flow so its top edge cannot clip", () => {
    mockPathname = "/studio";
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const header = getHeader();
    expect(header.className).toContain("relative");
    expect(header.className).not.toContain("sticky");
    expect(header.className).toContain("shrink-0");
  });

  it("keeps layout overflow guards in place (min-w-0 main, no sideways scroll)", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("min-w-0");
    expect(main!.className).toContain("overflow-x-hidden");
  });

  it("gives the account loading placeholder an accessible role (axe aria-prohibited-attr regression)", () => {
    // The identity dock renders a pulsing placeholder while auth loads.
    // An aria-label on a role-less element is an axe critical/serious
    // violation (aria-prohibited-attr) — CI's site-audit scan failed on
    // /voice and /agents because of it. role="status" keeps the accessible
    // name legal.
    mockAuthLoaded = false;
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const placeholder = getHeader().querySelector(
      '[aria-label="Loading account"]',
    );
    expect(placeholder).not.toBeNull();
    expect(placeholder!.getAttribute("role")).toBe("status");
  });
});
