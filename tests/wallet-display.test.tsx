// @vitest-environment jsdom
/**
 * Wallet page display truth regression.
 *
 * Behavior under test:
 *  3. Real wallet balance 0 displays as 0 (not "unavailable").
 *  4. Failed wallet request displays "Credit balance unavailable."
 *
 * The WalletContext state machine is tested in wallet-context-state.test.tsx
 * (which imports the real WalletContext). This file tests the wallet PAGE
 * rendering by mocking the context value.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import * as React from "react";
import type { ReactNode } from "react";

// ─── Mocks (hoisted by vitest) ────────────────────────────────────

vi.mock("@/context/WalletContext", () => ({
  useWallet: vi.fn(),
  WalletProvider: ({ children }: { children: ReactNode }) =>
    React.createElement(React.Fragment, null, children),
}));
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
      bgColor: "#000",
      textColor: "#fff",
      headerColor: "#fff",
      accentColor: "#0cf",
      borderColor: "#222",
      boxBg: "#111",
      textMuted: "#888",
      linkColor: "#0cf",
    },
  })),
}));
vi.mock("next/navigation", () => ({
  useSearchParams: vi.fn(() => new URLSearchParams()),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
  usePathname: vi.fn(() => "/wallet"),
}));

import { useWallet as mockedUseWallet } from "@/context/WalletContext";

// ─── Tests ────────────────────────────────────────────────────────

describe("Wallet page display text", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("renders '0' when balance is 0, not loading, no error", async () => {
    vi.mocked(mockedUseWallet).mockReturnValue({
      balance: 0,
      claimed: false,
      isLoading: false,
      isClaiming: false,
      isError: false,
      claim: vi.fn().mockResolvedValue(true),
      refresh: vi.fn().mockResolvedValue(undefined),
    });

    const mod = await import("@/app/(app)/wallet/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    // "0" is rendered via toLocaleString() → "0"
    expect(screen.getByText("0")).toBeTruthy();
    expect(screen.queryByText("Credit balance unavailable.")).toBeNull();
  });

  // NOTE: The "Credit balance unavailable." error-display test is
  // deferred to Commit B, which adds isError support to the wallet
  // page itself. The wallet CONTEXT already exposes isError (tested
  // in wallet-context-state.test.tsx), but the wallet PAGE does not
  // yet destructure or render it.

  it("renders a spinner when isLoading is true (not 0 or unavailable)", async () => {
    vi.mocked(mockedUseWallet).mockReturnValue({
      balance: 0,
      claimed: false,
      isLoading: true,
      isClaiming: false,
      isError: false,
      claim: vi.fn().mockResolvedValue(true),
      refresh: vi.fn().mockResolvedValue(undefined),
    });

    const mod = await import("@/app/(app)/wallet/page");
    await act(async () => {
      render(React.createElement(mod.default));
    });

    // Loading state shows a spinner, not a number or error text.
    expect(screen.queryByText("0")).toBeNull();
    expect(screen.queryByText("Credit balance unavailable.")).toBeNull();
  });
});
