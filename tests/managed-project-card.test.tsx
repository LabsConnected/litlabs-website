/**
 * Project card copy for managed projects.
 *
 * Production evidence (Ember Roast V1 Acceptance) showed:
 *
 *   Ember Roast V1 Acceptance 23-53-52
 *   STATIC
 *   No repository
 *   —
 *
 * for a project that had durable source, Git history and a `main`
 * branch. "STATIC" is the RUNTIME and was correct; "No repository · —"
 * was not, and together they read as "this project is empty".
 */

import { describe, it, expect } from "vitest";
import { describeSourceRows } from "@/app/(app)/studio/components/CommandStudio";
import type { ConnectionCapabilities } from "@/app/(app)/studio/hooks/useConnectionSummary";

type SourceFacts = Parameters<typeof describeSourceRows>[0];

function caps(overrides: Partial<ConnectionCapabilities> = {}): SourceFacts {
  return {
    sourceKind: "managed",
    sourceLabel: "LiTT Managed",
    sourceStatus: "ready",
    versionControl: "git",
    activeBranch: "main",
    repositoryName: null,
    githubConnected: false,
    workspaceStatus: "ready",
    ...overrides,
  } as SourceFacts;
}

describe("managed project card", () => {
  it("renders the full healthy managed state", () => {
    const rows = describeSourceRows(caps());
    expect(rows).toEqual({
      source: "LiTT Managed",
      versionControl: "Git",
      branch: "main",
      workspace: "Ready",
      github: "Not connected",
    });
  });

  it('never renders "No repository" or a bare dash', () => {
    const values = Object.values(describeSourceRows(caps()));
    expect(values).not.toContain("No repository");
    expect(values).not.toContain("—");
  });

  it("renders GitHub metadata when a repository is connected", () => {
    const rows = describeSourceRows(
      caps({
        sourceKind: "github",
        sourceLabel: "GitHub",
        repositoryName: "LabsConnected/ember-roast",
        githubConnected: true,
      }),
    );
    expect(rows.source).toBe("GitHub");
    expect(rows.github).toBe("LabsConnected/ember-roast");
    expect(rows.versionControl).toBe("Git");
    expect(rows.branch).toBe("main");
  });

  it("shows provisioning progress instead of a premature Ready", () => {
    const rows = describeSourceRows(
      caps({ sourceStatus: "provisioning", workspaceStatus: "provisioning" }),
    );
    expect(rows.source).toBe("Provisioning…");
    expect(rows.workspace).toBe("Starting…");
  });

  it("surfaces a source error rather than an endless spinner", () => {
    const rows = describeSourceRows(
      caps({ sourceStatus: "error", workspaceStatus: "failed" }),
    );
    expect(rows.source).toBe("Error");
    expect(rows.workspace).toBe("Failed");
  });

  it("marks a legacy unprovisioned project as needing setup, not broken", () => {
    const rows = describeSourceRows(
      caps({ sourceStatus: "needs_setup", workspaceStatus: "not_prepared", activeBranch: null }),
    );
    expect(rows.source).toBe("Needs setup");
    expect(rows.workspace).toBe("Not prepared");
    // Only here is a dash truthful — no source has been provisioned yet.
    expect(rows.branch).toBe("—");
  });

  it("falls back to main when the branch has not propagated yet", () => {
    const rows = describeSourceRows(caps({ activeBranch: null }));
    expect(rows.branch).toBe("main");
  });
});
