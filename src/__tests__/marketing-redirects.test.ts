import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ─── Regression test: /capabilities must redirect, never 404 ───
//
// Larry's site audit (2026-09-22, issue #469): https://www.litlabs.net/capabilities
// returned a 404. The nav "Capabilities" label points at the /#what-we-do
// homepage section, so the URL itself must permanently redirect there instead
// of dead-ending direct visitors and guessers.
//
// We assert against the raw next.config.ts source (rather than importing the
// config, which pulls in @sentry/nextjs and Next.js build-time APIs not meant
// to run under vitest) since the redirect entry is a static object literal.

describe("/capabilities redirect (issue #469)", () => {
  const configSource = readFileSync(
    join(__dirname, "../../next.config.ts"),
    "utf-8",
  );

  it("registers a permanent redirect from /capabilities to /#what-we-do", () => {
    const pattern =
      /\{\s*source:\s*"\/capabilities",\s*destination:\s*"\/\#what-we-do",\s*permanent:\s*true\s*\}/;
    expect(
      pattern.test(configSource),
      "next.config.ts must contain { source: \"/capabilities\", destination: \"/#what-we-do\", permanent: true }",
    ).toBe(true);
  });
});
