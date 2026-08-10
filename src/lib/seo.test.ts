import { describe, it, expect } from "vitest";
import {
  DEFAULT_TITLE,
  DEFAULT_DESCRIPTION,
  SITE_NAME,
  SITE_URL,
  absoluteUrl,
  buildMetadata,
} from "./seo";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

describe("SEO — Brand signals for LitLabs", () => {
  describe("Title and description", () => {
    it("homepage title contains LitLabs", () => {
      expect(DEFAULT_TITLE.toLowerCase()).toContain("litlabs");
    });

    it("homepage title contains LiTTree LabStudios", () => {
      expect(DEFAULT_TITLE).toContain("LiTTree LabStudios");
    });

    it("homepage description starts with LitLabs", () => {
      expect(DEFAULT_DESCRIPTION.toLowerCase().startsWith("litlabs")).toBe(true);
    });

    it("homepage description mentions LiTTree LabStudios", () => {
      expect(DEFAULT_DESCRIPTION).toContain("LiTTree LabStudios");
    });
  });

  describe("buildMetadata", () => {
    it("homepage metadata has canonical pointing to SITE_URL", () => {
      const meta = buildMetadata({ path: "/" });
      expect(meta.alternates?.canonical).toBe(`${SITE_URL}/`);
    });

    it("homepage metadata is indexable", () => {
      const meta = buildMetadata({ path: "/", index: true });
      const robots = meta.robots as { index: boolean; follow: boolean };
      expect(robots.index).toBe(true);
      expect(robots.follow).toBe(true);
    });

    it("non-indexed pages have noindex", () => {
      const meta = buildMetadata({ path: "/private", index: false });
      const robots = meta.robots as { index: boolean; follow: boolean };
      expect(robots.index).toBe(false);
      expect(robots.follow).toBe(false);
    });

    it("OG metadata is consistent with title and description", () => {
      const meta = buildMetadata({ path: "/" });
      expect(meta.openGraph?.siteName).toBe(SITE_NAME);
      expect(meta.openGraph?.url).toBe(`${SITE_URL}/`);
      expect(meta.openGraph?.title).toBe(DEFAULT_TITLE);
      expect(meta.openGraph?.description).toBe(DEFAULT_DESCRIPTION);
    });

    it("absoluteUrl produces correct URLs", () => {
      expect(absoluteUrl("/")).toBe(`${SITE_URL}/`);
      expect(absoluteUrl("/pricing")).toBe(`${SITE_URL}/pricing`);
    });
  });

  describe("Robots", () => {
    it("allows homepage", () => {
      const r = robots();
      const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
      const rootRule = rules.find((rule: { allow?: string | string[] }) => rule.allow === "/");
      expect(rootRule).toBeTruthy();
    });

    it("disallows /api/", () => {
      const r = robots();
      const rules = Array.isArray(r.rules) ? r.rules : [r.rules];
      const rootRule = rules.find((rule: { allow?: string | string[] }) => rule.allow === "/");
      const disallow = rootRule?.disallow;
      const disallowList = Array.isArray(disallow) ? disallow : disallow ? [disallow] : [];
      expect(disallowList).toContain("/api/");
    });

    it("declares sitemap", () => {
      const r = robots();
      expect(r.sitemap).toBe(absoluteUrl("/sitemap.xml"));
    });

    it("declares host", () => {
      const r = robots();
      expect(r.host).toBe(SITE_URL);
    });
  });

  describe("Sitemap", () => {
    it("contains homepage with priority 1", () => {
      const sm = sitemap();
      const home = sm.find((entry) => entry.url === absoluteUrl("/"));
      expect(home).toBeTruthy();
      expect(home?.priority).toBe(1);
    });

    it("contains all expected static pages", () => {
      const sm = sitemap();
      const urls = sm.map((entry) => entry.url);
      expect(urls).toContain(absoluteUrl("/"));
      expect(urls).toContain(absoluteUrl("/marketplace"));
      expect(urls).toContain(absoluteUrl("/pricing"));
      expect(urls).toContain(absoluteUrl("/docs"));
    });

    it("excludes obsolete /gallery", () => {
      const sm = sitemap();
      const urls = sm.map((entry) => entry.url);
      expect(urls).not.toContain(absoluteUrl("/gallery"));
    });
  });

  describe("Structured data — WebSite schema", () => {
    // We verify the schema shape by importing the page module's homeSchema
    // indirectly through the exported metadata. Since homeSchema is not
    // exported, we verify the SEO constants that feed into it.
    it("SITE_NAME is LiTTree LabStudios", () => {
      expect(SITE_NAME).toBe("LiTTree LabStudios");
    });

    it("SITE_URL is https://litlabs.net", () => {
      expect(SITE_URL).toBe("https://litlabs.net");
    });
  });
});
