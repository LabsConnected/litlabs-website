/**
 * Dex screenshot — Windows System.Drawing via one-shot PowerShell.
 *
 * Structured argv only (execFile -NoProfile -NonInteractive). The output
 * path is passed as a SEPARATE argv element bound by param($outPath) —
 * it never enters the script text, so apostrophes/spaces in the path
 * cannot break or inject into the command. Consent is the CALLER's job
 * (dex.ts requires --yes); this module only captures.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { dexShotsDir } from "./dex-home.js";

export type ScreenshotResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; reason: string };

type ExecCallback = (
  err: (Error & { killed?: boolean; code?: string | number }) | null,
  stdout: string,
  stderr: string,
) => void;

type ExecFileImpl = (
  cmd: string,
  args: string[],
  options: { timeout: number },
  cb: ExecCallback,
) => void;

export interface ScreenshotOptions {
  run?: ExecFileImpl;
  /** Injectable platform — tests exercise the Windows path anywhere. */
  platform?: NodeJS.Platform;
  /** Hard cap on the PowerShell child. Default 15s. */
  timeoutMs?: number;
}

// The path is bound via param($outPath) — NOTHING path-derived is
// interpolated into this string.
const PS_SCRIPT =
  "param($outPath) " +
  "Add-Type -AssemblyName System.Drawing,System.Windows.Forms; " +
  "$v=[System.Windows.Forms.SystemInformation]::VirtualScreen; " +
  "$b=New-Object System.Drawing.Bitmap($v.Width,$v.Height); " +
  "$g=[System.Drawing.Graphics]::FromImage($b); " +
  "$g.CopyFromScreen($v.Left,$v.Top,0,0,$b.Size); " +
  "$b.Save($outPath,[System.Drawing.Imaging.ImageFormat]::Png); " +
  "$g.Dispose(); $b.Dispose()";

export async function captureScreenshot(opts: ScreenshotOptions = {}): Promise<ScreenshotResult> {
  const { run = execFile as ExecFileImpl, platform = process.platform, timeoutMs = 15_000 } = opts;
  if (platform !== "win32") {
    return {
      ok: false,
      reason: `screenshot capture uses Windows System.Drawing; this platform is ${platform}`,
    };
  }
  const outPath = join(
    dexShotsDir(),
    `shot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
  );
  return new Promise((resolve) => {
    run(
      "powershell.exe",
      // Path is a standalone argv element → PowerShell param binding.
      // execFile passes it verbatim; no quoting or escaping can break.
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS_SCRIPT, outPath],
      { timeout: timeoutMs },
      (err) => {
        if (err) {
          const timedOut = err.killed === true || err.code === "ETIMEDOUT";
          resolve({
            ok: false,
            reason: timedOut
              ? `capture timed out after ${timeoutMs}ms and was terminated`
              : `PowerShell capture failed: ${err.message}`,
          });
          return;
        }
        if (!existsSync(outPath) || statSync(outPath).size === 0) {
          resolve({ ok: false, reason: "capture produced no output file" });
          return;
        }
        resolve({ ok: true, path: outPath, bytes: statSync(outPath).size });
      },
    );
  });
}
