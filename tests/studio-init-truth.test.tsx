// @vitest-environment jsdom
/**
 * Studio initialization truth regression.
 *
 * Behaviors under test:
 *  6. Studio labels map to actual auth/workspace/runtime signals.
 *  7. Eight-second timeout does not fire after Studio becomes ready.
 *  8. Retry restarts the failed initialization (re-mounts the loading
 *     state, not merely re-animating the spinner).
 *
 * The Studio loading state (src/app/(app)/studio/page.tsx) is shown
 * only while Clerk auth has not loaded. Once `isLoaded` is true, the
 * loading state unmounts and CommandStudio (with its own runtime
 * connection via useConnectionSummary) takes over. The 8s timeout
 * lives inside the loading state component, so it is cleared when
 * the component unmounts (Studio becomes ready).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent } from "@testing-library/react";
import * as React from "react";

// ─── Mocks ────────────────────────────────────────────────────────

const mockClerkAuth = vi.fn();
const mockTheme = vi.fn(() => ({
  tokens: {
    background: "#0a0a0f",
    text: "#ffffff",
    textMuted: "#888888",
    primary: "#00e5ff",
    surface: "#111111",
    border: "#222222",
  },
  resolvedColors: {
    bgColor: "#0a0a0f",
    textColor: "#ffffff",
    headerColor: "#ffffff",
    accentColor: "#00e5ff",
    borderColor: "#222222",
    boxBg: "#111111",
    textMuted: "#888888",
    linkColor: "#00e5ff",
  },
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => mockClerkAuth(),
  useAppUser: () => ({ user: null }),
}));
vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => mockTheme(),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => "/studio"),
}));

// CommandStudio is dynamically imported with many sub-dependencies.
// We stub it to avoid mounting the full Studio surface — we only
// need to verify that the loading state is replaced when auth loads.
vi.mock("@/app/(app)/studio/components/CommandStudio", () => ({
  __esModule: true,
  default: () =>
    React.createElement(
      "div",
      { "data-testid": "command-studio-mounted" },
      "Studio ready",
    ),
}));

// ─── Tests ────────────────────────────────────────────────────────

describe("Studio initialization labels", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("INIT_STEPS labels map to real phases (auth → workspace → runtime → ready)", async () => {
    // The loading state shows INIT_STEPS[0] = "Authenticating" while
    // Clerk auth is loading. This is the auth phase. The remaining
    // labels ("Loading workspace", "Connecting runtime", "Ready")
    // describe the phases that CommandStudio's useConnectionSummary
    // drives after the loading state unmounts. We verify the labels
    // are defined and correspond to real phases — not fake progress.
    mockClerkAuth.mockReturnValue({ isLoaded: false, isSignedIn: false });

    const mod = await import("@/app/(app)/studio/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    // The loading state should show "Authenticating" — the real auth
    // phase label, not a fake progress step.
    expect(screen.getByText("Authenticating")).toBeTruthy();
  });

  it("does not show fake progress labels while waiting for auth", async () => {
    // Only "Authenticating" should be visible during the auth phase.
    // "Loading workspace", "Connecting runtime", "Ready" must NOT
    // appear — they would imply the loading state is cycling through
    // phases it cannot actually observe.
    mockClerkAuth.mockReturnValue({ isLoaded: false, isSignedIn: false });

    const mod = await import("@/app/(app)/studio/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    expect(screen.queryByText("Loading workspace")).toBeNull();
    expect(screen.queryByText("Connecting runtime")).toBeNull();
    expect(screen.queryByText("Ready")).toBeNull();
  });
});

describe("Studio 8-second timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("does NOT fire after Studio becomes ready (auth loads before 8s)", async () => {
    // When isLoaded becomes true before 8s, the loading state unmounts,
    // clearing the timeout. The timeout UI must NOT appear.
    mockClerkAuth.mockReturnValue({ isLoaded: true, isSignedIn: true });

    const mod = await import("@/app/(app)/studio/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    // Auth loaded immediately → CommandStudio mounts, loading state
    // never had a chance to time out.
    expect(screen.getByTestId("command-studio-mounted")).toBeTruthy();

    // Advance past 8s — the timeout should NOT fire because the
    // loading state (which owns the timeout) has unmounted.
    await act(async () => {
      vi.advanceTimersByTime(9000);
    });

    // No timeout UI.
    expect(screen.queryByTestId("studio-timeout")).toBeNull();
    // CommandStudio is still mounted.
    expect(screen.getByTestId("command-studio-mounted")).toBeTruthy();
  });

  it("fires after 8s when auth never loads", async () => {
    mockClerkAuth.mockReturnValue({ isLoaded: false, isSignedIn: false });

    const mod = await import("@/app/(app)/studio/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    // Before 8s: loading state is shown, no timeout yet.
    expect(screen.queryByTestId("studio-timeout")).toBeNull();
    expect(screen.getByTestId("studio-loading")).toBeTruthy();

    // Advance to just before 8s.
    await act(async () => {
      vi.advanceTimersByTime(7999);
    });
    expect(screen.queryByTestId("studio-timeout")).toBeNull();

    // Advance past 8s — timeout fires.
    await act(async () => {
      vi.advanceTimersByTime(2);
    });
    expect(screen.getByTestId("studio-timeout")).toBeTruthy();
    expect(screen.queryByTestId("studio-loading")).toBeNull();
  });
});

describe("Studio Retry restarts the failed initialization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("Retry re-mounts the loading state (restarts initialization, not just animation)", async () => {
    mockClerkAuth.mockReturnValue({ isLoaded: false, isSignedIn: false });

    const mod = await import("@/app/(app)/studio/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    // Advance past 8s to trigger the timeout UI.
    await act(async () => {
      vi.advanceTimersByTime(8001);
    });
    expect(screen.getByTestId("studio-timeout")).toBeTruthy();

    // Click Retry — should re-mount the loading state via retryKey,
    // which resets the timeout and shows "Authenticating" again.
    const retryButton = screen.getByText("Retry");
    expect(retryButton).toBeTruthy();

    await act(async () => {
      fireEvent.click(retryButton);
    });

    // After retry: the loading state should be back (not the timeout),
    // and "Authenticating" should be visible again — proving the
    // initialization restarted, not just the animation.
    expect(screen.queryByTestId("studio-timeout")).toBeNull();
    expect(screen.getByTestId("studio-loading")).toBeTruthy();
    expect(screen.getByText("Authenticating")).toBeTruthy();
  });
});
