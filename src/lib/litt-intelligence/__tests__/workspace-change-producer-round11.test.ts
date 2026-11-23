/**
 * Round 11, Fix 3 — checkpoint-failure visibility + volume fallback.
 *
 * Diagnosis Q2: checkpoint failures were swallowed to null and the
 * run reported "Workspace unknown / 0 files" with no reason, even
 * when the workspace volume was readable the whole time (the Files
 * panel read it fine). These tests pin:
 *  (a) the checkpoint failure reason reaches unknownReason;
 *  (b) the volume-listing fallback verifies the files the run's own
 *      mutations declared, and only ever upgrades an "unknown".
 */
import { describe, it, expect, vi } from "vitest";
import {
  computeWorkspaceChange,
  workspaceChangeFromVolumeListing,
  workspaceChangeFromDirectReads,
  type WorkspaceChangeProbe,
} from "../workspace-change-producer";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";

const probe: WorkspaceChangeProbe = {
  gitStatus: vi.fn(async () => ({
    clean: true,
    branch: "main",
    ahead: 0,
    behind: 0,
    staged: [],
    modified: [],
    untracked: [],
  })),
};

const UNKNOWN: WorkspaceChangeEvidence = {
  status: "unknown",
  unknownReason: "No pre-mutation checkpoint was recorded to compare against.",
  rollbackAvailable: false,
};

describe("computeWorkspaceChange — checkpoint failure reason (Q2a)", () => {
  it("surfaces the recorded checkpoint failure in unknownReason", async () => {
    const result = await computeWorkspaceChange(probe, null, {
      checkpointError: "Checkpoint exec failed (500): sandbox unavailable",
    });
    expect(result.status).toBe("unknown");
    expect(result.unknownReason).toMatch(/No pre-mutation checkpoint was recorded/);
    expect(result.unknownReason).toMatch(/Checkpoint creation failed: Checkpoint exec failed \(500\)/);
  });

  it("keeps the plain reason when no failure was recorded (control)", async () => {
    const result = await computeWorkspaceChange(probe, null);
    expect(result.status).toBe("unknown");
    expect(result.unknownReason).toBe(
      "No pre-mutation checkpoint was recorded to compare against.",
    );
  });
});

describe("workspaceChangeFromVolumeListing — evidence fallback (Q2b)", () => {
  it("reports changed files when the volume listing verifies a declared path", async () => {
    const result = await workspaceChangeFromVolumeListing(UNKNOWN, {
      candidatePaths: ["public/assets/images/a-lion-mwjuqfd3.jpeg"],
      listDir: vi.fn(async (dir: string) => {
        expect(dir).toBe("public/assets/images");
        return [
          { name: "a-lion-mwjuqfd3.jpeg", type: "file" },
          { name: "other.png", type: "file" },
        ];
      }),
    });
    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["public/assets/images/a-lion-mwjuqfd3.jpeg"]);
    expect(result.evidenceSource).toBe("volume-listing");
    expect(result.rollbackAvailable).toBe(false);
  });

  it("returns the primary unknown when the volume does not contain the file", async () => {
    const result = await workspaceChangeFromVolumeListing(UNKNOWN, {
      candidatePaths: ["public/assets/images/a-lion-mwjuqfd3.jpeg"],
      listDir: vi.fn(async () => [{ name: "other.png", type: "file" }]),
    });
    expect(result).toBe(UNKNOWN);
  });

  it("never touches a non-unknown primary", async () => {
    const changed: WorkspaceChangeEvidence = {
      status: "changed",
      files: ["src/app/page.tsx"],
      rollbackAvailable: true,
    };
    const listDir = vi.fn(async () => [{ name: "page.tsx", type: "file" }]);
    const result = await workspaceChangeFromVolumeListing(changed, {
      candidatePaths: ["src/app/page.tsx"],
      listDir,
    });
    expect(result).toBe(changed);
    expect(listDir).not.toHaveBeenCalled();
  });

  it("a failing listing leaves the primary unknown untouched", async () => {
    const result = await workspaceChangeFromVolumeListing(UNKNOWN, {
      candidatePaths: ["public/assets/images/a-lion-mwjuqfd3.jpeg"],
      listDir: vi.fn(async () => {
        throw new Error("listFiles failed (503)");
      }),
    });
    expect(result).toBe(UNKNOWN);
  });

  it("directories in the listing do not count as the file", async () => {
    const result = await workspaceChangeFromVolumeListing(UNKNOWN, {
      candidatePaths: ["public/assets/images/a-lion-mwjuqfd3.jpeg"],
      listDir: vi.fn(async () => [{ name: "a-lion-mwjuqfd3.jpeg", type: "directory" }]),
    });
    expect(result).toBe(UNKNOWN);
  });
});

describe("workspaceChangeFromDirectReads — evidence fallback (ACC-01 F1)", () => {
  it("reports changed when a declared path reads back directly", async () => {
    const result = await workspaceChangeFromDirectReads(UNKNOWN, {
      candidatePaths: ["index.html"],
      readFile: vi.fn(async () => ({ content: "<html>Harbor Lights Coffee</html>" })),
    });
    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["index.html"]);
    expect(result.evidenceSource).toBe("direct-read");
    expect(result.rollbackAvailable).toBe(false);
  });

  it("verifies only the candidates that actually read back", async () => {
    const result = await workspaceChangeFromDirectReads(UNKNOWN, {
      candidatePaths: ["index.html", "assets/app.js"],
      readFile: vi.fn(async (path: string) => {
        if (path === "index.html") return { content: "<html>ok</html>" };
        throw new Error("404 not found");
      }),
    });
    expect(result.status).toBe("changed");
    expect(result.files).toEqual(["index.html"]);
  });

  it("leaves the primary unknown when nothing reads back", async () => {
    const result = await workspaceChangeFromDirectReads(UNKNOWN, {
      candidatePaths: ["index.html"],
      readFile: vi.fn(async () => {
        throw new Error("workspace unreachable");
      }),
    });
    expect(result).toBe(UNKNOWN);
  });

  it("never touches a non-unknown primary and never reads without candidates", async () => {
    const changed: WorkspaceChangeEvidence = {
      status: "changed",
      files: ["index.html"],
      rollbackAvailable: true,
    };
    const readFile = vi.fn(async () => ({ content: "x" }));
    expect(await workspaceChangeFromDirectReads(changed, { candidatePaths: ["index.html"], readFile })).toBe(changed);
    expect(await workspaceChangeFromDirectReads(UNKNOWN, { candidatePaths: [], readFile })).toBe(UNKNOWN);
    expect(readFile).not.toHaveBeenCalled();
  });
});
