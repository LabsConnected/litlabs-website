import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Production Supabase environment boundary.
 *
 * The production project ref must never appear as a fallback or default
 * target in scripts, tests, configuration, or app code. Automated tooling
 * (migrations, smoke tests, E2E) has to select its environment explicitly
 * and refuse production unless deliberately overridden.
 */
const PRODUCTION_PROJECT_REF = "rokbfvuoqildggnhappy";

const repoRoot = path.resolve(__dirname, "..");

function collectFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, out);
    else if (/\.(c?js|ts|tsx|mjs|example|env|sh|ps1|ya?ml|toml)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const scannedRoots = ["scripts", "tests", "packages", "src", "n8n", ".github"];

// Documentation may name the project for humans; executable trees may not.
const allowedPaths = new Set<string>([
  // The boundary check itself.
  path.join("tests", "supabase-prod-boundary.test.ts"),
  // Files whose only occurrence is the PRODUCTION_PROJECT_REF guard constant
  // (used to REFUSE production targets — verified by the third test below).
  path.join("scripts", "apply-migrations.js"),
  path.join("scripts", "smoke-canvas-api.cjs"),
  path.join("tests", "playwright", "hire-e2e.spec.ts"),
  // Environment-shape validator: uses the ref inside a negative-contains
  // check to assert env files do NOT point at production.
  path.join("scripts", "validate-env-shape.mjs"),
]);

describe("production Supabase project boundary", () => {
  it("no executable file contains the production project ref", () => {
    const offenders: string[] = [];
    for (const root of scannedRoots) {
      const dir = path.join(repoRoot, root);
      if (!fs.existsSync(dir)) continue;
      for (const file of collectFiles(dir)) {
        if (allowedPaths.has(path.relative(repoRoot, file))) continue;
        const content = fs.readFileSync(file, "utf8");
        if (content.includes(PRODUCTION_PROJECT_REF)) {
          offenders.push(path.relative(repoRoot, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("environment-mutating scripts refuse the production project by default", () => {
    const guardedScripts = [
      path.join("scripts", "apply-migrations.js"),
      path.join("scripts", "smoke-canvas-api.cjs"),
    ];
    for (const rel of guardedScripts) {
      const content = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      expect(
        content.includes("ALLOW_PRODUCTION_SUPABASE"),
        `${rel} must require ALLOW_PRODUCTION_SUPABASE=1 to touch production`,
      ).toBe(true);
    }
  });

  it("the production ref only survives inside guard constants and docs", () => {
    // Any remaining literal must be the PRODUCTION_PROJECT_REF guard
    // constant (used to REFUSE production) or documentation — never a
    // connection target.
    for (const rel of [
      path.join("scripts", "apply-migrations.js"),
      path.join("scripts", "smoke-canvas-api.cjs"),
      path.join("tests", "playwright", "hire-e2e.spec.ts"),
      path.join("scripts", "validate-env-shape.mjs"),
    ]) {
      const content = fs.readFileSync(path.join(repoRoot, rel), "utf8");
      for (const line of content.split("\n")) {
        if (!line.includes(PRODUCTION_PROJECT_REF)) continue;
        expect(
          line.includes("PRODUCTION_PROJECT_REF") ||
            line.includes("includes(") ||
            line.trim().startsWith("//") ||
            line.trim().startsWith("*"),
          `${rel} contains a non-guard production reference: ${line.trim()}`,
        ).toBe(true);
      }
    }
  });
});
