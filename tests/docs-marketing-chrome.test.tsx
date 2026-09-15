// @vitest-environment jsdom
/**
 * /docs shared marketing chrome regression.
 *
 * /docs is public documentation but used to render with zero header/footer
 * (see BARE_PUBLIC_PATHS in LayoutShell.tsx). It must render the same
 * shared MarketingHeader/MarketingFooter every other public marketing page
 * uses (src/app/(app)/docs/layout.tsx), not a bespoke or missing chrome.
 */
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { ThemeProvider } from "@/context/ThemeContext";
import DocsLayout from "@/app/(app)/docs/layout";

describe("/docs layout", () => {
  it("renders the shared MarketingHeader and MarketingFooter around the page content", () => {
    // DocsShell uses useTheme; the root layout always provides ThemeProvider in production.
    render(
      <ThemeProvider>
        <DocsLayout>
          <div data-testid="docs-page-content">docs content</div>
        </DocsLayout>
      </ThemeProvider>,
    );

    // Header: brand link + primary nav landmark.
    expect(screen.getByRole("link", { name: /LiTTree LabStudios home/i })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: /primary navigation/i })).toBeTruthy();

    // Page content renders between header and footer.
    expect(screen.getByTestId("docs-page-content")).toBeTruthy();

    // Footer: same shared footer other marketing pages use.
    const footer = screen.getByRole("contentinfo");
    expect(within(footer).getByRole("link", { name: "Privacy" })).toBeTruthy();
    expect(within(footer).getByRole("link", { name: "Terms" })).toBeTruthy();
  });
});
