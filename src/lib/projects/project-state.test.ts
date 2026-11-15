import { describe, it, expect } from "vitest";
import { describeProjectState, STALE_PROVISIONING_MS } from "./project-state";

const NOW = Date.parse("2026-11-10T12:00:00.000Z");
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

describe("describeProjectState — reference derivation (used by /projects)", () => {
  it("fresh provisioning reads as Preparing with no retry", () => {
    const s = describeProjectState(
      { workspaceStatus: "provisioning", runtimeStatus: "stopped", updatedAt: iso(60_000) },
      NOW,
    );
    expect(s.label).toBe("Preparing");
    expect(s.canRetry).toBe(false);
  });

  it("provisioning past the stale window reads as Stalled with retry", () => {
    const s = describeProjectState(
      {
        workspaceStatus: "provisioning",
        runtimeStatus: "stopped",
        updatedAt: iso(STALE_PROVISIONING_MS + 60_000),
      },
      NOW,
    );
    expect(s.label).toBe("Stalled");
    expect(s.detail).toBe(
      "Setup has been stuck for a while. Retry to pick it back up.",
    );
    expect(s.canRetry).toBe(true);
  });

  it("workspace ready + runtime ready reads as Preview ready (not Live)", () => {
    const s = describeProjectState(
      { workspaceStatus: "ready", runtimeStatus: "ready", updatedAt: iso(1000) },
      NOW,
    );
    expect(s.label).toBe("Preview ready");
  });

  it("workspace ready alone reads as Saved (specific state, not a vague Ready)", () => {
    const s = describeProjectState(
      { workspaceStatus: "ready", runtimeStatus: "stopped", updatedAt: iso(1000) },
      NOW,
    );
    expect(s.label).toBe("Saved");
  });

  it("failed workspace carrying HOST_EXECUTION_DISABLED reads as unavailable with NO retry", () => {
    const s = describeProjectState(
      {
        workspaceStatus: "failed",
        runtimeStatus: "stopped",
        updatedAt: iso(1000),
        workspaceError:
          'Workspace prepare failed (503): {"error":"Execution is unavailable on this deployment.","code":"HOST_EXECUTION_DISABLED"}',
      },
      NOW,
    );
    expect(s.label).toBe("Repo workspace unavailable");
    expect(s.canRetry).toBe(false);
    expect(s.detail).toMatch(/secure sandbox/i);
  });

  it("failed workspace carrying HOST_EXECUTION_DISABLED reads as a retryable Setup failed when the sandbox IS available", () => {
    // Stored-refusal fix (2026-11-14): the stored code records a
    // prepare refused by the pre-sandbox host policy. With sandboxed
    // execution available — the same truth Studio's workspace-state
    // route acts on — the card must not keep presenting the project
    // as permanently unavailable; retry is exactly how the stored
    // error gets cleared.
    const s = describeProjectState(
      {
        workspaceStatus: "failed",
        runtimeStatus: "stopped",
        updatedAt: iso(1000),
        workspaceError:
          'Workspace prepare failed (503): {"error":"Execution is unavailable on this deployment.","code":"HOST_EXECUTION_DISABLED"}',
        sandboxAvailable: true,
      },
      NOW,
    );
    expect(s.label).toBe("Setup failed");
    expect(s.canRetry).toBe(true);
    // The serialized refusal payload is not user-facing copy.
    expect(s.detail).toBe(
      "Workspace setup failed before it finished. Your project is safe.",
    );
    expect(s.detail).not.toMatch(/HOST_EXECUTION_DISABLED/);
  });

  it("failed workspace carrying HOST_EXECUTION_DISABLED stays unavailable when the sandbox probe says no", () => {
    const s = describeProjectState(
      {
        workspaceStatus: "error",
        runtimeStatus: "stopped",
        updatedAt: iso(1000),
        workspaceError:
          'Workspace prepare failed (503): {"error":"Execution is unavailable on this deployment.","code":"HOST_EXECUTION_DISABLED"}',
        sandboxAvailable: false,
      },
      NOW,
    );
    expect(s.label).toBe("Repo workspace unavailable");
    expect(s.canRetry).toBe(false);
  });

  it("sandbox availability does not soften an ordinary setup failure's detail", () => {
    const s = describeProjectState(
      {
        workspaceStatus: "failed",
        runtimeStatus: "stopped",
        updatedAt: iso(1000),
        workspaceError: "Provisioning timed out",
        sandboxAvailable: true,
      },
      NOW,
    );
    expect(s.label).toBe("Setup failed");
    expect(s.detail).toContain("Provisioning timed out");
    expect(s.canRetry).toBe(true);
  });

  it("failed workspace reads as Setup failed with retry", () => {
    const s = describeProjectState(
      {
        workspaceStatus: "failed",
        runtimeStatus: "stopped",
        updatedAt: iso(1000),
        workspaceError: "Provisioning timed out",
      },
      NOW,
    );
    expect(s.label).toBe("Setup failed");
    expect(s.detail).toContain("Provisioning timed out");
    expect(s.canRetry).toBe(true);
  });

  it("failed runtime reads as Preview failed", () => {
    const s = describeProjectState(
      { workspaceStatus: "ready", runtimeStatus: "failed", updatedAt: iso(1000) },
      NOW,
    );
    expect(s.label).toBe("Preview failed");
  });
});
