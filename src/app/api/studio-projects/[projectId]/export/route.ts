import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { verifyProjectWorkspace, getProject } from "@/lib/projects/project-repository";
import { createTerminalToken } from "@/lib/terminal-auth";
import { requireTerminalBaseUrl, terminalNotConfiguredResponse } from "@/lib/terminal-config";
import { isSafeArtifactPath } from "@/lib/deployments/user-deployment";
import { isPublishablePath, PUBLISH_EXCLUDED_DIRS } from "@/lib/deployments/publish-readiness";

/**
 * GET /api/studio-projects/[projectId]/export
 *
 * Complete source export — streams the entire publishable workspace as a ZIP archive.
 * The ZIP is built server-side from the terminal's ws-files listing (no git required)
 * and respects the same exclusion rules as the publish pipeline (PUBLISH_EXCLUDED_DIRS,
 * MAX_DIRS 60, MAX_ENTRIES 600). Suitable for "Export → Independently Build" workflow.
 *
 * Auth + workspace verification required. Terminal must be configured.
 */

const TERMINAL_BASE = () => requireTerminalBaseUrl();
const MAX_DIRS = 60;
const MAX_ENTRIES = 600;
const MAX_FILE_SIZE = 50 * 1024 * 1024;

type WsEntry = { name: string; type: string };

async function listDir(
  base: string,
  headers: Record<string, string>,
  dir: string,
): Promise<WsEntry[]> {
  const resp = await fetch(`${base}/ws-files?path=${encodeURIComponent(dir)}`, { headers });
  if (!resp.ok) throw new Error(`list failed ${resp.status}`);
  const data = (await resp.json()) as { entries?: WsEntry[] };
  return Array.isArray(data.entries) ? data.entries : [];
}

async function readFile(
  base: string,
  headers: Record<string, string>,
  path: string,
): Promise<Uint8Array | null> {
  try {
    const resp = await fetch(`${base}/ws-files/read`, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { content?: string; encoding?: string; size?: number };
    if (typeof data.size === "number" && data.size > MAX_FILE_SIZE) return null;
    if (typeof data.content !== "string") return null;
    // Handle base64-encoded binary (files/raw uses base64 for non-text)
    if (data.encoding === "base64") {
      const bin = Buffer.from(data.content, "base64");
      return new Uint8Array(bin);
    }
    return new TextEncoder().encode(data.content);
  } catch {
    return null;
  }
}

// Minimal CRC32 (IEEE) for ZIP
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = c >>> 1 ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}

// Build a minimal ZIP (STORE method, no compression) from path -> bytes
function buildZip(files: Array<{ path: string; data: Uint8Array }>): Uint8Array {
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  const enc = new TextEncoder();
  for (const f of files) {
    const nameBytes = enc.encode(f.path);
    const crc = crc32(f.data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true); // local file header sig
    view.setUint16(4, 20, true); // version
    view.setUint16(6, 0, true); // flags
    view.setUint16(8, 0, true); // method STORE
    view.setUint16(10, 0, true); // time
    view.setUint16(12, 0, true); // date
    view.setUint32(14, crc, true);
    view.setUint32(18, f.data.length, true);
    view.setUint32(22, f.data.length, true);
    view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true); // extra len
    localHeader.set(nameBytes, 30);
    parts.push(localHeader);
    parts.push(f.data);
    // Central directory entry
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true); // version made by
    cv.setUint16(6, 20, true); // version needed
    cv.setUint16(8, 0, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, 0, true);
    cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // extra
    cv.setUint16(32, 0, true); // comment
    cv.setUint16(34, 0, true); // disk
    cv.setUint16(36, 0, true); // internal attr
    cv.setUint32(38, 0, true); // external attr
    cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    central.push(centralHeader);
    offset += localHeader.length + f.data.length;
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of central) centralSize += c.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);
  ev.setUint16(20, 0, true);

  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
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
  const project = await getProject(projectId, userId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  let workspaceId: string;
  try {
    workspaceId = (await verifyProjectWorkspace(projectId, userId)).workspaceId;
  } catch (err) {
    const code = (err as { code?: string }).code;
    const status = code === "PROJECT_NOT_FOUND" ? 404 : code === "FORBIDDEN" ? 403 : 409;
    return NextResponse.json({ error: (err as Error).message }, { status });
  }

  const { token } = createTerminalToken(userId);
  const headers = { Authorization: `Bearer ${token}`, "X-Workspace-Id": workspaceId };
  const base = TERMINAL_BASE();

  try {
    // Collect publishable file list (same traversal as publish-readiness)
    const files: string[] = [];
    const queue: string[] = ["."];
    const seen = new Set<string>(["."]);
    let dirCount = 0;
    let entryCount = 0;
    let truncated = false;

    while (queue.length > 0 && dirCount < MAX_DIRS && !truncated) {
      const dir = queue.shift()!;
      dirCount++;
      let entries: WsEntry[];
      try {
        entries = await listDir(base, headers, dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        entryCount++;
        if (entryCount > MAX_ENTRIES) { truncated = true; break; }
        const path = dir === "." ? entry.name : `${dir}/${entry.name}`;
        if (entry.type === "directory") {
          if (PUBLISH_EXCLUDED_DIRS.has(entry.name)) continue;
          if (!isSafeArtifactPath(path)) continue;
          if (!seen.has(path)) { seen.add(path); queue.push(path); }
          continue;
        }
        if (!isPublishablePath(path)) continue;
        files.push(path);
      }
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No publishable files to export" }, { status: 422 });
    }

    // Read each file
    const fileData: Array<{ path: string; data: Uint8Array }> = [];
    for (const p of files) {
      const data = await readFile(base, headers, p);
      if (data) fileData.push({ path: p, data });
    }

    if (fileData.length === 0) {
      return NextResponse.json({ error: "Failed to read any files for export" }, { status: 502 });
    }

    // Independent build: ensure exported site is buildable even when the workspace
    // has no package.json (pure static). Inject a minimal package.json + README
    // so `pnpm build` succeeds standalone (mirrors checks/run-all buildCommand).
    const hasPackageJson = fileData.some((f) => f.path === "package.json");
    if (!hasPackageJson) {
      const pkg = JSON.stringify(
        {
          name: (project.name || projectId).toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 64) || "litt-export",
          version: "1.0.0",
          private: true,
          scripts: { build: "echo 'Static site — no build step required' && ls -la" },
        },
        null,
        2,
      );
      fileData.push({ path: "package.json", data: new TextEncoder().encode(pkg) });
      fileData.push({
        path: "README.md",
        data: new TextEncoder().encode(
          `# ${project.name || projectId}\n\nExported from LiTT Studio at ${new Date().toISOString()}.\n\nRun \`pnpm build\` or \`npm run build\` — static site, no compile step.\n`,
        ),
      });
    }

    const zip = buildZip(fileData);
    const safeName = (project.name || projectId).replace(/[^a-zA-Z0-9-_]/g, "_").slice(0, 64) || projectId;
    return new NextResponse(zip as unknown as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${safeName}.zip"`,
        "Content-Length": String(zip.length),
        "X-Export-File-Count": String(fileData.length),
        "X-Export-Truncated": String(truncated),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Export failed";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
