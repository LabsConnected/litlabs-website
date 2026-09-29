import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ─── Regression test: /capabilities is a real page, never a redirect ───
//
// Larry's site audit (2026-09-22, issue #469): https://www.litlabs.net/capabilities
// returned a 404, and was later given a permanent redirect to /#what-we-do.
// PR-B (public-route recovery, 2026-09-29) built the real page instead:
// /capabilities must now serve its own HTTP 200 page, so the redirect is
// gone and the real route file must exist.
//
// We assert against the raw next.config.ts source (rather than importing the
// config, which pulls in @sentry/nextjs and Next.js build-time APIs not meant
// to run under vitest) since the redirect entries are static object literals.

describe("/capabilities is a real page (issue #469, PR-B)", () => {
  const configSource = readFileSync(
    join(__dirname, "../../next.config.ts"),
    "utf-8",
  );

  it("does NOT register a redirect for /capabilities", () => {
    const pattern = /source:\s*"\/capabilities"/;
    expect(
      pattern.test(configSource),
      'next.config.ts must not contain a redirect with source "/capabilities"',
    ).toBe(false);
  });

  it("has a real route file serving the page", () => {
    const pagePath = join(
      __dirname,
      "../app/(marketing)/capabilities/page.tsx",
    );
    expect(
      existsSync(pagePath),
      "src/app/(marketing)/capabilities/page.tsx must exist",
    ).toBe(true);
  });

  it("the page renders the expected H1 without a client-side loading shell", () => {
    const pageSource = readFileSync(
      join(__dirname, "../app/(marketing)/capabilities/page.tsx"),
      "utf-8",
    );
    expect(pageSource).toContain("What LiTT Can Do");
    expect(pageSource).not.toMatch(/["']Loading capabilities/);
  });
});
