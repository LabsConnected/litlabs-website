/**
 * Atomic file replacement for workspace files.
 *
 * `writeFileSync(target, content)` truncates the destination and then
 * streams the new bytes into it. If the process dies, the disk fills, or
 * the write otherwise fails partway, the destination is left truncated or
 * half-written — the user's file is destroyed by a write that never
 * completed, and nothing upstream can tell that it happened.
 *
 * Writing to a temporary file in the SAME directory and renaming it into
 * place makes replacement atomic: rename(2) within a filesystem either
 * happens or it does not, so a reader sees the old content or the new
 * content and never a partial mix. The temporary file must share the
 * destination's directory — renaming across filesystems is a copy, which
 * is not atomic.
 *
 * The temp file is fsync'd before the rename so the bytes are on disk
 * rather than only in the page cache when the directory entry flips.
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
  chmodSync,
} from "fs";
import { dirname, basename, join } from "path";
import { randomBytes } from "crypto";

/**
 * Replace `target` with `content` atomically.
 *
 * Creates parent directories as needed. On any failure the destination is
 * left exactly as it was and the temporary file is removed.
 */
export function writeFileAtomic(target: string, content: string): void {
  const dir = dirname(target);
  mkdirSync(dir, { recursive: true });

  // Same directory → same filesystem → rename is atomic. The name is
  // unique per process and call so concurrent writers cannot collide.
  const tmp = join(
    dir,
    `.${basename(target)}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`,
  );

  let fd: number | undefined;
  try {
    // "wx" fails if the temp name somehow exists rather than clobbering it.
    fd = openSync(tmp, "wx");
    const buffer = Buffer.from(content, "utf-8");
    writeSync(fd, buffer, 0, buffer.length, 0);
    // Flush to disk before the rename makes the new content reachable.
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;

    // Carry the destination's permissions onto the replacement so an
    // executable or restricted file keeps its mode.
    if (existsSync(target)) {
      try {
        chmodSync(tmp, statSync(target).mode);
      } catch {
        // Permission carry-over is best effort — a filesystem that does
        // not support it must not fail the write.
      }
    }

    renameSync(tmp, target);
  } catch (err) {
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // Already closed or invalid — nothing further to do.
      }
    }
    try {
      if (existsSync(tmp)) unlinkSync(tmp);
    } catch {
      // Leaving a stray temp file is preferable to masking the real error.
    }
    throw err;
  }
}
