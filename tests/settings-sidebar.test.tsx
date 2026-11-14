// @vitest-environment jsdom
/**
 * Settings sidebar regression tests (replaces settings-top-tabs.test.tsx).
 *
 * Product direction 2026-11-13 (Settings redesign Phase 2, following the
 * Phase 1 audit): /settings adopts the shared LiTTAppShell frame — the
 * horizontal tab strip is gone, sections navigate through a grouped
 * sidebar rendered from SETTINGS_GROUPS / SETTINGS_SECTIONS, and below
 * the lg breakpoint the same sidebar lives in the shell's drawer. This
 * reverses the 2026-09-15 top-bar direction the old test pinned.
 * Verifies:
 *   - A sidebar renders with every section, grouped as the store defines
 *   - The active section is marked with aria-current
 *   - All sections are directly accessible (no mode locks)
 *   - Sidebar search filters the section list
 *   - Clicking a section switches the active section
 *   - The mobile drawer opens from the shell trigger and navigates
 *   - Section ids are unchanged (deep links key off them)
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
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    theme: "light",
    resolvedColors: {
      bgColor: "#f6f8f3",
      boxBg: "#ffffff",
      borderColor: "#445544",
      textMuted: "#5c6b5c",
      textColor: "#142114",
      accentColor: "#2f9e44",
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
  useStudioModelStore: () => ({ selectedModel: null, providerHealth: {} }),
  MODELS: [],
}));

function getDesktopSidebar(): HTMLElement {
  const aside = document.querySelector("aside");
  expect(aside).not.toBeNull();
  return aside as HTMLElement;
}

function getSidebarNav(scope?: HTMLElement): HTMLElement {
  const root = scope ?? getDesktopSidebar();
  const nav = within(root).getByTestId("settings-sidebar-sections");
  return nav;
}

function getSidebarButtons(scope?: HTMLElement): HTMLButtonElement[] {
  return Array.from(getSidebarNav(scope).querySelectorAll("button"));
}

describe("SettingsPage sidebar (LiTTAppShell frame)", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    useSettingsStore.setState({
      activeSection: "overview",
      searchQuery: "",
    });
  });

  it("renders sections in a sidebar — no top tab strip", () => {
    render(<SettingsPage />);
    const aside = getDesktopSidebar();
    expect(aside.getAttribute("aria-label")).toBe("Settings sections");
    expect(getSidebarButtons().length).toBe(SETTINGS_SECTIONS.length);
  });

  it("renders a sidebar entry for every settings section, grouped by the store model", () => {
    render(<SettingsPage />);
    const nav = getSidebarNav();
    const labels = getSidebarButtons().map((b) => b.textContent ?? "");
    for (const section of SETTINGS_SECTIONS) {
      expect(
        labels.some((t) => t.includes(section.label)),
        `missing sidebar entry for section "${section.label}"`,
      ).toBe(true);
    }
    // AI & Models sits inside the Advanced group, not as a top-level peer.
    const advancedGroup = within(nav).getByTestId("settings-sidebar-group-advanced");
    expect(advancedGroup.textContent).toContain("AI & Models");
    expect(advancedGroup.textContent).toContain("Diagnostics");
    const appGroup = within(nav).getByTestId("settings-sidebar-group-app");
    expect(appGroup.textContent).not.toContain("AI & Models");
  });

  it("marks the active section with aria-current", () => {
    render(<SettingsPage />);
    const current = getSidebarNav().querySelector('[aria-current="page"]');
    expect(current).not.toBeNull();
    expect(current!.textContent).toContain("Overview");
  });

  it("makes every section directly accessible — no mode locks", () => {
    render(<SettingsPage />);
    const buttons = getSidebarButtons();
    expect(buttons.length).toBe(SETTINGS_SECTIONS.length);
    for (const button of buttons) {
      expect(button.getAttribute("aria-label") ?? "").not.toContain("unlock");
      expect(button.getAttribute("aria-label") ?? "").not.toContain("locked");
    }
    const aiModels = buttons.find((b) => b.textContent?.includes("AI & Models"));
    expect(aiModels).not.toBeNull();
    fireEvent.click(aiModels!);
    expect(useSettingsStore.getState().activeSection).toBe("ai-models");
  });

  it("filters sections through the sidebar search", () => {
    render(<SettingsPage />);
    expect(getSidebarButtons().length).toBe(SETTINGS_SECTIONS.length);

    fireEvent.change(screen.getByTestId("settings-sidebar-search"), {
      target: { value: "billing" },
    });

    const labels = getSidebarButtons().map((b) => b.textContent ?? "");
    expect(labels.length).toBe(1);
    expect(labels[0]).toContain("Billing");
  });

  it("switches the active section when a sidebar entry is clicked", () => {
    render(<SettingsPage />);
    const account = getSidebarButtons().find((b) =>
      b.textContent?.includes("Account"),
    );
    expect(account).not.toBeNull();

    fireEvent.click(account!);
    expect(useSettingsStore.getState().activeSection).toBe("account");

    const current = getSidebarNav().querySelector('[aria-current="page"]');
    expect(current!.textContent).toContain("Account");
  });

  it("opens the section drawer from the shell trigger on small screens", () => {
    render(<SettingsPage />);
    expect(screen.queryByRole("dialog", { name: "Settings sections" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Settings sections" }));

    const dialog = screen.getByRole("dialog", { name: "Settings sections" });
    expect(within(dialog).getByTestId("settings-sidebar-sections")).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Workspace" })).toBeTruthy();
  });

  it("opens a category from the drawer and shows its content", () => {
    render(<SettingsPage />);
    fireEvent.click(screen.getByRole("button", { name: "Settings sections" }));
    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Settings sections" })).getByRole("button", { name: "Workspace" }),
    );

    expect(screen.queryByRole("dialog", { name: "Settings sections" })).toBeNull();
    expect(useSettingsStore.getState().activeSection).toBe("workspace");
    // The section header renders in the shell's header slot above the content.
    expect(screen.getByRole("heading", { name: "Workspace" })).toBeTruthy();
  });

  it("shows a selected workspace profile with a radio state and persists it", () => {
    render(<SettingsPage />);
    fireEvent.click(
      getSidebarButtons().find((b) => b.textContent?.includes("Workspace"))!,
    );

    const content = screen.getByTestId("settings-content");
    const builder = within(content).getByRole("radio", { name: "Builder workspace profile" });
    expect(builder.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(builder);
    expect(builder.getAttribute("aria-checked")).toBe("true");
    expect(JSON.parse(localStorage.getItem("littree:workspace-preferences") ?? "{}").defaultView).toBe("code");

    cleanup();
    render(<SettingsPage />);
    fireEvent.click(
      getSidebarButtons().find((b) => b.textContent?.includes("Workspace"))!,
    );
    expect(within(screen.getByTestId("settings-content")).getByRole("radio", { name: "Builder workspace profile" }).getAttribute("aria-checked")).toBe("true");
  });

  it("renders no floating save bar — settings persist without a global save model", () => {
    // PR-E: the global SaveBar was dead code (setUnsaved(true) was never
    // called); every settings surface persists its own changes. No
    // "Save changes" / "Saved to account" / "Discard" UI may exist.
    render(<SettingsPage />);
    expect(screen.queryByText("Save changes")).toBeNull();
    expect(screen.queryByText("Saved to account")).toBeNull();
    expect(screen.queryByText("Discard")).toBeNull();
    expect(screen.getByTestId("settings-content").className).toContain("safe-area-inset-bottom");
  });
});
