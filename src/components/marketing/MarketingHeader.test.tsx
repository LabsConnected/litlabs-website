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

// Larry's site audit (2026-09-22, issue #469): lead with the product —
// Studio → How it works → Pricing first. "Community" is back at the end now
// that the /discover feed is seeded with LiTT-team welcome posts; it points
// at /discover, the canonical route. Labels and hrefs must be unchanged;
// only the order is asserted here.
const EXPECTED_ORDER = [
  "Studio",
  "How it works",
  "Pricing",
  "Capabilities",
  "Creations",
  "CLI",
  "FAQ",
  "Community",
];

const EXPECTED_HREFS = [
  "/studio",
  "/#how-it-works",
  "/pricing",
  "/#what-we-do",
  "/#creations",
  "/cli",
  "/#faq",
  "/discover",
];

describe("MarketingHeader nav order (issue #469)", () => {
  it("renders the desktop nav in Larry's required order", () => {
    render(<MarketingHeader />);
    const nav = screen.getByLabelText("Primary navigation");
    const links = within(nav).getAllByRole("link");
    expect(links.map((l) => l.textContent)).toEqual(EXPECTED_ORDER);
    expect(links.map((l) => l.getAttribute("href"))).toEqual(EXPECTED_HREFS);
  });

  it("includes the Community link now that the Discover feed is seeded", () => {
    render(<MarketingHeader />);
    const link = screen.getByRole("link", { name: "Community" });
    expect(link.getAttribute("href")).toBe("/discover");
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
      within(mobileNav).getByRole("link", { name: /Community/ }),
      "Community must appear in the mobile nav now that /discover is seeded",
    ).toHaveAttribute("href", "/discover");
  });
});
