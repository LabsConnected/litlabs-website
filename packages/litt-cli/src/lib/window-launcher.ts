/**
 * WindowLauncher — `litt shell --window`: open LiTT in a dedicated
 * terminal window.
 *
 * Primary path: a new Windows Terminal window/tab titled "⚡ LiTT"
 * (118×36, PowerShell, no banner, starts directly in the shell).
 * Fallback: a plain PowerShell window.
 *
 * Spawns detached + unref'd — the parent `litt` process exits
 * immediately and the new window lives on its own.
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

function findWindowsTerminal(): string {
  // Already inside WT — "wt" resolves on PATH.
  if (process.env.WT_SESSION) return "wt";
  const candidates = [
    join(process.env.LOCALAPPDATA ?? "", "Microsoft", "WindowsApps", "wt.exe"),
    join(process.env.PROGRAMFILES ?? "", "WindowsApps", "wt.exe"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return "wt";
}

/**
 * Launch the dedicated LiTT shell window. Returns true when a window
 * process was spawned (best effort — spawn success ≠ window visible).
 */
export function launchShellWindow(cwd: string): boolean {
  const wt = findWindowsTerminal();
  const inner = "litt shell";
  const spawnOpts = { cwd, detached: true, stdio: "ignore" as const, shell: false };

  // Windows Terminal: new window, new tab, LiTT title + size, PowerShell
  // with -NoExit so the shell survives `litt` exits (e.g. Ctrl+C twice).
  try {
    const child = spawn(
      wt,
      [
        "-w", "new", "nt",
        "--title", "⚡ LiTT",
        "--windowSize", "118,36",
        "powershell", "-NoLogo", "-NoExit", "-Command", inner,
      ],
      spawnOpts,
    );
    child.unref();
    return true;
  } catch {
    // Fallback: plain PowerShell window.
    try {
      const child = spawn("powershell", ["-NoLogo", "-NoExit", "-Command", inner], spawnOpts);
      child.unref();
      return true;
    } catch {
      return false;
    }
  }
}
