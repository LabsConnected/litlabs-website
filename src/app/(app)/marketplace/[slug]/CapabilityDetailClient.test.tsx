// Capability detail view: version, compatibility, requirements, provider,
// permissions-adjacent info and changelog live here — off the cards.
import { render, screen, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

let signedIn = true;

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ isLoaded: true, isSignedIn: signedIn }),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
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

import CapabilityDetailClient from "./CapabilityDetailClient";

const ITEM = {
  id: "item1",
  slug: "code-review",
  name: "Code Review",
  description: "Reviews code for issues",
  item_type: "tool",
  category: "development",
  status: "available",
  compatible_assistants: ["litt", "spark"],
  capability_key: "github.code_review",
  version: "1.0.0",
  icon: "",
  author_name: "LiTTree Labs",
  is_featured: false,
  is_official: true,
  is_beta: true,
  price_cents: 0,
  required_connections: ["github"],
  installable: true,
};

let installations: unknown[] = [];
let installShouldFail = false;

function jsonResponse(body: unknown, init: { status?: number; ok?: boolean } = {}) {
  const status = init.status ?? 200;
  const ok = init.ok ?? (status >= 200 && status < 300);
  return { ok, status, json: async () => body } as Response;
}

function mockFetch() {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url === "/api/marketplace/items") return jsonResponse({ items: [ITEM] });
    if (url === "/api/marketplace/installations" && init?.method === "POST") {
      if (installShouldFail) return jsonResponse({}, { status: 500, ok: false });
      return jsonResponse({ installation: { id: "inst9" } });
    }
    if (url === "/api/marketplace/installations") return jsonResponse({ installations });
    if (url.startsWith("/api/marketplace/installations/") && init?.method === "DELETE") {
      return jsonResponse({});
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

describe("capability detail view", () => {
  beforeEach(() => {
    signedIn = true;
    installations = [];
    installShouldFail = false;
    vi.useRealTimers();
    mockFetch();
  });

  it("renders the hero and the detail sections", async () => {
    render(<CapabilityDetailClient slug="code-review" />);
    expect(await screen.findByRole("heading", { name: "Code Review" })).toBeInTheDocument();
    expect(screen.getByText("Reviews code for issues")).toBeInTheDocument();
    expect(screen.getByText("Tool")).toBeInTheDocument();
    // Beta stated once on this page.
    expect(screen.getAllByText("Beta")).toHaveLength(1);
    // Details section: version, compatibility, requirements, provider, price.
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("LiTT · Spark")).toBeInTheDocument();
    expect(screen.getByText("GitHub")).toBeInTheDocument();
    expect(screen.getByText("LiTTree Labs")).toBeInTheDocument();
    expect(screen.getByText("Official")).toBeInTheDocument();
    expect(screen.getAllByText("Free").length).toBeGreaterThan(0);
    // Honest empty changelog.
    expect(screen.getByText("No changelog published yet.")).toBeInTheDocument();
  });

  it("installs from the detail view and shows Installed", async () => {
    const { calls } = mockFetch();
    render(<CapabilityDetailClient slug="code-review" />);
    const installButton = await screen.findByRole("button", { name: "Install Code Review" });
    await act(async () => {
      installButton.click();
    });
    const post = calls.find((c) => c.init?.method === "POST");
    expect(post?.url).toBe("/api/marketplace/installations");
    expect(await screen.findByText("Installed")).toBeInTheDocument();
    expect(await screen.findByText("Code Review installed")).toBeInTheDocument();
  });

  it("shows Coming Soon for non-installable capabilities", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/marketplace/items") {
        return jsonResponse({ items: [{ ...ITEM, installable: false }] });
      }
      return jsonResponse({ installations: [] });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<CapabilityDetailClient slug="code-review" />);
    expect(await screen.findByText("Coming Soon")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /install code review/i })).not.toBeInTheDocument();
  });

  it("removes an installed capability", async () => {
    installations = [{ id: "inst1", marketplace_item_id: "item1", enabled: true, installed_at: "2026-01-01" }];
    const { calls } = mockFetch();
    render(<CapabilityDetailClient slug="code-review" />);
    expect(await screen.findByText("Installed")).toBeInTheDocument();
    const removeButton = await screen.findByRole("button", { name: "Remove" });
    await act(async () => {
      removeButton.click();
    });
    const del = calls.find((c) => c.init?.method === "DELETE");
    expect(del?.url).toBe("/api/marketplace/installations/inst1");
    expect(await screen.findByText("Code Review removed")).toBeInTheDocument();
  });

  it("shows a not-found state for an unknown slug", async () => {
    render(<CapabilityDetailClient slug="nope" />);
    expect(await screen.findByText(/doesn’t exist/)).toBeInTheDocument();
  });
});
