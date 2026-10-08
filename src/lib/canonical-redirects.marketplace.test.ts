import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { CANONICAL_REDIRECTS } from "./canonical-redirects";

describe("Marketplace route preservation (PR #630)", () => {
  it("keeps the marketplace index and live detail pages out of canonical redirects", () => {
    const livePaths = [
      "/marketplace",
      "/marketplace/example-capability",
      "/marketplace/agents/example-agent",
    ];
    const matching = (source: string, path: string) => {
      if (source.endsWith("/:path*")) {
        return path.startsWith(source.slice(0, -8) + "/");
      }
      return source === path;
    };
    for (const path of livePaths) {
      expect(CANONICAL_REDIRECTS.filter(({ source }) => matching(source, path)), path).toEqual([]);
    }
  });

  it("retains the existing marketplace route implementations", () => {
    for (const route of [
      "src/app/(app)/marketplace/page.tsx",
      "src/app/(app)/marketplace/[slug]/page.tsx",
      "src/app/(app)/marketplace/agents/[slug]/page.tsx",
    ]) {
      expect(existsSync(join(process.cwd(), route)), route).toBe(true);
    }
  });

  it("still sends community aliases to Discover", () => {
    expect(CANONICAL_REDIRECTS).toContainEqual({
      source: "/community",
      destination: "/discover",
      permanent: true,
    });
  });
});
