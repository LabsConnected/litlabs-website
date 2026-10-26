/**
 * Dex screenshot — Windows System.Drawing via one-shot PowerShell.
 *
 * Structured argv only (execFile -NoProfile -NonInteractive). The output
 * path is generated here inside dexShotsDir() — never caller-supplied —
 * and cannot contain a quote on any legal Windows path. Consent is the
 * CALLER's job (dex.ts requires --yes); this module only captures.
 */

import { execFile } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { dexShotsDir } from "./dex-home.js";

export type ScreenshotResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; reason: string };

type ExecFileImpl = (
  cmd: string,
  args: string[],
  cb: (err: Error | null, stdout: string, stderr: string) => void,
) => void;

const PS_SCRIPT = (outPath: string) =>
  "Add-Type -AssemblyName System.Drawing,System.Windows.Forms; " +
  "$v=[System.Windows.Forms.SystemInformation]::VirtualScreen; " +
  "$b=New-Object System.Drawing.Bitmap($v.Width,$v.Height); " +
  "$g=[System.Drawing.Graphics]::FromImage($b); " +
  `$g.CopyFromScreen($v.Left,$v.Top,0,0,$b.Size); ` +
  `$b.Save('${outPath}',[System.Drawing.Imaging.ImageFormat]::Png); ` +
  "$g.Dispose(); $b.Dispose()";

export async function captureScreenshot(
  run: ExecFileImpl = execFile,
): Promise<ScreenshotResult> {
  if (process.platform !== "win32") {
    return {
      ok: false,
      reason: `screenshot capture uses Windows System.Drawing; this platform is ${process.platform}`,
    };
  }
  const outPath = join(
    dexShotsDir(),
    `shot-${new Date().toISOString().replace(/[:.]/g, "-")}.png`,
  );
  return new Promise((resolve) => {
    run(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", PS_SCRIPT(outPath)],
      (err) => {
        if (err) {
          resolve({ ok: false, reason: `PowerShell capture failed: ${err.message}` });
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
