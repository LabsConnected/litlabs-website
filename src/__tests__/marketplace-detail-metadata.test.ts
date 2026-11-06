import { describe, it, expect, vi } from "vitest";
import { absoluteUrl } from "@/lib/seo";

// ─── /marketplace/[slug] per-item metadata ───
//
// Detail pages used to be client components with no metadata, so every
// catalog item consolidated onto canonical /marketplace. The page is now
// a server component whose generateMetadata resolves the item by slug.
// These tests pin the three outcomes: found → self-canonical indexable,
// missing → noindex, catalog failure → self-canonical generic (a
// transient error must not strip a real page's indexability).

const mocks = vi.hoisted(() => ({ getItem: vi.fn() }));
vi.mock("@/lib/public-marketplace", () => ({
  getPublicMarketplaceItemBySlug: mocks.getItem,
}));

import { generateMetadata } from "@/app/(app)/marketplace/[slug]/page";

function params(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

describe("/marketplace/[slug] generateMetadata", () => {
  it("emits a self-canonical indexable page for a catalog item", async () => {
    mocks.getItem.mockResolvedValue({
      slug: "landing-page-builder",
      name: "Landing Page Builder",
      description: "Generate a landing page from a brief.",
    });
    const metadata = await generateMetadata(params("landing-page-builder"));
    expect(metadata.alternates?.canonical).toBe(
      absoluteUrl("/marketplace/landing-page-builder"),
    );
    expect(metadata.robots && typeof metadata.robots === "object" && "index" in metadata.robots
      ? metadata.robots.index
      : undefined).not.toBe(false);
    expect(String(metadata.title)).toContain("Landing Page Builder");
    expect(metadata.description).toBe(
      "Generate a landing page from a brief.",
    );
  });

  it("noindexes a slug with no catalog item", async () => {
    mocks.getItem.mockResolvedValue(null);
    const metadata = await generateMetadata(params("no-such-item"));
    expect(metadata.alternates?.canonical).toBe(
      absoluteUrl("/marketplace/no-such-item"),
    );
    expect(
      metadata.robots && typeof metadata.robots === "object" && "index" in metadata.robots
        ? metadata.robots.index
        : undefined,
    ).toBe(false);
  });

  it("keeps a self-canonical generic title when the catalog lookup fails", async () => {
    mocks.getItem.mockRejectedValue(new Error("Failed to fetch marketplace item"));
    const metadata = await generateMetadata(params("landing-page-builder"));
    expect(metadata.alternates?.canonical).toBe(
      absoluteUrl("/marketplace/landing-page-builder"),
    );
    expect(
      metadata.robots && typeof metadata.robots === "object" && "index" in metadata.robots
        ? metadata.robots.index
        : undefined,
    ).not.toBe(false);
  });
});
