// Marketplace is a consumer-quality discovery surface: one primary CTA per
// card (Install / Installed / Coming Soon), metadata (version, author,
// compatibility, beta) moved to the detail view, beta stated once at page
// level, and an Install button that only fires when the API reports
// item.installable (true only when the capability has a real executor).
import { render, screen, act, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

let signedIn = true;
const pushMock = vi.fn();

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
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

vi.mock("@/components/ProductPageFrame", () => ({
  ProductFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import MarketplacePage from "./page";

const BASE = {
  compatible_assistants: ["litt"],
  capability_key: "test.key",
  icon: "",
  is_official: true,
  is_beta: true,
  price_cents: 0,
  author_name: "LiTTree Labs",
  version: "1.0.0",
};

const ITEM_FEATURED = {
  ...BASE,
  id: "item0",
  slug: "brand-kit",
  name: "Brand Kit",
  description: "Makes brand kits",
  item_type: "creative_pack",
  category: "creative",
  status: "available",
  is_featured: true,
  required_connections: [],
  installable: false,
};

const ITEM_DEV = {
  ...BASE,
  id: "item1",
  slug: "code-review",
  name: "Code Review",
  description: "Reviews code for issues",
  item_type: "tool",
  category: "development",
  status: "available",
  is_featured: false,
  required_connections: ["github"],
  installable: false,
};

const ITEM_SOON = {
  ...BASE,
  id: "item2",
  slug: "vercel-deploy",
  name: "Vercel Deploy",
  description: "Deploys to Vercel",
  item_type: "integration",
  category: "integration",
  status: "coming_soon",
  is_featured: false,
  required_connections: ["vercel"],
  installable: false,
};

const ITEM_REAL = {
  ...BASE,
  id: "item3",
  slug: "real-executor",
  name: "Real Executor",
  description: "Actually does the thing",
  item_type: "workflow",
  category: "automation",
  status: "available",
  is_featured: false,
  required_connections: [],
  installable: true,
};

const ALL = [ITEM_FEATURED, ITEM_DEV, ITEM_SOON, ITEM_REAL];

// Fetch behaviour knobs per test
let itemsMode: "ok" | "empty" | "fail500" = "ok";
let installMode: "ok" | "fail500" = "ok";
let installationsMode: "empty" | "one" = "empty";

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
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/marketplace/items") {
      if (itemsMode === "fail500") return jsonResponse({}, { status: 500, ok: false });
      if (itemsMode === "empty") return jsonResponse({ items: [] });
      return jsonResponse({ items: ALL });
    }
    if (url === "/api/marketplace/installations" && init?.method === "POST") {
      if (installMode === "fail500") return jsonResponse({}, { status: 500, ok: false });
      return jsonResponse({ installation: { id: "inst9" } }, { status: 200 });
    }
    if (url === "/api/marketplace/installations") {
      if (installationsMode === "one") {
        return jsonResponse({
          installations: [{ id: "inst1", marketplace_item_id: "item3", enabled: true, installed_at: "2026-01-01" }],
        });
      }
      return jsonResponse({ installations: [] });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("marketplace discovery page", () => {
  beforeEach(() => {
    itemsMode = "ok";
    installMode = "ok";
    installationsMode = "empty";
    signedIn = true;
    pushMock.mockClear();
    vi.useRealTimers();
    installFetchMock();
  });

  it("shows the header: title, one beta badge, description, search, filters", async () => {
    render(<MarketplacePage />);
    expect(await screen.findByRole("heading", { name: "Marketplace" })).toBeInTheDocument();
    // Beta is stated exactly once, at page level — never on cards.
    expect(screen.getAllByText("Beta")).toHaveLength(1);
    expect(screen.getByText(/give LiTT new abilities/i)).toBeInTheDocument();
    expect(screen.getByRole("searchbox", { name: "Search capabilities" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "All" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "development" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Explore" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Installed" })).toBeInTheDocument();
  });

  it("renders the card hierarchy without registry metadata", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    // Hierarchy: icon+name, type, benefit description, requires, price, CTA.
    expect(screen.getByText("Tool")).toBeInTheDocument();
    expect(screen.getByText("Reviews code for issues")).toBeInTheDocument();
    expect(screen.getByText("Requires GitHub")).toBeInTheDocument();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    // Registry metadata stays off the cards.
    expect(screen.queryByText("v1.0.0")).not.toBeInTheDocument();
    expect(screen.queryByText("LiTTree Labs")).not.toBeInTheDocument();
    expect(screen.queryByText("Official")).not.toBeInTheDocument();
    expect(screen.queryByText("Works with")).not.toBeInTheDocument();
  });

  it("shows the requires line only when there is a critical dependency", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    expect(screen.getByText("Requires GitHub")).toBeInTheDocument();
    expect(screen.getByText("Requires Vercel")).toBeInTheDocument();
    // Brand Kit and Real Executor have no required connections: exactly two requires lines total.
    expect(screen.getAllByText(/^Requires /)).toHaveLength(2);
  });

  it("gives every card exactly one honest CTA", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    // installable item -> Install
    expect(screen.getByRole("button", { name: "Install Real Executor" })).toBeInTheDocument();
    // available but not installable -> Coming Soon (never a fake Install)
    const comingSoon = screen.getAllByRole("button", { name: /coming soon/i });
    expect(comingSoon.length).toBeGreaterThanOrEqual(2);
    expect(
      screen.queryByRole("button", { name: "Install Code Review" }),
    ).not.toBeInTheDocument();
  });

  it("shows Installed for installed items", async () => {
    installationsMode = "one";
    installFetchMock();
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    expect(
      screen.getByRole("button", { name: "Real Executor installed — manage" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Install Real Executor" }),
    ).not.toBeInTheDocument();
  });

  it("shows featured as a small horizontal row, then Explore", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    expect(screen.getByRole("region", { name: "Featured capabilities" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Explore capabilities" })).toBeInTheDocument();
    // Featured item appears once (in the row, not duplicated in Explore).
    expect(screen.getAllByText("Brand Kit")).toHaveLength(1);
  });

  it("navigates to the detail view when a card is clicked", async () => {
    render(<MarketplacePage />);
    const card = await screen.findByRole("link", { name: "View Code Review" });
    await act(async () => {
      fireEvent.click(card);
    });
    expect(pushMock).toHaveBeenCalledWith("/marketplace/code-review");
  });

  it("filters by search query", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    await act(async () => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search capabilities" }), {
        target: { value: "vercel" },
      });
    });
    expect(screen.getByText("Vercel Deploy")).toBeInTheDocument();
    expect(screen.queryByText("Code Review")).not.toBeInTheDocument();
    // Featured row hides while searching.
    expect(screen.queryByRole("region", { name: "Featured capabilities" })).not.toBeInTheDocument();
  });

  it("filters by category", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "integration" }));
    });
    expect(screen.getByText("Vercel Deploy")).toBeInTheDocument();
    expect(screen.queryByText("Code Review")).not.toBeInTheDocument();
  });

  it("Installed view shows only installed capabilities", async () => {
    installationsMode = "one";
    installFetchMock();
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Installed" }));
    });
    expect(screen.getByText("Real Executor")).toBeInTheDocument();
    expect(screen.queryByText("Code Review")).not.toBeInTheDocument();
  });

  it("Installed view asks signed-out users to sign in", async () => {
    signedIn = false;
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Installed" }));
    });
    expect(await screen.findByText(/sign in to see the capabilities/i)).toBeInTheDocument();
  });

  it("installs the installable item and toasts success", async () => {
    const { calls } = installFetchMock();
    render(<MarketplacePage />);
    const installButton = await screen.findByRole("button", { name: "Install Real Executor" });
    await act(async () => {
      installButton.click();
    });
    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.url).toBe("/api/marketplace/installations");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ itemId: "item3" });
    const toast = await screen.findByText("Real Executor installed");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveStyle({ backgroundColor: "#0a2e0a" });
  });

  it("shows an error toast when the install POST fails", async () => {
    installMode = "fail500";
    installFetchMock();
    render(<MarketplacePage />);
    const installButton = await screen.findByRole("button", { name: "Install Real Executor" });
    await act(async () => {
      installButton.click();
    });
    const toast = await screen.findByText("Install failed.");
    expect(toast).toBeInTheDocument();
    expect(toast).toHaveStyle({ backgroundColor: "#2e0a0a" });
    expect(screen.queryByText("Real Executor installed")).not.toBeInTheDocument();
  });

  it("shows the retry UI when items fail to load, and retry refetches", async () => {
    itemsMode = "fail500";
    installFetchMock();
    render(<MarketplacePage />);
    await screen.findByText("Marketplace couldn’t load.");
    itemsMode = "ok";
    await act(async () => {
      screen.getByRole("button", { name: "Retry" }).click();
    });
    await screen.findByText("Code Review");
  });

  it("shows an honest empty state when there are no items", async () => {
    itemsMode = "empty";
    installFetchMock();
    render(<MarketplacePage />);
    await screen.findByText("No capabilities listed yet. Check back soon.");
  });
});
