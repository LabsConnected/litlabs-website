import { resolve, join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
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

  // Install dependencies if package.json exists and node_modules is missing.
  // Without this, the preview dev server fails with "next: not found" (exit 1)
  // because the cloned repo has no installed dependencies.
  if (existsSync(join(root, "package.json")) && !existsSync(join(root, "node_modules"))) {
    const pkgRaw = readFileSync(join(root, "package.json"), "utf-8");
    const pkg = JSON.parse(pkgRaw) as { packageManager?: string };
    // Prefer the packageManager field, then pnpm, then npm.
    const pm = pkg.packageManager?.startsWith("pnpm") ? "pnpm"
      : pkg.packageManager?.startsWith("yarn") ? "yarn"
      : existsSync(join(root, "pnpm-lock.yaml")) ? "pnpm"
      : existsSync(join(root, "yarn.lock")) ? "yarn"
      : "npm";
    try {
      execFileSync(pm, ["install", "--prefer-offline"], {
        cwd: root,
        stdio: "pipe",
        timeout: 300_000,
        env: { ...process.env, CI: "1" },
      });
    } catch {
      // Non-fatal — the workspace is still usable for file browsing and
      // the preview will surface a clear "next: not found" error if the
      // dev command needs deps. We don't fail prepare because some repos
      // have optional install steps or the user may install via chat.
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
 * Prepare a blank workspace (no GitHub clone).
 * Initializes a git repo and writes template files.
 */
export async function prepareBlankWorkspace(input: {
  userId: string;
  projectId: string;
  workspaceRoot: string;
  templateId: string;
}): Promise<WorkspaceDescriptor> {
  const workspaceId = `ws-${input.projectId.slice(0, 8)}-${randomUUID().slice(0, 8)}`;
  const root = resolve(input.workspaceRoot, input.userId, workspaceId);

  mkdirSync(root, { recursive: true });

  // Initialize template files
  writeTemplateFiles(root, input.templateId);

  // Initialize git repo
  const git: SimpleGit = simpleGit(root);
  await git.init();
  await git.addConfig("user.name", "LiTTree Studio");
  await git.addConfig("user.email", "studio@litree.dev");
  await git.add(".");
  await git.commit("Initial blank project from LiTTree Studio template");

  const commitSha = (await git.revparse("HEAD")).trim();

  const descriptor: WorkspaceDescriptor = {
    workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    root,
    branch: "main",
    commitSha,
    ready: true,
  };

  workspaces.set(workspaceId, descriptor);
  persistWorkspaces();
  return descriptor;
}

/** Write initial template files for blank projects. */
function writeTemplateFiles(root: string, templateId: string): void {
  if (templateId === "blank-static") {
    writeFileSync(
      join(root, "index.html"),
      `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>My Project</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; }
    h1 { color: #a970ff; }
  </style>
</head>
<body>
  <h1>Hello from LiTTree Studio</h1>
  <p>Start building your project here.</p>
</body>
</html>
`,
      "utf-8",
    );
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
    writeFileSync(
      join(root, "app", "page.tsx"),
      `export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>Hello from LiTTree Studio</h1>
      <p>Start building your Next.js project here.</p>
    </main>
  );
}
`,
      "utf-8",
    );
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
    writeFileSync(
      join(root, "src", "App.tsx"),
      `export default function App() {
  return (
    <main style={{ fontFamily: "system-ui", padding: "2rem" }}>
      <h1>Hello from LiTTree Studio</h1>
      <p>Start building your React + Vite project here.</p>
    </main>
  );
}
`,
      "utf-8",
    );
    return;
  }

  // Unknown template — create a minimal placeholder
  writeFileSync(
    join(root, "README.md"),
    `# My Project\n\nCreated with LiTTree Studio.\n`,
    "utf-8",
  );
}
