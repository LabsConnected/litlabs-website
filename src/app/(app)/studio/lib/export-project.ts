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
  if (blob.size === 0) return { ok: false, error: "Export returned an empty archive" };

  const disposition = response.headers.get("Content-Disposition") ?? "";
  const nameMatch = /filename="?([^";]+)"?/i.exec(disposition);
  const filename = nameMatch?.[1] ?? `${projectId}.zip`;
  const fileCountHeader = response.headers.get("X-Export-File-Count");
  const fileCount = fileCountHeader !== null ? Number(fileCountHeader) : null;
  const truncated = response.headers.get("X-Export-Truncated") === "true";

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
    fileCount: typeof fileCount === "number" && Number.isFinite(fileCount) ? fileCount : null,
    truncated,
  };
}
