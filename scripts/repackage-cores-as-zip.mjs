/**
 * Repackage EmulatorJS core .data files from 7z to zip format.
 *
 * The 7z decompression worker in EmulatorJS 4.2.3 has a known bug where it
 * reaches 99% but never sends the "done" message, leaving the emulator
 * permanently stalled. The zip extractor (extractzip.js) does not have
 * this issue.
 *
 * EmulatorJS auto-detects the archive format by signature:
 *   - 7z: bytes [55, 122, 188, 175, 39, 28]
 *   - zip: bytes [80, 75, 3, 4]  (PK\x03\x04)
 *
 * So replacing the .data files with zip archives "just works" — no code
 * changes needed in EmulatorJS.
 *
 * Usage: node scripts/repackage-cores-as-zip.mjs
 * Requires: 7-Zip at C:\Program Files\7-Zip\7z.exe (or in PATH)
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, "..");
const CORES_DIR = join(ROOT, "public", "emulatorjs", "4.2.3", "data", "cores");
const SEVEN_ZIP = "C:\\Program Files\\7-Zip\\7z.exe";

// PK\x03\x04
const ZIP_SIG = [0x50, 0x4b, 0x03, 0x04];
// 7z\xBC\xAF\x27\x1C
const SEVEN_Z_SIG = [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c];

function detectFormat(buf) {
  if (buf.length >= 6 && SEVEN_Z_SIG.every((b, i) => buf[i] === b)) return "7z";
  if (buf.length >= 4 && ZIP_SIG.every((b, i) => buf[i] === b)) return "zip";
  return "unknown";
}

function run(cmd, args, cwd) {
  execFileSync(cmd, args, { cwd, stdio: "pipe", windowsHide: true });
}

function repackageCore(filePath) {
  const buf = readFileSync(filePath);
  const format = detectFormat(buf);
  if (format === "zip") {
    console.log(`  ✓ already zip — skipping`);
    return { skipped: true };
  }
  if (format !== "7z") {
    console.log(`  ✖ unknown format (first bytes: ${Array.from(buf.slice(0, 8)).map((b) => b.toString(16).padStart(2, "0")).join(" ")}) — skipping`);
    return { skipped: true };
  }

  const tmpDir = join(dirname(filePath), `__tmp_extract_${Date.now()}`);
  mkdirSync(tmpDir, { recursive: true });

  try {
    // Extract 7z archive
    run(SEVEN_ZIP, ["x", "-y", "-o" + tmpDir, filePath]);

    // List extracted files
    const extracted = readdirSync(tmpDir).filter(
      (f) => !f.startsWith("__"),
    );

    if (extracted.length === 0) {
      throw new Error("7z extraction produced no files");
    }

    // Create zip archive containing all extracted files
    // Use 7-Zip to create the zip (it can create zip archives too)
    const zipTmp = filePath + ".zip.tmp";
    const zipArgs = ["a", "-tzip", "-mx=9", zipTmp, ...extracted.map((f) => join(tmpDir, f))];
    run(SEVEN_ZIP, zipArgs);

    // Verify the zip was created and has the correct signature
    const zipBuf = readFileSync(zipTmp);
    const zipFormat = detectFormat(zipBuf);
    if (zipFormat !== "zip") {
      throw new Error(`Created zip has wrong format: ${zipFormat}`);
    }

    // Replace the original .data file with the zip
    writeFileSync(filePath, zipBuf);

    // Clean up
    rmSync(zipTmp, { force: true });

    console.log(
      `  ✓ repackaged 7z → zip (${buf.length.toLocaleString()} → ${zipBuf.length.toLocaleString()} bytes, ${extracted.length} files)`,
    );
    return { repackaged: true, fileCount: extracted.length, oldSize: buf.length, newSize: zipBuf.length };
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

function main() {
  console.log("EmulatorJS core repackager: 7z → zip");
  console.log(`Cores dir: ${CORES_DIR}`);
  console.log(`7-Zip: ${SEVEN_ZIP}`);
  console.log("");

  if (!existsSync(SEVEN_ZIP)) {
    console.error(`✖ 7-Zip not found at ${SEVEN_ZIP}`);
    process.exit(1);
  }

  if (!existsSync(CORES_DIR)) {
    console.error(`✖ Cores directory not found: ${CORES_DIR}`);
    process.exit(1);
  }

  const dataFiles = readdirSync(CORES_DIR).filter((f) => f.endsWith(".data"));
  console.log(`Found ${dataFiles.length} .data files\n`);

  let repackaged = 0;
  let skipped = 0;
  let failed = 0;

  for (const file of dataFiles) {
    const filePath = join(CORES_DIR, file);
    const stat = statSync(filePath);
    console.log(`${file} (${stat.size.toLocaleString()} bytes)`);
    try {
      const result = repackageCore(filePath);
      if (result.repackaged) repackaged++;
      else skipped++;
    } catch (err) {
      console.error(`  ✖ FAILED: ${err.message}`);
      failed++;
    }
  }

  console.log("");
  console.log(`Done: ${repackaged} repackaged, ${skipped} skipped, ${failed} failed`);

  if (failed > 0) {
    process.exit(1);
  }
}

main();
