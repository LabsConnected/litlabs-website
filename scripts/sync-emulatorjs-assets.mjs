// scripts/sync-emulatorjs-assets.mjs
//
// Deterministic asset synchronization for the self-hosted EmulatorJS 4.2.3
// runtime. Downloads the pinned runtime, compression, and supported-core
// assets from the official EmulatorJS CDN into public/emulatorjs/4.2.3/data/.
//
// Guarantees:
//   * Pinned base URL — never combines versions.
//   * Atomic writes (temp file + rename).
//   * Rejects redirects to unexpected hosts, HTTP errors, HTML responses,
//     zero-byte files, and suspiciously small files.
//   * For every *-wasm.data / *-legacy-wasm.data core package:
//       - Requires at least 800,000 bytes.
//       - Verifies the 7z archive signature (37 7A BC AF 27 1C).
//   * Prints downloaded file sizes and SHA-256 hashes.
//   * Exits nonzero on any failure.
//
// Run:  node scripts/sync-emulatorjs-assets.mjs
// or:   pnpm sync:emulatorjs

import { createHash } from "node:crypto";
import { createWriteStream, renameSync, existsSync, mkdirSync, statSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, "..");

const PINNED_BASE_URL = "https://cdn.emulatorjs.org/4.2.3/data/";
const EXPECTED_HOST = "cdn.emulatorjs.org";
const LOCAL_DATA_DIR = join(REPO_ROOT, "public", "emulatorjs", "4.2.3", "data");

// 7z archive signature: 37 7A BC AF 27 1C
const SEVEN_Z_SIGNATURE = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];

const CORE_MIN_BYTES = 800_000;
const RUNTIME_MIN_BYTES = {
  "loader.js": 1_000,
  "emulator.min.js": 100_000,
  "emulator.min.css": 1_000,
  "emulator.css": 1_000,
  "version.json": 10,
  "compression/extract7z.js": 50_000,
  "compression/extractzip.js": 50_000,
  "compression/libunrar.js": 10_000,
  "compression/libunrar.wasm": 50_000,
};

// Runtime + compression files (pinned to 4.2.3 — never mix versions).
const RUNTIME_FILES = [
  "loader.js",
  "emulator.min.js",
  "emulator.min.css",
  "emulator.css",
  "version.json",
  "compression/extract7z.js",
  "compression/extractzip.js",
  "compression/libunrar.js",
  "compression/libunrar.wasm",
];

// Supported cores — matches src/lib/retro-arcade.ts system mapping.
// EJS_threads = false, so threaded variants are NOT required.
const SUPPORTED_CORES = [
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
  // Reject HTML error documents served with HTTP 200.
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
  const text = buffer.toString("utf8");
  return text.startsWith("version https://git-lfs.github.com/spec/");
}

async function fetchAsset(relativePath, minBytes, requireArchiveSignature) {
  const url = new URL(relativePath, PINNED_BASE_URL).href;
  console.log(`\n→ ${relativePath}`);
  console.log(`  URL: ${url}`);

  const res = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "litlabs-emulatorjs-sync/1.0" },
  });

  // Reject redirects to unexpected hosts (fetch already followed them, so
  // inspect res.url — if it differs in host, abort).
  const finalUrl = new URL(res.url);
  if (finalUrl.host !== EXPECTED_HOST) {
    throw new Error(`Redirected to unexpected host: ${finalUrl.host} (expected ${EXPECTED_HOST})`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}`);
  }

  const contentType = res.headers.get("content-type") ?? "";
  const contentLengthHeader = res.headers.get("content-length");
  console.log(`  Content-Type: ${contentType || "(none)"}`);
  if (contentLengthHeader) console.log(`  Content-Length: ${contentLengthHeader}`);

  const buffer = Buffer.from(await res.arrayBuffer());

  if (buffer.length === 0) {
    throw new Error("Zero-byte response");
  }

  if (looksLikeHtml(buffer)) {
    throw new Error(`Server returned HTML (content-type: ${contentType})`);
  }

  if (looksLikeGitLfsPointer(buffer)) {
    throw new Error("File contains a Git LFS pointer — binary asset was not actually downloaded");
  }

  if (buffer.length < minBytes) {
    throw new Error(`File too small: ${buffer.length} bytes (minimum ${minBytes})`);
  }

  if (requireArchiveSignature) {
    if (!hasSevenZSignature(buffer)) {
      const hex = Array.from(buffer.subarray(0, 8))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" ");
      throw new Error(
        `Missing 7z archive signature. First bytes: ${hex} (expected 37 7a bc af 27 1c)`,
      );
    }
  }

  const hash = sha256(buffer);
  console.log(`  Bytes: ${buffer.length}`);
  console.log(`  SHA-256: ${hash}`);
  if (requireArchiveSignature) console.log(`  7z signature: OK`);

  return buffer;
}

function atomicWrite(targetPath, buffer) {
  const dir = dirname(targetPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
  // Write synchronously via stream then rename for atomicity.
  return new Promise((resolveWrite, rejectWrite) => {
    const stream = createWriteStream(tmpPath);
    stream.on("error", rejectWrite);
    stream.on("finish", () => {
      try {
        // Verify the temp file landed at the expected size before renaming.
        const stat = statSync(tmpPath);
        if (stat.size !== buffer.length) {
          unlinkSync(tmpPath);
          rejectWrite(new Error(`Temp file size mismatch: ${stat.size} != ${buffer.length}`));
          return;
        }
        renameSync(tmpPath, targetPath);
        resolveWrite();
      } catch (err) {
        try { unlinkSync(tmpPath); } catch { /* ignore */ }
        rejectWrite(err);
      }
    });
    stream.end(buffer);
  });
}

async function main() {
  console.log("EmulatorJS 4.2.3 asset synchronization");
  console.log("======================================");
  console.log(`Pinned CDN: ${PINNED_BASE_URL}`);
  console.log(`Local dir:  ${LOCAL_DATA_DIR}`);

  if (!existsSync(LOCAL_DATA_DIR)) {
    mkdirSync(LOCAL_DATA_DIR, { recursive: true });
  }

  const manifest = [];
  let failures = 0;

  // Runtime + compression files
  for (const relPath of RUNTIME_FILES) {
    try {
      const minBytes = RUNTIME_MIN_BYTES[relPath] ?? 1_000;
      const buffer = await fetchAsset(relPath, minBytes, false);
      const targetPath = join(LOCAL_DATA_DIR, relPath);
      await atomicWrite(targetPath, buffer);
      manifest.push({ path: relPath, bytes: buffer.length, sha256: sha256(buffer) });
    } catch (err) {
      failures += 1;
      console.error(`  ✖ ${relPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  // Core packages — require 7z signature
  for (const core of SUPPORTED_CORES) {
    const relPath = `cores/${core}-wasm.data`;
    try {
      const buffer = await fetchAsset(relPath, CORE_MIN_BYTES, true);
      const targetPath = join(LOCAL_DATA_DIR, relPath);
      await atomicWrite(targetPath, buffer);
      manifest.push({ path: relPath, bytes: buffer.length, sha256: sha256(buffer) });
    } catch (err) {
      failures += 1;
      console.error(`  ✖ ${relPath}: ${err instanceof Error ? err.message : err}`);
    }
  }

  console.log("\n======================================");
  console.log("Sync summary");
  console.log("======================================");
  for (const entry of manifest) {
    console.log(`  ✓ ${entry.path.padEnd(48)} ${String(entry.bytes).padStart(10)} bytes  ${entry.sha256.slice(0, 16)}…`);
  }

  if (failures > 0) {
    console.error(`\n✖ ${failures} asset(s) failed to sync. Aborting.`);
    process.exit(1);
  }

  console.log(`\n✓ Synced ${manifest.length} asset(s) successfully.`);
  console.log("Do NOT require the CDN during ordinary gameplay — assets are now self-hosted.");
}

main().catch((err) => {
  console.error("Fatal sync error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
