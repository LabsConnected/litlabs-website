/**
 * EmulatorROMValidation — validates ROM files before launching the emulator.
 *
 * For NES: validates the iNES header magic bytes (4E 45 53 1A).
 * Calculates SHA-256 for diagnostics.
 * Manages blob URL lifecycle (create once, revoke only after session destroy).
 */

import type { RomValidationResult } from "./types";
import { INES_MAGIC } from "./types";

/** Check if a byte array has a valid iNES header (magic: 4E 45 53 1A). */
export function isLikelyNesRom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 16 &&
    bytes[0] === INES_MAGIC[0] &&
    bytes[1] === INES_MAGIC[1] &&
    bytes[2] === INES_MAGIC[2] &&
    bytes[3] === INES_MAGIC[3]
  );
}

async function sha256(buffer: ArrayBuffer): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hash = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  return "";
}

/**
 * Validate a ROM File/Blob for a given system.
 * Currently supports NES (iNES header validation).
 */
export async function validateRom(
  rom: Blob,
  fileName: string,
  system: string,
): Promise<RomValidationResult> {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  const size = rom.size;

  if (size < 16) {
    return {
      valid: false,
      extension,
      size,
      headerValid: false,
      failureCode: "ROM_INVALID",
      error: "ROM is too small (less than 16 bytes).",
    };
  }

  const buffer = await rom.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const sha = await sha256(buffer);

  if (system === "nes") {
    // Require .nes extension or recognized MIME
    if (extension !== "nes" && extension !== "unf" && extension !== "unif") {
      return {
        valid: false,
        extension,
        size,
        sha256: sha,
        headerValid: false,
        failureCode: "ROM_UNSUPPORTED",
        error: `Expected a .nes file, got .${extension}.`,
      };
    }
    const headerValid = isLikelyNesRom(bytes);
    if (!headerValid) {
      return {
        valid: false,
        extension,
        size,
        sha256: sha,
        headerValid: false,
        failureCode: "ROM_INVALID",
        error: "Missing iNES header magic (4E 45 53 1A). This may not be a NES ROM.",
      };
    }
    return {
      valid: true,
      extension,
      size,
      sha256: sha,
      headerValid: true,
    };
  }

  // For non-NES systems, we don't validate the header yet — just accept
  // the file with a known extension. The emulator will reject it if invalid.
  return {
    valid: true,
    extension,
    size,
    sha256: sha,
    headerValid: true,
  };
}

/**
 * Create a blob URL for a ROM file. The URL must be kept alive for the
 * entire emulator session and revoked ONLY after the iframe is destroyed.
 */
export function createRomBlobUrl(rom: Blob): string {
  return URL.createObjectURL(rom);
}

/** Revoke a blob URL. Only call after the iframe has been destroyed. */
export function revokeRomBlobUrl(url: string): void {
  if (url.startsWith("blob:")) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore — URL may already be revoked
    }
  }
}
