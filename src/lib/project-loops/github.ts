/**
 * Project Loops — GitHub integration
 *
 * Thin wrapper around `src/lib/github-app.ts` that exposes the higher-level
 * operations a loop needs: snapshot the repo, create a working branch,
 * apply file changes, revert, and open a pull request.
 *
 * If the GitHub App credentials aren't set we degrade to a "dry-run"
 * mode that still returns plausible shapes so the UI keeps working.
 */

import type { ProjectLoop, LoopFileChange } from "@/types/project-loops";
import type { RepoSnapshot } from "@/lib/project-loops/roles";

/* ── Credential check ──────────────────────────────────────────── */

export function githubAvailable(): boolean {
  return !!(
    process.env.GITHUB_APP_ID &&
    process.env.GITHUB_PRIVATE_KEY &&
    process.env.GITHUB_INSTALLATION_ID
  );
}

/* ── Lazy loader for the GitHub App helpers ────────────────────── */

async function getOctokit() {
  const { getInstallationOctokit } = await import("@/lib/github-app");
  const installationId = Number(process.env.GITHUB_INSTALLATION_ID);
  if (!Number.isFinite(installationId) || installationId <= 0) {
    throw new Error("GITHUB_INSTALLATION_ID is not a positive number");
  }
  return getInstallationOctokit(installationId);
}

/* ── Repo snapshot ─────────────────────────────────────────────── */

const SAMPLE_FILES: { path: string; size: number }[] = [
  { path: "README.md", size: 1200 },
  { path: "package.json", size: 980 },
  { path: "tsconfig.json", size: 540 },
  { path: "next.config.ts", size: 700 },
  { path: "src/app/layout.tsx", size: 4300 },
  { path: "src/app/page.tsx", size: 2100 },
  { path: "src/components/LayoutShell.tsx", size: 1800 },
  { path: "src/components/TopNavbar.tsx", size: 1500 },
  { path: "src/components/Sidebar.tsx", size: 4200 },
  { path: "src/components/MobileBottomNav.tsx", size: 1100 },
  { path: "src/lib/navigation.ts", size: 1600 },
  { path: "src/lib/llm.ts", size: 5400 },
  { path: "src/lib/AgentOrchestrator.ts", size: 1900 },
  { path: "src/lib/github-app.ts", size: 1600 },
  { path: "src/types/project-loops.ts", size: 1500 },
  { path: "src/lib/project-loops/runner.ts", size: 5800 },
  { path: "src/lib/project-loops/roles.ts", size: 1200 },
  { path: "src/lib/project-loops/github.ts", size: 900 },
  { path: "supabase/migrations/20260716000000_project_loops.sql", size: 1300 },
  { path: "src/app/api/loops/route.ts", size: 800 },
  { path: "src/app/studio/tools/LoopsTool.tsx", size: 4200 },
  { path: ".gitignore", size: 600 },
  { path: "eslint.config.mjs", size: 400 },
];

export async function readRepoSnapshot(
  loop: ProjectLoop,
  _iteration: number,
): Promise<RepoSnapshot> {
  if (!githubAvailable()) {
    return {
      available: false,
      files: SAMPLE_FILES,
      languages: ["TypeScript", "TSX", "SQL", "Markdown"],
      headSha: "dry-run",
    };
  }
  try {
    const octokit = await getOctokit();
    const [owner, repo] = loop.repo.split("/");
    if (!owner || !repo) {
      throw new Error(`Invalid repo identifier: ${loop.repo}`);
    }
    const { data } = await octokit.git.getTree({
      owner,
      repo,
      tree_sha: loop.baseBranch,
      recursive: "false",
    });
    const files = (data.tree ?? [])
      .filter((node) => node.type === "blob" && node.path && node.size != null)
      .map((node) => ({ path: String(node.path), size: Number(node.size ?? 0) }))
      .slice(0, 200);

    const ref = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${loop.baseBranch}`,
    });

    return {
      available: true,
      files,
      languages: detectLanguages(files.map((f) => f.path)),
      headSha: ref.data.object.sha,
    };
  } catch {
    return {
      available: false,
      files: SAMPLE_FILES,
      languages: ["TypeScript", "TSX", "SQL"],
      headSha: "snapshot-failed",
    };
  }
}

function detectLanguages(paths: string[]): string[] {
  const set = new Set<string>();
  for (const p of paths) {
    if (/\.(ts|tsx)$/.test(p)) set.add("TypeScript");
    else if (/\.(js|jsx|mjs|cjs)$/.test(p)) set.add("JavaScript");
    else if (/\.py$/.test(p)) set.add("Python");
    else if (/\.go$/.test(p)) set.add("Go");
    else if (/\.rs$/.test(p)) set.add("Rust");
    else if (/\.sql$/.test(p)) set.add("SQL");
    else if (/\.md$/.test(p)) set.add("Markdown");
    else if (/\.(css|scss)$/.test(p)) set.add("CSS");
  }
  return Array.from(set);
}

/* ── Working branch ────────────────────────────────────────────── */

export async function ensureWorkingBranch(loop: ProjectLoop): Promise<void> {
  if (!githubAvailable()) return;
  const octokit = await getOctokit();
  const [owner, repo] = loop.repo.split("/");
  if (!owner || !repo) return;
  const branch = loop.workingBranch;
  try {
    await octokit.git.getRef({ owner, repo, ref: `heads/${branch}` });
    return; // already exists
  } catch {
    // not found — create it from the base branch
  }
  const base = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${loop.baseBranch}`,
  });
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${branch}`,
    sha: base.data.object.sha,
  });
}

/* ── Apply file changes ────────────────────────────────────────── */

export async function applyFileChanges(
  loop: ProjectLoop,
  files: { path: string; content: string }[],
): Promise<LoopFileChange[]> {
  if (!githubAvailable()) {
    return synthesizeDiff(files);
  }
  const octokit = await getOctokit();
  const [owner, repo] = loop.repo.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo: ${loop.repo}`);

  // Read the current head of the working branch so we can build a tree
  // on top of it.
  const baseRef = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${loop.workingBranch}`,
  });
  const baseSha = baseRef.data.object.sha;
  const baseCommit = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: baseSha,
  });
  const baseTreeSha = baseCommit.data.tree.sha;

  // Build a new tree with each file replaced by the proposed content.
  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: baseTreeSha,
    tree: files.map((f) => ({
      path: f.path,
      mode: "100644",
      type: "blob",
      content: f.content,
    })),
  });

  // Commit the new tree on top of the working branch head.
  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message: `lit-loop: iteration ${loop.iteration + 1}\n\n${files
      .map((f) => `- ${f.path}`)
      .join("\n")}`,
    tree: newTree.sha,
    parents: [baseSha],
  });

  // Fast-forward the working branch to the new commit.
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${loop.workingBranch}`,
    sha: newCommit.sha,
  });

  return files.map((f) => ({
    path: f.path,
    additions: f.content.split("\n").length,
    deletions: 0,
    status: "modified" as const,
    patch: f.content.slice(0, 500),
  }));
}

/* ── Revert ────────────────────────────────────────────────────── */

export async function revertToSha(
  loop: ProjectLoop,
  sha: string,
): Promise<void> {
  if (!githubAvailable()) return;
  const octokit = await getOctokit();
  const [owner, repo] = loop.repo.split("/");
  if (!owner || !repo) return;

  // Force-reset the working branch to the recorded rollback SHA so
  // the next iteration starts from a clean slate.
  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${loop.workingBranch}`,
    sha,
    force: true,
  });
}

/* ── Helpers ───────────────────────────────────────────────────── */

function synthesizeDiff(
  files: { path: string; content: string }[],
): LoopFileChange[] {
  return files.map((f) => ({
    path: f.path,
    additions: f.content.split("\n").length,
    deletions: 0,
    status: "modified" as const,
    patch: f.content.slice(0, 500),
  }));
}

/* ── Pull request ──────────────────────────────────────────────── */

export async function openPullRequest(
  loop: ProjectLoop,
  diff: LoopFileChange[],
  title: string,
  body: string,
): Promise<{ url: string }> {
  if (!githubAvailable()) {
    // Dry-run: synthesize a deterministic URL so the UI has something
    // to display.
    const fake = `https://github.com/${loop.repo}/pull/${Math.floor(100 + Math.random() * 900)}`;
    return { url: fake };
  }
  const octokit = await getOctokit();
  const [owner, repo] = loop.repo.split("/");
  if (!owner || !repo) throw new Error(`Invalid repo: ${loop.repo}`);
  const pr = await octokit.pulls.create({
    owner,
    repo,
    title,
    head: loop.workingBranch,
    base: loop.baseBranch,
    body,
  });
  return { url: pr.data.html_url };
}
