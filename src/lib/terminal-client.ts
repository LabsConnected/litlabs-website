"use client";

type CachedTerminalToken = {
  token: string;
  expiresAt: number;
  projectId: string | null;
  baseUrl: string;
};

export type TerminalTokenResult = {
  token: string;
  baseUrl: string;
};

export class WorkspaceNotReadyError extends Error {
  code: string;
  detail?: string;
  constructor(message: string, detail?: string) {
    super(message);
    this.name = "WorkspaceNotReadyError";
    this.code = "WORKSPACE_NOT_READY";
    this.detail = detail;
  }
}

export class TerminalDisabledError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.name = "TerminalDisabledError";
    this.code = "TERMINAL_DISABLED";
  }
}

let cached: CachedTerminalToken | null = null;
let pending: Promise<TerminalTokenResult> | null = null;
// A TERMINAL_DISABLED 403 is a deploy-time feature-flag verdict, not a
// transient failure — retrying can never change it until the flag flips
// (a redeploy + page reload). Cache it for the session so retries show the
// truthful "not available" state without re-hammering the endpoint.
let terminalDisabled = false;

export function clearTerminalTokenCache() {
  cached = null;
  pending = null;
  terminalDisabled = false;
}

export async function getTerminalToken(
  forceRefresh = false,
  projectId?: string,
  authToken?: string,
): Promise<string> {
  const result = await getTerminalTokenResult(forceRefresh, projectId, authToken);
  return result.token;
}

export async function getTerminalTokenResult(
  forceRefresh = false,
  projectId?: string,
  authToken?: string,
): Promise<TerminalTokenResult> {
  const now = Date.now();
  const requestedProjectId = projectId ?? null;
  if (terminalDisabled && !forceRefresh) {
    throw new TerminalDisabledError("The terminal is not available yet.");
  }
  if (!forceRefresh && cached && cached.projectId === requestedProjectId && cached.expiresAt - now > 30_000) {
    return { token: cached.token, baseUrl: cached.baseUrl };
  }
  if (!forceRefresh && pending) return pending;

  const url = projectId
    ? `/api/terminal/token?projectId=${encodeURIComponent(projectId)}`
    : "/api/terminal/token";

  const headers: HeadersInit = authToken
    ? { Authorization: `Bearer ${authToken}` }
    : {};

  pending = fetch(url, {
    credentials: "include",
    cache: "no-store",
    headers,
  })
    .then(async (response) => {
      const body = (await response.json().catch(() => ({}))) as Partial<
        CachedTerminalToken & { error: string; code?: string; detail?: string }
      >;
      if (!response.ok || !body.token || !body.expiresAt) {
        if (response.status === 403 && body.code === "TERMINAL_DISABLED") {
          terminalDisabled = true;
          throw new TerminalDisabledError(body.error || "The terminal is not available yet.");
        }
        if (response.status === 409 && body.code === "WORKSPACE_NOT_READY") {
          throw new WorkspaceNotReadyError(body.error || "Workspace not ready", body.detail);
        }
        throw new Error(body.error || "Terminal authentication failed");
      }
      cached = { token: body.token, expiresAt: body.expiresAt, projectId: requestedProjectId, baseUrl: body.baseUrl || "" };
      return { token: body.token, baseUrl: body.baseUrl || "" };
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export async function terminalAuthHeaders(): Promise<HeadersInit> {
  return {
    Authorization: `Bearer ${await getTerminalToken()}`,
    "Content-Type": "application/json",
  };
}
