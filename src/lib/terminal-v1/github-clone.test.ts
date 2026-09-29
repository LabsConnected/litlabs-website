/**
 * github-clone input validation tests (git option-injection hardening).
 *
 * Run: npx vitest run src/lib/terminal-v1/github-clone.test.ts
 */

import { describe, it, expect } from "vitest";
import { validateCloneInput, cloneRepository, type CloneInput } from "./github-clone";

function validInput(overrides: Partial<CloneInput> = {}): CloneInput {
  return {
    owner: "LabsConnected",
    repo: "litlabs-website",
    branch: "main",
    githubToken: null,
    targetPath: "/tmp/clone-test",
    ...overrides,
  };
}

describe("validateCloneInput", () => {
  it("accepts valid inputs", () => {
    expect(() => validateCloneInput(validInput())).not.toThrow();
    expect(() =>
      validateCloneInput(
        validInput({
          owner: "my-org_2",
          repo: "my.repo-2",
          branch: "feature/add-thing_v2",
          commitSha: "9b11262166a3c48b3167a2c15daa0806195fc670",
        }),
      ),
    ).not.toThrow();
  });

  it("rejects option-injection branch names", () => {
    expect(() =>
      validateCloneInput(validInput({ branch: "--upload-pack=evil" })),
    ).toThrow(/invalid branch/i);
    expect(() =>
      validateCloneInput(validInput({ branch: "-b" })),
    ).toThrow(/invalid branch/i);
  });

  it("rejects path-traversal owner/repo", () => {
    expect(() =>
      validateCloneInput(validInput({ owner: "../x" })),
    ).toThrow(/invalid repository owner/i);
    expect(() =>
      validateCloneInput(validInput({ repo: "../../etc" })),
    ).toThrow(/invalid repository name/i);
    expect(() =>
      validateCloneInput(validInput({ owner: "x; rm -rf /" })),
    ).toThrow(/invalid repository owner/i);
  });

  it("rejects branch names outside the allowlist", () => {
    for (const branch of ["main;evil", "branch$(id)", "a b", "branch`id`", ""]) {
      expect(() => validateCloneInput(validInput({ branch }))).toThrow();
    }
  });

  it("rejects option-like target paths", () => {
    expect(() =>
      validateCloneInput(validInput({ targetPath: "--upload-pack=evil" })),
    ).toThrow(/invalid target path/i);
    expect(() => validateCloneInput(validInput({ targetPath: "" }))).toThrow();
  });

  it("rejects malformed commit SHAs", () => {
    expect(() =>
      validateCloneInput(validInput({ commitSha: "--help" })),
    ).toThrow(/invalid commit sha/i);
    expect(() =>
      validateCloneInput(validInput({ commitSha: "xyz" })),
    ).toThrow(/invalid commit sha/i);
  });

  it("requires owner, repo, and branch", () => {
    expect(() => validateCloneInput(validInput({ owner: "" }))).toThrow(
      /required/,
    );
    expect(() => validateCloneInput(validInput({ repo: "" }))).toThrow(/required/);
    expect(() => validateCloneInput(validInput({ branch: "" }))).toThrow();
  });
});

describe("cloneRepository", () => {
  it("fails closed on injection inputs before invoking git", async () => {
    await expect(
      cloneRepository(validInput({ branch: "--upload-pack=evil" })),
    ).rejects.toThrow(/invalid branch/i);
    await expect(
      cloneRepository(validInput({ owner: "../x" })),
    ).rejects.toThrow(/invalid repository owner/i);
  });
});
