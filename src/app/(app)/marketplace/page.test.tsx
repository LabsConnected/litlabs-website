// Public marketplace page is a server component: the catalog (or the
// empty/failure state) must be in the initial HTML — no "Loading
// marketplace..." shell, no Clerk/auth initialization. These tests render
// the resolved server-component output and assert each state.
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: async () =>
    new Map([
      ["host", "www.litlabs.net"],
      ["x-forwarded-proto", "https"],
    ]),
}));

vi.mock("next/link", () => ({
  default: ({
    children,
    href,
  }: {
    children: React.ReactNode;
    href: string;
  }) => <a href={href}>{children}</a>,
}));

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

import MarketplacePage from "./page";

async function renderPage() {
  const ui = await MarketplacePage();
  return render(ui);
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe("MarketplacePage (public SSR)", () => {
  it("renders the catalog in the initial HTML when items exist", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [
          {
            id: "item-1",
            name: "Test Agent",
            description: "Does test things.",
          },
        ],
      }),
    });

    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Marketplace", level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText("Test Agent")).toBeInTheDocument();
    expect(screen.getByText("Does test things.")).toBeInTheDocument();
    expect(screen.queryByText(/loading marketplace/i)).not.toBeInTheDocument();
  });

  it("renders the truthful early-access empty state server-side", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });

    await renderPage();

    expect(
      screen.getByRole("heading", { name: "Marketplace", level: 1 }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/the first agents and workflows are being added now/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/loading marketplace/i)).not.toBeInTheDocument();
  });

  it("renders the empty state when the API is non-OK", async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });

    await renderPage();

    expect(
      screen.getByText(/the first agents and workflows are being added now/i),
    ).toBeInTheDocument();
  });

  it("renders a failure state server-side when the fetch throws", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));

    await renderPage();

    expect(
      screen.getByText(/the marketplace couldn.t load right now/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/loading marketplace/i)).not.toBeInTheDocument();
  });

  it("fetches the catalog from the same host over https", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });

    await renderPage();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toBe("https://www.litlabs.net/api/marketplace/items");
  });
});
