/**
 * RemoteWorkspaceStore — persists the user's selected remote workspace.
 *
 * When a user has multiple ready workspaces on terminal-server, they
 * must select one before managed-key chat can run. The selection is
 * stored in ~/.litt/remote-workspace.json so it survives CLI restarts.
 *
 * Pure data access — no React, no Ink, no network.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface RemoteWorkspaceSelection {
  workspaceId: string;
  projectId: string;
  root: string;
  branch: string;
  selectedAt: number;
}

function storeFile(): string {
  const override = process.env.LITT_REMOTE_WORKSPACE_FILE;
  if (override) return override;
  return join(homedir(), ".litt", "remote-workspace.json");
}

/** Read the persisted workspace selection, or null if none. */
export function getSelectedRemoteWorkspace(): RemoteWorkspaceSelection | null {
  try {
    const raw = readFileSync(storeFile(), "utf8");
    const parsed = JSON.parse(raw) as RemoteWorkspaceSelection;
    if (parsed && typeof parsed.workspaceId === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist the selected workspace. Creates ~/.litt/ if needed. */
export function setSelectedRemoteWorkspace(
  selection: Omit<RemoteWorkspaceSelection, "selectedAt">,
): RemoteWorkspaceSelection {
  const full: RemoteWorkspaceSelection = {
    ...selection,
    selectedAt: Date.now(),
  };
  const dir = join(homedir(), ".litt");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(storeFile(), JSON.stringify(full, null, 2), "utf8");
  return full;
}

/** Clear the persisted workspace selection (e.g. on logout). */
export function clearSelectedRemoteWorkspace(): void {
  try {
    const file = storeFile();
    if (existsSync(file)) writeFileSync(file, "null", "utf8");
  } catch {
    // Best-effort — if the file can't be written, the selection is
    // stale but not harmful (the server re-verifies ownership).
  }
}
