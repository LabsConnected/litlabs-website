/**
 * Regression: the server-rendered Marketplace hero hardcoded white text
 * (text-white / text-white-55 / lime-300), which is invisible on the
 * Light Signature background — the 2026-11-15 live proof found the hero
 * heading white-on-white in Light mode. The hero now colors itself from
 * the theme CSS variables ThemeContext publishes (--header-color,
 * --text-color, --link-color, --accent-color, --border-color), which
 * resolve dark-on-light in Light mode and light-on-charcoal in Dark.
 */
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/public-marketplace", () => ({
  getPublicMarketplaceItems: vi.fn(async () => []),
}));

vi.mock("@/components/ProductPageFrame", () => ({
  ProductFrame: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ProductFrameHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("./MarketplaceClient", () => ({
  default: () => null,
}));

import MarketplacePage from "./page";

describe("Marketplace server hero theming", () => {
  it("colors the heading from the theme header variable, never hardcoded white", async () => {
    const ui = await MarketplacePage();
    render(ui);
    const heading = screen.getByRole("heading", { name: "Marketplace" });
    expect(heading.style.color).toBe("var(--header-color)");
    expect(heading.className).not.toContain("text-white");
  });
});
