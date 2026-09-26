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
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
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
    // to switch modes instead of opening the section. The locked label
    // names the (free) mode explicitly so locks are never mistaken for
    // a paywall (settings audit, 2026-09-26).
    const lockedTab = getTabButtons().find((b) =>
      b
        .getAttribute("aria-label")
        ?.includes("locked. Activate Pro mode (free) to unlock"),
    );
    expect(lockedTab).toBeDefined();
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

    fireEvent.change(screen.getByTestId("desktop-settings-search"), {
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

  it("uses a compact mobile selector instead of rendering mobile category tabs", () => {
    render(<SettingsPage />);

    expect(screen.getByTestId("mobile-settings-selector")).toBeTruthy();
    expect(screen.getByTestId("desktop-settings-sections").className).toContain("lg:flex");
    expect(screen.queryByRole("dialog", { name: "All settings" })).toBeNull();

    fireEvent.click(screen.getByTestId("mobile-settings-selector"));

    const sheet = screen.getByRole("dialog", { name: "All settings" });
    expect(within(sheet).getByText("Choose a category")).toBeTruthy();
    expect(within(sheet).getByRole("button", { name: "Workspace" })).toBeTruthy();
  });

  it("opens a category from the mobile sheet and exposes a back control", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByTestId("mobile-settings-selector"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "All settings" })).getByRole("button", { name: "Workspace" }));

    expect(screen.queryByRole("dialog", { name: "All settings" })).toBeNull();
    expect(screen.getByRole("button", { name: "Back to all settings" })).toBeTruthy();
    expect(within(screen.getByTestId("mobile-settings-content")).getByRole("heading", { name: "Workspace" })).toBeTruthy();
  });

  it("collapses settings search behind an icon on mobile", () => {
    render(<SettingsPage />);
    expect(screen.queryByTestId("mobile-settings-search")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Search settings" }));

    expect(screen.getByTestId("mobile-settings-search")).toBeTruthy();
  });

  it("shows a selected workspace profile with a radio state and persists it", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByTestId("mobile-settings-selector"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "All settings" })).getByRole("button", { name: "Workspace" }));

    const mobileContent = screen.getByTestId("mobile-settings-content");
    const builder = within(mobileContent).getByRole("radio", { name: "Builder workspace profile" });
    expect(builder.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(builder);
    expect(builder.getAttribute("aria-checked")).toBe("true");
    expect(JSON.parse(localStorage.getItem("littree:workspace-preferences") ?? "{}").defaultView).toBe("code");

    cleanup();
    render(<SettingsPage />);
    fireEvent.click(screen.getByTestId("mobile-settings-selector"));
    fireEvent.click(within(screen.getByRole("dialog", { name: "All settings" })).getByRole("button", { name: "Workspace" }));
    expect(within(screen.getByTestId("mobile-settings-content")).getByRole("radio", { name: "Builder workspace profile" }).getAttribute("aria-checked")).toBe("true");
  });

  it("reserves the mobile safe area for floating assistance and save actions", () => {
    useSettingsStore.setState({ hasUnsavedChanges: true });
    render(<SettingsPage />);

    const saveBar = screen.getByText("Save changes").parentElement as HTMLElement;
    expect(saveBar.className).toContain("env(safe-area-inset-bottom)");
    expect(screen.getByTestId("mobile-settings-content").className).toContain("safe-area-inset-bottom");
  });
});
