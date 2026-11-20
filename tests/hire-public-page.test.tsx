// @vitest-environment jsdom
/**
 * /hire public-page regression.
 *
 * /hire must render real hiring content for signed-out visitors instead of
 * redirecting into Studio. The page is inquiry-only: it must not resurrect
 * the retired fixed-price service catalog, Stripe payment links, or the
 * hireServices feature flag.
 */
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import HireClient from "@/app/(marketing)/hire/HireClient";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("/hire public page", () => {
  it("renders scoped hiring content and an inquiry form", () => {
    render(<HireClient />);

    expect(screen.getByRole("heading", { name: /tell us what you need built/i })).toBeTruthy();
    expect(screen.getByText(/confirm scope, availability, and pricing/i)).toBeTruthy();
    expect(screen.getByText(/what we can help with/i)).toBeTruthy();
    expect(screen.getByText(/how hiring works/i)).toBeTruthy();
    expect(screen.getByLabelText("Your name")).toBeTruthy();
    expect(screen.getByLabelText("Email address")).toBeTruthy();
    expect(screen.getByLabelText("Project details")).toBeTruthy();
    expect(screen.getByRole("button", { name: /send inquiry/i })).toBeTruthy();
  });

  it("does not render the retired offer catalog, prices, or checkout links", () => {
    const { container } = render(<HireClient />);
    const text = container.textContent ?? "";

    expect(text).not.toContain("Launch Sprint");
    expect(text).not.toContain("Automation Setup");
    expect(text).not.toContain("Brand Pack");
    expect(text).not.toMatch(/\$\d+/);
    expect(container.querySelector('a[href^="https://buy.stripe.com"], a[href*="stripe"]')).toBeNull();
  });

  it("is a real marketing route, not a Studio redirect", () => {
    const page = read("src/app/(marketing)/hire/page.tsx");
    const client = read("src/app/(marketing)/hire/HireClient.tsx");
    const proxy = read("src/proxy.ts");

    expect(page).toContain('path: "/hire"');
    expect(page).toContain("<HireClient />");
    expect(page).not.toContain('redirect("/studio")');
    expect(client).not.toContain("service-offers");
    expect(client).not.toContain("paymentLink");
    expect(proxy).not.toContain('"/hire(.*)"');
  });

  it("lead endpoint returns real errors instead of fake success", () => {
    const route = read("src/app/api/leads/service-inquiry/route.ts");
    const client = read("src/app/(marketing)/hire/HireClient.tsx");
    expect(route).toContain("status: 503");
    expect(route).toContain("status: 500");
    expect(client).toContain("if (!response.ok)");
  });
});
