/**
 * Release guard: verifies no retired Clerk auth domains leak into
 * production executable code.
 *
 * The old Account Portal (accounts.litlabs.net) is retired. The
 * canonical OAuth consent endpoint is www.litlabs.net/oauth-consent.
 * The canonical Clerk FAPI is clerk.litlabs.net. The canonical OIDC
 * issuer (from .well-known) is litlabs.net/__clerk.
 *
 * This test scans production source files (excluding test scripts,
 * node_modules, and build artifacts) for references to the retired
 * domain and fails if any are found in executable code.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const RETIRED_DOMAINS = ["accounts.litlabs.net"] as const;

// Directories that are NOT production executable code.
const EXCLUDE_DIRS = [
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  "test-results",
  "artifacts",
];

// File extensions that ARE production executable code.
const PRODUCTION_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mjs"];

// Files/directories under src/ that are test scripts, not production code.
const TEST_PATH_PATTERNS = [
  /\/__tests__\//,
  /\/__mocks__\//,
  /\.test\./,
  /\.spec\./,
  /\/tests\//,
  /\/scripts\//,
];

/**
 * The sign-in page contains a DEFENSIVE rewrite that maps
 * accounts.litlabs.net → www.litlabs.net in the redirect_url. This is
 * required because the Clerk Dashboard OAuth client's consent URL may
 * still point to the old Account Portal. The rewrite is a compatibility
 * shim, not a stale reference — it actively neutralizes the retired domain.
 *
 * Files in this allowlist are permitted to mention the retired domain
 * ONLY in the context of rewriting it to the canonical domain.
 */
const DEFENSIVE_REWRITE_ALLOWLIST: ReadonlyMap<string, string> = new Map([
  ["src/app/sign-in/page.tsx", "accounts.litlabs.net"],
]);

function isProductionFile(filePath: string): boolean {
  const ext = path.extname(filePath);
  if (!PRODUCTION_EXTENSIONS.includes(ext)) return false;
  if (TEST_PATH_PATTERNS.some((p) => p.test(filePath))) return false;
  return true;
}

function walkDir(dir: string, results: string[] = []): string[] {
  if (!fs.existsSync(dir)) return results;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (EXCLUDE_DIRS.includes(entry.name)) continue;
      walkDir(fullPath, results);
    } else if (entry.isFile() && isProductionFile(fullPath)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("release guard: no retired Clerk auth domains in production code", () => {
  it.each(RETIRED_DOMAINS)("production source contains no references to %s", (domain) => {
    const srcDir = path.resolve("src");
    const files = walkDir(srcDir);
    const offenders: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes(domain)) {
        const relPath = path.relative(process.cwd(), file).replace(/\\/g, "/");
        const allowedDomain = DEFENSIVE_REWRITE_ALLOWLIST.get(relPath);
        if (allowedDomain === domain) continue; // defensive rewrite — allowed
        offenders.push(relPath);
      }
    }

    // Also check the allowlisted files actually contain the rewrite
    for (const [allowedFile, allowedDomain] of DEFENSIVE_REWRITE_ALLOWLIST) {
      if (allowedDomain !== domain) continue;
      const fullPath = path.resolve(allowedFile);
      if (fs.existsSync(fullPath)) {
        const content = fs.readFileSync(fullPath, "utf8");
        if (!content.includes(domain)) {
          offenders.push(`${allowedFile} (allowlisted but domain not present — remove from allowlist)`);
        }
      }
    }

    if (offenders.length > 0) {
      expect.fail(
        `Retired domain "${domain}" found in production source files:\n` +
          offenders.map((f) => `  - ${f}`).join("\n") +
          `\n\nThe canonical consent endpoint is www.litlabs.net/oauth-consent.\n` +
          `The old Account Portal (${domain}) is retired and must not be\n` +
          `referenced in executable production code.`,
      );
    }
  });

  it("NEXT_PUBLIC_CLERK_PROXY_URL is not set as a real proxy URL in ClerkProvider", () => {
    const layoutPath = path.resolve("src/app/layout.tsx");
    if (!fs.existsSync(layoutPath)) return; // skip if structure changed
    const content = fs.readFileSync(layoutPath, "utf8");
    // ClerkProvider should NOT have proxyUrl set to a /__clerk path
    // (we use direct FAPI via clerk.litlabs.net)
    expect(content).not.toMatch(/proxyUrl\s*[:=]\s*["'`].*\/__clerk/);
  });
});
