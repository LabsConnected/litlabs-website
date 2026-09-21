/**
 * Internal client for terminal-server service-to-service calls.
 *
 * This is server-only code. It uses a shared secret
 * (TERMINAL_INTERNAL_SERVICE_KEY) to authenticate with the
 * terminal-server's /internal/* endpoints.
 *
 * The browser NEVER calls terminal-server directly for workspace
 * operations. The browser calls Next.js, which calls terminal-server.
 */

const INTERNAL_KEY = () => process.env.TERMINAL_INTERNAL_SERVICE_KEY ?? "";
const TERMINAL_BASE = () => {
  const raw = process.env.TERMINAL_SERVER_URL ??
    process.env.TERMINAL_SERVER_INTERNAL_URL ??
    "";
  if (raw && !raw.includes("localhost")) return raw;
  // Dev fallback — only when not in production
  if (process.env.NODE_ENV !== "production") {
    return process.env.TERMINAL_SERVER_URL || "http://localhost:4001";
  }
  return raw || "";
};

/**
 * The project's previously-recorded workspace, so the terminal server
 * ADOPTS existing durable source instead of provisioning a new empty
 * directory beside it. Omitting these is safe but loses the files of a
 * workspace created under the old random-id scheme.
 */
export interface WorkspaceAdoptionHints {
  existingRoot?: string | null;
  existingWorkspaceId?: string | null;
}

export interface WorkspacePrepareResponse {
  workspaceId: string;
  userId: string;
  projectId: string;
  root: string;
  branch: string;
  commitSha: string;
  ready: boolean;
}

export interface WorkspaceGetResponse {
  workspaceId: string;
  userId: string;
  projectId: string;
  root: string;
  branch: string;
  commitSha: string;
  ready: boolean;
}

/**
 * Per-operation timeouts for terminal-server calls (milliseconds).
 *
 * Nothing in this chain is allowed to hang forever. A hung terminal server
 * previously left Studio previews stuck on "Preparing preview…" for hours
 * with no error and no retry — the browser fetch, the Next.js route, and
 * these internal calls all waited indefinitely. Now every call fails loudly
 * with a descriptive error so the UI can show "failed" instead of spinning.
 *
 * Budgets: prepare can clone a repo and copy a template (generous);
 * preview start/restart can npm-install and boot a dev server; everything
 * else is a quick status check.
 */
export const TERMINAL_TIMEOUTS = {
  prepareWorkspace: 180_000,
  startPreview: 120_000,
  restartPreview: 120_000,
  getWorkspace: 20_000,
  getPreviewStatus: 20_000,
  stopPreview: 20_000,
  getPreviewLogs: 20_000,
  runtimeSnapshot: 10_000,
} as const;

/**
 * fetch() with a hard timeout. On timeout, throws a descriptive Error
 * naming the operation — never lets the caller hang indefinitely.
 * Exported for tests.
 */
export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  operationLabel: string,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (controller.signal.aborted) {
      const method = (init.method ?? "GET").toUpperCase();
      throw new Error(
        `Terminal server timed out after ${Math.round(timeoutMs / 1000)}s: ${method} ${operationLabel} — the request never completed.`,
      );
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Prepare a workspace on the terminal server.
 * Returns the workspace descriptor with root path and commit SHA.
 */
export async function prepareWorkspaceInternal(
  body:
    | ({ sourceType: "github"; userId: string; projectId: string; installationId: number; owner: string; repo: string; branch: string; githubToken?: string | null; commitSha?: string | null } & WorkspaceAdoptionHints)
    | ({ sourceType: "managed"; userId: string; projectId: string; templateId: string } & WorkspaceAdoptionHints),
): Promise<WorkspacePrepareResponse> {
  const key = INTERNAL_KEY();
  if (key.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const url = `${TERMINAL_BASE()}/internal/workspace/prepare`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": key,
      },
      body: JSON.stringify(body),
    },
    TERMINAL_TIMEOUTS.prepareWorkspace,
    "POST /internal/workspace/prepare",
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Workspace prepare failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as WorkspacePrepareResponse;
}

/**
 * Get workspace state from the terminal server.
 */
export async function getWorkspaceInternal(
  workspaceId: string,
  userId: string,
): Promise<WorkspaceGetResponse | null> {
  const key = INTERNAL_KEY();
  if (key.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const url = `${TERMINAL_BASE()}/internal/workspace/${encodeURIComponent(workspaceId)}?userId=${encodeURIComponent(userId)}`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        "X-Internal-Service-Key": key,
      },
    },
    TERMINAL_TIMEOUTS.getWorkspace,
    "GET /internal/workspace/{id}",
  );

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Workspace get failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as WorkspaceGetResponse;
}

// ─── Preview Runtime Client ─────────────────────────────────────────

export interface PreviewStatusResponse {
  status: "stopped" | "starting" | "ready" | "failed" | "restarting";
  port: number | null;
  framework: string | null;
  command: string | null;
  startedAt: number | null;
  lastHealthCheck: number | null;
  error: string | null;
  errorCode: string | null;
  logs: string[];
}

export interface PreviewStartResponse {
  workspaceId: string;
  status: PreviewStatusResponse["status"];
  port: number;
  framework: string;
  command: string;
  startedAt: number | null;
}

/**
 * Start a preview dev server on the terminal server.
 */
export async function startPreviewInternal(
  workspaceId: string,
  userId: string,
  options?: { framework?: string; command?: string; packageManager?: string },
): Promise<PreviewStartResponse> {
  const key = INTERNAL_KEY();
  if (key.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const url = `${TERMINAL_BASE()}/internal/workspace/${encodeURIComponent(workspaceId)}/preview/start`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": key,
      },
      body: JSON.stringify({ userId, ...options }),
    },
    TERMINAL_TIMEOUTS.startPreview,
    "POST /internal/workspace/{id}/preview/start",
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    // Try to extract errorCode from the terminal-server's error response
    let errorCode: string | null = null;
    try {
      const parsed = JSON.parse(text);
      if (parsed?.errorCode) errorCode = String(parsed.errorCode);
    } catch {
      // Not JSON — fall through
    }
    const err = new Error(`Preview start failed (${resp.status}): ${text}`);
    if (errorCode) (err as { code?: string }).code = errorCode;
    throw err;
  }

  return (await resp.json()) as PreviewStartResponse;
}

/**
 * Get preview runtime status from the terminal server.
 * This performs a live health check — it does NOT trust cached state.
 */
export async function getPreviewStatusInternal(
  workspaceId: string,
  userId: string,
): Promise<PreviewStatusResponse | null> {
  const key = INTERNAL_KEY();
  if (key.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const url = `${TERMINAL_BASE()}/internal/workspace/${encodeURIComponent(workspaceId)}/preview/status?userId=${encodeURIComponent(userId)}`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        "X-Internal-Service-Key": key,
      },
    },
    TERMINAL_TIMEOUTS.getPreviewStatus,
    "GET /internal/workspace/{id}/preview/status",
  );

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Preview status failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as PreviewStatusResponse;
}

/**
 * Stop a preview dev server on the terminal server.
 */
export async function stopPreviewInternal(
  workspaceId: string,
  userId: string,
): Promise<void> {
  const key = INTERNAL_KEY();
  if (key.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const url = `${TERMINAL_BASE()}/internal/workspace/${encodeURIComponent(workspaceId)}/preview/stop`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": key,
      },
      body: JSON.stringify({ userId }),
    },
    TERMINAL_TIMEOUTS.stopPreview,
    "POST /internal/workspace/{id}/preview/stop",
  );

  if (!resp.ok && resp.status !== 404) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Preview stop failed (${resp.status}): ${text}`);
  }
}

/**
 * Restart a preview dev server on the terminal server.
 */
export async function restartPreviewInternal(
  workspaceId: string,
  userId: string,
): Promise<PreviewStartResponse> {
  const key = INTERNAL_KEY();
  if (key.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const url = `${TERMINAL_BASE()}/internal/workspace/${encodeURIComponent(workspaceId)}/preview/restart`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Internal-Service-Key": key,
      },
      body: JSON.stringify({ userId }),
    },
    TERMINAL_TIMEOUTS.restartPreview,
    "POST /internal/workspace/{id}/preview/restart",
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Preview restart failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as PreviewStartResponse;
}

/**
 * Get preview logs from the terminal server.
 */
export async function getPreviewLogsInternal(
  workspaceId: string,
  userId: string,
  lines = 100,
): Promise<string[]> {
  const key = INTERNAL_KEY();
  if (key.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const url = `${TERMINAL_BASE()}/internal/workspace/${encodeURIComponent(workspaceId)}/preview/logs?userId=${encodeURIComponent(userId)}&lines=${lines}`;
  const resp = await fetchWithTimeout(
    url,
    {
      method: "GET",
      headers: {
        "X-Internal-Service-Key": key,
      },
    },
    TERMINAL_TIMEOUTS.getPreviewLogs,
    "GET /internal/workspace/{id}/preview/logs",
  );

  if (resp.status === 404) return [];
  if (!resp.ok) {
    return [];
  }

  const data = (await resp.json()) as { logs: string[] };
  return data.logs ?? [];
}

/**
 * Build the public preview proxy URL for a workspace.
 * The browser uses this URL to access the running dev server.
 */
export function buildPreviewProxyUrl(workspaceId: string): string {
  const base = TERMINAL_BASE().replace(/\/+$/, "");
  const token = process.env.PREVIEW_ACCESS_TOKEN ?? "";
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";

  const candidate = `${base}/preview/${encodeURIComponent(workspaceId)}${tokenParam}`;

  // Some deployed terminal-server domains do not serve the Studio preview
  // proxy at the origin root. The canonical Railway domain is
  // `litlabs-terminal-server-production-0be1.up.railway.app` (see
  // deploy-terminal.yml); other known domains are variants of the same
  // service. Use the explicit preview host when available so the iframe
  // can actually load the proxied workspace.
  const previewHost = process.env.PREVIEW_PROXY_HOST?.trim();
  if (previewHost) {
    return `https://${previewHost}/preview/${encodeURIComponent(workspaceId)}${tokenParam}`;
  }

  return candidate;
}

/**
 * Fetch the canonical runtime snapshot from the terminal server's
 * /internal/runtime endpoint (same state the Socket.IO feed broadcasts).
 *
 * Used by the same-origin /api/runtime-feed relay so browsers never need
 * a direct WebSocket URL to the terminal server — the web server proxies
 * the status feed over the already-proven internal service connection.
 */
export async function getRuntimeSnapshotInternal(): Promise<unknown> {
  const key = INTERNAL_KEY();
  if (key.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const base = TERMINAL_BASE();
  if (!base) {
    throw new Error("Terminal server URL not configured");
  }

  const resp = await fetchWithTimeout(
    `${base}/internal/runtime`,
    {
      method: "GET",
      headers: {
        "X-Internal-Service-Key": key,
      },
    },
    TERMINAL_TIMEOUTS.runtimeSnapshot,
    "GET /internal/runtime",
  );

  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Runtime snapshot failed (${resp.status}): ${text}`);
  }

  return (await resp.json()) as unknown;
}
