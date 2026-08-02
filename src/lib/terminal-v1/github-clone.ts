/**
 * GitHub clone service for Terminal V1.
 *
 * Clones GitHub repositories into a sandbox's persistent volume.
 * Uses the GitHub App installation token for authentication.
 */

import { execFile } from "child_process";
import { promisify } from "util";

const execFileAsync = promisify(execFile);

export interface CloneInput {
  owner: string;
  repo: string;
  branch: string;
  githubToken: string | null;
  targetPath: string;
  commitSha?: string | null;
}

export interface CloneResult {
  commitSha: string;
  branch: string;
}

/**
 * Clone a GitHub repository into the target path.
 *
 * If a commitSha is provided, checks out that specific commit.
 * Otherwise, checks out the branch HEAD.
 */
export async function cloneRepository(input: CloneInput): Promise<CloneResult> {
  const { owner, repo, branch, githubToken, targetPath, commitSha } = input;

  if (!owner || !repo || !branch) {
    throw new Error("owner, repo, and branch are required for clone");
  }

  // Build the clone URL with optional token
  const protocol = githubToken ? "https" : "https";
  const authPart = githubToken ? `${githubToken}@` : "";
  const cloneUrl = `${protocol}://${authPart}github.com/${owner}/${repo}.git`;

  // Clone the repository (shallow clone for speed)
  const cloneArgs = [
    "clone",
    "--depth", "1",
    "--branch", branch,
    cloneUrl,
    targetPath,
  ];

  try {
    await execFileAsync("git", cloneArgs, {
      timeout: 60_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (err) {
    throw new Error(
      `Failed to clone ${owner}/${repo}:${branch}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Get the commit SHA
  let finalCommitSha = commitSha ?? "";
  if (!finalCommitSha) {
    try {
      const { stdout } = await execFileAsync(
        "git",
        ["rev-parse", "HEAD"],
        { cwd: targetPath, timeout: 10_000 },
      );
      finalCommitSha = stdout.trim();
    } catch {
      // Non-fatal — we just don't have the SHA
    }
  }

  // If a specific commit was requested, try to check it out
  if (commitSha && commitSha !== finalCommitSha) {
    try {
      // Unshallow first to access the specific commit
      await execFileAsync("git", ["fetch", "--unshallow"], {
        cwd: targetPath,
        timeout: 60_000,
      });
      await execFileAsync("git", ["checkout", commitSha], {
        cwd: targetPath,
        timeout: 10_000,
      });
      finalCommitSha = commitSha;
    } catch {
      // Non-fatal — stay on branch HEAD
    }
  }

  return {
    commitSha: finalCommitSha,
    branch,
  };
}

/**
 * Initialize a blank workspace with a default directory structure.
 */
export async function initBlankWorkspace(targetPath: string): Promise<void> {
  const { mkdir } = await import("fs/promises");
  const { join } = await import("path");

  // Create basic directory structure
  await mkdir(join(targetPath, "src"), { recursive: true });
  await mkdir(join(targetPath, "tests"), { recursive: true });

  // Create a minimal README
  const { writeFile } = await import("fs/promises");
  await writeFile(
    join(targetPath, "README.md"),
    "# My LiTTree Workspace\n\nCreated with LiTTree Lab Studios.\n",
    "utf-8",
  );
}
