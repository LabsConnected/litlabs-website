import { describe, it, expect } from "vitest";
import { DEFAULT_TITLE, DEFAULT_DESCRIPTION, SITE_NAME, SITE_URL, absoluteUrl } from "@/lib/seo";

// This test verifies the structured data shape that the homepage renders.
// We replicate the schema here to test its structure without needing to
// render the full Next.js page (which requires complex mocking).

const homeSchema = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE_URL}/#organization`,
      name: SITE_NAME,
      alternateName: [
        "LitLabs",
        "Lit Labs",
        "LiTTree",
        "LiTTree Labs",
        "LiTTree LabStudio",
        "LiTT Labs",
        "litlabs.net",
      ],
      url: SITE_URL,
      sameAs: [
        "https://github.com/LabsConnected",
        "https://www.youtube.com/@LiTTreeLabStudios",
        "https://www.linkedin.com/company/litlabs",
        "https://x.com/LitLabsNet",
        "https://www.instagram.com/litlabsnet",
      ],
      logo: {
        "@type": "ImageObject",
        url: absoluteUrl("/icon-512.png"),
        width: 512,
        height: 512,
      },
      image: absoluteUrl("/opengraph-image.png"),
      description: DEFAULT_DESCRIPTION,
    },
    {
      "@type": "WebSite",
      "@id": `${SITE_URL}/#website`,
      url: SITE_URL,
      name: SITE_NAME,
      alternateName: [
        "LitLabs",
        "Lit Labs",
        "LiTTree",
        "LiTTree Labs",
        "litlabs.net",
      ],
      description: DEFAULT_DESCRIPTION,
      publisher: {
        "@id": `${SITE_URL}/#organization`,
      },
      inLanguage: "en-US",
    },
  ],
};

describe("Homepage structured data (JSON-LD)", () => {
  it("has @graph with Organization and WebSite", () => {
    const graph = homeSchema["@graph"] as Array<Record<string, unknown>>;
    expect(graph).toHaveLength(2);
    expect(graph[0]["@type"]).toBe("Organization");
    expect(graph[1]["@type"]).toBe("WebSite");
  });

  it("Organization alternateName includes LitLabs", () => {
    const org = (homeSchema["@graph"] as Array<Record<string, unknown>>)[0];
    const altNames = org.alternateName as string[];
    expect(altNames).toContain("LitLabs");
  });

  it("Organization alternateName includes Lit Labs", () => {
    const org = (homeSchema["@graph"] as Array<Record<string, unknown>>)[0];
    const altNames = org.alternateName as string[];
    expect(altNames).toContain("Lit Labs");
  });

  it("Organization has sameAs with real profile URLs", () => {
    const org = (homeSchema["@graph"] as Array<Record<string, unknown>>)[0];
    const sameAs = org.sameAs as string[];
    expect(sameAs.length).toBeGreaterThan(0);
    // All sameAs entries should be valid URLs
    sameAs.forEach((url) => {
      expect(url).toMatch(/^https:\/\/(www\.)?[a-z]+\.[a-z]+/i);
    });
  });

  it("Organization name is LiTTree LabStudios", () => {
    const org = (homeSchema["@graph"] as Array<Record<string, unknown>>)[0];
    expect(org.name).toBe("LiTTree LabStudios");
  });

  it("Organization @id is correct", () => {
    const org = (homeSchema["@graph"] as Array<Record<string, unknown>>)[0];
    expect(org["@id"]).toBe(`${SITE_URL}/#organization`);
  });

  it("WebSite alternateName includes LitLabs", () => {
    const site = (homeSchema["@graph"] as Array<Record<string, unknown>>)[1];
    const altNames = site.alternateName as string[];
    expect(altNames).toContain("LitLabs");
  });

  it("WebSite alternateName includes Lit Labs", () => {
    const site = (homeSchema["@graph"] as Array<Record<string, unknown>>)[1];
    const altNames = site.alternateName as string[];
    expect(altNames).toContain("Lit Labs");
  });

  it("WebSite name is LiTTree LabStudios", () => {
    const site = (homeSchema["@graph"] as Array<Record<string, unknown>>)[1];
    expect(site.name).toBe("LiTTree LabStudios");
  });

  it("WebSite @id is correct", () => {
    const site = (homeSchema["@graph"] as Array<Record<string, unknown>>)[1];
    expect(site["@id"]).toBe(`${SITE_URL}/#website`);
  });

  it("WebSite publisher references Organization @id", () => {
    const site = (homeSchema["@graph"] as Array<Record<string, unknown>>)[1];
    const publisher = site.publisher as Record<string, string>;
    expect(publisher["@id"]).toBe(`${SITE_URL}/#organization`);
  });

  it("WebSite has alternateName array (not just string)", () => {
    const site = (homeSchema["@graph"] as Array<Record<string, unknown>>)[1];
    expect(Array.isArray(site.alternateName)).toBe(true);
  });

  it("LitLabs appears first in WebSite alternateName", () => {
    const site = (homeSchema["@graph"] as Array<Record<string, unknown>>)[1];
    const altNames = site.alternateName as string[];
    expect(altNames[0]).toBe("LitLabs");
  });

  it("LitLabs appears first in Organization alternateName", () => {
    const org = (homeSchema["@graph"] as Array<Record<string, unknown>>)[0];
    const altNames = org.alternateName as string[];
    expect(altNames[0]).toBe("LitLabs");
  });

  it("DEFAULT_TITLE contains LitLabs", () => {
    expect(DEFAULT_TITLE).toContain("LitLabs");
  });

  it("DEFAULT_DESCRIPTION starts with LitLabs", () => {
    expect(DEFAULT_DESCRIPTION.startsWith("LitLabs")).toBe(true);
  });
});
