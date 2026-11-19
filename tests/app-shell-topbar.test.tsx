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

let mockPathname = "/projects";
let mockAuthLoaded = true;
vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

// GlobalLittEntry uses <dialog> which jsdom doesn't fully support.
// These tests verify AppShell chrome, not the LiTT dialog.
vi.mock("@/components/litt/GlobalLittEntry", () => ({
  default: () => null,
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    // The real useTheme returns the Theme object; AppShell reads
    // theme.mode to compute the effective mode for the top bar.
    theme: { mode: "dark" },
    resolvedColors: {
      bgColor: "#0a0a12",
      boxBg: "#14141f",
      borderColor: "#333344",
      textMuted: "#888899",
      textColor: "#ffffff",
      accentColor: "#72f238",
    },
  }),
  // Faithful copy of the real export's semantics (ThemeContext.tsx):
  // "system" follows the OS preference; explicit modes render as stored.
  resolveEffectiveMode: (mode: string, systemPrefersDark: boolean) =>
    mode === "system" ? (systemPrefersDark ? "dark" : "light") : mode,
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
    mockPathname = "/projects";
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
    // Canonical main pills (issue #627 Studio Merge) — including the five
    // destinations promoted out of the More overflow menu (Larry,
    // 2026-11-16). Assets/Agents/Missions/Create lost their own pills —
    // they are internal Studio surfaces now, reached from inside Studio,
    // not the global nav. There is still no Home pill: Studio is the
    // prime landing surface.
    for (const label of ["Studio", "Discover", "Projects", "Marketplace", "Games", "CLI", "Deployments", "Docs"]) {
      expect(scope.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    // Settings is NOT an inline pill anymore (Studio Finish Spec, Larry
    // 2026-11-14): it moved out of the top navigation into the account
    // menu, so it must not render in the bar while the account menu is
    // closed. Its account-menu home is covered
    // by tests/app-shell-navigation.test.ts.
    expect(scope.queryByText("Settings")).toBeNull();
    // The More overflow button is gone entirely (Larry, 2026-11-16).
    expect(scope.queryAllByTestId("nav-more")).toEqual([]);
    expect(scope.queryByText("More")).toBeNull();
  });

  it("renders the five promoted destinations inline with their real hrefs; no More menu exists", () => {
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const header = getHeader();
    // Promoted destinations are inline pills on both nav surfaces
    // (desktop row + mobile strip), linking to the exact hrefs the More
    // menu used. Games shows because retroGameRuntime is enabled
    // (feature-flags module is not mocked here, so real flag state
    // applies — games is enabled).
    const expected: Record<string, string> = {
      Marketplace: "/marketplace",
      Games: "/games",
      CLI: "/cli",
      Deployments: "/deployments",
      Docs: "/docs",
    };
    for (const [label, href] of Object.entries(expected)) {
      const links = Array.from(
        header.querySelectorAll(`a[href="${href}"]`),
      ) as HTMLElement[];
      expect(links.length).toBeGreaterThanOrEqual(2);
      for (const link of links) {
        expect(within(link).getByText(label)).toBeTruthy();
      }
    }
    // Non-nav destinations still do not render in the bar.
    for (const notNav of ["Wallet", "Showcase", "Music"]) {
      expect(within(header).queryByText(notNav)).toBeNull();
    }
    // No More button and no dropdown menu anywhere.
    expect(header.querySelector('[data-testid="nav-more"]')).toBeNull();
    expect(document.querySelector('[data-more-menu]')).toBeNull();
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("marks the current page with aria-current on every nav surface", () => {
    // /marketplace was a More destination until Larry's 2026-11-16
    // promotion — now its own pill carries aria-current directly.
    mockPathname = "/marketplace";
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    // Both surfaces (desktop inline nav + mobile strip) mark the
    // Marketplace pill as the current page, and no More button exists.
    const current = Array.from(
      getHeader().querySelectorAll('a[href="/marketplace"][aria-current="page"]'),
    );
    expect(current.length).toBeGreaterThanOrEqual(2);
    expect(getHeader().querySelector('[data-testid="nav-more"]')).toBeNull();
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
    // /voice and /agents because of it.
    //
    // Corrected contract: naming is prohibited on role="status" itself
    // too, so the placeholder must not carry an aria-label at all. The
    // conforming pattern is role="status" whose accessible text is its
    // content — a visually-hidden "Loading account" span inside the
    // status element. This test previously selected the placeholder BY
    // '[aria-label="Loading account"]', which enshrined the very
    // violation it guards against; it now selects by role and asserts
    // the prohibited attribute is gone while the announcement remains.
    mockAuthLoaded = false;
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const header = getHeader();
    const placeholder = header.querySelector('[role="status"]');
    expect(placeholder).not.toBeNull();
    // The prohibited pattern must be gone: no aria-label naming the
    // status element, anywhere in the header.
    expect(placeholder!.getAttribute("aria-label")).toBeNull();
    expect(
      header.querySelector('[aria-label="Loading account"]'),
    ).toBeNull();
    // The loading state is still announced accessibly — via the status
    // element's text content (the visually-hidden span).
    expect(placeholder!.textContent).toContain("Loading account");
  });
});
