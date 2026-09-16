// @vitest-environment jsdom
/**
 * Settings top-bar conversion regression tests.
 *
 * Product direction 2026-09-15: the app nav lives in a top bar
 * everywhere. /settings used to bypass AppShell (LayoutShell
 * OWN_SHELL_PATHS) and render its own 260px desktop sidebar. It now
 * renders inside AppShell and navigates its sections through a
 * horizontal sticky tab strip under the top bar. Verifies:
 *   - No <aside> sidebar renders on the settings page at any viewport
 *   - The sticky section-tab strip renders with every section
 *   - The active section tab is marked with aria-current
 *   - Locked sections keep the unlock-on-click behavior
 *   - Strip search filters the tabs
 *   - Clicking a tab switches the active section
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as React from "react";
import SettingsPage from "@/app/(app)/settings/page";
import {
  useSettingsStore,
  SETTINGS_SECTIONS,
} from "@/stores/useSettingsStore";

vi.mock("next/navigation", () => ({
  usePathname: () => "/settings",
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

vi.mock("@clerk/nextjs", () => ({
  useClerk: () => ({}),
  useUser: () => ({ user: null, isLoaded: true, isSignedIn: false }),
}));

vi.mock("@/context/ClerkAuthContext", () => ({
  useClerkAuthContext: () => ({
    isSignedIn: false,
    isLoaded: true,
    sessionClaims: null,
  }),
}));

vi.mock("@/app/(app)/studio/hooks/useConnectionSummary", () => ({
  useConnectionSummary: () => ({
    capabilities: { connectedProviders: [], terminalStatus: "disconnected" },
  }),
}));

vi.mock("@/app/(app)/studio/stores/useStudioModelStore", () => ({
  useStudioModelStore: () => ({ selectedModel: null }),
  MODELS: [],
}));

function getTabStrip(): HTMLElement {
  const nav = document.querySelector('nav[aria-label="Settings sections"]');
  expect(nav).not.toBeNull();
  return nav as HTMLElement;
}

function getTabButtons(): HTMLButtonElement[] {
  return Array.from(getTabStrip().querySelectorAll("button"));
}

describe("SettingsPage top-bar conversion", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useSettingsStore.setState({
      controlMode: "standard",
      activeSection: "overview",
      searchQuery: "",
      hasUnsavedChanges: false,
    });
  });

  it("renders no left sidebar — sections navigate through the top tab strip", () => {
    render(<SettingsPage />);
    expect(document.querySelector("aside")).toBeNull();
    // The sticky tab strip sits directly under the AppShell top bar:
    // 56px bar + 48px mobile nav strip on small screens, 56px bar on md+.
    const strip = getTabStrip().parentElement as HTMLElement;
    expect(strip.className).toContain("sticky");
    expect(strip.className).toContain("top-[104px]");
    expect(strip.className).toContain("md:top-14");
  });

  it("renders a tab for every settings section", () => {
    render(<SettingsPage />);
    const labels = getTabButtons().map((b) => b.textContent ?? "");
    for (const section of SETTINGS_SECTIONS) {
      expect(
        labels.some((t) => t.includes(section.label)),
        `missing tab for section "${section.label}"`,
      ).toBe(true);
    }
  });

  it("marks the active section tab with aria-current", () => {
    render(<SettingsPage />);
    const current = getTabStrip().querySelector('[aria-current="page"]');
    expect(current).not.toBeNull();
    expect(current!.textContent).toContain("Overview");
  });

  it("keeps the locked-section unlock behavior (click switches control mode)", () => {
    render(<SettingsPage />);
    // "AI & Models" requires pro mode; in standard mode its tab offers
    // to switch modes instead of opening the section.
    const lockedTab = getTabButtons().find((b) =>
      b.getAttribute("aria-label")?.includes("switch to Pro mode to unlock"),
    );
    expect(lockedTab).not.toBeNull();
    expect(lockedTab!.textContent).toContain("AI & Models");

    fireEvent.click(lockedTab!);
    expect(useSettingsStore.getState().controlMode).toBe("pro");

    // After unlocking, the tab becomes a regular section tab.
    const unlockedTab = getTabButtons().find((b) =>
      b.textContent?.includes("AI & Models"),
    );
    expect(unlockedTab).not.toBeNull();
    expect(unlockedTab!.getAttribute("aria-label") ?? "").not.toContain(
      "unlock",
    );
  });

  it("filters tabs through the strip search", () => {
    render(<SettingsPage />);
    expect(getTabButtons().length).toBe(SETTINGS_SECTIONS.length);

    fireEvent.change(screen.getByLabelText("Search settings"), {
      target: { value: "billing" },
    });

    const labels = getTabButtons().map((b) => b.textContent ?? "");
    expect(labels.length).toBe(1);
    expect(labels[0]).toContain("Billing");
  });

  it("switches the active section when a tab is clicked", () => {
    render(<SettingsPage />);
    const accountTab = getTabButtons().find((b) =>
      b.textContent?.includes("Account"),
    );
    expect(accountTab).not.toBeNull();

    fireEvent.click(accountTab!);
    expect(useSettingsStore.getState().activeSection).toBe("account");

    const current = getTabStrip().querySelector('[aria-current="page"]');
    expect(current!.textContent).toContain("Account");
  });
});
