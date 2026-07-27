// scripts/verify-emulatorjs-assets.mjs
//
// Verifies that the self-hosted EmulatorJS 4.2.3 assets are present and valid
// before a production build. Wired into the `prebuild` npm script so a broken
// deployment can never ship.
//
// Checks for every required asset:
//   * File exists.
//   * File size is above its minimum.
//   * Core archive signature is valid (7z: 37 7A BC AF 27 1C).
//   * No file contains Git LFS pointer text.
//   * No file contains an HTML error document.
//   * Runtime version.json reports 4.2.3.
//
// Run:  node scripts/verify-emulatorjs-assets.mjs
// or:   pnpm verify:emulatorjs

import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");
const DATA_DIR = join(REPO_ROOT, "public", "emulatorjs", "4.2.3", "data");
const EXPECTED_VERSION = "4.2.3";

const SEVEN_Z_SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];
const CORE_MIN_BYTES = 800_000;

// Runtime + compression files with per-file minimums.
const RUNTIME_FILES = [
  { rel: "loader.js", min: 1_000 },
  { rel: "emulator.min.js", min: 100_000 },
  { rel: "compression/extract7z.js", min: 50_000 },
  { rel: "compression/extractzip.js", min: 50_000 },
  { rel: "version.json", min: 10 },
];

// Required core packages — every core mapped from src/lib/retro-arcade.ts
// plus both NES alternatives (fceumm + nestopia).
const REQUIRED_CORES = [
  "fceumm",
  "fceumm-legacy",
  "nestopia",
  "nestopia-legacy",
  "snes9x",
  "snes9x-legacy",
  "gambatte",
  "gambatte-legacy",
  "mgba",
  "mgba-legacy",
  "genesis_plus_gx",
  "genesis_plus_gx-legacy",
];

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function hasSevenZSignature(buffer) {
  if (buffer.length < SEVEN_Z_SIGNATURE.length) return false;
  for (let i = 0; i < SEVEN_Z_SIGNATURE.length; i++) {
    if (buffer[i] !== SEVEN_Z_SIGNATURE[i]) return false;
  }
  return true;
}

function looksLikeHtml(buffer) {
  if (buffer.length > 1024 * 1024) return false; // large binaries aren't HTML
  const head = buffer.subarray(0, Math.min(buffer.length, 512)).toString("utf8").toLowerCase();
  return (
    head.includes("<!doctype html") ||
    head.includes("<html") ||
    head.includes("<head") ||
    head.includes("<title>")
  );
}

function looksLikeGitLfsPointer(buffer) {
  if (buffer.length > 1024) return false;
  return buffer.toString("utf8").startsWith("version https://git-lfs.github.com/spec/");
}

function fail(rel, reason) {
  console.error(`  ✖ ${rel}: ${reason}`);
  return false;
}

function pass(rel, bytes, hash) {
  console.log(`  ✓ ${rel.padEnd(48)} ${String(bytes).padStart(10)} bytes  ${hash.slice(0, 16)}…`);
  return true;
}

function verifyFile(rel, minBytes, requireArchiveSignature) {
  const fullPath = join(DATA_DIR, rel);
  if (!existsSync(fullPath)) return fail(rel, "File does not exist");
  let stat;
  try {
    stat = statSync(fullPath);
  } catch (err) {
    return fail(rel, `stat failed: ${err instanceof Error ? err.message : err}`);
  }
  if (!stat.isFile()) return fail(rel, "Not a regular file");
  if (stat.size < minBytes) {
    return fail(rel, `File too small: ${stat.size} bytes (minimum ${minBytes})`);
  }
  let buffer;
  try {
    buffer = readFileSync(fullPath);
  } catch (err) {
    return fail(rel, `read failed: ${err instanceof Error ? err.message : err}`);
  }
  if (looksLikeHtml(buffer)) return fail(rel, "File contains an HTML error document");
  if (looksLikeGitLfsPointer(buffer)) return fail(rel, "File contains a Git LFS pointer");
  if (requireArchiveSignature && !hasSevenZSignature(buffer)) {
    const hex = Array.from(buffer.subarray(0, 8))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ");
    return fail(rel, `Missing 7z archive signature. First bytes: ${hex}`);
  }
  return pass(rel, buffer.length, sha256(buffer));
}

function verifyVersion() {
  const fullPath = join(DATA_DIR, "version.json");
  if (!existsSync(fullPath)) return fail("version.json", "File does not exist");
  try {
    const parsed = JSON.parse(readFileSync(fullPath, "utf8"));
    // EmulatorJS version.json shape: { "version": "4.2.3", ... }
    const version = parsed?.version ?? parsed?.emulatorjs ?? parsed?.data;
    if (version !== EXPECTED_VERSION) {
      return fail("version.json", `Reports version "${version}" (expected "${EXPECTED_VERSION}")`);
    }
    console.log(`  ✓ version.json reports ${EXPECTED_VERSION}`);
    return true;
  } catch (err) {
    return fail("version.json", `Could not parse: ${err instanceof Error ? err.message : err}`);
  }
}

function main() {
  console.log("EmulatorJS 4.2.3 asset verification");
  console.log("====================================");
  console.log(`Local dir: ${DATA_DIR}`);
  console.log("");

  let ok = true;

  console.log("Runtime + compression files:");
  for (const { rel, min } of RUNTIME_FILES) {
    if (!verifyFile(rel, min, false)) ok = false;
  }
  if (!verifyVersion()) ok = false;

  console.log("");
  console.log("Core packages (require 7z signature + >= 800,000 bytes):");
  for (const core of REQUIRED_CORES) {
    const rel = `cores/${core}-wasm.data`;
    if (!verifyFile(rel, CORE_MIN_BYTES, true)) ok = false;
  }

  console.log("");
  console.log("====================================");
  if (ok) {
    console.log("✓ All EmulatorJS assets verified.");
    process.exit(0);
  } else {
    console.error("✖ EmulatorJS asset verification FAILED. Run `pnpm sync:emulatorjs` to fix.");
    process.exit(1);
  }
}

main();
