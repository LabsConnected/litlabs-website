/**
 * Owner mode regression test.
 *
 * The v2 MissionControlDashboard (which consumed ownerMode client-side)
 * was retired with the canonical-nav dashboard consolidation. The live
 * contract is now server-side: /api/dashboard/mission-control resolves
 * owner identity via isOwnerClerkId/getRole — never a hardcoded false.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Owner mode resolved server-side (not hardcoded)", () => {
  const routePath = path.resolve(
    __dirname,
    "../src/app/api/dashboard/mission-control/route.ts",
  );
  const source = fs.readFileSync(routePath, "utf-8");

  it("resolves owner identity via isOwnerClerkId", () => {
    expect(source).toContain("isOwnerClerkId(userId)");
  });

  it("derives ownerMode from the server-resolved role", () => {
    expect(source).toContain('ownerMode = role === "owner"');
  });

  it("returns ownerMode in the response payload", () => {
    expect(source).toContain("ownerMode,");
  });

  it("gates owner-only growth data on ownerMode", () => {
    expect(source).toContain("ownerMode ? await resolveGrowth(client) : null");
  });
});
