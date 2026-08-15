import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * Regression test: a verified GitHub workspace must never render "DEMO".
 *
 * The DEMO badge was unconditionally hardcoded in CommandStudioHeader.tsx.
 * This test reads the source file and verifies no DEMO badge is rendered
 * without a conditional that gates it to non-production environments.
 */
describe("DEMO badge regression", () => {
  const headerPath = join(
    process.cwd(),
    "src",
    "app",
    "(app)",
    "studio",
    "components",
    "CommandStudioHeader.tsx",
  );

  it("source file does not contain unconditional DEMO badge", () => {
    const source = readFileSync(headerPath, "utf-8");

    // The unconditional DEMO span was removed. Verify it's gone.
    // We search for the pattern: >DEMO< which would be the rendered text content.
    const demoMatches = source.match(/>DEMO</g);
    expect(demoMatches).toBeNull();
  });

  it("source file does not contain 'Demo environment' title", () => {
    const source = readFileSync(headerPath, "utf-8");
    expect(source).not.toContain('title="Demo environment"');
  });

  it("source file does not contain demo badge comment", () => {
    const source = readFileSync(headerPath, "utf-8");
    // The old comment was: {/* DEMO badge — indicates demo/test environment */}
    expect(source).not.toContain("DEMO badge");
  });
});
