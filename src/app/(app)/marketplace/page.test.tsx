// P1-4: uninstall must only claim success when the server confirms deletion.
// The page used to remove the item from state and toast "removed" before the
// DELETE response was even checked — a failed DELETE still read as success.
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    resolvedColors: {
      bgColor: "#070812",
      textColor: "#ffffff",
      accentColor: "#a3e635",
      linkColor: "#a3e635",
      borderColor: "#222222",
      boxBg: "#111111",
      textMuted: "#888888",
      headerColor: "#ffffff",
    },
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => ({ get: () => null }),
}));

vi.mock("@/components/ProductPageFrame", () => ({
  ProductFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./_components/AgentCard", () => ({
  AgentCard: () => null,
}));

import MarketplacePage from "./page";

const ITEM = {
  id: "item1",
  slug: "test-tool",
  name: "Test Tool",
  description: "A test marketplace tool",
  item_type: "tool",
  category: "development",
  status: "available",
  compatible_assistants: ["litt"],
  capability_key: "test_tool",
  version: "1.0.0",
  icon: "wrench",
  author_name: null,
  is_featured: false,
  is_official: true,
  is_beta: false,
  price_cents: 0,
  required_connections: [],
};

const INSTALLATION = {
  id: "inst1",
  marketplace_item_id: "item1",
  enabled: true,
  installed_at: "2026-09-18T00:00:00.000Z",
};

// DELETE behaviour knob per test: "ok" | "fail500" | "throw"
let deleteMode: "ok" | "fail500" | "throw" = "ok";

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return {
    ok,
    status,
    json: async () => body,
  } as Response;
}

function installFetchMock() {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/marketplace/items") return jsonResponse({ items: [ITEM] });
    if (url === "/api/marketplace/installations") return jsonResponse({ installations: [INSTALLATION] });
    if (url === "/api/connections") return jsonResponse({ overview: [] });
    if (url === "/api/marketplace/installations/inst1" && init?.method === "DELETE") {
      if (deleteMode === "throw") throw new Error("network down");
      if (deleteMode === "fail500")
        return jsonResponse({}, { status: 500, ok: false });
      return jsonResponse({ deleted: true }, { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function renderWithInstall() {
  render(<MarketplacePage />);
  // Wait for the item + installed card to appear after the three loads.
  const removeButton = await screen.findByRole("button", { name: "Uninstall Test Tool" });
  return removeButton;
}

describe("P1-4 marketplace uninstall honesty", () => {
  beforeEach(() => {
    deleteMode = "ok";
    vi.useRealTimers();
    installFetchMock();
  });

  it("removes the item and toasts success only after the server confirms (DELETE 200)", async () => {
    const removeButton = await renderWithInstall();
    await act(async () => {
      removeButton.click();
    });
    // Item is gone from installed state → the card offers Install again.
    await screen.findByRole("button", { name: "Install Test Tool" });
    expect(screen.queryByRole("button", { name: "Uninstall Test Tool" })).not.toBeInTheDocument();
    const toast = await screen.findByText("Test Tool removed");
    expect(toast).toBeInTheDocument();
    // Success toast styling (green), not error red.
    expect(toast).toHaveStyle({ backgroundColor: "#0a2e0a" });
  });

  it("keeps the item installed and shows an error when the backend rejects the DELETE (500)", async () => {
    deleteMode = "fail500";
    const removeButton = await renderWithInstall();
    await act(async () => {
      removeButton.click();
    });
    // Error is visible…
    const toast = await screen.findByText("Could not remove Test Tool. Please try again.");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveStyle({ backgroundColor: "#2e0a0a" });
    // …and the item is still installed: the Remove button remains, no success toast.
    expect(screen.getByRole("button", { name: "Uninstall Test Tool" })).toBeInTheDocument();
    expect(screen.queryByText("Test Tool removed")).not.toBeInTheDocument();
  });

  it("keeps the item installed and shows an error when the network throws", async () => {
    deleteMode = "throw";
    const removeButton = await renderWithInstall();
    await act(async () => {
      removeButton.click();
    });
    const toast = await screen.findByText(
      "Network error while removing Test Tool. It is still installed — please try again.",
    );
    expect(toast).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Uninstall Test Tool" })).toBeInTheDocument();
    expect(screen.queryByText("Test Tool removed")).not.toBeInTheDocument();
  });

  it("supports retry: fail then succeed ends removed with a success toast", async () => {
    deleteMode = "fail500";
    await renderWithInstall();
    await act(async () => {
      screen.getByRole("button", { name: "Uninstall Test Tool" }).click();
    });
    await screen.findByText("Could not remove Test Tool. Please try again.");
    // Retry succeeds.
    deleteMode = "ok";
    await act(async () => {
      screen.getByRole("button", { name: "Uninstall Test Tool" }).click();
    });
    await screen.findByRole("button", { name: "Install Test Tool" });
    expect(await screen.findByText("Test Tool removed")).toBeInTheDocument();
  });
});
