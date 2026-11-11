/**
 * Workspace seed-identity check — the workspace half of the loosened
 * empty-project reuse predicate (see findReusableEmptyBlankProject in
 * project-repository.ts).
 *
 * "Seed-identical" means: the project's workspace still holds EXACTLY the
 * files provisioning seeded for its template, byte for byte — no file
 * added, removed, or modified. Only then is an entered-but-contentless
 * project (it may have conversation messages, tasks, or paused runs)
 * safe to re-focus on a fresh entry instead of minting a duplicate.
 *
 * Authority for "still on starter scaffolding" is the scaffold manifest
 * the terminal server writes at provisioning time
 * (terminal-server/workspace/scaffold.ts): `.litt/scaffold.json` records
 * the seeded welcome files with a sha256 of their seeded bytes, and the
 * manifest is consumed by the first write through the workspace file
 * gateway — so a manifest that is still present and valid, whose hashes
 * still match, already proves no sanctioned write has occurred. This
 * check additionally requires the full file set to equal the template's
 * seeded set (catches files added by any path) and hash-checks the
 * seeded files the manifest does not cover (package.json, layout.tsx…).
 *
 * FAIL-SAFE BY CONSTRUCTION: every doubt returns false — unprovisioned
 * or not-ready workspace, unreachable file operations, unreadable or
 * malformed manifest, marker/template mismatch, any extra or missing
 * file, any byte difference. A wrong "false" costs one duplicate
 * project; a wrong "true" would hand a user someone else's work-in-
 * progress shell as if it were blank. Only false is acceptable.
 *
 * The expected non-scaffold seed hashes below were measured from the
 * real seed (WorkspaceManager.writeTemplateFiles run per template,
 * 2026-11-11). If the terminal-server seed content changes, this check
 * simply stops matching for that template (fail-safe) until the hashes
 * are refreshed — it can never start matching content that is not the
 * seed it was measured against.
 */

import { createHash } from "crypto";

/** In-file marker counterpart of the scaffold manifest (welcome-screen.ts). */
const WELCOME_SCREEN_MARKER = "LITT-WELCOME-SCREEN";
const SCAFFOLD_MANIFEST_PATH = ".litt/scaffold.json";
const SCAFFOLD_MANIFEST_VERSION = 1;

/** Bounds for the workspace walk — mirrors verifyProjectArtifacts. */
const MAX_WALK_FILES = 500;
const MAX_WALK_DEPTH = 6;

interface TemplateSeedSpec {
  /** Every file provisioning writes for this template, excluding the scaffold manifest itself. */
  files: readonly string[];
  /** Files the scaffold manifest must list (the seeded welcome files). */
  scaffoldFiles: readonly string[];
  /** Whether provisioning writes a scaffold manifest for this template. */
  manifest: boolean;
  /** sha256 hex of seeded bytes for seeded files NOT covered by the manifest. */
  contentHashes: Readonly<Record<string, string>>;
}

const TEMPLATE_SEED_SPECS: Readonly<Record<string, TemplateSeedSpec>> = {
  // The Studio Website entry template: one seeded welcome index.html,
  // hash-covered by the manifest.
  "blank-static": {
    files: ["index.html"],
    scaffoldFiles: ["index.html"],
    manifest: true,
    contentHashes: {},
  },
  // Seeds nothing at all — identity means a completely empty workspace.
  "empty-static": {
    files: [],
    scaffoldFiles: [],
    manifest: false,
    contentHashes: {},
  },
  nextjs: {
    files: ["app/layout.tsx", "app/page.tsx", "package.json"],
    scaffoldFiles: ["app/page.tsx"],
    manifest: true,
    contentHashes: {
      "app/layout.tsx":
        "806a78943199cddbe9dc56447e677e4c4fa363e2922b6639277fdd452bdff3ec",
      "package.json":
        "83ad3d1e6bd01508990c8cadd30d1e765f5287bdf140218e9a378b518d359bab",
    },
  },
  "react-vite": {
    files: ["index.html", "package.json", "src/App.tsx", "src/main.tsx"],
    scaffoldFiles: ["src/App.tsx"],
    manifest: true,
    contentHashes: {
      "index.html":
        "a9c9f31e640c83ffbf5a0d2d76bd0d56dd523a1e83cafe5abd9febd40d783814",
      "package.json":
        "fba1bd1731e60d471434a895cf1341c8e11e2807ee34cd82ed39707e83094c4d",
      "src/main.tsx":
        "cae0540d8d93a09581b095dd6246cf5a5d91921e5d5a7d9642dfd026256d4191",
    },
  },
  // Templates provisioning seeds through the unknown-template fallback
  // (a lone README.md, no scaffold manifest — e.g. expo-react-native)
  // have no manifest authority to verify against, so they are
  // deliberately absent here: tier-2 reuse is unavailable for them and
  // the untouched tier in project-repository.ts is unaffected.
};

/** The slice of the workspace transport this check needs. */
export interface SeedCheckTransport {
  readonly fileOpsReachable: boolean;
  listFiles(path: string): Promise<{ entries: Array<{ name: string; type: string }> }>;
  readFile(path: string): Promise<{ content: string; size: number }>;
}

export interface SeedCheckProject {
  id: string;
  templateId: string | null;
  workspaceId: string | null;
  workspaceStatus: string;
  workspaceRoot: string | null;
}

export interface SeedCheckDeps {
  createTransport?: (
    projectId: string,
    userId: string,
  ) => Promise<SeedCheckTransport>;
}

async function defaultCreateTransport(
  projectId: string,
  userId: string,
): Promise<SeedCheckTransport> {
  // Dynamic import: workspace-transport imports project-repository
  // (verifyProjectWorkspace), and project-repository imports this
  // module — a static import here would close a cycle.
  const { createWorkspaceTransport } = await import(
    "@/lib/litt-intelligence/workspace-transport"
  );
  return createWorkspaceTransport(projectId, userId);
}

function sha256Hex(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

function samePathSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((p, i) => p === sortedB[i]);
}

/**
 * Collect every file in the workspace (posix-relative paths), skipping
 * only the `.git` internals. Returns null on any listing failure.
 */
async function listAllFiles(
  transport: SeedCheckTransport,
): Promise<string[] | null> {
  const files: string[] = [];
  const queue: Array<{ path: string; depth: number }> = [{ path: ".", depth: 0 }];
  const visited = new Set<string>();
  try {
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (visited.has(current.path)) continue;
      visited.add(current.path);
      const { entries } = await transport.listFiles(current.path);
      for (const entry of entries) {
        const name = String(entry.name || "").replace(/\\/g, "/");
        if (!name || name === "." || name === ".." || name.includes("/")) continue;
        const relative = current.path === "." ? name : `${current.path}/${name}`;
        if (entry.type === "folder" || entry.type === "directory") {
          if (relative === ".git") continue;
          if (current.depth < MAX_WALK_DEPTH) {
            queue.push({ path: relative, depth: current.depth + 1 });
          } else {
            // A directory too deep to enumerate is content we cannot
            // verify — fail safe rather than assume it is empty.
            return null;
          }
        } else {
          files.push(relative);
          if (files.length > MAX_WALK_FILES) return null;
        }
      }
    }
  } catch {
    return null;
  }
  return files;
}

interface ScaffoldManifestShape {
  version: number;
  scaffolded: true;
  marker: string;
  templateId: string;
  scaffoldFiles: string[];
  hashes: Record<string, string>;
}

/** Parse + validate a scaffold manifest, mirroring readScaffoldManifest. */
function parseScaffoldManifest(raw: string): ScaffoldManifestShape | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const m = parsed as Record<string, unknown>;
  if (m.version !== SCAFFOLD_MANIFEST_VERSION || m.scaffolded !== true) return null;
  if (m.marker !== WELCOME_SCREEN_MARKER) return null;
  if (typeof m.templateId !== "string") return null;
  if (!Array.isArray(m.scaffoldFiles)) return null;
  if (!m.hashes || typeof m.hashes !== "object") return null;
  return m as unknown as ScaffoldManifestShape;
}

/**
 * True only when the project's workspace is PROVEN byte-identical to
 * the starter provisioning seeded for its template. Any uncertainty —
 * including a workspace that cannot be inspected at all — is false.
 */
export async function isWorkspaceSeedIdentical(
  userId: string,
  project: SeedCheckProject,
  deps?: SeedCheckDeps,
): Promise<boolean> {
  const spec = project.templateId ? TEMPLATE_SEED_SPECS[project.templateId] : undefined;
  if (!spec) return false;

  // No ready workspace on record — nothing can be proven about its
  // contents. (This is also what keeps DB-only callers and tests from
  // ever reaching the transport.)
  if (!project.workspaceId || !project.workspaceRoot) return false;
  if (project.workspaceStatus !== "ready") return false;

  let transport: SeedCheckTransport;
  try {
    transport = await (deps?.createTransport ?? defaultCreateTransport)(
      project.id,
      userId,
    );
  } catch {
    return false;
  }
  if (!transport.fileOpsReachable) return false;

  const files = await listAllFiles(transport);
  if (files === null) return false;

  const hasManifest = files.includes(SCAFFOLD_MANIFEST_PATH);
  if (hasManifest !== spec.manifest) return false;
  // Nothing but the manifest itself may live under .litt — checkpoints
  // or any other scaffold bookkeeping mean the workspace was worked in.
  if (files.some((f) => f.startsWith(".litt/") && f !== SCAFFOLD_MANIFEST_PATH)) {
    return false;
  }
  const contentFiles = files.filter((f) => f !== SCAFFOLD_MANIFEST_PATH);
  if (!samePathSet(contentFiles, spec.files)) return false;

  try {
    if (spec.manifest) {
      const manifest = parseScaffoldManifest(
        (await transport.readFile(SCAFFOLD_MANIFEST_PATH)).content,
      );
      if (!manifest) return false;
      if (manifest.templateId !== project.templateId) return false;
      if (!samePathSet(manifest.scaffoldFiles, spec.scaffoldFiles)) return false;
      for (const path of spec.scaffoldFiles) {
        const expected = manifest.hashes[path];
        if (typeof expected !== "string") return false;
        const content = (await transport.readFile(path)).content;
        if (sha256Hex(content) !== expected) return false;
      }
    }
    for (const [path, expected] of Object.entries(spec.contentHashes)) {
      const content = (await transport.readFile(path)).content;
      if (sha256Hex(content) !== expected) return false;
    }
  } catch {
    return false;
  }
  return true;
}
