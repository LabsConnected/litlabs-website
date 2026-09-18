import { resolve, join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { execFileSync } from "child_process";
import { simpleGit, type SimpleGit } from "simple-git";
import {
  buildWelcomeHtml,
  buildWelcomeNextJs,
  buildWelcomeReactVite,
} from "./welcome-screen";
import { writeScaffoldManifest } from "./scaffold";


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
  /** Existing root from studio_projects, adopted when it still exists. */
  existingRoot?: string | null;
  /** Existing id from studio_projects, reused so the DB stays valid. */
  existingWorkspaceId?: string | null;
}

/** Managed workspaces are always initialised on this branch. */
const DEFAULT_BRANCH = "main";

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
  // Durable, project-identified root — see managedWorkspaceRoot(). A
  // GitHub-backed workspace must also resolve to the same path across
  // provisions, otherwise the "already cloned, just fetch" branch below
  // is unreachable and every re-provision re-clones into a new
  // directory, discarding uncommitted local work.
  const root = input.existingRoot && existsSync(input.existingRoot)
    ? input.existingRoot
    : managedWorkspaceRoot(input.workspaceRoot, input.userId, input.projectId);
  const workspaceId = input.existingWorkspaceId || managedWorkspaceId(input.projectId);

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

  // Install dependencies if package.json exists and node_modules is missing.
  // Without this, the preview dev server fails with "next: not found" (exit 1)
  // because the cloned repo has no installed dependencies.
  if (existsSync(join(root, "package.json")) && !existsSync(join(root, "node_modules"))) {
    const pkgRaw = readFileSync(join(root, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as {
      packageManager?: string;
      devDependencies?: Record<string, string>;
    };
    // Prefer the packageManager field, then pnpm, then npm.
    const pm = pkg.packageManager?.startsWith("pnpm") ? "pnpm"
      : pkg.packageManager?.startsWith("yarn") ? "yarn"
      : existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm"
      : existsSync(join(root, "yarn.lock")) ? "yarn"
      : "npm";
    try {
      // Force NODE_ENV=development during install so pnpm/npm include
      // devDependencies. The Railway service runs with NODE_ENV=production,
      // which causes pnpm to skip devDeps by default — this breaks Next.js
      // dev server startup (TypeScript types are in devDependencies).
      execFileSync(pm, ["install", "--prefer-offline"], {
        cwd: root,
        stdio: "pipe",
        timeout: 300_000,
        env: { ...process.env, NODE_ENV: "development" },
      });
    } catch {
      // Non-fatal — the workspace is still usable for file browsing and
      // the preview will surface a clear "next: not found" error if the
      // dev command needs deps. We don't fail prepare because some repos
      // have optional install steps or the user may install via chat.
    }

    // Pre-install TypeScript dev deps if tsconfig.json exists but typescript
    // is not in devDependencies. Next.js auto-installs these during dev
    // startup, but the auto-install can fail in pnpm workspaces with
    // ERR_PNPM_UNEXPECTED_STORE or ERR_PNPM_ADDING_TO_ROOT. Pre-installing
    // them here avoids that race.
    if (existsSync(join(root, "tsconfig.json"))) {
      const hasTs = pkg.devDependencies?.typescript != null;
      if (!hasTs) {
        try {
          const addArgs = pm === "pnpm"
            ? ["add", "--save-dev", "--save-exact", "--ignore-workspace-root-check",
               "typescript", "@types/react", "@types/node"]
            : ["add", "--save-dev", "--save-exact",
               "typescript", "@types/react", "@types/node"];
          execFileSync(pm, addArgs, {
            cwd: root,
            stdio: "pipe",
            timeout: 120_000,
            env: { ...process.env, NODE_ENV: "development" },
          });
        } catch {
          // Non-fatal — Next.js will attempt its own auto-install.
        }
      }
    }
  }

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

/**
 * A filesystem-safe segment derived from an identifier.
 *
 * Project and user ids come from Clerk and Supabase and are already
 * opaque, but they are interpolated into a path, so anything that could
 * traverse or escape is stripped rather than trusted.
 */
function safeSegment(value: string): string {
  const cleaned = value
    // Drop separators and anything outside a conservative allowlist.
    .replace(/[^A-Za-z0-9._-]/g, "")
    // Collapse dot runs. A single path segment has no legitimate use for
    // "..", so removing them leaves no traversal token behind even if a
    // caller later joins this value without resolving.
    .replace(/\.{2,}/g, "");
  if (!cleaned || cleaned === ".") {
    throw new Error("Invalid identifier for workspace path");
  }
  return cleaned.slice(0, 128);
}

/**
 * The DURABLE root for a project's managed source.
 *
 * Derived from (userId, projectId) — NOT from a random workspace id.
 * The previous scheme minted `ws-<pid8>-<uuid8>` on every prepare, so
 * re-provisioning a project (after a terminal-server restart, or after
 * the DB row was reset to not_prepared) created a brand-new EMPTY
 * directory and silently orphaned the user's files. A project's source
 * must resolve to the same path for the life of the project.
 */
export function managedWorkspaceRoot(
  workspaceRoot: string,
  userId: string,
  projectId: string,
): string {
  return resolve(workspaceRoot, safeSegment(userId), safeSegment(projectId));
}

/**
 * The deterministic workspace id for a project.
 *
 * Stable across restarts so a recovered workspace re-registers under
 * the id already stored in studio_projects.workspace_id.
 */
export function managedWorkspaceId(projectId: string): string {
  return `ws-${safeSegment(projectId)}`;
}

/** Whether a directory holds project content (ignoring .git). */
function hasProjectContent(root: string): boolean {
  try {
    return readdirSync(root).some((entry) => entry !== ".git");
  } catch {
    return false;
  }
}

/**
 * Ensure a directory is a Git repository with at least one commit.
 *
 * Managed source is Git-backed so checkpoints, diff and restore work
 * without any GitHub repository existing. Safe to call on a workspace
 * that is already initialised — it only fills in what is missing, and
 * never rewrites existing history.
 */
async function ensureGitRepository(root: string): Promise<{ branch: string; commitSha: string }> {
  const git: SimpleGit = simpleGit(root);

  if (!existsSync(join(root, ".git"))) {
    await git.init();
  }

  // Identity is required before a commit can be created. Set it
  // locally so it never depends on a global git config being present
  // in the container.
  await git.addConfig("user.name", "LiTT Studio");
  await git.addConfig("user.email", "studio@litt.dev");

  let hasCommit = true;
  try {
    await git.revparse("HEAD");
  } catch {
    hasCommit = false;
  }

  if (!hasCommit) {
    // Name the branch before the first commit so the repository lands
    // on `main` regardless of the host's init.defaultBranch setting.
    try {
      await git.raw(["checkout", "-B", DEFAULT_BRANCH]);
    } catch {
      // Older git without -B on an unborn branch — fall back below.
    }
    await git.add(".");
    // Empty managed workspaces still need a stable Git identity/branch for
    // checkpoints and revision routing before the first approved file write.
    // Git refuses a normal commit with no user files, so allow an empty
    // initial commit for the explicit empty-static template.
    await git.commit("Initial commit — LiTT managed project", {
      "--allow-empty": null,
    });
  }

  const status = await git.status();
  const branch = status.current || DEFAULT_BRANCH;
  const commitSha = (await git.revparse("HEAD")).trim();
  return { branch, commitSha };
}

/**
 * Prepare a MANAGED workspace — LiTT-owned durable source, no GitHub.
 *
 * Idempotent and adoption-first:
 *   1. If durable source already exists on disk, ADOPT it. Files,
 *      history and branch are preserved. This is what makes a project
 *      survive a terminal-server restart: the in-memory registry is
 *      lost, but the volume is not, so the workspace re-registers
 *      against the same directory instead of being recreated empty.
 *   2. Otherwise create the directory and write the template.
 *   3. Either way, guarantee a Git repository with a commit.
 *
 * Never deletes or overwrites existing project content.
 */
export async function prepareManagedWorkspace(input: {
  userId: string;
  projectId: string;
  workspaceRoot: string;
  templateId: string;
  /** Existing root from studio_projects, adopted when it still exists. */
  existingRoot?: string | null;
  /** Existing id from studio_projects, reused so the DB stays valid. */
  existingWorkspaceId?: string | null;
}): Promise<WorkspaceDescriptor> {
  const canonicalRoot = managedWorkspaceRoot(input.workspaceRoot, input.userId, input.projectId);

  // A legacy workspace lives under a random ws-* directory. Keep using
  // it rather than stranding the user's files at an unreachable path.
  const legacyRoot = input.existingRoot && existsSync(input.existingRoot) && hasProjectContent(input.existingRoot)
    ? input.existingRoot
    : null;

  const root = legacyRoot ?? canonicalRoot;
  const adopting = existsSync(root) && hasProjectContent(root);

  mkdirSync(root, { recursive: true });

  if (!adopting) {
    writeTemplateFiles(root, input.templateId);
  }

  const { branch, commitSha } = await ensureGitRepository(root);

  const workspaceId = input.existingWorkspaceId || managedWorkspaceId(input.projectId);

  const descriptor: WorkspaceDescriptor = {
    workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    root,
    branch,
    commitSha,
    ready: true,
  };

  workspaces.set(workspaceId, descriptor);
  persistWorkspaces();
  return descriptor;
}

/**
 * Back-compat alias for the previous blank-project entry point.
 * Managed source and "blank project" are the same thing.
 */
export async function prepareBlankWorkspace(input: {
  userId: string;
  projectId: string;
  workspaceRoot: string;
  templateId: string;
  existingRoot?: string | null;
  existingWorkspaceId?: string | null;
}): Promise<WorkspaceDescriptor> {
  return prepareManagedWorkspace(input);
}

/** Write initial template files for blank projects. Exported for tests. */
export function writeTemplateFiles(root: string, templateId: string): void {
  if (templateId === "empty-static") {
    // The agent must create the first application artifact through the normal
    // approved tool gateway; do not seed a starter file here.
    return;
  }
  if (templateId === "blank-static") {
    // Polished LiTT Studio welcome / blank-state. This is the empty state of
    // the builder itself, not project content — the agent replaces it with
    // the user's real files as soon as it starts building.
    writeFileSync(join(root, "index.html"), buildWelcomeHtml(), "utf-8");
    // Machine-readable scaffolding flag (brief §7): the manifest — not a
    // text match — is the authority on "still on starter scaffolding".
    writeScaffoldManifest(root, templateId, ["index.html"]);
    return;
  }

  if (templateId === "nextjs") {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(
        {
          name: "my-project",
          private: true,
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            lint: "next lint",
          },
          dependencies: { next: "^16.0.0", react: "^19.0.0", "react-dom": "^19.0.0" },
        },
        null,
        2,
      ),
      "utf-8",
    );
    mkdirSync(join(root, "app"), { recursive: true });
    // Polished LiTT Studio welcome / blank-state (see blank-static above).
    writeFileSync(join(root, "app", "page.tsx"), buildWelcomeNextJs(), "utf-8");
    writeScaffoldManifest(root, templateId, ["app/page.tsx"]);
    writeFileSync(
      join(root, "app", "layout.tsx"),
      `export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
      "utf-8",
    );
    return;
  }

  if (templateId === "react-vite") {
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify(
        {
          name: "my-project",
          private: true,
          type: "module",
          scripts: {
            dev: "vite",
            build: "tsc && vite build",
            preview: "vite preview",
          },
          dependencies: { react: "^19.0.0", "react-dom": "^19.0.0" },
          devDependencies: {
            "@vitejs/plugin-react": "^4.3.0",
            typescript: "^5.6.0",
            vite: "^6.0.0",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    writeFileSync(
      join(root, "index.html"),
      `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>My Project</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      "utf-8",
    );
    mkdirSync(join(root, "src"), { recursive: true });
    writeFileSync(
      join(root, "src", "main.tsx"),
      `import { createRoot } from "react-dom/client";
import App from "./App";

createRoot(document.getElementById("root")!).render(<App />);
`,
      "utf-8",
    );
    // Polished LiTT Studio welcome / blank-state (see blank-static above).
    writeFileSync(join(root, "src", "App.tsx"), buildWelcomeReactVite(), "utf-8");
    writeScaffoldManifest(root, templateId, ["src/App.tsx"]);
    return;
  }

  // Unknown template — create a minimal placeholder
  writeFileSync(
    join(root, "README.md"),
    `# My Project\n\nCreated with LiTTree Studio.\n`,
    "utf-8",
  );
}
