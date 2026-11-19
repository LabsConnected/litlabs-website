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
    // sr-only text is assistive-only live-region content (e.g. the
    // StudioShell role="status" announcement), not rendered fake
    // content — exclude it from the visible-copy scan.
    expect(
      screen.queryByText(new RegExp(s), { selector: ":not(.sr-only)" }),
    ).toBeNull();
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
  it("renders the board-shaped Studio entry skeleton by default", () => {
    render(<StudioShell />);
    // Corrected contract (axe aria-prohibited-attr): the root div's
    // implicit generic role cannot be named, so it must not carry an
    // aria-label at all. The conforming pattern is role="status" whose
    // accessible text is its content — a visually-hidden "Loading
    // Studio" span inside the status element. This test previously
    // asserted the aria-label, which enshrined the very violation the
    // /voice site audit guards against.
    const shell = screen.getByTestId("studio-shell");
    expect(shell).toHaveAttribute("role", "status");
    expect(shell).not.toHaveAttribute("aria-label");
    expect(shell.querySelector(".sr-only")).toHaveTextContent(
      "Loading Studio",
    );
    expect(screen.getByTestId("studio-shell")).toHaveAttribute(
      "data-layout",
      "board",
    );
    expect(screen.getByTestId("studio-shell-header")).toBeInTheDocument();
    // The board area holds floating panel placeholders; the chat
    // placeholder is one panel among them (its top-center board
    // slot), never a lone centered column, and the retired 2-zone
    // chrome (bottom dock / mobile nav) is gone.
    const board = screen.getByTestId("studio-shell-board");
    expect(board).toBeInTheDocument();
    expect(board.contains(screen.getByTestId("studio-shell-chat"))).toBe(true);
    expect(screen.getByTestId("studio-shell-panel-preview")).toBeInTheDocument();
    expect(screen.getByTestId("studio-shell-panel-files")).toBeInTheDocument();
    expect(screen.getByTestId("studio-shell-panel-media")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-shell-dock")).not.toBeInTheDocument();
    expect(screen.queryByTestId("studio-shell-mobile-nav")).not.toBeInTheDocument();
    expect(screen.queryByTestId("studio-shell-classic")).not.toBeInTheDocument();
    expectNoFakeContent();
  });

  it("renders the classic (Regular) entry skeleton when chosen", () => {
    render(<StudioShell layout="classic" />);
    expect(screen.getByTestId("studio-shell")).toHaveAttribute(
      "data-layout",
      "classic",
    );
    expect(screen.getByTestId("studio-shell-header")).toBeInTheDocument();
    // Chat placeholder in its real in-flow left column, workspace
    // main beside it.
    const classic = screen.getByTestId("studio-shell-classic");
    expect(classic.contains(screen.getByTestId("studio-shell-chat"))).toBe(true);
    expect(screen.getByTestId("studio-shell-workspace")).toBeInTheDocument();
    expect(screen.queryByTestId("studio-shell-board")).not.toBeInTheDocument();
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
