/**
 * RemoteWorkspaceStore — persists the user's selected remote workspace.
 *
 * When a user has multiple ready workspaces on terminal-server, they
 * must select one before managed-key chat can run. The selection is
 * stored in ~/.litt/remote-workspace.json so it survives CLI restarts.
 *
 * Pure data access — no React, no Ink, no network.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

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

/** Validate the complete persisted selection shape. */
function isRemoteWorkspaceSelection(value: unknown): value is RemoteWorkspaceSelection {
  if (!value || typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.workspaceId === "string" &&
    typeof s.projectId === "string" &&
    typeof s.root === "string" &&
    typeof s.branch === "string" &&
    typeof s.selectedAt === "number"
  );
}

/** Read the persisted workspace selection, or null if none/invalid. */
export function getSelectedRemoteWorkspace(): RemoteWorkspaceSelection | null {
  try {
    const raw = readFileSync(storeFile(), "utf8");
    const parsed: unknown = JSON.parse(raw);
    if (isRemoteWorkspaceSelection(parsed)) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

/** Persist the selected workspace. Creates the parent directory if needed. */
export function setSelectedRemoteWorkspace(
  selection: Omit<RemoteWorkspaceSelection, "selectedAt">,
): RemoteWorkspaceSelection {
  const full: RemoteWorkspaceSelection = {
    ...selection,
    selectedAt: Date.now(),
  };
  const file = storeFile();
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify(full, null, 2), "utf8");
  return full;
}

/** Clear the persisted workspace selection (e.g. on logout). Removes the file. */
export function clearSelectedRemoteWorkspace(): void {
  try {
    rmSync(storeFile(), { force: true });
  } catch {
    // Best-effort — if the file can't be removed, the selection is
    // stale but not harmful (the server re-verifies ownership).
  }
}
