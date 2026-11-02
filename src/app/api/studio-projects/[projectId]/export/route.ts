import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { requireTerminalBaseUrl, terminalNotConfiguredResponse } from "@/lib/terminal-config";
import { ensureWorkspaceAlive, normalizeFileError, reprepareWorkspace } from "@/lib/studio/workspace-recovery";
import { buildZip, type ZipEntryInput } from "@/lib/studio/zip";

/**
 * GET /api/studio-projects/[projectId]/export
 *
 * Downloads the project workspace as a real ZIP archive. Walks the
 * terminal-server workspace recursively, reads every file, and packs a
 * deflate-compressed archive server-side.
 *
 * Truthful behavior: files that cannot be read (oversize, vanished mid-
 * export) are listed in an EXPORT-SKIPPED.txt manifest inside the archive
 * — never silently dropped. If the workspace has no files at all the
 * export fails with 409 rather than emitting an empty zip.
 */

const TERMINAL_BASE = () => requireTerminalBaseUrl();

const MAX_FILES = 2000;
const MAX_WALK_DEPTH = 10;
const MAX_TOTAL_BYTES = 128 * 1024 * 1024; // 128MB uncompressed
const FILE_READ_TIMEOUT_MS = 30_000;

/** Directories that are environment state, not project content. */
const SKIP_DIRS = new Set(["node_modules", ".git", ".next", ".turbo", "dist", "build"]);

interface ListedEntry {
  name: string;
  type: string;
}

function isSafeRelativePath(value: string): boolean {
  const normalized = value.replace(/\\/g, "/");
  return (
    normalized !== "" &&
    normalized !== "." &&
    !normalized.startsWith("/") &&
    !normalized.split("/").some((segment) => segment === ".." || segment.includes("\u0000"))
  );
}

async function terminalList(
  dir: string,
  workspaceId: string,
  token: string,
): Promise<{ entries: ListedEntry[] }> {
  const resp = await fetch(`${TERMINAL_BASE()}/ws-files?path=${encodeURIComponent(dir)}`, {
    headers: { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceId },
    signal: AbortSignal.timeout(FILE_READ_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "list failed");
    const err = new Error(text) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  return resp.json() as Promise<{ entries: ListedEntry[] }>;
}

async function terminalRead(
  path: string,
  workspaceId: string,
  token: string,
): Promise<Buffer> {
  const resp = await fetch(`${TERMINAL_BASE()}/ws-files/read`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "X-Workspace-Id": workspaceId,
    },
    body: JSON.stringify({ path, encoding: "base64" }),
    signal: AbortSignal.timeout(FILE_READ_TIMEOUT_MS),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "read failed");
    const err = new Error(text) as Error & { status?: number };
    err.status = resp.status;
    throw err;
  }
  const data = (await resp.json()) as { content?: string; encoding?: string };
  if (data.encoding !== "base64" || typeof data.content !== "string") {
    throw new Error("terminal server did not honor base64 encoding");
  }
  return Buffer.from(data.content, "base64");
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return slug || "project";
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { userId } = await auth(request);
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const terminalUnavailable = terminalNotConfiguredResponse();
  if (terminalUnavailable) return terminalUnavailable;

  const { projectId } = await params;

  try {
    // Same verification + auto-recovery contract as /files.
    let verified;
    try {
      verified = await verifyProjectWorkspace(projectId, userId);
    } catch (verifyErr) {
      const code = (verifyErr as { code?: string }).code;
      if (code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY") {
        try {
          const { getProject } = await import("@/lib/projects/project-repository");
          const project = await getProject(projectId, userId);
          if (project?.workspaceId) {
            await ensureWorkspaceAlive(projectId, userId, project.workspaceId);
          } else {
            await reprepareWorkspace(projectId, userId);
          }
          verified = await verifyProjectWorkspace(projectId, userId);
        } catch {
          throw verifyErr;
        }
      } else {
        throw verifyErr;
      }
    }

    const { project } = verified;
    let { workspaceId } = verified;
    let { token } = createTerminalToken(userId);

    // Recursive walk — folders are descended, skipped-dir names excluded,
    // everything else is a file to pack.
    const filePaths: string[] = [];
    const skipped: string[] = [];
    let totalBytes = 0;

    async function walk(dir: string, depth: number): Promise<void> {
      if (depth > MAX_WALK_DEPTH || filePaths.length >= MAX_FILES) return;
      const { entries } = await terminalList(dir, workspaceId, token);
      for (const e of entries ?? []) {
        const rel = dir === "." ? e.name : `${dir}/${e.name}`;
        if (!isSafeRelativePath(rel)) continue;
        const isDir = e.type === "directory" || e.type === "dir" || e.type === "folder";
        if (isDir) {
          if (SKIP_DIRS.has(e.name)) continue;
          await walk(rel, depth + 1);
        } else {
          filePaths.push(rel);
        }
      }
    }

    try {
      await walk(".", 0);
    } catch (err) {
      const status = (err as { status?: number }).status;
      // Stale-workspace recovery: re-prepare once and retry the walk.
      if (status === 404) {
        const recovered = await ensureWorkspaceAlive(projectId, userId, workspaceId);
        if (recovered.reprepared) {
          workspaceId = recovered.workspaceId;
          token = createTerminalToken(userId).token;
          await walk(".", 0);
        }
      } else {
        throw err;
      }
    }

    if (filePaths.length === 0) {
      return NextResponse.json(
        { error: "The project workspace has no files to export yet." },
        { status: 409 },
      );
    }

    const zipEntries: ZipEntryInput[] = [];
    for (const rel of filePaths) {
      if (totalBytes > MAX_TOTAL_BYTES) {
        skipped.push(`${rel} (export size limit reached)`);
        continue;
      }
      try {
        const data = await terminalRead(rel, workspaceId, token);
        totalBytes += data.length;
        zipEntries.push({ name: rel, data });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unreadable";
        skipped.push(`${rel} (${msg.slice(0, 160)})`);
      }
    }

    if (skipped.length > 0) {
      zipEntries.push({
        name: "EXPORT-SKIPPED.txt",
        data: Buffer.from(
          "These workspace files could not be included in this export:\n\n" +
            skipped.map((s) => `- ${s}`).join("\n") +
            "\n",
          "utf-8",
        ),
      });
    }

    const zip = buildZip(zipEntries);
    const filename = `${slugify(project?.name ?? projectId)}-export.zip`;

    return new NextResponse(new Uint8Array(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(zip.length),
        "Cache-Control": "no-store",
        "X-Export-File-Count": String(zipEntries.length - (skipped.length > 0 ? 1 : 0)),
        "X-Export-Skipped": String(skipped.length),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Export failed";
    const code = (err as { code?: string }).code;
    const status =
      code === "PROJECT_NOT_FOUND" ? 404 :
      code === "FORBIDDEN" ? 403 :
      code === "WORKSPACE_NOT_PROVISIONED" || code === "WORKSPACE_NOT_READY" ? 409 :
      msg.includes("not found") ? 404 :
      msg.includes("Forbidden") ? 403 :
      500;
    return NextResponse.json({ error: normalizeFileError(msg), code: code ?? null }, { status });
  }
}
