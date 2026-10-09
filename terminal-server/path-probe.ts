/**
 * Locate an executable on PATH using only filesystem metadata. Never starts
 * a process, so it is safe for unauthenticated health endpoints.
 */
import { existsSync, statSync } from "fs";
import { delimiter, join } from "path";

export function findOnPath(
  bin: string,
  pathVar: string | undefined = process.env.PATH,
  platform: NodeJS.Platform = process.platform,
): string | null {
  if (!pathVar || /[\\/]/.test(bin)) return null;
  const exts = platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];
  for (const dir of pathVar.split(delimiter)) {
    if (!dir) continue;
    for (const ext of exts) {
      const candidate = join(dir, bin + ext);
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
      } catch {
        /* unreadable entry — keep scanning */
      }
    }
  }
  return null;
}
