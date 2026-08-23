/**
 * Browser launcher — opens the system browser to the Clerk OAuth URL.
 *
 * Desktop:
 *   - macOS:   `open <url>`
 *   - Windows: `cmd /c start "" "<url>"` (via exec, not spawn)
 *   - Linux:   `xdg-open <url>`
 *
 * Termux/Android:
 *   - `termux-open-url <url>` (if Termux:API is installed)
 *
 * If opening the browser fails, the URL is printed so the user can
 * tap/copy it manually. The Android browser redirect to 127.0.0.1:{port}
 * returns to the one-shot HTTP listener running inside Termux.
 *
 * ─── Why the OS calls are injected ────────────────────────────────
 * Every process-launching call in this module is reached through the
 * `BrowserLaunchDeps` parameter rather than the imported binding.
 *
 * This is not abstraction for its own sake. Previously the unit tests
 * imported this module and called the real openBrowser() with a sample
 * URL. On Windows that ran `start "" "https://example.com/auth"` through
 * cmd.exe, which faithfully opened the developer's actual default
 * browser — a real window, on every test run. Tests must be able to
 * assert WHICH command would be issued without issuing it.
 *
 * A second, independent guard (`isAutomatedTestRun`) refuses real
 * launches under a test runner even when nothing was injected, so a
 * future test that forgets to pass fakes still cannot hijack the
 * developer's screen. Defence in depth: injection is the mechanism,
 * the runner check is the backstop.
 */

import { spawn, exec, execSync } from "node:child_process";

/**
 * The OS-facing side effects this module performs. Injecting these is
 * what makes the launcher testable without launching anything.
 */
export interface BrowserLaunchDeps {
  exec: typeof exec;
  spawn: typeof spawn;
  execSync: typeof execSync;
  /** Where the manual-URL fallback is printed. */
  log: (message: string) => void;
}

/** The real, process-launching implementations. */
export const REAL_BROWSER_DEPS: BrowserLaunchDeps = {
  exec,
  spawn,
  execSync,
  log: (message: string) => console.log(message),
};

/**
 * Check if the provided deps object uses real Node.js child_process implementations.
 */
export function isRealLauncher(deps: BrowserLaunchDeps): boolean {
  return (
    deps === REAL_BROWSER_DEPS ||
    deps.exec === exec ||
    deps.spawn === spawn ||
    deps.execSync === execSync
  );
}

/**
 * Checks if a URL targets an RFC 2606 / RFC 6761 reserved domain or test domain
 * (e.g. example.com, example.org, example.net, *.test, *.example, *.invalid, test.com).
 * Real browsers must never be launched for documentation or test URLs.
 */
export function isExampleOrTestUrl(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    if (
      host === "example.com" ||
      host.endsWith(".example.com") ||
      host === "example.org" ||
      host.endsWith(".example.org") ||
      host === "example.net" ||
      host.endsWith(".example.net") ||
      host === "test.com" ||
      host.endsWith(".test.com") ||
      host.endsWith(".test") ||
      host.endsWith(".example") ||
      host.endsWith(".invalid")
    ) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * True when running under an automated test runner or headless test environment.
 *
 * Used as a backstop so a real browser can never be launched from a test
 * process. `LITT_NO_BROWSER=1` lets CI and headless environments opt into
 * the same behaviour explicitly.
 */
export function isAutomatedTestRun(): boolean {
  if (
    process.env.VITEST !== undefined ||
    process.env.NODE_ENV === "test" ||
    process.env.LITT_NO_BROWSER !== undefined ||
    process.env.JEST_WORKER_ID !== undefined ||
    process.env.PLAYWRIGHT !== undefined ||
    process.env.PW_TEST !== undefined ||
    process.env.NODE_TEST_CONTEXT !== undefined ||
    process.env.CI !== undefined ||
    process.env.CONTINUOUS_INTEGRATION !== undefined
  ) {
    return true;
  }

  if (
    Array.isArray(process.argv) &&
    process.argv.some((arg) => {
      const lower = String(arg).toLowerCase();
      return (
        lower.includes("vitest") ||
        lower.includes("jest") ||
        lower.includes("playwright") ||
        lower.endsWith(".test.ts") ||
        lower.endsWith(".test.js") ||
        lower.endsWith(".spec.ts") ||
        lower.endsWith(".spec.js")
      );
    })
  ) {
    return true;
  }

  return false;
}

/** Check if we're running inside Termux on Android. */
export function isTermux(): boolean {
  return !!process.env.TERMUX_VERSION || (process.env.PREFIX?.includes("/com.termux/") ?? false);
}

/** Check if a command exists in PATH (synchronous, best-effort). */
export function hasCommand(cmd: string, deps: BrowserLaunchDeps = REAL_BROWSER_DEPS): boolean {
  if (isRealLauncher(deps) && isAutomatedTestRun()) {
    return false;
  }
  try {
    deps.execSync(`${cmd} --version`, { stdio: "ignore", timeout: 3000 });
    return true;
  } catch {
    try {
      deps.execSync(`which ${cmd}`, { stdio: "ignore", timeout: 3000 });
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Build the Windows command string for opening a URL via `start`.
 *
 * `start` is a cmd.exe builtin — it cannot be called via spawn() without
 * going through cmd.exe. Using spawn() with args causes Node.js to apply
 * its own argument escaping, which mangles the literal double-quotes we
 * need around the URL, producing paths like `"https://..."` (with quotes
 * as literal characters) and triggering "Windows cannot find" dialogs.
 *
 * Using exec() passes the command string directly to cmd.exe's parser,
 * so `start "" "https://..."` is interpreted correctly:
 *   - `""` is the window title (start's first quoted arg is the title)
 *   - `"https://..."` is the URL, quoted to protect `&` from cmd.exe's
 *     command separator
 *
 * The URL is generated by our own OAuth code (not user input), but we
 * strip any literal double-quotes as defense in depth.
 *
 * Pure string construction — safe to call in tests.
 */
export function buildWindowsStartCommand(url: string): string {
  const safeUrl = url.replace(/"/g, "");
  return `start "" "${safeUrl}"`;
}

/** The launcher a given platform/environment would use. Pure. */
export type LauncherKind = "termux" | "windows" | "macos" | "linux";

/**
 * Decide which launcher applies, without invoking anything.
 *
 * Exposed so platform-selection tests assert the decision directly
 * instead of calling openBrowser() and inferring it from side effects.
 */
export function selectLauncher(platform: string = process.platform): LauncherKind {
  if (isTermux()) return "termux";
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  return "linux";
}

/** The exact command + args a launcher would invoke for a URL. Pure. */
export function describeLaunch(
  url: string,
  platform: string = process.platform,
): { kind: LauncherKind; command: string; args: string[]; usesShell: boolean } {
  const kind = selectLauncher(platform);
  switch (kind) {
    case "termux":
      return { kind, command: "termux-open-url", args: [url], usesShell: false };
    case "windows":
      // exec() — a single cmd.exe string, not an argv vector.
      return { kind, command: buildWindowsStartCommand(url), args: [], usesShell: true };
    case "macos":
      return { kind, command: "open", args: [url], usesShell: false };
    case "linux":
      return { kind, command: "xdg-open", args: [url], usesShell: false };
  }
}

/** Print the manual fallback when automatic opening is unavailable. */
function printManualUrl(url: string, deps: BrowserLaunchDeps): void {
  deps.log(`\n  Could not open browser automatically.`);
  deps.log(`  Open this URL to sign in:\n  ${url}\n`);
}

/**
 * Open a URL in the system browser.
 *
 * On failure, prints the URL so the user can open it manually.
 * Never throws — browser-open failure is non-fatal (manual URL fallback).
 *
 * @param deps Injected OS calls. Defaults to the real ones; tests pass
 *             fakes so no process is ever created.
 */
export async function openBrowser(
  url: string,
  deps: BrowserLaunchDeps = REAL_BROWSER_DEPS,
): Promise<void> {
  // ─── Backstop: never launch a real browser from a test process or for test/example URLs ───
  // Only applies when the REAL deps are in play; an injected fake is
  // always allowed through so tests can still exercise the full path.
  const isReal = isRealLauncher(deps);
  if (isReal && (isAutomatedTestRun() || isExampleOrTestUrl(url))) {
    printManualUrl(url, deps);
    return;
  }

  const platform = process.platform;

  // ─── Termux/Android ────────────────────────────────────────────
  if (isTermux()) {
    if (hasCommand("termux-open-url", deps)) {
      try {
        const child = deps.spawn("termux-open-url", [url], { detached: true, stdio: "ignore" });
        child.unref();
        return;
      } catch {
        // Fall through to manual URL
      }
    }
    // termux-open-url not available — print URL for manual open
    printManualUrl(url, deps);
    return;
  }

  // ─── Windows ───────────────────────────────────────────────────
  // `start` is a cmd.exe builtin, so we must go through cmd.exe's command
  // parser. Using spawn() with args causes Node.js to re-escape the literal
  // double-quotes, mangling the URL. exec() passes the string directly to
  // cmd.exe, preserving the correct quoting.
  if (platform === "win32") {
    try {
      await new Promise<void>((resolve, reject) => {
        deps.exec(buildWindowsStartCommand(url), {
          windowsHide: true,
          timeout: 5000,
        }, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      return;
    } catch {
      printManualUrl(url, deps);
      return;
    }
  }

  // ─── macOS / Linux desktop ─────────────────────────────────────
  const command = platform === "darwin" ? "open" : "xdg-open";

  try {
    await new Promise<void>((resolve, reject) => {
      const child = deps.spawn(command, [url], { detached: true, stdio: "ignore" });
      child.once("error", (err) => reject(err));
      child.unref();
      // Give the spawn a moment to succeed, then resolve
      setTimeout(resolve, 500);
    });
  } catch {
    // Browser open failed — print URL for manual open
    printManualUrl(url, deps);
  }
}
