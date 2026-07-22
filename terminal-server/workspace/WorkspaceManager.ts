import { resolve, join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { simpleGit, type SimpleGit } from "simple-git";
import { randomUUID } from "crypto";

export interface WorkspaceDescriptor {
  workspaceId: string;
  userId: string;
  projectId: string;
  root: string;
  branch: string;
  commitSha: string;
  ready: boolean;
}

export interface PrepareInput {
  userId: string;
  projectId: string;
  installationId: number;
  owner: string;
  repo: string;
  branch: string;
  commitSha?: string | null;
  workspaceRoot: string;
  githubToken?: string | null;
}

const workspaces = new Map<string, WorkspaceDescriptor>();

const PERSIST_PATH = resolve(
  process.env.TERMINAL_WORKSPACE_ROOT || "/tmp/littree-workspaces",
  ".workspaces.json",
);

function loadPersisted(): void {
  try {
    if (!existsSync(PERSIST_PATH)) return;
    const data = JSON.parse(readFileSync(PERSIST_PATH, "utf-8")) as WorkspaceDescriptor[];
    for (const ws of data) {
      if (ws.workspaceId && ws.root && existsSync(ws.root)) {
        workspaces.set(ws.workspaceId, ws);
      }
    }
  } catch {
    // Corrupt or missing file — start fresh
  }
}

function persistWorkspaces(): void {
  try {
    const data = Array.from(workspaces.values());
    writeFileSync(PERSIST_PATH, JSON.stringify(data), "utf-8");
  } catch {
    // Non-fatal — persistence is best-effort
  }
}

loadPersisted();

export function getWorkspace(workspaceId: string): WorkspaceDescriptor | undefined {
  return workspaces.get(workspaceId);
}

export function getWorkspaceRoot(workspaceId: string, userId?: string): string | null {
  const ws = workspaces.get(workspaceId);
  if (userId && ws?.userId !== userId) return null;
  return ws?.root ?? null;
}

export async function prepareWorkspace(
  input: PrepareInput,
): Promise<WorkspaceDescriptor> {
  const workspaceId = `ws-${input.projectId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const root = resolve(input.workspaceRoot, input.userId, workspaceId);

  mkdirSync(root, { recursive: true });

  const git: SimpleGit = simpleGit(root);

  // Construct clone URL — use installation token for private repos, plain URL for public
  let cloneUrl: string;
  if (input.githubToken) {
    cloneUrl = `https://x-access-token:${input.githubToken}@github.com/${input.owner}/${input.repo}.git`;
  } else {
    cloneUrl = `https://github.com/${input.owner}/${input.repo}.git`;
  }

  if (!existsSync(join(root, ".git"))) {
    await git.clone(cloneUrl, root, ["--depth", "1", "--branch", input.branch]);
  } else {
    await git.fetch("origin", input.branch);
    await git.checkout(input.branch);
    await git.pull("origin", input.branch);
  }

  // Sanitize the git remote to remove any embedded token from .git/config
  if (input.githubToken) {
    const cleanUrl = `https://github.com/${input.owner}/${input.repo}.git`;
    try {
      await git.remote(["set-url", "origin", cleanUrl]);
    } catch {
      // Non-fatal — clone succeeded, remote URL just contains token
    }
  }

  const commitSha = (await git.revparse("HEAD")).trim();

  const descriptor: WorkspaceDescriptor = {
    workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    root,
    branch: input.branch,
    commitSha,
    ready: true,
  };

  workspaces.set(workspaceId, descriptor);
  persistWorkspaces();
  return descriptor;
}

export function listWorkspaces(userId: string): WorkspaceDescriptor[] {
  return Array.from(workspaces.values()).filter((workspace) => workspace.userId === userId);
}
