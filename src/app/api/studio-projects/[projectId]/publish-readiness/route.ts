import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { getTerminalServerUrl } from "@/lib/terminal-url";
import { isSafeArtifactPath } from "@/lib/deployments/user-deployment";
import {
  checkPublishReadiness,
  detectFramework,
  isMediaPath,
  isPublishablePath,
  PUBLISH_EXCLUDED_DIRS,
  type WorkspaceInventory,
} from "@/lib/deployments/publish-readiness";

/**
 * GET /api/studio-projects/[projectId]/publish-readiness
 *
 * UI-side early warning for the static-only publish pipeline: walks the
 * workspace metadata (names only — no file contents except a small
 * package.json read) and reports the same failure modes validateArtifact
 * would hit *after* the deploy approval flow (missing index.html,
 * file-count cap, framework build output, media-heavy workspaces).
 *
 * Read-only: it never changes deploy-service.ts or any deployment state.
 */

const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ?? getTerminalServerUrl();

// Bounds so a huge workspace can't turn a readiness check into a crawl.
const MAX_DIRS = 60;
const MAX_ENTRIES = 600;

type WsEntry = { name: string; type: string };

async function listDir(
  base: string,
  headers: Record<string, string>,
  dir: string,
): Promise<WsEntry[]> {
  const resp = await fetch(`${base}/ws-files?path=${encodeURIComponent(dir)}`, {
    headers,
  });
  if (!resp.ok) throw new Error(`list failed (${resp.status})`);
  const data = (await resp.json()) as { entries?: WsEntry[] };
  return Array.isArray(data.entries) ? data.entries : [];
}

async function readTextFile(
  base: string,
  headers: Record<string, string>,
  path: string,
  maxBytes: number,
): Promise<string | null> {
  try {
    const resp = await fetch(`${base}/ws-files/read`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { content?: string; size?: number };
    if (typeof data.size === "number" && data.size > maxBytes) return null;
    return typeof data.content === "string" ? data.content : null;
  } catch {
    return null;
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { projectId } = await params;

  let workspaceId: string;
  try {
    ({ workspaceId } = await verifyProjectWorkspace(projectId, userId));
  } catch (err) {
    const code = (err as { code?: string }).code;
    const status =
      code === "PROJECT_NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 409;
    return NextResponse.json(
      { checkable: false, reason: "workspace-not-ready" },
      { status },
    );
  }

  const { token } = createTerminalToken(userId);
  const headers = {
    Authorization: `Bearer ${token}`,
    "X-Workspace-Id": workspaceId,
  };
  const base = TERMINAL_BASE();

  try {
    const files: string[] = [];
    let mediaFileCount = 0;
    let truncated = false;

    let hasIndexHtml = false;
    let packageJson: string | null = null;
    const rootBuildOutputDirs: string[] = [];

    const queue: string[] = ["."];
    const seenDirs = new Set<string>(["."]);
    let dirCount = 0;
    let entryCount = 0;

    while (queue.length > 0 && dirCount < MAX_DIRS && !truncated) {
      const dir = queue.shift()!;
      dirCount += 1;
      let entries: WsEntry[];
      try {
        entries = await listDir(base, headers, dir);
      } catch {
        continue; // unreadable directory — skip, like the deploy pipeline does
      }

      for (const entry of entries) {
        entryCount += 1;
        if (entryCount > MAX_ENTRIES) {
          truncated = true;
          break;
        }
        const path = dir === "." ? entry.name : `${dir}/${entry.name}`;

        if (dir === ".") {
          // Mirror validateArtifact exactly: the entrypoint must be
          // lowercase "index.html" at the root.
          if (entry.type !== "directory" && entry.name === "index.html") {
            hasIndexHtml = true;
          }
          if (entry.type === "directory" && PUBLISH_EXCLUDED_DIRS.has(entry.name)) {
            // Build output / dependency dirs are never published — note the
            // framework-ish ones for the warning, then don't descend.
            if ([".next", "dist", "build"].includes(entry.name)) {
              rootBuildOutputDirs.push(entry.name);
            }
          }
        }

        if (entry.type === "directory") {
          if (PUBLISH_EXCLUDED_DIRS.has(entry.name)) continue;
          if (!isSafeArtifactPath(path)) continue;
          if (!seenDirs.has(path)) {
            seenDirs.add(path);
            queue.push(path);
          }
          continue;
        }

        if (!isPublishablePath(path)) continue;
        files.push(path);
        if (isMediaPath(path)) mediaFileCount += 1;
      }

      // Read package.json once, from the root listing.
      if (dir === "." && entries.some((e) => e.type !== "directory" && e.name === "package.json")) {
        const raw = await readTextFile(base, headers, "package.json", 64 * 1024);
        if (raw) packageJson = raw;
      }
    }

    let framework: string | null = null;
    if (packageJson) {
      try {
        const parsed = JSON.parse(packageJson) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        framework = detectFramework([
          ...Object.keys(parsed.dependencies ?? {}),
          ...Object.keys(parsed.devDependencies ?? {}),
        ]);
      } catch {
        framework = null;
      }
    }

    const inventory: WorkspaceInventory = {
      files,
      hasIndexHtml,
      framework,
      buildOutputDirs: rootBuildOutputDirs,
      mediaFileCount,
      truncated,
    };

    return NextResponse.json({
      checkable: true,
      warnings: checkPublishReadiness(inventory),
      fileCount: files.length,
      hasIndexHtml,
      framework,
      mediaFileCount,
      truncated,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Readiness check failed";
    return NextResponse.json({ checkable: false, reason: msg }, { status: 502 });
  }
}
