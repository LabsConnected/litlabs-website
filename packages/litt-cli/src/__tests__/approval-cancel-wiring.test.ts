/**
 * Approval-cancel wiring — regression for the swallowed-Esc bug.
 *
 * Observed live (drive-run7): Esc pressed while `⚠ APPROVAL` owned the
 * keyboard did NOTHING — ApprovalUX accepted an optional onCancelMission
 * prop ("Esc = deny + stop the mission") but app.tsx never passed it, so
 * `onCancelMission?.()` was a no-op and the mission kept running (and
 * kept requesting approvals) until verification failed on its own.
 *
 * These are source-level assertions matching the repo's wiring-test
 * convention (see activity-stream-stage1.test.tsx).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appSrc = readFileSync(join(here, "..", "ink", "app.tsx"), "utf8");
const approvalSrc = readFileSync(join(here, "..", "ink", "approval-ux.tsx"), "utf8");

describe("approval Esc/Ctrl+C cancel wiring", () => {
  it("app.tsx passes onCancelMission to ApprovalUX", () => {
    expect(appSrc).toMatch(/<ApprovalUX[\s\S]*?onCancelMission=\{cancelActiveWork\}/);
  });

  it("cancelActiveWork aborts every execution layer", () => {
    const fn = appSrc.match(/const cancelActiveWork = useCallback\(\(\) => \{([\s\S]*?)\}, \[/);
    expect(fn).not.toBeNull();
    const body = fn![1];
    expect(body).toContain("session.cancel()");
    expect(body).toContain("controller.cancelRemoteModel()");
    expect(body).toContain("controller.cancelActiveRun()");
    expect(body).toContain("approvalBridge.cancel()");
    expect(body).toContain("clearApproval()");
  });

  it("app-level Esc and Ctrl+C both route through cancelActiveWork", () => {
    expect(appSrc).toMatch(/key\.escape[\s\S]*?cancelActiveWork\(\)/);
    expect(appSrc).toMatch(/isCtrl\(input, key, "c"\)[\s\S]*?cancelActiveWork\(\)/);
  });

  it("ApprovalUX Esc and Ctrl+C invoke onCancelMission", () => {
    expect(approvalSrc).toMatch(/isEscape\(key, input\)[\s\S]*?onCancelMission\?\.\(\)/);
    expect(approvalSrc).toMatch(/key\.ctrl[\s\S]*?onCancelMission\?\.\(\)/);
  });
});
