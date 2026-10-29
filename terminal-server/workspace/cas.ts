import { existsSync, statSync, readFileSync } from "fs";
import { createHash } from "crypto";

/**
 * Compare-and-swap precondition for workspace file writes.
 *
 * `expectedSha256` is the sha256 (hex) of the file's utf-8 content the caller
 * last confirmed, or the sentinel "absent" meaning "the file must not exist".
 * Runs synchronously inside the /ws-files/write handler, so no other request
 * can interleave between this check and the writeFileSync that follows it.
 *
 * Hash basis: utf-8 bytes of the file's content string — the same basis the
 * Next.js layer and the browser compute (canvas-ssot.sha256Hex), so the three
 * layers agree.
 */
export function sha256Utf8(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

export interface CasVerdict {
  ok: boolean;
  /** sha256 of the current file when the check failed (null = file absent). */
  currentSha256: string | null;
  reason?: string;
}

export function checkExpectedSha256(targetPath: string, expectedSha256: string): CasVerdict {
  const exists = existsSync(targetPath) && statSync(targetPath).isFile();
  if (expectedSha256 === "absent") {
    return exists
      ? { ok: false, currentSha256: sha256Utf8(readFileSync(targetPath).toString("utf-8")), reason: "file already exists" }
      : { ok: true, currentSha256: null };
  }
  if (!exists) {
    return { ok: false, currentSha256: null, reason: "file does not exist" };
  }
  const currentSha256 = sha256Utf8(readFileSync(targetPath).toString("utf-8"));
  return currentSha256 === expectedSha256
    ? { ok: true, currentSha256 }
    : { ok: false, currentSha256, reason: "file changed since the caller's revision" };
}
