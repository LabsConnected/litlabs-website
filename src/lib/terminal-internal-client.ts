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
 * Prepare a workspace on the terminal server.
 * Returns the workspace descriptor with root path and commit SHA.
 */
export async function prepareWorkspaceInternal(
  body:
    | { sourceType: "github"; userId: string; projectId: string; installationId: number; owner: string; repo: string; branch: string; githubToken?: string | null; commitSha?: string | null }
    | { sourceType: "blank"; userId: string; projectId: string; templateId: string },
): Promise<WorkspacePrepareResponse> {
  const key = INTERNAL_KEY();
  if (key.length < 32) {
    throw new Error("TERMINAL_INTERNAL_SERVICE_KEY not configured");
  }

  const url = `${TERMINAL_BASE()}/internal/workspace/prepare`;
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": key,
    },
    body: JSON.stringify(body),
  });

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
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "X-Internal-Service-Key": key,
    },
  });

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
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": key,
    },
    body: JSON.stringify({ userId, ...options }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "Unknown error");
    throw new Error(`Preview start failed (${resp.status}): ${text}`);
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
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "X-Internal-Service-Key": key,
    },
  });

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
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": key,
    },
    body: JSON.stringify({ userId }),
  });

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
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Internal-Service-Key": key,
    },
    body: JSON.stringify({ userId }),
  });

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
  const resp = await fetch(url, {
    method: "GET",
    headers: {
      "X-Internal-Service-Key": key,
    },
  });

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
  const base = TERMINAL_BASE();
  const token = process.env.PREVIEW_ACCESS_TOKEN ?? "";
  const tokenParam = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${base}/preview/${encodeURIComponent(workspaceId)}${tokenParam}`;
}
