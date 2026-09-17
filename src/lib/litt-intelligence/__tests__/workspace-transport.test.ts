import { describe, it, expect } from "vitest";
import {
  checkCommandForWorkspace,
  type ProjectPackageInfo,
} from "@/lib/litt-intelligence/workspace-transport";

function makeInfo(overrides: Partial<ProjectPackageInfo> = {}): ProjectPackageInfo {
  return {
    packageManager: "npm",
    scripts: {},
    hasPackageJson: true,
    hasTypecheck: false,
    hasLint: false,
    hasBuild: false,
    hasTest: false,
    ...overrides,
  };
}

describe("checkCommandForWorkspace", () => {
  it("skips typecheck entirely on a static workspace (no package.json)", () => {
    // Regression: golden acceptance failed because a static Ember Roast
    // workspace fell back to `npm exec tsc --noEmit`, which exited 1 with no
    // output and burned all three repair attempts before deploy.
    const staticInfo = makeInfo({ hasPackageJson: false });
    expect(checkCommandForWorkspace("typecheck", staticInfo)).toBeNull();
    expect(checkCommandForWorkspace("lint", staticInfo)).toBeNull();
    expect(checkCommandForWorkspace("test", staticInfo)).toBeNull();
    expect(checkCommandForWorkspace("build", staticInfo)).toBeNull();
  });

  it("runs `pm run typecheck` when a typecheck script exists", () => {
    const info = makeInfo({ hasTypecheck: true });
    expect(checkCommandForWorkspace("typecheck", info)).toBe("npm run typecheck");
  });

  it("falls back to `pm exec tsc --noEmit` when package.json exists without a typecheck script", () => {
    const info = makeInfo({ packageManager: "pnpm" });
    expect(checkCommandForWorkspace("typecheck", info)).toBe(
      "pnpm exec tsc --noEmit",
    );
  });

  it("skips build/lint/test when their scripts are absent", () => {
    const info = makeInfo();
    expect(checkCommandForWorkspace("build", info)).toBeNull();
    expect(checkCommandForWorkspace("lint", info)).toBeNull();
    expect(checkCommandForWorkspace("test", info)).toBeNull();
  });

  it("uses the detected package manager in run commands", () => {
    const info = makeInfo({ packageManager: "yarn", hasBuild: true, hasTest: true });
    expect(checkCommandForWorkspace("build", info)).toBe("yarn run build");
    expect(checkCommandForWorkspace("test", info)).toBe("yarn run test");
  });
});
