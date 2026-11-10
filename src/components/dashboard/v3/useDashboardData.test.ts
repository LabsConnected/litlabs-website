import { describe, it, expect } from "vitest";
import { mapCanonicalProjectToDashboard } from "./useDashboardData";
import type { CanonicalListProject } from "@/lib/projects/canonical-project-list";

const DAY = 24 * 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString();

function project(overrides: Partial<CanonicalListProject>): CanonicalListProject {
  return {
    id: "proj-1",
    name: "SUDSY-PAWS-ACCEPTANCE",
    workspaceStatus: "ready",
    runtimeStatus: "stopped",
    updatedAt: iso(DAY),
    ...overrides,
  };
}

describe("mapCanonicalProjectToDashboard — must agree with /projects", () => {
  it("runtime ready is Preview ready, NOT Live (no deployment evidence)", () => {
    const p = mapCanonicalProjectToDashboard(
      project({ workspaceStatus: "ready", runtimeStatus: "ready" }),
    );
    expect(p.status).toBe("preview");
  });

  it("42-day-old provisioning is Stalled, not Building", () => {
    const p = mapCanonicalProjectToDashboard(
      project({
        workspaceStatus: "provisioning",
        runtimeStatus: "stopped",
        updatedAt: iso(42 * DAY),
      }),
    );
    expect(p.status).toBe("stalled");
  });

  it("42-day-old runtime starting is Stalled, not Building", () => {
    const p = mapCanonicalProjectToDashboard(
      project({
        workspaceStatus: "ready",
        runtimeStatus: "starting",
        updatedAt: iso(42 * DAY),
      }),
    );
    expect(p.status).toBe("stalled");
  });

  it("fresh provisioning is Building", () => {
    const p = mapCanonicalProjectToDashboard(
      project({
        workspaceStatus: "provisioning",
        runtimeStatus: "stopped",
        updatedAt: iso(60_000),
      }),
    );
    expect(p.status).toBe("building");
  });

  it("workspace ready + runtime stopped is Ready, matching /projects", () => {
    const p = mapCanonicalProjectToDashboard(
      project({ workspaceStatus: "ready", runtimeStatus: "stopped" }),
    );
    expect(p.status).toBe("ready");
  });

  it("failed workspace is Failed", () => {
    const p = mapCanonicalProjectToDashboard(
      project({ workspaceStatus: "failed", runtimeStatus: "stopped" }),
    );
    expect(p.status).toBe("failed");
  });

  it("failed runtime is Failed", () => {
    const p = mapCanonicalProjectToDashboard(
      project({ workspaceStatus: "ready", runtimeStatus: "failed" }),
    );
    expect(p.status).toBe("failed");
  });

  it("not-prepared workspace is Draft", () => {
    const p = mapCanonicalProjectToDashboard(
      project({ workspaceStatus: "not_prepared", runtimeStatus: "stopped" }),
    );
    expect(p.status).toBe("draft");
  });
});
