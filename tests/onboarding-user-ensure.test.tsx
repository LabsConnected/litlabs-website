// @vitest-environment jsdom
/**
 * Onboarding user-ensure behavioral tests.
 *
 * Tests the UserEnsureProvider contract:
 *  1. Calls POST /api/user/ensure when the user becomes signed-in.
 *  2. Exposes `isNew` from the ensure response.
 *  3. Does NOT call ensure when not signed-in.
 *  4. Retries on failure (up to 3 attempts).
 *  5. Exposes error after all retries exhausted.
 *  6. Resets state on sign-out.
 *  7. Does not re-call ensure after success on re-render.
 *
 * Mocks external boundaries (fetch, Clerk auth) — not business behavior.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import * as React from "react";

// ─── Mocks ────────────────────────────────────────────────────────

let mockIsLoaded = false;
let mockIsSignedIn = false;

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({
    isLoaded: mockIsLoaded,
    isSignedIn: mockIsSignedIn,
    userId: mockIsSignedIn ? "test-clerk-id" : null,
    sessionClaims: undefined,
    getToken: vi.fn(async () => "test-token"),
    signOut: vi.fn(async () => {}),
  }),
}));

// Track fetch calls so tests can assert on them
let fetchCalls: { url: string; method: string }[] = [];
let fetchShouldFail = false;
let fetchResponseData: unknown = { success: true, isNew: true };

vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
  fetchCalls.push({ url, method: init?.method ?? "GET" });
  if (fetchShouldFail) {
    return {
      ok: false,
      status: 500,
      json: async () => ({ error: "Server error" }),
    } as Response;
  }
  return {
    ok: true,
    status: 200,
    json: async () => fetchResponseData,
  } as Response;
}));

// ─── Test consumer component ──────────────────────────────────────

function TestConsumer() {
  const { useUserEnsure } = require("@/context/UserEnsureContext");
  const state = useUserEnsure();
  return React.createElement(
    "div",
    {
      "data-testid": "ensure-state",
      "data-ensuring": String(state.ensuring),
      "data-ensured": String(state.ensured),
      "data-isnew": String(state.isNew),
      "data-error": state.error ?? "",
    },
    null,
  );
}

function renderProvider() {
  const { UserEnsureProvider } = require("@/context/UserEnsureContext");
  return render(
    React.createElement(
      UserEnsureProvider,
      null,
      React.createElement(TestConsumer),
    ),
  );
}

function getState() {
  const el = screen.getByTestId("ensure-state");
  return {
    ensuring: el.getAttribute("data-ensuring") === "true",
    ensured: el.getAttribute("data-ensured") === "true",
    isNew: el.getAttribute("data-isnew") === "true",
    error: el.getAttribute("data-error") || null,
  };
}

// ─── Tests ────────────────────────────────────────────────────────

describe("UserEnsureProvider", () => {
  beforeEach(() => {
    mockIsLoaded = false;
    mockIsSignedIn = false;
    fetchCalls = [];
    fetchShouldFail = false;
    fetchResponseData = { success: true, isNew: true };
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT call /api/user/ensure when not signed-in", async () => {
    mockIsLoaded = true;
    mockIsSignedIn = false;
    renderProvider();

    // Give it a moment — no fetch should fire
    await new Promise((r) => setTimeout(r, 100));

    const ensureCalls = fetchCalls.filter((c) => c.url === "/api/user/ensure");
    expect(ensureCalls).toHaveLength(0);
  });

  it("calls POST /api/user/ensure when user becomes signed-in", async () => {
    mockIsLoaded = true;
    mockIsSignedIn = true;
    renderProvider();

    await waitFor(() => {
      const ensureCalls = fetchCalls.filter(
        (c) => c.url === "/api/user/ensure" && c.method === "POST",
      );
      expect(ensureCalls.length).toBeGreaterThanOrEqual(1);
    });

    const state = getState();
    expect(state.ensured).toBe(true);
  });

  it("exposes isNew=true from the ensure response for new users", async () => {
    mockIsLoaded = true;
    mockIsSignedIn = true;
    fetchResponseData = { success: true, isNew: true };
    renderProvider();

    await waitFor(() => {
      expect(getState().ensured).toBe(true);
    });

    expect(getState().isNew).toBe(true);
  });

  it("exposes isNew=false for existing users", async () => {
    mockIsLoaded = true;
    mockIsSignedIn = true;
    fetchResponseData = { success: true, isNew: false };
    renderProvider();

    await waitFor(() => {
      expect(getState().ensured).toBe(true);
    });

    expect(getState().isNew).toBe(false);
  });

  it("retries on failure with exponential backoff (3 attempts total)", async () => {
    mockIsLoaded = true;
    mockIsSignedIn = true;
    fetchShouldFail = true;
    renderProvider();

    // Wait for all retries to complete (1s + 2s + processing = ~4s)
    // Use a generous timeout
    await waitFor(
      () => {
        const ensureCalls = fetchCalls.filter(
          (c) => c.url === "/api/user/ensure",
        );
        expect(ensureCalls).toHaveLength(3);
      },
      { timeout: 10000 },
    );

    // Wait a bit more for state to settle
    await new Promise((r) => setTimeout(r, 500));

    const state = getState();
    expect(state.ensured).toBe(false);
    expect(state.error).not.toBeNull();
  });

  it("does NOT re-call ensure after success", async () => {
    mockIsLoaded = true;
    mockIsSignedIn = true;
    renderProvider();

    await waitFor(() => {
      expect(getState().ensured).toBe(true);
    });

    const callsAfterSuccess = fetchCalls.filter(
      (c) => c.url === "/api/user/ensure",
    ).length;

    // Wait a while — no new calls should fire
    await new Promise((r) => setTimeout(r, 500));

    const callsAfterWait = fetchCalls.filter(
      (c) => c.url === "/api/user/ensure",
    ).length;

    expect(callsAfterWait).toBe(callsAfterSuccess);
  });

  it("resets state when user signs out", async () => {
    mockIsLoaded = true;
    mockIsSignedIn = true;
    const { rerender } = renderProvider();

    await waitFor(() => {
      expect(getState().ensured).toBe(true);
    });

    expect(getState().isNew).toBe(true);

    // Simulate sign-out
    mockIsSignedIn = false;
    rerender(
      React.createElement(
        require("@/context/UserEnsureContext").UserEnsureProvider,
        null,
        React.createElement(TestConsumer),
      ),
    );

    await waitFor(() => {
      expect(getState().ensured).toBe(false);
    });

    expect(getState().isNew).toBe(false);
    expect(getState().error).toBeNull();
  });
});
