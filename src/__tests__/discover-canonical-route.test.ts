import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  CANONICAL_REDIRECTS,
  type CanonicalRedirect,
} from "@/lib/canonical-redirects";
import { metadata as discoverMetadata } from "@/app/(app)/discover/layout";
import { absoluteUrl } from "@/lib/seo";

// ─── Regression tests: /discover is the one canonical community route ───
//
// The community surface has been called "Community", "Discover", and
// "Communities" in different places. The decision (polish program PR #2,
// issue #467): /discover is canonical; /community and /communities
// permanently redirect (308) to it; no nav label may say "Community" for
// the /discover destination. These tests lock that in so a future route
// can't silently fork the surface again.
//
// NOTE: the redirect entries live in src/lib/canonical-redirects.ts rather
// than inline in next.config.ts so they are unit-testable — importing
// next.config.ts into the type-checked test world would drag in the Sentry
// wrapper's build options and break `tsc --noEmit`.

const repoRoot = path.resolve(__dirname, "..", "..");

function findRedirect(source: string): CanonicalRedirect | undefined {
  return (CANONICAL_REDIRECTS as readonly CanonicalRedirect[]).find(
    (r) => r.source === source,
  );
}

describe("canonical /discover route", () => {
  it("redirects /community permanently (308) to /discover", () => {
    const entry = findRedirect("/community");
    expect(entry).toBeDefined();
    expect(entry!.destination).toBe("/discover");
    // permanent: true => Next.js serves a 308 Permanent Redirect
    expect(entry!.permanent).toBe(true);
  });

  it("redirects /communities permanently (308) to /discover", () => {
    const entry = findRedirect("/communities");
    expect(entry).toBeDefined();
    expect(entry!.destination).toBe("/discover");
    expect(entry!.permanent).toBe(true);
  });

  it("next.config.ts wires the canonical redirects into redirects()", () => {
    const configSource = readFileSync(
      path.join(repoRoot, "next.config.ts"),
      "utf8",
    );
    expect(configSource).toContain("CANONICAL_REDIRECTS");
  });

  it("/discover metadata carries the canonical URL", () => {
    const canonical = discoverMetadata.alternates?.canonical;
    expect(canonical).toBe(absoluteUrl("/discover"));
  });

  it("no /community or /communities route directories exist", () => {
    const aliasDirs = [
      "src/app/community",
      "src/app/communities",
      "src/app/(app)/community",
      "src/app/(app)/communities",
    ];
    for (const dir of aliasDirs) {
      expect(existsSync(path.join(repoRoot, dir)), `${dir} must not exist`).toBe(
        false,
      );
    }
  });
});
