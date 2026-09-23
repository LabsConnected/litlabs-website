/**
 * Projects page — honest state badges + recent-first ordering.
 *
 * Covers src/lib/projects/project-state.ts:
 *   - failed workspace / runtime produce truthful labels, detail copy,
 *     and the right retry affordance
 *   - provisioning stuck longer than STALE_PROVISIONING_MS becomes "Stalled"
 *     with a retry action instead of a permanent "Preparing"
 *   - badge colors never drift into blue/purple/cyan/pink
 *   - projects sort newest-first
 */
import { describe, it, expect } from "vitest";
import {
  describeProjectState,
  sortProjectsRecentFirst,
  BADGE_PALETTE,
  STALE_PROVISIONING_MS,
  type ProjectStateInput,
} from "@/lib/projects/project-state";

const base: ProjectStateInput = {
  workspaceStatus: "ready",
  runtimeStatus: "ready",
  updatedAt: new Date().toISOString(),
};

const NOW = Date.parse("2026-09-22T12:00:00Z");
const twoDaysAgo = new Date(NOW - 2 * 24 * 60 * 60 * 1000).toISOString();
const tenMinutesAgo = new Date(NOW - 10 * 60 * 1000).toISOString();

describe("describeProjectState", () => {
  it("reports a failed workspace as 'Setup failed' with a retry action", () => {
    const s = describeProjectState(
      { ...base, workspaceStatus: "failed", workspaceError: "clone timed out" },
      NOW,
    );
    expect(s.label).toBe("Setup failed");
    expect(s.canRetry).toBe(true);
    expect(s.detail).toContain("clone timed out");
  });

  it("falls back to honest generic copy when no workspace error is stored", () => {
    const s = describeProjectState(
      { ...base, workspaceStatus: "error" },
      NOW,
    );
    expect(s.label).toBe("Setup failed");
    expect(s.detail).toBeTruthy();
    expect(s.canRetry).toBe(true);
  });

  it("reports a failed runtime as 'Preview failed' without a retry action", () => {
    const s = describeProjectState(
      { ...base, runtimeStatus: "failed", runtimeError: "port in use" },
      NOW,
    );
    expect(s.label).toBe("Preview failed");
    expect(s.canRetry).toBe(false);
    expect(s.detail).toContain("port in use");
  });

  it("marks long-stuck provisioning as 'Stalled' with a retry action", () => {
    const s = describeProjectState(
      { ...base, workspaceStatus: "provisioning", updatedAt: twoDaysAgo },
      NOW,
    );
    expect(s.label).toBe("Stalled");
    expect(s.canRetry).toBe(true);
    expect(s.detail).toBeTruthy();
  });

  it("keeps fresh provisioning as 'Preparing' with no alarm", () => {
    const s = describeProjectState(
      { ...base, workspaceStatus: "preparing", updatedAt: tenMinutesAgo },
      NOW,
    );
    expect(s.label).toBe("Preparing");
    expect(s.canRetry).toBe(false);
    expect(s.detail).toBeNull();
  });

  it("treats a stuck starting runtime as stalled too", () => {
    const s = describeProjectState(
      { ...base, runtimeStatus: "starting", updatedAt: twoDaysAgo },
      NOW,
    );
    expect(s.label).toBe("Stalled");
    expect(s.canRetry).toBe(true);
  });

  it("reports a fully ready project as 'Preview ready'", () => {
    const s = describeProjectState(base, NOW);
    expect(s.label).toBe("Preview ready");
    expect(s.canRetry).toBe(false);
    expect(s.detail).toBeNull();
  });

  it("reports a prepared-but-idle workspace as 'Ready'", () => {
    const s = describeProjectState(
      { ...base, runtimeStatus: "stopped" },
      NOW,
    );
    expect(s.label).toBe("Ready");
  });

  it("reports an untouched project as 'Setup needed'", () => {
    const s = describeProjectState(
      { ...base, workspaceStatus: "not_prepared" },
      NOW,
    );
    expect(s.label).toBe("Setup needed");
  });

  it("never returns a badge color outside the lime-system palette", () => {
    const cases: ProjectStateInput[] = [
      base,
      { ...base, workspaceStatus: "failed" },
      { ...base, runtimeStatus: "failed" },
      { ...base, workspaceStatus: "provisioning", updatedAt: twoDaysAgo },
      { ...base, workspaceStatus: "preparing", updatedAt: tenMinutesAgo },
      { ...base, runtimeStatus: "starting", updatedAt: twoDaysAgo },
      { ...base, runtimeStatus: "stopped" },
      { ...base, workspaceStatus: "not_prepared" },
    ];
    for (const c of cases) {
      const s = describeProjectState(c, NOW);
      expect(BADGE_PALETTE).toContain(s.color);
      expect(s.color.toLowerCase()).not.toMatch(
        /60a5fa|a78bfa|violet|purple|cyan|pink/,
      );
    }
  });

  it("uses a staleness threshold of at most one hour", () => {
    expect(STALE_PROVISIONING_MS).toBeLessThanOrEqual(60 * 60 * 1000);
  });
});

describe("sortProjectsRecentFirst", () => {
  it("orders newest first and sinks unparseable dates", () => {
    const ordered = sortProjectsRecentFirst([
      { id: "old", updatedAt: "2026-09-20T00:00:00Z" },
      { id: "new", updatedAt: "2026-09-22T00:00:00Z" },
      { id: "mid", updatedAt: "2026-09-21T00:00:00Z" },
      { id: "bad", updatedAt: "not-a-date" },
    ]);
    expect(ordered.map((p) => p.id)).toEqual(["new", "mid", "old", "bad"]);
  });

  it("does not mutate the input array", () => {
    const input = [
      { id: "a", updatedAt: "2026-09-20T00:00:00Z" },
      { id: "b", updatedAt: "2026-09-22T00:00:00Z" },
    ];
    sortProjectsRecentFirst(input);
    expect(input[0].id).toBe("a");
  });
});
