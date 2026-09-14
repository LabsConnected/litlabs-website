// @vitest-environment jsdom
/**
 * Marketplace state truth regression.
 *
 * Behavior under test:
 *  5. Marketplace distinguishes loading, empty, and error states.
 *
 * The marketplace page (src/app/(app)/marketplace/page.tsx) fetches
 * items from /api/marketplace/items directly on mount (see the
 * requestAnimationFrame regression test below for why it must not be
 * deferred behind rAF). waitFor is used for the resulting async state
 * transitions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import * as React from "react";

// ─── Mocks ────────────────────────────────────────────────────────

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: vi.fn(() => ({
    isLoaded: true,
    isSignedIn: true,
    userId: "u1",
  })),
  useAppUser: vi.fn(() => ({ user: null })),
}));
vi.mock("@/context/ThemeContext", () => ({
  useTheme: vi.fn(() => ({
    resolvedColors: {
      bgColor: "#070812",
      textColor: "#ffffff",
      headerColor: "#ffffff",
      accentColor: "#f97316",
      borderColor: "#222222",
      boxBg: "#111111",
      textMuted: "#888888",
      linkColor: "#f97316",
    },
  })),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => "/marketplace"),
}));

// ─── Helpers ──────────────────────────────────────────────────────

function mockFetchItems(items: unknown[], opts?: { ok?: boolean; status?: number }) {
  const ok = opts?.ok ?? true;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/marketplace/items")) {
        if (!ok) {
          return Promise.resolve({
            ok: false,
            status: opts?.status ?? 500,
            json: async () => ({ error: "Server error" }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ items }),
        });
      }
      if (url.includes("/api/marketplace/installations")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ installations: [] }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({}),
      });
    }),
  );
}

const SAMPLE_ITEM = {
  id: "item-1",
  slug: "test-tool",
  name: "Test Tool",
  description: "A test tool for testing",
  item_type: "tool",
  category: "development",
  status: "available",
  compatible_assistants: ["litt"],
  capability_key: "test",
  version: "1.0.0",
  icon: "🔧",
  author_name: "Test Author",
  is_featured: false,
  is_official: true,
  is_beta: false,
  price_cents: 0,
  required_connections: [],
};

// ─── Tests ────────────────────────────────────────────────────────

describe("Marketplace state distinctions", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("times out and shows a retry action when the items fetch never settles", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    // Fetch that never resolves and never rejects — simulates a stalled
    // network / hung backend. It only settles if aborted.
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string, init?: { signal?: AbortSignal }) => {
        if (url.includes("/api/marketplace/items")) {
          return new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              const err = new Error("Aborted");
              err.name = "AbortError";
              reject(err);
            });
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ installations: [] }),
        });
      }),
    );

    const mod = await import("@/app/(app)/marketplace/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    // Before the timeout fires, it's still loading.
    expect(screen.getByText("Loading capabilities...")).toBeTruthy();

    // Fast-forward past the bounded fetch timeout — the fetch must abort
    // and the page must surface the existing error + Retry UI instead of
    // spinning forever.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000);
    });

    expect(screen.getByText(/Marketplace couldn.*load/)).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();

    vi.useRealTimers();
  });

  it("times out and shows a retry action when auth never reports isLoaded", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const useClerkAuthMock = vi.mocked((await import("@/hooks/useClerkAuth")).useClerkAuth);
    useClerkAuthMock.mockReturnValue({
      isLoaded: false,
      isSignedIn: false,
      userId: null,
      sessionClaims: undefined,
      getToken: vi.fn(),
      signOut: vi.fn(),
    });
    mockFetchItems([SAMPLE_ITEM]);

    const mod = await import("@/app/(app)/marketplace/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    expect(screen.getByText("Loading marketplace...")).toBeTruthy();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(
      screen.getByText("Marketplace is taking longer than expected to load."),
    ).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();

    vi.useRealTimers();
    // vi.clearAllMocks() (afterEach) resets call history but not a
    // mockReturnValue — restore the module's default so later tests get
    // a signed-in, loaded user again.
    useClerkAuthMock.mockReturnValue({
      isLoaded: true,
      isSignedIn: true,
      userId: "u1",
      sessionClaims: undefined,
      getToken: vi.fn(),
      signOut: vi.fn(),
    });
  });

  it("starts loading items without waiting on requestAnimationFrame", async () => {
    // Regression for the marketplace first-load stall: browsers pause
    // requestAnimationFrame entirely while a tab is backgrounded/hidden
    // (e.g. a link opened in a new background tab), so gating the very
    // first data fetch behind rAF could leave the page on the loading
    // skeleton forever — the fetch never even started, so the bounded
    // fetch timeout above never had anything in flight to abort. The
    // initial load must not depend on rAF ever firing.
    const rafSpy = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0);
    mockFetchItems([SAMPLE_ITEM]);

    const mod = await import("@/app/(app)/marketplace/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    await waitFor(() => {
      expect(screen.getByText("Test Tool")).toBeTruthy();
    });

    rafSpy.mockRestore();
  });

  it("shows a loading message while items are being fetched", async () => {
    // Delay the fetch response so the loading state is visible.
    let resolveFetch: ((value: unknown) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/marketplace/items")) {
          return new Promise<unknown>((resolve) => {
            resolveFetch = resolve;
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ installations: [] }),
        });
      }),
    );

    const mod = await import("@/app/(app)/marketplace/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    // The marketplace shows "Loading capabilities..." when items are
    // empty and loading is true. Wait for the rAF + render cycle.
    await waitFor(
      () => {
        expect(screen.getByText("Loading capabilities...")).toBeTruthy();
      },
      { timeout: 3000 },
    );

    // Clean up: resolve the pending fetch.
    const resolve = resolveFetch as ((value: unknown) => void) | null;
    if (resolve) {
      await act(async () => {
        resolve({
          ok: true,
          status: 200,
          json: async () => ({ items: [SAMPLE_ITEM] }),
        });
      });
    }
    resolveFetch = null;
  });

  it("shows an empty message when the API returns zero items", async () => {
    mockFetchItems([]);

    const mod = await import("@/app/(app)/marketplace/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    await waitFor(
      () => {
        expect(screen.getByText("No tools available yet.")).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it("shows an error message with Retry when the API fails", async () => {
    mockFetchItems([], { ok: false, status: 500 });

    const mod = await import("@/app/(app)/marketplace/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    await waitFor(
      () => {
        expect(screen.getByText(/Marketplace couldn.*load/)).toBeTruthy();
        expect(screen.getByText("Retry")).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });

  it("renders items when the API returns data", async () => {
    mockFetchItems([SAMPLE_ITEM]);

    const mod = await import("@/app/(app)/marketplace/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    await waitFor(
      () => {
        expect(screen.getByText("Test Tool")).toBeTruthy();
      },
      { timeout: 3000 },
    );
  });
});
