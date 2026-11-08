import { deflateRawSync } from "zlib";

/**
 * Minimal ZIP writer — store-or-deflate entries, UTF-8 names, no deps.
 * Produces a standard archive readable by every unzip implementation.
 * Server-side only (uses node:zlib).
 */

export interface ZipEntryInput {
  /** Archive path, forward slashes, no leading slash. */
  name: string;
  data: Buffer;
  /** True for explicit directory entries (name should end with "/"). */
  isDirectory?: boolean;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function toDosDateTime(d: Date): { time: number; date: number } {
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | ((d.getSeconds() >> 1) & 0x1f);
  const date =
    (((d.getFullYear() - 1980) & 0x7f) << 9) | (((d.getMonth() + 1) & 0xf) << 5) | (d.getDate() & 0x1f);
  return { time, date };
}

/**
 * Build a ZIP archive. Each entry is deflated when compression helps,
 * stored otherwise — correct either way, just smaller when it can be.
 */
export function buildZip(entries: ZipEntryInput[]): Buffer {
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  const { time, date } = toDosDateTime(new Date());

  for (const entry of entries) {
    const isDir = entry.isDirectory === true || entry.name.endsWith("/");
    const name = isDir && !entry.name.endsWith("/") ? `${entry.name}/` : entry.name;
    const nameBuf = Buffer.from(name, "utf-8");
    const data = isDir ? Buffer.alloc(0) : entry.data;
    const crc = crc32(data);

    // Deflate only when it wins; tiny/already-compressed data stores raw.
    const deflated = data.length > 0 ? deflateRawSync(data) : Buffer.alloc(0);
    const useDeflate = !isDir && deflated.length > 0 && deflated.length < data.length;
    const method = useDeflate ? 8 : 0;
    const stored = useDeflate ? deflated : data;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // UTF-8 name flag
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(stored.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra len
    chunks.push(local, nameBuf, stored);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt16LE(20, 4); // version made by
    cen.writeUInt16LE(20, 6); // version needed
    cen.writeUInt16LE(0x0800, 8); // UTF-8 flag
    cen.writeUInt16LE(method, 10);
    cen.writeUInt16LE(time, 12);
    cen.writeUInt16LE(date, 14);
    cen.writeUInt32LE(crc, 16);
    cen.writeUInt32LE(stored.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(isDir ? 0x10 : 0, 38); // external attrs: dir bit
    cen.writeUInt32LE(offset, 42);
    central.push(cen, nameBuf);

    offset += 30 + nameBuf.length + stored.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}
