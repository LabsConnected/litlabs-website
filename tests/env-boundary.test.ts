/**
 * Environment-boundary tests: production Supabase must never be the implicit
 * target of a script or automated test.
 *
 * Rules enforced:
 *  1. No `|| "https://<prod>.supabase.co"` fallback in scripts or specs —
 *     targets must come from explicit env configuration.
 *  2. Any script/spec file that references the production project ref must
 *     also contain the LITT_ALLOW_PROD_TARGET opt-in guard.
 *  3. The production ref itself may appear in docs and in fake test fixtures;
 *     this test only scans executable script/spec code.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "..");
const PROD_PROJECT_REF = "rokbfvuoqildggnhappy";
const GUARD = "LITT_ALLOW_PROD_TARGET";

function collect(dir: string, exts: RegExp): string[] {
  const base = path.join(ROOT, dir);
  if (!fs.existsSync(base)) return [];
  return fs
    .readdirSync(base, { recursive: true })
    .map(String)
    .filter((f) => exts.test(f))
    .map((f) => path.join(base, f));
}

const SCAN_DIRS = ["scripts", path.join("tests", "playwright")];
const files = SCAN_DIRS.flatMap((d) => collect(d, /\.(c?js|ts|mts)$/));

describe("environment boundary — production Supabase", () => {
  it("no script or spec defaults to the production project", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      // implicit fallback: `env || "https://prod…"` or bare assignment
      const hasFallback =
        new RegExp(`\\|\\|\\s*["'\`]https://${PROD_PROJECT_REF}\\.supabase\\.co`).test(src) ||
        new RegExp(`=\\s*["'\`]https://${PROD_PROJECT_REF}\\.supabase\\.co["'\`]\\s*;`).test(src);
      if (hasFallback) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it("every file referencing the production ref also carries the opt-in guard", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes(PROD_PROJECT_REF)) continue;
      // Fake fixtures (values fed to code under test, not connection targets)
      // and this test itself are exempt — guards are about who can CONNECT.
      const name = path.basename(file);
      if (name === "env-boundary.test.ts" || name === "railway-env-regression.test.ts") continue;
      if (!src.includes(GUARD)) offenders.push(path.relative(ROOT, file));
    }
    expect(offenders).toEqual([]);
  });

  it("the guard constant used everywhere matches", () => {
    for (const file of files) {
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes(PROD_PROJECT_REF)) continue;
      expect(src, `${path.relative(ROOT, file)} should use ${GUARD}`).not.toMatch(
        /ALLOW_PROD(?!_TARGET)|ALLOW_PRODUCTION[^_]/,
      );
    }
  });
});
