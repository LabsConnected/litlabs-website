import { createRequire } from 'module';
const text = new TextEncoder();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c >>> 1 ^ (0xedb88320 & -(c & 1));
  }
  return (c ^ 0xffffffff) >>> 0;
}
function buildZip(files) {
  const parts = [], central = [];
  let offset = 0;
  const enc = new TextEncoder();
  for (const f of files) {
    const nameBytes = enc.encode(f.path);
    const crc = crc32(f.data);
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const view = new DataView(localHeader.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true); view.setUint16(6, 0, true); view.setUint16(8, 0, true);
    view.setUint16(10, 0, true); view.setUint16(12, 0, true);
    view.setUint32(14, crc, true); view.setUint32(18, f.data.length, true);
    view.setUint32(22, f.data.length, true); view.setUint16(26, nameBytes.length, true);
    view.setUint16(28, 0, true);
    localHeader.set(nameBytes, 30);
    parts.push(localHeader); parts.push(f.data);
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
    cv.setUint16(8, 0, true); cv.setUint16(10, 0, true); cv.setUint16(12, 0, true); cv.setUint16(14, 0, true);
    cv.setUint32(16, crc, true); cv.setUint32(20, f.data.length, true); cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, nameBytes.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true);
    cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true);
    centralHeader.set(nameBytes, 46);
    central.push(centralHeader);
    offset += localHeader.length + f.data.length;
  }
  const centralOffset = offset;
  let centralSize = 0; for (const c of central) centralSize += c.length;
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(4, 0, true); ev.setUint16(6, 0, true);
  ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
  ev.setUint32(12, centralSize, true); ev.setUint32(16, centralOffset, true); ev.setUint16(20, 0, true);
  const total = offset + centralSize + eocd.length;
  const out = new Uint8Array(total);
  let pos = 0; for (const p of parts) { out.set(p, pos); pos += p.length; }
  for (const c of central) { out.set(c, pos); pos += c.length; }
  out.set(eocd, pos);
  return out;
}

// Test
const files = [
  { path: 'index.html', data: text.encode('<!DOCTYPE html><html><body>Premium demo - Black Label</body></html>') },
  { path: 'style.css', data: text.encode('body{font-family:system-ui;background:#0a0a0b;color:#f5f3f0}') },
  { path: '.litt/canvas.json', data: text.encode('{"nodes":{},"rootNodeIds":[]}') },
];
const zip = buildZip(files);
console.log('zip bytes', zip.length);
console.log('sig check', zip[0].toString(16), zip[1].toString(16), zip[2].toString(16), zip[3].toString(16));
console.log('central sig at', zip.length - 22 - (files.reduce((a,f)=>a+46+f.path.length,0)), 'is central?');
// Verify ZIP structure basics
if (zip[0]===0x50 && zip[1]===0x4b && zip[2]===0x03 && zip[3]===0x04) console.log('PASS local header');
const eocdSig = (zip[zip.length-22]<<0)|(zip[zip.length-21]<<8)|(zip[zip.length-20]<<16)|(zip[zip.length-19]<<24);
if ((eocdSig>>>0)===0x06054b50) console.log('PASS EOCD');
else console.log('FAIL EOCD', eocdSig.toString(16));
console.log('Export ZIP verification complete');
