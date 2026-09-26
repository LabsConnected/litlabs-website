// Marketplace is now an honest roadmap page: every item shows its real
// status, and an Install button renders ONLY when the API reports
// item.installable (true only when the capability has a real executor).
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

vi.mock("@/components/ProductPageFrame", () => ({
  ProductFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import MarketplacePage from "./page";

const BASE = {
  slug: "x",
  compatible_assistants: ["litt"],
  capability_key: "test.key",
  icon: "",
  is_featured: false,
  is_official: true,
  is_beta: false,
  price_cents: 0,
  required_connections: [],
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
  version: "1.0.0",
  author_name: "LiTTree Labs",
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
  version: "0.9.0",
  author_name: "LiTTree Labs",
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
  version: "2.0.0",
  author_name: "LiTTree Labs",
  installable: true,
};

// Fetch behaviour knobs per test
let itemsMode: "ok" | "empty" | "fail500" = "ok";
let installMode: "ok" | "fail500" = "ok";

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
      return jsonResponse({ items: [ITEM_DEV, ITEM_SOON, ITEM_REAL] });
    }
    if (url === "/api/marketplace/installations" && init?.method === "POST") {
      if (installMode === "fail500") return jsonResponse({}, { status: 500, ok: false });
      return jsonResponse({ installation: { id: "inst9" } }, { status: 200 });
    }
    if (url === "/api/marketplace/installations") return jsonResponse({ installations: [] });
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("marketplace roadmap page", () => {
  beforeEach(() => {
    itemsMode = "ok";
    installMode = "ok";
    vi.useRealTimers();
    installFetchMock();
  });

  it("shows the honest header and subtitle", async () => {
    render(<MarketplacePage />);
    expect(await screen.findByRole("heading", { name: "Marketplace" })).toBeInTheDocument();
    expect(
      await screen.findByText(/installable here the moment they’re real/i),
    ).toBeInTheDocument();
  });

  it("lists every item with type, category, description, author and version", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    expect(screen.getByText("Vercel Deploy")).toBeInTheDocument();
    expect(screen.getByText("Real Executor")).toBeInTheDocument();
    // Type · category labels
    expect(screen.getByText("Tool")).toBeInTheDocument();
    expect(screen.getByText("Integration")).toBeInTheDocument();
    expect(screen.getByText("Workflow")).toBeInTheDocument();
    // Description, author, version
    expect(screen.getByText("Reviews code for issues")).toBeInTheDocument();
    expect(screen.getAllByText("LiTTree Labs").length).toBeGreaterThan(0);
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("v0.9.0")).toBeInTheDocument();
  });

  it("badges coming_soon items as Coming soon and everything else as In development", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getAllByText("In development")).toHaveLength(2);
  });

  it("renders an Install button only for the installable item", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    expect(
      screen.getByRole("button", { name: "Install Real Executor" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Install Code Review" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Install Vercel Deploy" }),
    ).not.toBeInTheDocument();
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
    // Retry succeeds once the backend recovers.
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

  it("has no stats pills, tabs, filters, search, or pricing UI", async () => {
    render(<MarketplacePage />);
    await screen.findByText("Code Review");
    expect(screen.queryByText("Available")).not.toBeInTheDocument();
    expect(screen.queryByText("Installed")).not.toBeInTheDocument();
    expect(screen.queryByText("Beta Access")).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/search/i)).not.toBeInTheDocument();
    expect(screen.queryByText("Featured")).not.toBeInTheDocument();
    expect(screen.queryByText("Starter")).not.toBeInTheDocument();
  });
});
