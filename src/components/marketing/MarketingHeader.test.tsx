import { render, screen, within, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

vi.mock("@/lib/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("./BrandMark", () => ({
  default: () => <span data-testid="brand-mark" />,
}));

import MarketingHeader from "./MarketingHeader";

// Larry's site audit (2026-09-23 round 2): nav cut to four items —
// Studio · Capabilities · Pricing · Docs. Labels and hrefs must match.
const EXPECTED_ORDER = ["Studio", "Capabilities", "Pricing", "Docs"];

const EXPECTED_HREFS = ["/studio", "/#what-we-do", "/pricing", "/docs"];

describe("MarketingHeader nav order (audit round 2)", () => {
  it("renders the desktop nav with exactly the four required items", () => {
    render(<MarketingHeader />);
    const nav = screen.getByLabelText("Primary navigation");
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(EXPECTED_ORDER);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(EXPECTED_HREFS);
  });

  it("links Docs to the public /docs route", () => {
    render(<MarketingHeader />);
    const link = screen.getByRole("link", { name: "Docs" });
    expect(link.getAttribute("href")).toBe("/docs");
  });

  it("renders the mobile menu in the same order", async () => {
    render(<MarketingHeader />);
    fireEvent.click(screen.getByRole("button", { name: "Open menu" }));
    const mobileNav = await screen.findByLabelText("Mobile navigation");
    const links = within(mobileNav).getAllByRole("link");
    // Mobile rows render "Label <chevron>", so strip the icon's text.
    expect(links.map((l) => l.textContent?.replace(/\s*$/, "") ?? "")).toEqual(
      EXPECTED_ORDER,
    );
    expect(
      within(mobileNav).getByRole("link", { name: /Docs/ }),
      "Docs must appear in the mobile nav",
    ).toHaveAttribute("href", "/docs");
  });
});
