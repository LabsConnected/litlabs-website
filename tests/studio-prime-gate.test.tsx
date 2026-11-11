// @vitest-environment jsdom
/**
 * Studio prime gate (ART-20261110-029).
 *
 * Studio is the one signed-in landing surface:
 *  - Bare /studio (no params) for a user WITH projects renders the
 *    prime landing: the universal create launcher (BuildConsole —
 *    the same component the retired dashboard used) + recent projects.
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

describe("Studio prime gate", () => {
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

  it("bare /studio renders the prime landing with the create launcher", async () => {
    const mod = await import("@/app/(app)/studio/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });
    expect(screen.getByTestId("studio-prime-landing")).toBeTruthy();
    // The universal composer itself — launcher parity with the retired
    // dashboard (same BuildConsole component, same testid).
    expect(screen.getByTestId("dashboard-composer")).toBeTruthy();
    expect(screen.queryByTestId("command-studio-mounted")).toBeNull();
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
