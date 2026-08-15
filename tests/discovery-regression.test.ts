import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "fs";
import path from "path";
import {
  SITE_URL,
  SITE_NAME,
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  DEFAULT_OG_IMAGE,
  absoluteUrl,
  buildMetadata,
} from "@/lib/seo";

// ── Helpers ──────────────────────────────────────────────
const publicDir = path.resolve(__dirname, "../public");
const readFile = (rel: string) => readFileSync(path.join(publicDir, rel), "utf-8");

// ── Canonical identity ───────────────────────────────────
describe("Discovery regression — canonical identity", () => {
  it("SITE_URL is https://litlabs.net", () => {
    expect(SITE_URL).toBe("https://litlabs.net");
  });

  it("SITE_NAME is LiTTree LabStudios", () => {
    expect(SITE_NAME).toBe("LiTTree LabStudios");
  });

  it("DEFAULT_TITLE includes LitLabs and LiTTree LabStudios", () => {
    expect(DEFAULT_TITLE).toContain("LitLabs");
    expect(DEFAULT_TITLE).toContain("LiTTree LabStudios");
  });

  it("DEFAULT_DESCRIPTION mentions AI creative platform", () => {
    expect(DEFAULT_DESCRIPTION.toLowerCase()).toContain("ai creative platform");
  });

  it("absoluteUrl produces canonical URLs", () => {
    expect(absoluteUrl("/about")).toBe("https://litlabs.net/about");
    expect(absoluteUrl("/pricing")).toBe("https://litlabs.net/pricing");
  });
});

// ── buildMetadata ────────────────────────────────────────
describe("Discovery regression — buildMetadata", () => {
  it("sets canonical URL", () => {
    const m = buildMetadata({ title: "Test", path: "/test" });
    expect(m.alternates?.canonical).toBe("https://litlabs.net/test");
  });

  it("sets OpenGraph with site name, title, description, and image", () => {
    const m = buildMetadata({ title: "Test", description: "Desc", path: "/test" });
    const og = m.openGraph as Record<string, unknown> | undefined;
    expect(og?.type).toBe("website");
    expect(og?.siteName).toBe(SITE_NAME);
    expect(og?.title).toBe("Test | LiTTree LabStudios");
    expect(og?.description).toBe("Desc");
    expect(og?.images).toHaveLength(1);
  });

  it("sets Twitter card as summary_large_image", () => {
    const m = buildMetadata({ title: "Test", path: "/test" });
    const tw = m.twitter as Record<string, unknown> | undefined;
    expect(tw?.card).toBe("summary_large_image");
    expect(tw?.title).toBe("Test | LiTTree LabStudios");
  });

  it("respects index=false to set robots noindex", () => {
    const m = buildMetadata({ title: "Private", path: "/private", index: false });
    const robots = m.robots as Record<string, unknown> | undefined;
    expect(robots?.index).toBe(false);
    expect(robots?.follow).toBe(false);
  });

  it("uses DEFAULT_TITLE when no title provided", () => {
    const m = buildMetadata({ path: "/" });
    expect(m.title).toBe(DEFAULT_TITLE);
  });
});

// ── robots.ts ────────────────────────────────────────────
describe("Discovery regression — robots.txt rules", () => {
  it("disallows private routes", () => {
    const robotsSrc = readFileSync(
      path.resolve(__dirname, "../src/app/robots.ts"),
      "utf-8"
    );
    const privateRoutes = [
      "/api/",
      "/admin/",
      "/wallet/",
      "/projects/",
      "/deployments/",
      "/library/",
      "/memories/",
      "/voice/",
      "/order/",
      "/creator/",
      "/resources/",
    ];
    for (const route of privateRoutes) {
      expect(robotsSrc).toContain(`"${route}"`);
    }
  });

  it("allows root /", () => {
    const robotsSrc = readFileSync(
      path.resolve(__dirname, "../src/app/robots.ts"),
      "utf-8"
    );
    expect(robotsSrc).toContain('allow: "/"');
  });

  it("references sitemap.xml", () => {
    const robotsSrc = readFileSync(
      path.resolve(__dirname, "../src/app/robots.ts"),
      "utf-8"
    );
    expect(robotsSrc).toContain("/sitemap.xml");
  });

  it("sets host to SITE_URL", () => {
    const robotsSrc = readFileSync(
      path.resolve(__dirname, "../src/app/robots.ts"),
      "utf-8"
    );
    expect(robotsSrc).toContain("SITE_URL");
  });
});

// ── sitemap.ts ───────────────────────────────────────────
describe("Discovery regression — sitemap.xml entries", () => {
  it("includes all canonical public pages", () => {
    const sitemapSrc = readFileSync(
      path.resolve(__dirname, "../src/app/sitemap.ts"),
      "utf-8"
    );
    const expectedPages = [
      "/",
      "/about",
      "/marketplace",
      "/games",
      "/pricing",
      "/docs",
      "/showcase",
      "/privacy",
      "/terms",
    ];
    for (const page of expectedPages) {
      expect(sitemapSrc).toContain(`absoluteUrl("${page}")`);
    }
  });

  it("does not include private or auth-gated routes", () => {
    const sitemapSrc = readFileSync(
      path.resolve(__dirname, "../src/app/sitemap.ts"),
      "utf-8"
    );
    const privateRoutes = [
      "/api",
      "/admin",
      "/wallet",
      "/studio",
      "/dashboard",
      "/projects",
      "/deployments",
    ];
    for (const route of privateRoutes) {
      expect(sitemapSrc).not.toContain(`absoluteUrl("${route}")`);
    }
  });
});

// ── llms.txt ─────────────────────────────────────────────
describe("Discovery regression — llms.txt", () => {
  it("file exists in public/", () => {
    expect(existsSync(path.join(publicDir, "llms.txt"))).toBe(true);
  });

  it("contains company name LiTTree LabStudios", () => {
    const content = readFile("llms.txt");
    expect(content).toContain("LiTTree LabStudios");
  });

  it("contains canonical URL https://litlabs.net", () => {
    const content = readFile("llms.txt");
    expect(content).toContain("https://litlabs.net");
  });

  it("mentions LiTT and Spark", () => {
    const content = readFile("llms.txt");
    expect(content).toContain("LiTT");
    expect(content).toContain("Spark");
  });

  it("links to About page", () => {
    const content = readFile("llms.txt");
    expect(content).toContain("https://litlabs.net/about");
  });
});

// ── llms-full.txt ────────────────────────────────────────
describe("Discovery regression — llms-full.txt", () => {
  it("file exists in public/", () => {
    expect(existsSync(path.join(publicDir, "llms-full.txt"))).toBe(true);
  });

  it("contains company name and product details", () => {
    const content = readFile("llms-full.txt");
    expect(content).toContain("LiTTree LabStudios");
    expect(content).toContain("LiTT");
    expect(content).toContain("Spark");
    expect(content).toContain("Studio");
  });

  it("contains canonical URL", () => {
    const content = readFile("llms-full.txt");
    expect(content).toContain("https://litlabs.net");
  });
});

// ── /.well-known/littree.json ───────────────────────────
describe("Discovery regression — .well-known/littree.json", () => {
  it("file exists in public/.well-known/", () => {
    expect(existsSync(path.join(publicDir, ".well-known/littree.json"))).toBe(true);
  });

  it("has valid JSON with correct identity fields", () => {
    const raw = readFile(".well-known/littree.json");
    const data = JSON.parse(raw);
    expect(data.name).toBe("LiTTree LabStudios");
    expect(data.product).toBe("LiTTree");
    expect(data.canonical_url).toBe("https://litlabs.net");
    expect(data.ai_agent).toBe("LiTT");
    expect(data.creative_companion).toBe("Spark");
  });

  it("includes official resources with canonical URLs", () => {
    const raw = readFile(".well-known/littree.json");
    const data = JSON.parse(raw);
    expect(data.official_resources.homepage).toBe("https://litlabs.net");
    expect(data.official_resources.llms_txt).toBe("https://litlabs.net/llms.txt");
  });
});

// ── JSON-LD AuthorityJsonLd ─────────────────────────────
describe("Discovery regression — JSON-LD structured data", () => {
  it("AuthorityJsonLd component file exists", () => {
    expect(
      existsSync(
        path.resolve(__dirname, "../src/components/seo/AuthorityJsonLd.tsx")
      )
    ).toBe(true);
  });

  it("component defines Organization, WebSite, and WebApplication schemas", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/components/seo/AuthorityJsonLd.tsx"),
      "utf-8"
    );
    expect(src).toContain('"Organization"');
    expect(src).toContain('"WebSite"');
    expect(src).toContain('"WebApplication"');
  });

  it("uses SITE_NAME and SITE_URL in schemas", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/components/seo/AuthorityJsonLd.tsx"),
      "utf-8"
    );
    expect(src).toContain("SITE_NAME");
    expect(src).toContain("SITE_URL");
  });

  it("includes sameAs social links", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/components/seo/AuthorityJsonLd.tsx"),
      "utf-8"
    );
    expect(src).toContain("x.com/LabsConnected");
    expect(src).toContain("github.com/LabsConnected");
  });

  it("is imported in root layout", () => {
    const layoutSrc = readFileSync(
      path.resolve(__dirname, "../src/app/layout.tsx"),
      "utf-8"
    );
    expect(layoutSrc).toContain("AuthorityJsonLd");
  });
});

// ── About page ──────────────────────────────────────────
describe("Discovery regression — About page", () => {
  it("page file exists", () => {
    expect(
      existsSync(path.resolve(__dirname, "../src/app/(app)/about/page.tsx"))
    ).toBe(true);
  });

  it("exports metadata with buildMetadata", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/app/(app)/about/page.tsx"),
      "utf-8"
    );
    expect(src).toContain("buildMetadata");
    expect(src).toContain('path: "/about"');
  });
});

// ── Canonical domain redirect ───────────────────────────
describe("Discovery regression — canonical domain redirect", () => {
  it("next.config.ts redirects www.litlabs.net to litlabs.net", () => {
    const configSrc = readFileSync(
      path.resolve(__dirname, "../next.config.ts"),
      "utf-8"
    );
    expect(configSrc).toContain("www.litlabs.net");
    expect(configSrc).toContain("https://litlabs.net/:path*");
    expect(configSrc).toContain("permanent: true");
  });
});

// ── No stale WordPress fingerprints ─────────────────────
describe("Discovery regression — no WordPress fingerprints", () => {
  it("robots.ts does not reference wp-content or wp-includes", () => {
    const robotsSrc = readFileSync(
      path.resolve(__dirname, "../src/app/robots.ts"),
      "utf-8"
    );
    expect(robotsSrc.toLowerCase()).not.toContain("wp-content");
    expect(robotsSrc.toLowerCase()).not.toContain("wp-includes");
  });

  it("sitemap.ts does not reference WordPress paths", () => {
    const sitemapSrc = readFileSync(
      path.resolve(__dirname, "../src/app/sitemap.ts"),
      "utf-8"
    );
    expect(sitemapSrc.toLowerCase()).not.toContain("wp-content");
    expect(sitemapSrc.toLowerCase()).not.toContain("wp-includes");
    expect(sitemapSrc.toLowerCase()).not.toContain("wp-admin");
  });
});

// ── Studio noindex ───────────────────────────────────────
describe("Discovery regression — studio noindex", () => {
  it("studio layout sets robots index:false", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/app/(app)/studio/layout.tsx"),
      "utf-8"
    );
    expect(src).toContain("index: false");
    expect(src).toContain("follow: false");
  });
});

// ── Showcase metadata ───────────────────────────────────
describe("Discovery regression — showcase metadata", () => {
  it("showcase layout exports buildMetadata", () => {
    const src = readFileSync(
      path.resolve(__dirname, "../src/app/(app)/showcase/layout.tsx"),
      "utf-8"
    );
    expect(src).toContain("buildMetadata");
    expect(src).toContain('path: "/showcase"');
  });
});
