import { resolve, join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, readdirSync } from "fs";
import { execFileSync } from "child_process";
import { simpleGit, type SimpleGit } from "simple-git";
import { assertHostExecutionPermitted } from "../isolation-policy";
import {
  buildWelcomeHtml,
  buildWelcomeNextJs,
  buildWelcomeReactVite,
} from "./welcome-screen";
import { writeScaffoldManifest } from "./scaffold";
import { writeFileAtomic } from "./atomic-write";

/**
 * The sandbox binding for a workspace (Phase 2 lifecycle, design
 * note §2.2). One optional block on the existing descriptor — the
 * registry stays a bare JSON array, so a rollback to the previous
 * terminal build preserves bindings instead of erasing them
 * (loadPersisted keeps each object whole).
 *
 * NEVER persisted here: the provider's traffic token, the provider
 * URL, the GitHub token, project secrets. The traffic token comes
 * back from the provider on connect/expose; the rest never belong
 * on disk at all.
 */
export interface WorkspaceSandboxBinding {
  /** Provider name, e.g. "e2b". */
  provider: string;
  sandboxId: string;
  /** Template build the sandbox was created from. */
  templateId: string;
  state: "provisioning" | "running" | "paused" | "lost";
  createdAt: string;
  /** ISO time of the last completed sandbox → volume sync-back. */
  lastSyncBackAt: string | null;
  /** HEAD sha inside the sandbox at the last sync-back. */
  lastSyncedHead: string | null;
  /** Volume paths not yet pushed into a live sandbox (§1.3). */
  pendingForward: string[];
  /** Sandbox-side port the preview dev server listens on. */
  previewPort: number | null;
}

export interface WorkspaceDescriptor {
  workspaceId: string;
  userId: string;
  projectId: string;
  root: string;
  branch: string;
  commitSha: string;
  ready: boolean;
  /** Phase 2 lifecycle binding. Absent = no sandbox for this workspace. */
  sandbox?: WorkspaceSandboxBinding;
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

/**
 * Environment handed to package-manager child processes (dependency
 * install and the TypeScript pre-install in prepareWorkspace).
 *
 * The host path historically spread the terminal's ENTIRE process
 * environment into these calls (`{ ...process.env, ... }`). Package
 * scripts are repo-controlled code: they must never receive the
 * terminal's platform secrets (Clerk/Supabase/Stripe keys, the E2B
 * API key, internal service keys) just because an install ran. Only
 * the benign variables a package manager actually needs are passed,
 * plus NODE_ENV=development (forced, as before, so devDependencies
 * are installed despite the service running NODE_ENV=production).
 * The sandbox install path (design note §4.4) uses the same rule via
 * sandbox/env.ts; this is the host path's equivalent — the whole-env
 * spread must not be ported anywhere.
 */
export const PACKAGE_SCRIPT_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "TERM",
  "LANG",
  "LC_ALL",
  "SHELL",
  "TMPDIR",
  "USER",
  "LOGNAME",
  "PNPM_HOME",
] as const;

export function buildPackageScriptEnv(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env: Record<string, string> = {};
  for (const key of PACKAGE_SCRIPT_ENV_ALLOWLIST) {
    const value = source[key];
    if (value) env[key] = value;
  }
  // Constructed as one literal: this repo augments NodeJS.ProcessEnv with
  // NODE_ENV required and read-only, so the forced value must be present
  // at construction rather than assigned afterward.
  return { ...env, NODE_ENV: "development" };
}

const workspaces = new Map<string, WorkspaceDescriptor>();

const PERSIST_PATH = resolve(
  process.env.TERMINAL_WORKSPACE_ROOT || "/tmp/littree-workspaces",
  ".workspaces.json",
);

interface RegistryLoadResult {
  fileFound: boolean;
  loaded: number;
}

function loadPersisted(): RegistryLoadResult {
  try {
    if (!existsSync(PERSIST_PATH)) {
      // Distinguishable in the boot log from "the file existed and its
      // entries were kept": a registry file that is not visible at the
      // load instant (volume mount timing) starts the process with an
      // EMPTY registry while the web DB still points at the lost ids —
      // every lookup then 404s "Workspace not found" until a heal
      // re-registers, and the next persist seals the loss by
      // overwriting the file with only the current map (round 5,
      // 2026-11-15). First-ever boot also lands here; the line is the
      // evidence that tells the two apart (deploy history + whether
      // workspaces existed before the restart).
      console.error(
        `[WorkspaceManager] No persisted workspace registry found at ${PERSIST_PATH} — ` +
          "starting with an empty registry",
      );
      return { fileFound: false, loaded: 0 };
    }
    const data = JSON.parse(readFileSync(PERSIST_PATH, "utf-8")) as WorkspaceDescriptor[];
    let loaded = 0;
    for (const ws of data) {
      if (!ws.workspaceId || !ws.root) {
        console.error(
          "[WorkspaceManager] Dropping malformed persisted workspace entry " +
            `(missing workspaceId/root): ${JSON.stringify(ws).slice(0, 200)}`,
        );
        continue;
      }
      if (!existsSync(ws.root)) {
        // The root is not visible at this instant (volume mount timing
        // during a restart is the known cause). Do NOT silently delete
        // the descriptor: the web DB still points at this workspaceId,
        // and deleting it makes every registry lookup (preview start,
        // files, exec) 404 "Workspace not found" while the Studio gate
        // keeps reporting the project ready — with no code path able
        // to re-register it. Keep the descriptor registered as
        // ready=false instead: lookups then answer an honest "not
        // ready" (preview start 409s), the descriptor survives the
        // next persist, and a later prepare with the stored id can
        // re-register the workspace in place.
        console.error(
          `[WorkspaceManager] Persisted workspace ${ws.workspaceId} root not visible at load (${ws.root}); ` +
            "keeping descriptor registered as ready=false",
        );
        workspaces.set(ws.workspaceId, { ...ws, ready: false });
        loaded++;
        continue;
      }
      workspaces.set(ws.workspaceId, ws);
      loaded++;
    }
    // The successful load used to log NOTHING, so a boot that loaded
    // the registry was indistinguishable in the logs from one that
    // started empty — during the 2026-11-16 round-9 diagnosis the
    // absence of any registry line was itself a multi-hour question.
    // State the outcome plainly: how many descriptors, and which ids.
    console.log(
      `[WorkspaceManager] Loaded ${loaded} persisted workspace(s) from ${PERSIST_PATH}: ` +
        (Array.from(workspaces.keys()).join(", ") || "(none)"),
    );
    return { fileFound: true, loaded };
  } catch (err) {
    // Corrupt or unreadable file — start fresh, but SAY SO: this catch
    // used to swallow parse errors silently, so a registry file that
    // existed but failed to parse looked exactly like a healthy empty
    // registry while every lookup 404'd (round 9 observability gap).
    console.error(
      `[WorkspaceManager] FAILED to load persisted workspace registry at ${PERSIST_PATH}: ` +
        (err instanceof Error ? err.message : String(err)) +
        " — starting with an empty registry",
    );
    return { fileFound: true, loaded: 0 };
  }
}

function persistWorkspaces(): void {
  try {
    const data = Array.from(workspaces.values());
    // Atomic + loud (design note §2.2): the registry now carries
    // sandbox bindings, and a silently lost binding is a leaked,
    // billed sandbox. writeFileAtomic replaces the file by rename,
    // so a crash mid-write can never truncate the registry; a failed
    // persist is logged, never swallowed.
    writeFileAtomic(PERSIST_PATH, JSON.stringify(data));
  } catch (err) {
    console.error(
      `[WorkspaceManager] FAILED to persist workspace registry to ${PERSIST_PATH}: ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }
}

loadPersisted();

/**
 * One registry-load retry, called by the server once it is listening
 * (before boot reconcile runs). The import-time load above can run
 * before the volume mount is visible, in which case it finds no file
 * and starts empty even though the registry exists on disk. When the
 * registry is still empty at listen time, load once more: by then the
 * mount has had the whole boot sequence to settle. A registry that
 * already holds descriptors is never reloaded (the in-memory map is
 * the live state; reloading could resurrect stale entries over it).
 * Returns the descriptor count after the retry.
 */
export function retryRegistryLoadOnceAtListen(): number {
  if (workspaces.size > 0) return workspaces.size;
  const result = loadPersisted();
  console.error(
    `[WorkspaceManager] Registry load retry at listen: fileFound=${result.fileFound}, ` +
      `loaded=${result.loaded} — registry now holds ${workspaces.size} workspace(s)`,
  );
  return workspaces.size;
}

export function getWorkspace(workspaceId: string): WorkspaceDescriptor | undefined {
  return workspaces.get(workspaceId);
}

/** Every registered descriptor (boot reconcile iterates these). */
export function listAllWorkspaceDescriptors(): WorkspaceDescriptor[] {
  return Array.from(workspaces.values());
}

/** Insert or replace a descriptor and persist. */
export function upsertWorkspaceDescriptor(descriptor: WorkspaceDescriptor): void {
  workspaces.set(descriptor.workspaceId, descriptor);
  persistWorkspaces();
}

/**
 * Set or clear a workspace's sandbox binding and persist. Returns
 * false when the workspace is not registered.
 */
export function updateWorkspaceSandboxBinding(
  workspaceId: string,
  binding: WorkspaceSandboxBinding | undefined,
): boolean {
  const ws = workspaces.get(workspaceId);
  if (!ws) return false;
  if (binding) ws.sandbox = binding;
  else delete ws.sandbox;
  persistWorkspaces();
  return true;
}

export function getWorkspaceRoot(workspaceId: string, userId?: string): string | null {
  const ws = workspaces.get(workspaceId);
  if (userId && ws?.userId !== userId) return null;
  return ws?.root ?? null;
}

/**
 * Sandbox prepare dispatch (Phase 2 lifecycle, design note §4.1/§5).
 *
 * The sandbox workspace executor registers itself here at server
 * boot. When it reports itself available for the requesting user
 * (the §4.6 predicate: real provider + fresh green canary + owner),
 * prepareWorkspace's host body is replaced wholesale by the sandbox
 * sequence — clone and install happen inside the sandbox. When it is
 * not available, prepare falls through to the host body below,
 * untouched, whose first act is the existing host-execution guard.
 * Registration lives here (rather than the executor importing this
 * module's prepare) so the dependency runs one way:
 * executor → WorkspaceManager, never the reverse.
 */
export interface SandboxPrepareHandler {
  isAvailableFor(userId: string): boolean;
  prepare(input: PrepareInput): Promise<WorkspaceDescriptor>;
}

let sandboxPrepareHandler: SandboxPrepareHandler | null = null;

export function registerSandboxPrepareHandler(
  handler: SandboxPrepareHandler | null,
): void {
  sandboxPrepareHandler = handler;
}

/** Whether the sandbox prepare path would route for this user right now. */
export function sandboxPrepareAvailableFor(userId: string): boolean {
  return sandboxPrepareHandler?.isAvailableFor(userId) ?? false;
}

/**
 * The prepare route's idempotency decision: may an existing descriptor
 * be served as-is instead of running prepare?
 *
 * Only when nothing needs repair. A descriptor whose sandbox binding
 * is live (running/paused with an id) is complete — serve it. But a
 * READY descriptor whose binding is lost, was cleared by boot
 * reconcile, or was never created is NOT complete when the sandbox
 * path is available for the user: serving it as-is certifies a
 * workspace with no sandbox behind it, and the heal that called
 * prepare goes away believing the binding was restored (round 9,
 * 2026-11-16: boot reconcile cleared the binding, every heal prepare
 * was answered from this short-circuit shape or the host path, and
 * the workspace stayed sandbox-less). In that state the request must
 * fall through to prepareWorkspace, whose sandbox branch recreates
 * and rebinds via the executor's ensure path.
 *
 * When the sandbox path is NOT available for the user, the existing
 * descriptor remains the honest answer: the fallthrough would run the
 * host body, which refuses with 503 in production even though the
 * volume workspace is fully usable for file operations. Gate-closed
 * deployments keep their exact previous behavior.
 */
export function shouldServeExistingWorkspace(
  existing: WorkspaceDescriptor,
  userId: string,
): boolean {
  if (!existing.ready) return false;
  const binding = existing.sandbox;
  const bindingLive =
    !!binding &&
    binding.sandboxId !== "" &&
    (binding.state === "running" || binding.state === "paused");
  if (bindingLive) return true;
  return !sandboxPrepareAvailableFor(userId);
}

export async function prepareWorkspace(
  input: PrepareInput,
): Promise<WorkspaceDescriptor> {
  // Sandbox branch first: availability is the executor's predicate,
  // evaluated per request. A closed gate changes nothing below.
  if (sandboxPrepareHandler?.isAvailableFor(input.userId)) {
    return sandboxPrepareHandler.prepare(input);
  }

  // Durable, project-identified root — see managedWorkspaceRoot(). A
  // GitHub-backed workspace must also resolve to the same path across
  // provisions, otherwise the "already cloned, just fetch" branch below
  // is unreachable and every re-provision re-clones into a new
  // directory, discarding uncommitted local work.
  const root = input.existingRoot && existsSync(input.existingRoot)
    ? input.existingRoot
    : managedWorkspaceRoot(input.workspaceRoot, input.userId, input.projectId);
  const workspaceId = input.existingWorkspaceId || managedWorkspaceId(input.projectId);

  // Clone/fetch and the dependency install below run host git and the
  // repo's own package scripts. Closed in production until sandboxed.
  assertHostExecutionPermitted("workspace.prepare(git,install)");

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
      assertHostExecutionPermitted("workspace.install");
      execFileSync(pm, ["install", "--prefer-offline"], {
        cwd: root,
        stdio: "pipe",
        timeout: 300_000,
        env: buildPackageScriptEnv(),
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
          assertHostExecutionPermitted("workspace.install");
          execFileSync(pm, addArgs, {
            cwd: root,
            stdio: "pipe",
            timeout: 120_000,
            env: buildPackageScriptEnv(),
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
  assertHostExecutionPermitted("workspace.git");
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

/**
 * Sentinel commit SHA for static workspaces. These workspaces have no Git
 * repository by design — Git operations (even `init`/`add`/`commit`) can
 * execute hooks and filters, so they stay behind the host-execution guard.
 * This value marks the descriptor as gitless; it is not a real SHA.
 */
export const STATIC_WORKSPACE_COMMIT_SHA = "static-no-git";

/**
 * Prepare a STATIC workspace — file storage without Git.
 *
 * Unlike `prepareManagedWorkspace`, this NEVER initializes a Git repository
 * and NEVER spawns any subprocess. The workspace directory is created,
 * template files are written with pure filesystem operations, and the
 * descriptor is registered. File read/write via /ws-files works normally.
 *
 * This exists because Gate 1 containment correctly blocks ALL Git operations
 * in production (git add/commit can run hooks), which would otherwise make
 * it impossible for any new user to get a working workspace. Static projects
 * (HTML/CSS/JS sites with no build step) don't need version control to be
 * useful — they need a directory the AI can write files into.
 *
 * Checkpoints, diff, and restore are unavailable for static workspaces
 * (they require Git). The descriptor's branch/commitSha carry sentinel
 * values so downstream code that reads them doesn't break.
 *
 * Idempotent and adoption-first, same as managed: existing content is
 * preserved, never deleted or overwritten.
 */
export async function prepareStaticWorkspace(input: {
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

  // Same legacy-adoption logic as managed: keep using an existing
  // directory rather than stranding the user's files.
  const legacyRoot = input.existingRoot && existsSync(input.existingRoot) && hasProjectContent(input.existingRoot)
    ? input.existingRoot
    : null;

  const root = legacyRoot ?? canonicalRoot;
  const adopting = existsSync(root) && hasProjectContent(root);

  mkdirSync(root, { recursive: true });

  if (!adopting) {
    writeTemplateFiles(root, input.templateId);
  }

  // NO git. No ensureGitRepository(), no subprocesses, no hooks.
  // Pure filesystem operations only.

  const workspaceId = input.existingWorkspaceId || managedWorkspaceId(input.projectId);

  const descriptor: WorkspaceDescriptor = {
    workspaceId,
    userId: input.userId,
    projectId: input.projectId,
    root,
    branch: DEFAULT_BRANCH,
    commitSha: STATIC_WORKSPACE_COMMIT_SHA,
    ready: true,
  };

  workspaces.set(workspaceId, descriptor);
  persistWorkspaces();
  return descriptor;
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
