/**
 * export-project — canonical client path for the project source-export ZIP.
 *
 * GET /api/studio-projects/{id}/export streams a ZIP built server-side from
 * the workspace's publishable files. The UI calls this exactly once per
 * export (single-flight is the caller's job via a busy flag) and reports
 * the server's real outcome — a failed export must surface the server's
 * error, never a silent no-op or a fake "exported" state.
 */

export type ExportProjectResult =
  | { ok: true; filename: string; fileCount: number | null; truncated: boolean }
  | { ok: false; error: string };

type GetToken = (() => Promise<string | null>) | undefined;

async function hasCompleteZipStructure(blob: Blob, expectedCount: number | null): Promise<boolean> {
  if (blob.size < 52) return false;
  const first = new DataView(await blob.slice(0, 4).arrayBuffer());
  const end = new DataView(await blob.slice(blob.size - 22).arrayBuffer());
  if (first.getUint32(0, true) !== 0x04034b50 || end.getUint32(0, true) !== 0x06054b50) return false;
  const count = end.getUint16(10, true);
  const centralSize = end.getUint32(12, true);
  const centralOffset = end.getUint32(16, true);
  if (count === 0 || (expectedCount !== null && count !== expectedCount)) return false;
  if (centralOffset + centralSize !== blob.size - 22 || centralSize < 46) return false;
  const central = new DataView(await blob.slice(centralOffset, centralOffset + 4).arrayBuffer());
  return central.getUint32(0, true) === 0x02014b50;
}

export async function downloadProjectExport(
  projectId: string,
  getToken?: GetToken,
): Promise<ExportProjectResult> {
  const token = (await getToken?.().catch(() => null)) ?? null;
  let response: Response;
  try {
    response = await fetch(
      `/api/studio-projects/${encodeURIComponent(projectId)}/export`,
      {
        cache: "no-store",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(120_000),
      },
    );
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof DOMException && err.name === "TimeoutError"
          ? "Export timed out — try again."
          : "Export request failed — check your connection and retry.",
    };
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const serverError = typeof payload?.error === "string" ? payload.error : null;
    return { ok: false, error: serverError ?? `Export failed (${response.status})` };
  }

  const blob = await response.blob();
  const reportedCount = response.headers.get("X-Export-File-Count");
  const fileCount = reportedCount === null ? null : Number(reportedCount);
  if (response.headers.get("X-Export-Truncated") === "true" ||
      Number(response.headers.get("X-Export-Skipped") ?? "0") > 0) {
    return { ok: false, error: "Export was incomplete. Retry after checking project files." };
  }
  if (!response.headers.get("Content-Type")?.toLowerCase().includes("application/zip") ||
      (fileCount !== null && (!Number.isInteger(fileCount) || fileCount < 1)) ||
      !await hasCompleteZipStructure(blob, fileCount)) {
    return { ok: false, error: "Export returned an invalid ZIP archive. Retry the download." };
  }

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const nameMatch = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = nameMatch?.[1] ?? `${projectId}.zip`;

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.rel = "noopener";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Defer revocation so the browser has committed the download.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }

  return {
    ok: true,
    filename,
    fileCount,
    truncated: false,
  };
}
