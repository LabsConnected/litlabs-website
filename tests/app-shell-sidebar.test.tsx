// @vitest-environment jsdom
/**
 * AppShell sidebar responsive regression tests.
 *
 * Verifies:
 *   - Expanded 256px sidebar at wide viewports (>=1280px)
 *   - Forced 72px icon rail at narrow desktop/tablet widths (768-1279px)
 *     so the sidebar never consumes most of the Studio viewport
 *   - Persisted collapse preference still honored at wide widths
 *   - Removed nav entries never render; core entries do
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, within, cleanup } from "@testing-library/react";
import * as React from "react";
import { AppShell } from "@/components/AppShell";
import { COLLAPSED_KEY } from "@/lib/navigation";

vi.mock("next/navigation", () => ({
  usePathname: () => "/studio",
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
    isLoaded: true,
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

function setViewportWidth(width: number) {
  globalThis.__TEST_VIEWPORT_WIDTH__ = width;
}

function getSidebar(): HTMLElement {
  const aside = document.querySelector("aside");
  expect(aside).not.toBeNull();
  return aside as HTMLElement;
}

describe("AppShell sidebar", () => {
  beforeEach(() => {
    cleanup();
    localStorage.clear();
    setViewportWidth(1440);
  });

  it("renders the expanded 256px sidebar at wide viewports", () => {
    setViewportWidth(1440);
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const aside = getSidebar();
    expect(aside.className).toContain("w-[256px]");
    expect(aside.getAttribute("data-collapsed")).toBe("false");
  });

  it("forces the 72px icon rail at narrow desktop widths even when the user preference is expanded", () => {
    setViewportWidth(1024);
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const aside = getSidebar();
    expect(aside.className).toContain("w-[72px]");
    expect(aside.getAttribute("data-collapsed")).toBe("true");
  });

  it("still honors the persisted collapse preference at wide widths", () => {
    localStorage.setItem(COLLAPSED_KEY, "true");
    setViewportWidth(1440);
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    expect(getSidebar().className).toContain("w-[72px]");
  });

  it("renders the required entries and none of the removed ones at wide widths", () => {
    setViewportWidth(1440);
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    const aside = getSidebar();
    const nav = within(aside);
    // "Studio" and "Create" appear as both section headers and item labels.
    for (const label of ["Dashboard", "Studio", "Create", "Games", "Discover", "Marketplace", "Wallet", "Settings"]) {
      expect(nav.getAllByText(label).length).toBeGreaterThanOrEqual(1);
    }
    for (const removed of ["Music", "Showcase", "Projects"]) {
      expect(nav.queryByText(removed)).toBeNull();
    }
    // Section headers present in the required order — the label is the
    // first div child of each section wrapper inside the nav.
    const headers = Array.from(aside.querySelectorAll("nav > div > div:first-child"))
      .map((el) => el.textContent);
    expect(headers).toEqual(["Command", "Studio", "Create", "Explore"]);
  });

  it("keeps layout overflow guards in place (shrink-0 rail, min-w-0 main)", () => {
    setViewportWidth(1440);
    render(
      <AppShell>
        <div>content</div>
      </AppShell>,
    );
    expect(getSidebar().className).toContain("shrink-0");
    const main = document.getElementById("main-content");
    expect(main).not.toBeNull();
    expect(main!.className).toContain("min-w-0");
    expect(main!.className).toContain("overflow-x-hidden");
  });
});
