// Repackage EmulatorJS core .data archives as STORE (method 0) zip files.
// Avoids the Emscripten extractzip.js deflate decompression worker bug that
// stalls at 99% indefinitely.
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const coresDir = path.join(
  "public",
  "emulatorjs",
  "4.2.3",
  "data",
  "cores",
);
const tmpBase = path.join(require("os").tmpdir(), "ejs-core-repack");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function buildStoreZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const f of files) {
    const data = f.data;
    const nameBuf = Buffer.from(f.name, "utf8");
    const crcVal = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // STORE
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crcVal, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    const localFull = Buffer.concat([local, nameBuf, data]);
    localParts.push(localFull);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crcVal, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, nameBuf]));
    offset += localFull.length;
  }
  const cdOffset = offset;
  const cdSize = centralParts.reduce((s, b) => s + b.length, 0);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, ...centralParts, eocd]);
}

const coreFiles = fs.readdirSync(coresDir).filter((f) => f.endsWith(".data"));
let processed = 0;
let skipped = 0;

for (const coreFile of coreFiles) {
  const corePath = path.join(coresDir, coreFile);
  const buf = fs.readFileSync(corePath);
  if (buf.length >= 4 && buf.readUInt32LE(0) === 0x04034b50) {
    const method = buf.readUInt16LE(8);
    if (method === 0) {
      console.log("SKIP (already STORE):", coreFile);
      skipped++;
      continue;
    }
  }
  const tmpDir = path.join(tmpBase, coreFile.replace(".data", ""));
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch {}
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    execSync(
      `powershell -NoProfile -Command "Expand-Archive -LiteralPath '${corePath}' -DestinationPath '${tmpDir}' -Force"`,
      { stdio: "pipe" },
    );
  } catch (e) {
    console.log("FAIL extract:", coreFile, "-", e.message);
    continue;
  }
  const extracted = fs.readdirSync(tmpDir).sort();
  const files = extracted.map((name) => ({
    name,
    data: fs.readFileSync(path.join(tmpDir, name)),
  }));
  const newZip = buildStoreZip(files);
  fs.writeFileSync(corePath, newZip);
  console.log(
    "OK:",
    coreFile,
    "-",
    newZip.length,
    "bytes,",
    files.length,
    "files",
  );
  processed++;
}

try {
  fs.rmSync(tmpBase, { recursive: true, force: true });
} catch {}
console.log("---");
console.log("Processed:", processed, "Skipped:", skipped);
