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
const TERMINAL_BASE = () =>
  process.env.TERMINAL_SERVER_INTERNAL_URL ??
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL ??
  "https://litlabs-terminal-server-production-0be1.up.railway.app";

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
