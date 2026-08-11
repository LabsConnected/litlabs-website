/**
 * Owner mode regression test.
 *
 * Verifies that MissionControlDashboard uses data.ownerMode from the
 * API response instead of the previous hardcoded `const ownerMode = false`.
 */

import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";

describe("Owner mode from server (not hardcoded)", () => {
  const dashboardPath = path.resolve(
    __dirname,
    "../src/components/dashboard/v2/MissionControlDashboard.tsx",
  );
  const source = fs.readFileSync(dashboardPath, "utf-8");

  it("does NOT contain the hardcoded `const ownerMode = false`", () => {
    expect(source).not.toContain("const ownerMode = false");
  });

  it("uses data?.ownerMode from the API response", () => {
    expect(source).toContain("data?.ownerMode");
  });

  it("passes ownerMode to DraggableWidgetGrid", () => {
    expect(source).toContain("ownerMode={ownerMode}");
  });
});
