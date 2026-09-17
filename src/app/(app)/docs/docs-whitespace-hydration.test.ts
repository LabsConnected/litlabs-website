import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Regression test for the React hydration #418 caused by a literal space
 * after a component closing tag, e.g.:
 *
 *   <InlineCode>litt doctor</InlineCode> checks your setup
 *
 * Production streaming SSR can drop that leading space from the emitted
 * HTML while the client render keeps it, so hydration throws #418
 * ("Text content does not match server-rendered HTML") and React discards
 * the SSR tree. The fix is an explicit {" "}:
 *
 *   <InlineCode>litt doctor</InlineCode>{" "}checks your setup
 *
 * This test statically scans docs client components for the hazardous
 * pattern so it can't be reintroduced. (PR #311 fixed the lowercase-tag
 * variant; this covers PascalCase components like <InlineCode> which the
 * original grep missed — /docs/troubleshooting kept throwing #418.)
 */
function collectClientFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectClientFiles(full, out);
    } else if (/Client\.tsx$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

// A component closing tag (PascalCase or lowercase) followed by a literal
// space and then visible text on the same line. Excludes the {" "} fix.
const HAZARD = /<\/[A-Za-z][A-Za-z0-9]*> (?![{"< \n])/;

describe("docs hydration: no literal space after component closing tags", () => {
  const docsDir = join(__dirname);
  const files = collectClientFiles(docsDir);

  it("finds docs client components to scan", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} has no hazardous trailing-space pattern`, () => {
      const src = readFileSync(file, "utf8");
      const badLines = src
        .split("\n")
        .map((line, i) => ({ line, i: i + 1 }))
        .filter(({ line }) => HAZARD.test(line))
        // Allow the pattern inside string literals / comments is out of
        // scope; flag the raw JSX usage.
        .map(({ line, i }) => `L${i}: ${line.trim()}`);
      expect(badLines).toEqual([]);
    });
  }
});
