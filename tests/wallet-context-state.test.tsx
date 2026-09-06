// @vitest-environment jsdom
/**
 * WalletContext state machine — tests the REAL WalletContext (not mocked).
 *
 * Behaviors under test:
 *  3. Real wallet balance 0 displays as 0 (not "unavailable").
 *  4. Failed wallet request displays "Credit balance unavailable."
 *
 * This file must NOT use vi.mock for WalletContext — it imports the
 * real implementation and drives it via mocked fetch.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import * as React from "react";

// WalletContext now gates /api/wallet on Clerk auth state (isLoaded && isSignedIn).
// These tests exercise the wallet fetch path, so mock the auth hook as signed in.
vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({
    isLoaded: true,
    isSignedIn: true,
    userId: "test-user-id",
    sessionClaims: undefined,
    getToken: async () => null,
    signOut: async () => {},
  }),
}));

function makeFetchMock(response: {
  ok: boolean;
  status?: number;
  json: () => Promise<unknown>;
}) {
  return vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 500),
    json: response.json,
  }) as unknown as typeof fetch;
}

async function renderWalletConsumer(fetchMock: typeof fetch) {
  vi.stubGlobal("fetch", fetchMock);
  vi.resetModules();
  const { WalletProvider, useWallet } = await import("@/context/WalletContext");

  const states: Array<{
    balance: number;
    isError: boolean;
    isLoading: boolean;
  }> = [];

  function Consumer() {
    const w = useWallet();
    states.push({
      balance: w.balance,
      isError: w.isError,
      isLoading: w.isLoading,
    });
    return null;
  }

  await act(async () => {
    render(
      React.createElement(
        WalletProvider,
        null,
        React.createElement(Consumer),
      ),
    );
  });

  return states;
}

describe("WalletContext state machine", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("balance 0 from API → balance=0, isError=false", async () => {
    const states = await renderWalletConsumer(
      makeFetchMock({
        ok: true,
        json: async () => ({ balance: 0, last_claim_date: null }),
      }),
    );

    // Advance past the fetch microtask + interval setup.
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    const final = states[states.length - 1];
    expect(final.isLoading).toBe(false);
    expect(final.balance).toBe(0);
    expect(final.isError).toBe(false);
  });

  it("fetch rejection → isError=true", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));

    vi.resetModules();
    const { WalletProvider, useWallet } = await import("@/context/WalletContext");

    const states: Array<{ isError: boolean; isLoading: boolean }> = [];
    function Consumer() {
      const w = useWallet();
      states.push({ isError: w.isError, isLoading: w.isLoading });
      return null;
    }

    await act(async () => {
      render(
        React.createElement(
          WalletProvider,
          null,
          React.createElement(Consumer),
        ),
      );
    });

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    const final = states[states.length - 1];
    expect(final.isError).toBe(true);
    expect(final.isLoading).toBe(false);
  });

  it("HTTP 500 → isError=true", async () => {
    const states = await renderWalletConsumer(
      makeFetchMock({
        ok: false,
        status: 500,
        json: async () => ({ error: "Failed" }),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    const final = states[states.length - 1];
    expect(final.isError).toBe(true);
  });

  it("HTTP 401 → isError=false (graceful sign-out, not an error)", async () => {
    const states = await renderWalletConsumer(
      makeFetchMock({
        ok: false,
        status: 401,
        json: async () => ({ error: "Unauthorized" }),
      }),
    );

    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    const final = states[states.length - 1];
    expect(final.isError).toBe(false);
    expect(final.balance).toBe(0);
  });
});
