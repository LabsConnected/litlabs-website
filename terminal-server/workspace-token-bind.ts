/**
 * Bind a terminal JWT to a workspace for /ws-files.
 *
 * Token `wid` is the authority. The X-Workspace-Id header must be present
 * and must match. An unbound token cannot name a workspace via the header.
 * This does not replace the workspace.userId === token.sub check.
 */

export type WorkspaceBindResult =
  | { ok: true; workspaceId: string }
  | { ok: false; status: 400 | 403; error: string };

export function bindWorkspaceFromToken(input: {
  tokenWorkspaceId: string | undefined;
  headerWorkspaceId: string | undefined;
}): WorkspaceBindResult {
  const header = input.headerWorkspaceId?.trim() ?? "";
  if (!header) {
    return { ok: false, status: 400, error: "Missing X-Workspace-Id header" };
  }
  const wid = input.tokenWorkspaceId?.trim() ?? "";
  if (!wid) {
    return { ok: false, status: 403, error: "Workspace-bound token required" };
  }
  if (wid !== header) {
    return { ok: false, status: 403, error: "Token workspace does not match" };
  }
  return { ok: true, workspaceId: wid };
}
