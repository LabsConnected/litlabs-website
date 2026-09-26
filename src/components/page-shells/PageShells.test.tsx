import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

import DiscoverShell from "./DiscoverShell";
import StudioShell from "./StudioShell";
import DashboardShell from "./DashboardShell";
import ProfileShell from "./ProfileShell";

// Lime-canonical theme tokens — the shells must inherit brand from these,
// never hardcode their own accent.
const TOKENS = {
  background: "#050812",
  surface: "#080c17",
  surfaceElevated: "#0d1220",
  border: "#1c2438",
  text: "#f5f5f7",
  textMuted: "#8b93a7",
  textInverse: "#050812",
  primary: "#a8ff2f",
  secondary: "#b6ff5c",
  success: "#25e08a",
  warning: "#ffb020",
  danger: "#ef4444",
  focus: "#a8ff2f",
};

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ tokens: TOKENS }),
}));

// Off-brand hexes that must never appear in a shell's rendered output.
// Accents come from the (lime) theme; anything here means a hardcoded drift.
const OFF_BRAND_HEXES = [
  "a855f7", // purple (old profile button)
  "8b5cf6",
  "9b4dff",
  "c084fc",
  "d946ef", // fuchsia/pink
  "ec4899",
  "38bdf8", // sky/cyan
  "22d3ee",
  "06b6d4",
  "0ea5e9",
];

function expectNoFakeContent() {
  const html = document.body.innerHTML;
  // No fake people, posts, projects, or welcome copy.
  for (const s of [
    "Loading Discover",
    "Loading Studio",
    "Loading Dashboard",
    "Loading Profile",
    "Welcome",
    "AI Creator",
    "John Doe",
    "Example Post",
    "My Project",
  ]) {
    expect(screen.queryByText(new RegExp(s))).toBeNull();
  }
  expect(html).not.toMatch(/john|example@|lorem/i);
  // No off-brand hardcoded accent drift.
  for (const hex of OFF_BRAND_HEXES) {
    expect(html.toLowerCase()).not.toContain(hex);
  }
}

describe("DiscoverShell", () => {
  it("renders the truthful Discover layout regions", () => {
    render(<DiscoverShell />);
    expect(screen.getByTestId("discover-shell")).toHaveAttribute(
      "aria-label",
      "Loading Discover feed",
    );
    expect(screen.getByTestId("discover-shell-header")).toBeInTheDocument();
    expect(screen.getByTestId("discover-shell-composer")).toBeInTheDocument();
    expect(screen.getByTestId("discover-shell-tabs")).toBeInTheDocument();
    const posts = screen.getByTestId("discover-shell-posts");
    // 3 post cards × (avatar + 2 meta + 2 body + media + 5 reactions) shimmer blocks
    expect(posts.querySelectorAll(".animate-pulse").length).toBeGreaterThan(20);
    expectNoFakeContent();
  });
});

describe("StudioShell", () => {
  it("renders the canvas-first 2-zone Studio chrome", () => {
    render(<StudioShell />);
    expect(screen.getByTestId("studio-shell")).toHaveAttribute(
      "aria-label",
      "Loading Studio",
    );
    expect(screen.getByTestId("studio-shell-header")).toBeInTheDocument();
    expect(screen.getByTestId("studio-shell-chat")).toBeInTheDocument();
    expect(screen.getByTestId("studio-shell-workspace")).toBeInTheDocument();
    expect(screen.getByTestId("studio-shell-dock")).toBeInTheDocument();
    expect(screen.getByTestId("studio-shell-mobile-nav")).toBeInTheDocument();
    expectNoFakeContent();
  });
});

describe("DashboardShell", () => {
  it("renders the v3 launchpad composition regions", () => {
    render(<DashboardShell />);
    expect(screen.getByTestId("dashboard-shell")).toHaveAttribute(
      "aria-label",
      "Loading Dashboard",
    );
    // Utility row (Home + Search/Developer pills), the universal composer
    // card with its shortcut chips, recent projects — no ops telemetry,
    // no pulsebar, no hero.
    expect(screen.getByTestId("dashboard-shell-utility")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-shell-composer")).toBeInTheDocument();
    // 7 creation-type shortcut chip skeletons.
    expect(
      screen.getByTestId("dashboard-shell-chips").childElementCount,
    ).toBe(7);
    expect(screen.getByTestId("dashboard-shell-recent-work")).toBeInTheDocument();
    expect(screen.getByTestId("dashboard-shell-mediadock")).toBeInTheDocument();
    expect(
      screen.queryByTestId("dashboard-shell-pulsebar"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("dashboard-shell-recent-media"),
    ).not.toBeInTheDocument();
    expectNoFakeContent();
  });
});

describe("ProfileShell", () => {
  it("renders the profile layout regions", () => {
    render(<ProfileShell />);
    expect(screen.getByTestId("profile-shell")).toHaveAttribute(
      "aria-label",
      "Loading Profile",
    );
    expect(screen.getByTestId("profile-shell-cover")).toBeInTheDocument();
    expect(screen.getByTestId("profile-shell-identity")).toBeInTheDocument();
    expect(screen.getByTestId("profile-shell-tabs")).toBeInTheDocument();
    expect(screen.getByTestId("profile-shell-overview")).toBeInTheDocument();
    expect(screen.getByTestId("profile-shell-right-rail")).toBeInTheDocument();
    expect(screen.getByTestId("profile-shell-action-panel")).toBeInTheDocument();
    expectNoFakeContent();
  });
});
