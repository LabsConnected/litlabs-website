import {
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, test } from "vitest";

import {
  checkGitMain,
  getProductionRepoRoot,
} from "../lib/production-checks.js";

const originalCwd = process.cwd();
const originalLittCwd = process.env.LITT_CWD;

function restoreEnvironment(): void {
  process.chdir(originalCwd);

  if (originalLittCwd === undefined) {
    delete process.env.LITT_CWD;
  } else {
    process.env.LITT_CWD = originalLittCwd;
  }
}

function createGitProject(branch: string): string {
  const root = mkdtempSync(join(tmpdir(), "litt-production-root-"));

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "litt-production-root-fixture",
        private: true,
      },
      null,
      2,
    ),
  );

  writeFileSync(join(root, "README.md"), "# fixture\n");

  execFileSync("git", ["init"], {
    cwd: root,
    stdio: "ignore",
  });

  execFileSync("git", ["config", "user.email", "test@example.invalid"], {
    cwd: root,
    stdio: "ignore",
  });

  execFileSync("git", ["config", "user.name", "LiTT Test"], {
    cwd: root,
    stdio: "ignore",
  });

  execFileSync("git", ["add", "."], {
    cwd: root,
    stdio: "ignore",
  });

  execFileSync("git", ["commit", "-m", "fixture"], {
    cwd: root,
    stdio: "ignore",
  });

  execFileSync("git", ["branch", "-M", branch], {
    cwd: root,
    stdio: "ignore",
  });

  return root;
}

afterEach(() => {
  restoreEnvironment();
});

describe("production project root", () => {
  test("uses the caller project instead of the CLI installation directory", () => {
    const project = createGitProject("main");

    try {
      delete process.env.LITT_CWD;
      process.chdir(project);

      expect(getProductionRepoRoot()).toBe(project);

      expect(checkGitMain()).toMatchObject({
        id: "git.branch",
        status: "pass",
        detail: "main",
      });
    } finally {
      restoreEnvironment();
      rmSync(project, { recursive: true, force: true });
    }
  });

  test("honors LITT_CWD when the launcher runs from another directory", () => {
    const project = createGitProject("main");

    try {
      process.chdir(originalCwd);
      process.env.LITT_CWD = project;

      expect(getProductionRepoRoot()).toBe(project);

      expect(checkGitMain()).toMatchObject({
        status: "pass",
        detail: "main",
      });
    } finally {
      restoreEnvironment();
      rmSync(project, { recursive: true, force: true });
    }
  });
});
