// @vitest-environment jsdom
/**
 * Studio one-chat entry gate (ART-20261111-031).
 *
 * Supersedes the Studio prime gate (ART-20261110-029) under Larry's
 * one-chat directive (2026-11-11): the "What do you want to make?"
 * hub page must go — Studio opens straight into the main chat.
 *  - Bare /studio (no params) for a user WITH projects renders the
 *    CommandStudio workspace (the one chat) directly. The prime
 *    landing (hub) is never rendered.
 *  - Any deep link (?project=, ?tool=, ?prompt=…) renders the
 *    CommandStudio workspace exactly as before.
 *  - Users with NO projects keep the first-run welcome.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import * as React from "react";

const nav = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
}));

const mockClerkAuth = vi.fn();

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => mockClerkAuth(),
  useAppUser: () => ({ user: null }),
}));
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    tokens: {
      background: "#0a0a0f",
      text: "#ffffff",
      textMuted: "#888888",
      primary: "#00e5ff",
      surface: "#111111",
      border: "#222222",
    },
    // The landing components consume the full hook shape since the
    // layout/theme wave (ART-20261111-004): theme.mode +
    // resolvedColors. Values are inert — this gate tests routing.
    theme: { mode: "light" },
    resolvedColors: {
      accentColor: "#177A36",
      boxBg: "#ffffff",
      bgColor: "#ffffff",
      borderColor: "#CFDEC4",
      textColor: "#0E1510",
      textMuted: "#5c6b5e",
    },
  }),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.searchParams,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/studio",
}));
vi.mock("@/app/(app)/studio/components/CommandStudio", () => ({
  __esModule: true,
  default: () =>
    React.createElement("div", { "data-testid": "command-studio-mounted" }, "Studio ready"),
}));
vi.mock("@/app/(app)/studio/components/FirstRunWelcome", () => ({
  __esModule: true,
  default: () =>
    React.createElement("div", { "data-testid": "first-run-welcome" }, "Welcome"),
}));

describe("Studio one-chat entry gate", () => {
  beforeEach(() => {
    nav.searchParams = new URLSearchParams();
    mockClerkAuth.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      userId: "user_1",
      getToken: async () => null,
    });
    // No backend in jsdom: the project check fetch fails, and StudioHub
    // treats a failed check as "has projects" (never blocks real users).
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("bare /studio renders the one-chat workspace — the hub landing is gone", async () => {
    const mod = await import("@/app/(app)/studio/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });
    // Straight into the main chat surface (mocked CommandStudio).
    expect(screen.getByTestId("command-studio-mounted")).toBeTruthy();
    // The hub composition never renders: no prime landing, no
    // "What do you want to make?" create box, no hub composer.
    expect(screen.queryByTestId("studio-prime-landing")).toBeNull();
    expect(screen.queryByTestId("dashboard-composer")).toBeNull();
    expect(screen.queryByText("What do you want to make?")).toBeNull();
  });

  it("a describe deep link (?prompt=) renders the workspace, not the landing", async () => {
    nav.searchParams = new URLSearchParams("tool=chat&prompt=A%20website%20for%20my%20bakery");
    const mod = await import("@/app/(app)/studio/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });
    expect(screen.getByTestId("command-studio-mounted")).toBeTruthy();
    expect(screen.queryByTestId("studio-prime-landing")).toBeNull();
  });

  it("a project deep link renders the workspace, not the landing", async () => {
    nav.searchParams = new URLSearchParams("project=proj_1");
    const mod = await import("@/app/(app)/studio/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });
    expect(screen.getByTestId("command-studio-mounted")).toBeTruthy();
    expect(screen.queryByTestId("studio-prime-landing")).toBeNull();
  });
});
