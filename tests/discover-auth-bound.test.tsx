// @vitest-environment jsdom
/**
 * Discover auth-loading bound regression.
 *
 * Behavior under test: /discover must never sit on the Clerk
 * `!isLoaded` spinner forever. After AUTH_LOAD_TIMEOUT_MS it must show
 * a real fallback with a working Retry, and recover when auth
 * eventually loads.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, fireEvent, cleanup } from "@testing-library/react";
import * as React from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import DiscoverPage from "@/app/(app)/discover/page";

const mockUseClerkAuth = vi.mocked(useClerkAuth);

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: vi.fn(),
}));
vi.mock("@/context/ThemeContext", () => ({
  useTheme: vi.fn(() => ({
    tokens: {
      background: "#000000",
      surface: "#111111",
      border: "#333333",
      text: "#ffffff",
      textMuted: "#888888",
      primary: "#ff6600",
    },
  })),
}));
vi.mock("@/components/feed/Feed", () => ({
  Feed: React.forwardRef(function MockFeed() {
    return <div data-testid="discover-feed">feed</div>;
  }),
}));
vi.mock("@/components/feed/Composer", () => ({
  Composer: () => <div data-testid="discover-composer">composer</div>,
}));

function setAuth(state: { isLoaded: boolean; isSignedIn?: boolean }) {
  mockUseClerkAuth.mockReturnValue({
    isLoaded: state.isLoaded,
    isSignedIn: state.isSignedIn ?? false,
    userId: state.isSignedIn ? "u1" : null,
  } as ReturnType<typeof useClerkAuth>);
}

describe("Discover auth-loading bound", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setAuth({ isLoaded: true, isSignedIn: true });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("renders the discover feed once auth is loaded (signed in)", () => {
    render(<DiscoverPage />);
    expect(screen.getByTestId("discover-feed")).toBeTruthy();
    expect(screen.getByTestId("discover-composer")).toBeTruthy();
  });

  it("renders the discover feed when signed out", () => {
    setAuth({ isLoaded: true, isSignedIn: false });
    render(<DiscoverPage />);
    expect(screen.getByTestId("discover-feed")).toBeTruthy();
    expect(screen.queryByTestId("discover-composer")).toBeNull();
    expect(
      screen.getByRole("link", { name: /sign in/i }),
    ).toBeTruthy();
  });

  it("shows the loading UI while auth is initializing", () => {
    setAuth({ isLoaded: false });
    render(<DiscoverPage />);
    expect(screen.getByText(/loading discover feed/i)).toBeTruthy();
  });

  it("stops spinning and shows a retry fallback when auth load stalls", () => {
    setAuth({ isLoaded: false });
    render(<DiscoverPage />);

    act(() => {
      vi.advanceTimersByTime(9000);
    });

    expect(
      screen.getByText(/taking longer than expected/i),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: /retry/i })).toBeTruthy();
    // The unbounded spinner/loading copy must be gone.
    expect(screen.queryByText(/loading discover feed/i)).toBeNull();
  });

  it("retry re-arms the bound instead of leaving a dead fallback", () => {
    // window.location.reload is non-configurable in jsdom so it cannot
    // be stubbed; the observable half of the retry contract is that the
    // page resets to the loading state and re-arms the timeout — and
    // surfaces the fallback again if auth still has not loaded.
    setAuth({ isLoaded: false });
    render(<DiscoverPage />);
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(screen.getByText(/taking longer than expected/i)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /retry/i }));

    // Back to loading while the (real) reload / re-init proceeds.
    expect(screen.getByText(/loading discover feed/i)).toBeTruthy();
    expect(screen.queryByText(/taking longer than expected/i)).toBeNull();

    // Still stalled after another bound → fallback returns, never stuck.
    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(screen.getByText(/taking longer than expected/i)).toBeTruthy();
  });

  it("recovers to the feed if auth finishes loading after the bound", () => {
    setAuth({ isLoaded: false });
    const { rerender } = render(<DiscoverPage />);

    act(() => {
      vi.advanceTimersByTime(9000);
    });
    expect(screen.getByText(/taking longer than expected/i)).toBeTruthy();

    setAuth({ isLoaded: true, isSignedIn: true });
    act(() => {
      rerender(<DiscoverPage />);
    });

    expect(screen.getByTestId("discover-feed")).toBeTruthy();
    expect(screen.queryByText(/taking longer than expected/i)).toBeNull();
  });
});
