/**
 * User-authenticated workspace routes.
 *
 * GET /api/workspaces — list the authenticated user's ready workspaces.
 *
 * This is the endpoint `litt workspace list|select` calls. It is the
 * USER-facing counterpart to the service-to-service
 * `/internal/workspace/*` routes: authentication is a terminal JWT
 * minted by `/api/token-exchange`, NOT the internal service key.
 *
 * Security chain:
 *   CLI (authenticated Clerk user)
 *     → POST /api/token-exchange  → terminal JWT (userId signed in `sub`)
 *     → GET /api/workspaces with that JWT
 *     → userId read from the VERIFIED token, never from query/body
 *     → only workspaces owned by that userId are returned
 *
 * A user cannot enumerate another account's workspaces: there is no
 * userId input to this endpoint at all.
 *
 * Response shape (the contract `listRemoteWorkspaces` in the CLI decodes):
 *   { workspaces: [{ workspaceId, projectId, root, branch }] }
 *
 * Only those four fields are exposed. `userId`, `ready`, `commitSha`
 * and any future internal metadata stay server-side.
 *
 * This handler lives in its own module — rather than inline in
 * server.ts — so the endpoint tests exercise the SAME code the server
 * registers. A previous version of this endpoint existed only as an
 * inline handler inside its own test file, so the suite passed while
 * production returned 404 for every request.
 */

import type { Application, Response } from "express";
import { verifyTerminalToken, bearerToken } from "./auth";
import {
  listWorkspaces as defaultListWorkspaces,
  type WorkspaceDescriptor,
} from "./workspace/WorkspaceManager";
import type { AuthenticatedRequest } from "./internal-auth";

/** The safe, user-facing projection of a workspace. */
export interface PublicWorkspace {
  workspaceId: string;
  projectId: string;
  root: string;
  branch: string;
}

export interface WorkspaceRouteDeps {
  /** Injected for tests; defaults to the real WorkspaceManager store. */
  listWorkspaces?: (userId: string) => WorkspaceDescriptor[];
}

/**
 * Project a descriptor onto the public shape, or null when the record
 * is unusable (missing required fields).
 *
 * Returning null rather than throwing keeps ONE malformed registry
 * entry from failing the whole list — the user still sees every other
 * workspace they own. `.workspaces.json` is written by several code
 * paths across deploys, so a partially-written record is a realistic
 * state, not a theoretical one.
 */
export function toPublicWorkspace(ws: WorkspaceDescriptor): PublicWorkspace | null {
  const { workspaceId, projectId, root, branch } = ws ?? {};
  if (
    typeof workspaceId !== "string" || !workspaceId ||
    typeof projectId !== "string" || !projectId ||
    typeof root !== "string" || !root ||
    typeof branch !== "string" || !branch
  ) {
    return null;
  }
  return { workspaceId, projectId, root, branch };
}

/**
 * Select the workspaces a given user may see: owned by them, ready,
 * and structurally valid. Pure — exported for direct testing.
 */
export function selectReadyWorkspaces(
  all: readonly WorkspaceDescriptor[],
  userId: string,
): PublicWorkspace[] {
  const out: PublicWorkspace[] = [];
  for (const ws of all) {
    // Ownership re-check. listWorkspaces() already filters by userId;
    // this is defense in depth so a change there can never turn this
    // endpoint into a cross-user enumeration.
    if (!ws || ws.userId !== userId) continue;
    if (!ws.ready) continue;
    const projected = toPublicWorkspace(ws);
    if (!projected) {
      console.warn("[Workspaces] Skipping malformed workspace record for user");
      continue;
    }
    out.push(projected);
  }
  return out;
}

/**
 * Register the user-authenticated workspace routes on an Express app.
 * Called by server.ts, and by the endpoint tests, so both run the
 * identical handler.
 */
export function registerWorkspaceRoutes(
  app: Application,
  deps: WorkspaceRouteDeps = {},
): void {
  const listWorkspaces = deps.listWorkspaces ?? defaultListWorkspaces;

  app.get("/api/workspaces", (req: AuthenticatedRequest, res: Response) => {
    // ─── 1. Verify the terminal JWT ──────────────────────────────
    let userId: string;
    try {
      const payload = verifyTerminalToken(bearerToken(req.headers.authorization));
      userId = payload.sub;
    } catch {
      res.status(401).json({ error: "Unauthorized — valid terminal token required" });
      return;
    }

    // ─── 2. List only this user's ready workspaces ───────────────
    try {
      res.json({ workspaces: selectReadyWorkspaces(listWorkspaces(userId), userId) });
    } catch (err) {
      // The registry is unreadable — a real server-side fault. Report
      // it as 500 so the client distinguishes "the service broke" from
      // "you have no workspaces" (200 + []) and from "this endpoint
      // does not exist" (404).
      const message = err instanceof Error ? err.message : "Workspace listing failed";
      console.error("[Workspaces] list error:", message);
      res.status(500).json({ error: "Workspace listing failed" });
    }
  });
}
