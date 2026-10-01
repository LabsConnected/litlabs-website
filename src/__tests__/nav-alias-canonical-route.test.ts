import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CANONICAL_REDIRECTS,
  type CanonicalRedirect,
} from "@/lib/canonical-redirects";

const repoRoot = path.resolve(__dirname, "..", "..");

function findRedirect(source: string): CanonicalRedirect | undefined {
  return (CANONICAL_REDIRECTS as readonly CanonicalRedirect[]).find(
    (r) => r.source === source,
  );
}

const ALIASES: Array<{ source: string; destination: string }> = [
  { source: "/assets", destination: "/studio?tool=assets" },
  { source: "/missions", destination: "/studio?tool=workflows" },
  { source: "/files", destination: "/library/files" },
  { source: "/saved", destination: "/library/saved" },
  { source: "/connections", destination: "/settings/connections" },
];

describe("P0 nav aliases (issue #602)", () => {
  it.each(ALIASES)("308 $source → $destination", ({ source, destination }) => {
    const entry = findRedirect(source);
    expect(entry).toBeDefined();
    expect(entry!.destination).toBe(destination);
    expect(entry!.permanent).toBe(true);
  });

  it("next.config.ts still spreads CANONICAL_REDIRECTS", () => {
    const configSource = readFileSync(
      path.join(repoRoot, "next.config.ts"),
      "utf8",
    );
    expect(configSource).toContain("CANONICAL_REDIRECTS");
  });

  it("wallet starter copy is 1,500 LiTTBits, not 500 credits", () => {
    const wallet = readFileSync(
      path.join(repoRoot, "src/app/(app)/wallet/page.tsx"),
      "utf8",
    );
    expect(wallet).toContain("1,500 LiTTBits");
    expect(wallet).not.toContain("500 starter AI credits");
  });

  it("agents catalog branches on the Clerk server session", () => {
    const agents = readFileSync(
      path.join(repoRoot, "src/app/(marketing)/agents/page.tsx"),
      "utf8",
    );
    expect(agents).toContain('from "@clerk/nextjs/server"');
    expect(agents).toContain("You're signed in.");
    expect(agents).toContain("Sign in or create an account to use agents.");
  });
});
