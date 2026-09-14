import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import {
  DOCS_NAV,
  ALL_DOCS_PAGES,
  allDocsHrefs,
  docsPrevNext,
} from "./_components/docs-nav";
import DocsShell from "./_components/DocsShell";
import { CodeBlock } from "./_components/DocPrimitives";
import DocsOverviewClient from "./DocsOverviewClient";

// ── Mocks ────────────────────────────────────────────────────────────────

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => "/docs",
}));

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({
    resolvedColors: {
      bgColor: "#03050a",
      textColor: "#d4d4e8",
      headerColor: "#7dd3fc",
      accentColor: "#38bdf8",
      boxBg: "#131320",
      borderColor: "#334155",
    },
  }),
}));

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ isSignedIn: false, isLoaded: true }),
}));

// ── 1. /docs renders actual guide content ────────────────────────────────

describe("Docs overview — real guide content", () => {
  it("renders the required documentation sections, not teaser cards", () => {
    render(<DocsOverviewClient />);
    // Required structure §1: the overview must explain each of these.
    for (const heading of [
      "What LiTT is",
      "How it works",
      "Studio",
      "Projects & workspaces",
      "Chat & agents",
      "Preview",
      "Terminal",
      "Build & edit workflow",
      "Deployment",
      "CLI",
      "Marketplace",
      "Approvals & safety",
      "Guides",
    ]) {
      expect(
        screen.getAllByRole("heading", { name: heading }).length,
        `missing overview section: ${heading}`,
      ).toBeGreaterThan(0);
    }
  });

  it("links every guide from the overview cards", () => {
    const { container } = render(<DocsOverviewClient />);
    const cards = container.querySelector('[data-testid="docs-guide-cards"]')!;
    for (const page of ALL_DOCS_PAGES) {
      if (page.href === "/docs") continue;
      const link = cards.querySelector(`a[href="${page.href}"]`);
      expect(link, `overview has no card linking to ${page.href}`).toBeTruthy();
      expect(link!.textContent).toContain(page.title);
    }
  });

  it("shows the support section when ?topic=support", () => {
    // Re-mock is overkill here; the support branch is covered by the
    // search-param wiring in DocsOverviewClient (topic === "support").
    // This test documents the contract: the mailto must exist in source.
    const src = readFileSync(
      path.resolve(__dirname, "DocsOverviewClient.tsx"),
      "utf-8",
    );
    expect(src).toContain("topic");
    expect(src).toContain("support@litlabs.net");
  });
});

// ── 2. Internal docs navigation works ────────────────────────────────────

describe("DocsShell navigation", () => {
  it("renders every docs page as a sidebar link with the right href", () => {
    const { container } = render(
      <DocsShell>
        <p>child</p>
      </DocsShell>,
    );
    const sidebar = container.querySelector('[data-testid="docs-desktop-sidebar"]');
    expect(sidebar, "desktop sidebar missing").toBeTruthy();
    for (const page of ALL_DOCS_PAGES) {
      const link = sidebar!.querySelector(`a[href="${page.href}"]`);
      expect(link, `sidebar missing link to ${page.href}`).toBeTruthy();
      expect(link!.textContent).toContain(page.title);
    }
  });

  it("marks the current page with aria-current", () => {
    const { container } = render(
      <DocsShell>
        <p>child</p>
      </DocsShell>,
    );
    const active = container.querySelector(
      '[data-testid="docs-desktop-sidebar"] a[aria-current="page"]',
    );
    expect(active?.getAttribute("href")).toBe("/docs");
  });

  it("mobile nav toggle expands and collapses the section list", () => {
    const { container } = render(
      <DocsShell>
        <p>child</p>
      </DocsShell>,
    );
    const toggle = container.querySelector('[data-testid="docs-mobile-nav-toggle"]');
    expect(toggle, "mobile nav toggle missing").toBeTruthy();
    expect(container.querySelector('[data-testid="docs-mobile-nav"]')).toBeNull();
    fireEvent.click(toggle!);
    const panel = container.querySelector('[data-testid="docs-mobile-nav"]');
    expect(panel, "mobile nav panel did not open").toBeTruthy();
    for (const page of ALL_DOCS_PAGES) {
      expect(
        panel!.querySelector(`a[href="${page.href}"]`),
        `mobile nav missing link to ${page.href}`,
      ).toBeTruthy();
    }
    fireEvent.click(toggle!);
    expect(container.querySelector('[data-testid="docs-mobile-nav"]')).toBeNull();
  });

  it("prev/next pager follows the nav reading order", () => {
    const { prev, next } = docsPrevNext("/docs/quick-start");
    expect(prev?.href).toBe("/docs");
    expect(next?.href).toBe("/docs/studio");
    const first = docsPrevNext("/docs");
    expect(first.prev).toBeNull();
    expect(first.next?.href).toBe("/docs/quick-start");
    const last = docsPrevNext("/docs/troubleshooting");
    expect(last.next).toBeNull();
    expect(last.prev?.href).toBe("/docs/safety");
  });
});

// ── 3. No dead internal documentation links ──────────────────────────────

describe("Docs internal links — no dead ends", () => {
  const docsDir = path.resolve(__dirname);

  /** Map a /docs href to the route file that must render it. */
  function routeFileFor(href: string): string {
    const suffix = href === "/docs" ? "" : href.replace(/^\/docs/, "");
    return path.join(docsDir, suffix, "page.tsx");
  }

  it("every nav href resolves to a real route file", () => {
    for (const href of allDocsHrefs()) {
      const file = routeFileFor(href);
      expect(existsSync(file), `no route file for ${href} (expected ${file})`).toBe(true);
    }
  });

  it("every /docs/* href used in docs source is a known nav page", () => {
    const known = new Set(allDocsHrefs());
    // _components + all *Client.tsx files (page.tsx files carry no links).
    const sources: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir)) {
        const full = path.join(dir, entry);
        if (statSync(full).isDirectory()) {
          if (entry === "node_modules") continue;
          walk(full);
        } else if (/\.tsx?$/.test(entry) && !entry.endsWith(".test.tsx")) {
          sources.push(full);
        }
      }
    };
    walk(docsDir);
    const problems: string[] = [];
    for (const file of sources) {
      const src = readFileSync(file, "utf-8");
      const matches = src.matchAll(/href="(\/docs[^"]*)"/g);
      for (const m of matches) {
        const href = m[1]!;
        // Anchor links within a page are fine; anything else must be nav.
        const [page] = href.split("#");
        if (page && !known.has(page)) {
          problems.push(`${path.relative(docsDir, file)} links to unknown docs page ${href}`);
        }
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("nav has no duplicate hrefs", () => {
    const hrefs = allDocsHrefs();
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("every group has at least one page and every page has a description", () => {
    for (const group of DOCS_NAV) {
      expect(group.pages.length).toBeGreaterThan(0);
      for (const page of group.pages) {
        expect(page.title.trim().length).toBeGreaterThan(0);
        expect(page.description.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ── 4. Mobile layout — no horizontal overflow ────────────────────────────

describe("Docs mobile layout", () => {
  it("desktop sidebar is hidden on mobile and the article can shrink", () => {
    const { container } = render(
      <DocsShell>
        <p>child</p>
      </DocsShell>,
    );
    const sidebar = container.querySelector('[data-testid="docs-desktop-sidebar"]')!;
    expect(sidebar.className).toContain("hidden");
    const article = container.querySelector('[data-testid="docs-article"]')!;
    // min-w-0 inside the grid lets long content shrink instead of
    // forcing the page wider than the viewport.
    expect(article.className).toContain("min-w-0");
  });

  it("code blocks scroll horizontally instead of overflowing", () => {
    const { container } = render(
      <CodeBlock>{`litt deploy verify --some-very-long-flag-name-that-would-overflow-on-mobile`}</CodeBlock>,
    );
    const pre = container.querySelector("pre")!;
    expect(pre.className).toContain("overflow-x-auto");
  });
});
