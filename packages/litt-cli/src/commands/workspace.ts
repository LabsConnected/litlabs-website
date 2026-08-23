/**
 * litt workspace — Manage remote workspace selection.
 *
 * Subcommands:
 *   list      — Show all ready workspaces for the signed-in user
 *   select    — Choose a workspace (by index, ID, or interactive prompt)
 *   current   — Show the currently selected workspace
 *
 * Users with multiple ready workspaces must select one before managed-key
 * chat can run. The selection is persisted locally in ~/.litt/remote-workspace.json
 * and sent as a signed claim during token exchange.
 *
 * Usage:
 *   litt workspace list
 *   litt workspace select
 *   litt workspace select <workspace-id>
 *   litt workspace select 1        (by index from `litt workspace list`)
 *   litt workspace current
 */

import { getAuthSession } from "../lib/auth/auth-session.js";
import { listRemoteWorkspaces, type RemoteWorkspace } from "../lib/remote.js";
import {
  getSelectedRemoteWorkspace,
  setSelectedRemoteWorkspace,
  clearSelectedRemoteWorkspace,
} from "../lib/remote-workspace-store.js";
import { ok, fail, warn, header, label, value, c } from "../lib/utils.js";
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

/**
 * Resolve a workspace from a string argument (index, ID, or partial name).
 * Returns the matched workspace, or null if no match / ambiguous match.
 * Exported for testability — pure function, no side effects.
 */
export function resolveWorkspaceByArg(
  arg: string,
  workspaces: RemoteWorkspace[],
): RemoteWorkspace | null {
  // Numeric index (1-based)
  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= workspaces.length) {
    return workspaces[idx - 1] ?? null;
  }

  // Exact workspace ID match — takes precedence over partial name
  const idMatch = workspaces.find((ws) => ws.workspaceId === arg);
  if (idMatch) {
    return idMatch;
  }

  // Partial name match (root basename) — only if exactly one match
  const nameMatches = workspaces.filter((ws) => {
    const name = ws.root.split("/").pop() ?? ws.root;
    return name.toLowerCase().includes(arg.toLowerCase());
  });
  if (nameMatches.length === 1) {
    return nameMatches[0];
  }
  // Ambiguous or no match
  return null;
}

/** Returns true if the arg matches multiple workspace names (ambiguous). */
export function isAmbiguousNameMatch(arg: string, workspaces: RemoteWorkspace[]): boolean {
  // Exact ID match is never ambiguous
  if (workspaces.some((ws) => ws.workspaceId === arg)) return false;
  // Numeric index is never ambiguous
  const idx = parseInt(arg, 10);
  if (!isNaN(idx) && idx >= 1 && idx <= workspaces.length) return false;
  const nameMatches = workspaces.filter((ws) => {
    const name = ws.root.split("/").pop() ?? ws.root;
    return name.toLowerCase().includes(arg.toLowerCase());
  });
  return nameMatches.length > 1;
}

export async function workspaceCommand(args: string[]): Promise<number> {
  const subcommand = args[0] ?? "list";

  switch (subcommand) {
    case "list":
      return listWorkspaces();
    case "select":
      return selectWorkspace(args.slice(1));
    case "current":
      return currentWorkspace();
    case "clear":
      clearSelectedRemoteWorkspace();
      ok("Workspace selection cleared.");
      return 0;
    default:
      fail(`Unknown subcommand: ${subcommand}`);
      console.error(`${c.dim}  Usage: litt workspace [list|select|current|clear]${c.reset}`);
      return 1;
  }
}

async function listWorkspaces(): Promise<number> {
  header("LiTT Workspaces");

  const session = getAuthSession();
  const signedIn = await session.isSignedIn().catch(() => false);
  if (!signedIn) {
    fail("Not signed in.");
    console.error(`${c.dim}  Run 'litt login' to authenticate.${c.reset}`);
    return 1;
  }

  const clerkToken = await session.getAccessToken();
  if (!clerkToken) {
    fail("Could not get access token.");
    console.error(`${c.dim}  Run 'litt login --force' to re-authenticate.${c.reset}`);
    return 1;
  }

  let workspaces: RemoteWorkspace[];
  try {
    workspaces = await listRemoteWorkspaces({ clerkToken });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fail(`Failed to list workspaces: ${msg}`);
    return 1;
  }

  if (workspaces.length === 0) {
    warn("No ready workspaces found.");
    console.error(`${c.dim}  Workspaces are created when you open a project on litlabs.net.${c.reset}`);
    return 0;
  }

  const current = getSelectedRemoteWorkspace();
  ok(`Found ${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}:`);
  console.log();

  workspaces.forEach((ws, i) => {
    const isCurrent = current?.workspaceId === ws.workspaceId;
    const marker = isCurrent ? `${c.green}*${c.reset}` : " ";
    const idx = `${c.dim}${i + 1}.${c.reset}`;
    const name = ws.root.split("/").pop() ?? ws.root;
    console.log(`  ${marker} ${idx} ${value(name, c.cyan)}`);
    console.log(`      ${label("ID:")} ${value(ws.workspaceId, c.dim)}`);
    console.log(`      ${label("Branch:")} ${value(ws.branch, c.dim)}`);
    console.log(`      ${label("Root:")} ${value(ws.root, c.dim)}`);
    if (isCurrent) {
      console.log(`      ${c.green}(selected)${c.reset}`);
    }
    console.log();
  });

  if (!current) {
    console.error(`${c.dim}  Run 'litt workspace select' to choose a workspace.${c.reset}`);
  }

  return 0;
}

async function selectWorkspace(args: string[]): Promise<number> {
  header("LiTT Workspace Select");

  const session = getAuthSession();
  const signedIn = await session.isSignedIn().catch(() => false);
  if (!signedIn) {
    fail("Not signed in.");
    console.error(`${c.dim}  Run 'litt login' to authenticate.${c.reset}`);
    return 1;
  }

  const clerkToken = await session.getAccessToken();
  if (!clerkToken) {
    fail("Could not get access token.");
    console.error(`${c.dim}  Run 'litt login --force' to re-authenticate.${c.reset}`);
    return 1;
  }

  let workspaces: RemoteWorkspace[];
  try {
    workspaces = await listRemoteWorkspaces({ clerkToken });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    fail(`Failed to list workspaces: ${msg}`);
    return 1;
  }

  if (workspaces.length === 0) {
    warn("No ready workspaces found.");
    console.error(`${c.dim}  Workspaces are created when you open a project on litlabs.net.${c.reset}`);
    return 0;
  }

  // Auto-select if only one workspace
  if (workspaces.length === 1) {
    const ws = workspaces[0];
    setSelectedRemoteWorkspace({
      workspaceId: ws.workspaceId,
      projectId: ws.projectId,
      root: ws.root,
      branch: ws.branch,
    });
    const name = ws.root.split("/").pop() ?? ws.root;
    ok(`Workspace selected: ${name}`);
    console.log(`${c.dim}  Only one workspace available — selected automatically.${c.reset}`);
    return 0;
  }

  // Try to match by argument (ID or index)
  if (args.length > 0) {
    const arg = args[0];

    if (isAmbiguousNameMatch(arg, workspaces)) {
      fail(`Multiple workspaces match '${arg}'.`);
      console.error(`${c.dim}  Use a number or full workspace ID from 'litt workspace list'.${c.reset}`);
      return 1;
    }

    const match = resolveWorkspaceByArg(arg, workspaces);
    if (match) {
      return doSelect(match);
    }

    fail(`No workspace matching '${arg}'.`);
    console.error(`${c.dim}  Run 'litt workspace list' to see available workspaces.${c.reset}`);
    return 1;
  }

  // Interactive selection
  console.log("Choose a workspace:");
  console.log();
  workspaces.forEach((ws, i) => {
    const name = ws.root.split("/").pop() ?? ws.root;
    console.log(`  ${c.dim}${i + 1}.${c.reset} ${value(name, c.cyan)} ${c.dim}(${ws.branch})${c.reset}`);
  });
  console.log();

  const rl = readline.createInterface({ input, output });
  try {
    const answer = await rl.question(`Select [1-${workspaces.length}]: `);
    const choice = parseInt(answer.trim(), 10);
    if (isNaN(choice) || choice < 1 || choice > workspaces.length) {
      fail(`Invalid selection: '${answer.trim()}'.`);
      return 1;
    }
    return doSelect(workspaces[choice - 1]);
  } finally {
    rl.close();
  }
}

function doSelect(ws: RemoteWorkspace): number {
  setSelectedRemoteWorkspace({
    workspaceId: ws.workspaceId,
    projectId: ws.projectId,
    root: ws.root,
    branch: ws.branch,
  });
  const name = ws.root.split("/").pop() ?? ws.root;
  ok(`Workspace selected: ${name}`);
  console.log(`${c.dim}  Managed LiTT access ready. Run 'litt' to start chatting.${c.reset}`);
  return 0;
}

function currentWorkspace(): number {
  header("LiTT Current Workspace");

  const current = getSelectedRemoteWorkspace();
  if (!current) {
    warn("No workspace selected.");
    console.error(`${c.dim}  Run 'litt workspace select' to choose a workspace.${c.reset}`);
    return 0;
  }

  const name = current.root.split("/").pop() ?? current.root;
  ok(`Current workspace: ${name}`);
  console.log(`${label("ID:")} ${value(current.workspaceId, c.dim)}`);
  console.log(`${label("Branch:")} ${value(current.branch, c.dim)}`);
  console.log(`${label("Root:")} ${value(current.root, c.dim)}`);
  return 0;
}
