// @vitest-environment jsdom
/**
 * Marketplace state truth regression.
 *
 * Behavior under test:
 *  5. Marketplace distinguishes loading, empty, and error states.
 *
 * The marketplace page (src/app/(app)/marketplace/page.tsx) fetches
 * items from /api/marketplace/items via requestAnimationFrame. We use
 * real timers (rAF is not fakeable in jsdom) and waitFor for async
 * state transitions.
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
