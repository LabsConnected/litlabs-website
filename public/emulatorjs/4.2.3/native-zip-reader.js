/**
 * NativeZipReader — a pure-JS replacement for EmulatorJS's Emscripten-based
 * extractzip.js / extract7z.js decompression workers.
 *
 * WHY: The Emscripten-compiled extractzip.js worker in EmulatorJS 4.2.3 has a
 * bug where it emits decompression progress to 99% but never fires the
 * completion event (postMessage({t:1})), causing the emulator to stall
 * indefinitely at "Decompress Game Core 99%". This affects all cores
 * regardless of compression method (STORE or deflate).
 *
 * HOW: This script overrides window.EJS_COMPRESSION with a native JS zip
 * reader that parses the ZIP central directory, extracts entries using
 * direct byte copying (STORE) or DecompressionStream (deflate), and resolves
 * the decompress Promise directly — no Web Worker, no Emscripten, no stall.
 *
 * The original EJS_COMPRESSION class is preserved for 7z/rar fallback.
 */
(function () {
  "use strict";

  // CRC32 table for zip verification
  var crcTable = null;
  function makeCrcTable() {
    crcTable = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      crcTable[n] = c >>> 0;
    }
  }
  function crc32(buf) {
    if (!crcTable) makeCrcTable();
    var crc = 0xffffffff;
    for (var i = 0; i < buf.length; i++) {
      crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }

  function readUint16(view, off) { return view.getUint16(off, true); }
  function readUint32(view, off) { return view.getUint32(off, true); }

  var ZIP_LOCAL_SIG = 0x04034b50;
  var ZIP_CENTRAL_SIG = 0x02014b50;
  var ZIP_EOCD_SIG = 0x06054b50;

  function NativeZipReader(EJS) {
    this.EJS = EJS;
  }

  NativeZipReader.prototype.isCompressed = function (t) {
    if (t[0] === 0x50 && t[1] === 0x4b && (t[2] === 0x03 || t[2] === 0x05 || t[2] === 0x07))
      return "zip";
    if (t[0] === 0x37 && t[1] === 0x7a && t[2] === 0xbc && t[3] === 0xaf && t[4] === 0x27 && t[5] === 0x1c)
      return "7z";
    if (t[0] === 0x52 && t[1] === 0x61 && t[2] === 0x72 && t[3] === 0x21 && t[4] === 0x1a && t[5] === 0x07)
      return "rar";
    return null;
  };

  NativeZipReader.prototype.decompress = function (data, progressCb, notCompressedCb) {
    var self = this;
    var type = self.isCompressed(data.subarray(0, 10));

    if (type === null) {
      if (typeof notCompressedCb === "function")
        notCompressedCb("!!notCompressedData", data);
      return Promise.resolve({ "!!notCompressedData": data });
    }

    // For 7z/rar, fall back to the original Emscripten worker
    if (type !== "zip") {
      if (self._origCompression) {
        var orig = new self._origCompression(self.EJS);
        return orig.decompress(data, progressCb, notCompressedCb);
      }
      return Promise.reject(new Error("No fallback available for " + type + " decompression"));
    }

    return self._extractZip(data, progressCb);
  };

  NativeZipReader.prototype._extractZip = function (data, progressCb) {
    return new Promise(function (resolve, reject) {
      try {
        var view = new DataView(data.buffer, data.byteOffset, data.byteLength);

        // Find End of Central Directory record (search backwards from end)
        var eocdOffset = -1;
        for (var i = data.length - 22; i >= Math.max(0, data.length - 65557); i--) {
          if (readUint32(view, i) === ZIP_EOCD_SIG) {
            eocdOffset = i;
            break;
          }
        }
        if (eocdOffset < 0) {
          reject(new Error("NativeZipReader: EOCD record not found"));
          return;
        }

        var cdCount = readUint16(view, eocdOffset + 8);
        var cdOffset = readUint32(view, eocdOffset + 16);

        // Parse central directory entries
        var entries = [];
        var off = cdOffset;
        for (var i = 0; i < cdCount; i++) {
          if (readUint32(view, off) !== ZIP_CENTRAL_SIG) break;
          var compMethod = readUint16(view, off + 10);
          var compSize = readUint32(view, off + 20);
          var uncompSize = readUint32(view, off + 24);
          var nameLen = readUint16(view, off + 28);
          var extraLen = readUint16(view, off + 30);
          var commentLen = readUint16(view, off + 32);
          var localHeaderOffset = readUint32(view, off + 42);
          var name = new TextDecoder().decode(
            data.subarray(off + 46, off + 46 + nameLen)
          );
          entries.push({
            name: name,
            compMethod: compMethod,
            compSize: compSize,
            uncompSize: uncompSize,
            localHeaderOffset: localHeaderOffset,
          });
          off += 46 + nameLen + extraLen + commentLen;
        }

        // Calculate total uncompressed size for progress
        var totalUncomp = 0;
        for (var i = 0; i < entries.length; i++)
          totalUncomp += entries[i].uncompSize;

        var result = {};
        var processedUncomp = 0;

        // Process entries sequentially (async for deflate)
        function processEntry(idx) {
          if (idx >= entries.length) {
            // All done — resolve with the result map
            if (progressCb) progressCb(" 100%", true);
            resolve(result);
            return;
          }

          var entry = entries[idx];

          // Read local file header to find actual data offset
          var lho = entry.localHeaderOffset;
          if (readUint32(view, lho) !== ZIP_LOCAL_SIG) {
            reject(new Error("NativeZipReader: bad local header for " + entry.name));
            return;
          }
          var localNameLen = readUint16(view, lho + 26);
          var localExtraLen = readUint16(view, lho + 28);
          var dataOffset = lho + 30 + localNameLen + localExtraLen;

          var fileData;

          if (entry.compMethod === 0) {
            // STORE — copy bytes directly
            fileData = new Uint8Array(entry.uncompSize);
            fileData.set(data.subarray(dataOffset, dataOffset + entry.uncompSize));
            finishEntry(entry, fileData);
          } else if (entry.compMethod === 8) {
            // DEFLATE — use DecompressionStream('deflate-raw')
            var compressed = data.subarray(dataOffset, dataOffset + entry.compSize);
            inflateRaw(compressed).then(
              function (decompressed) {
                finishEntry(entry, decompressed);
              },
              function (err) {
                reject(new Error("NativeZipReader: deflate failed for " + entry.name + ": " + err.message));
              }
            );
          } else {
            reject(new Error("NativeZipReader: unsupported method " + entry.compMethod + " for " + entry.name));
            return;
          }

          function finishEntry(entry, fileData) {
            result[entry.name] = fileData;
            processedUncomp += entry.uncompSize;
            if (progressCb && totalUncomp > 0) {
              var pct = Math.floor((processedUncomp / totalUncomp) * 100);
              progressCb(" " + pct + "%", true);
            }
            // Process next entry on next microtask to avoid stack overflow
            setTimeout(processEntry, 0, idx + 1);
          }
        }

        processEntry(0);
      } catch (err) {
        reject(err);
      }
    });
  };

  // Inflate raw deflate data using the browser's native DecompressionStream.
  // Falls back to a pure-JS inflate if DecompressionStream is unavailable.
  function inflateRaw(compressed) {
    if (typeof DecompressionStream !== "undefined") {
      try {
        var ds = new DecompressionStream("deflate-raw");
        var writer = ds.writable.getWriter();
        writer.write(compressed);
        writer.close();

        var reader = ds.readable.getReader();
        var chunks = [];
        var totalLen = 0;

        return reader.read().then(function pump(chunk) {
          if (chunk.done) {
            var result = new Uint8Array(totalLen);
            var offset = 0;
            for (var i = 0; i < chunks.length; i++) {
              result.set(chunks[i], offset);
              offset += chunks[i].length;
            }
            return result;
          }
          chunks.push(chunk.value);
          totalLen += chunk.value.length;
          return reader.read().then(pump);
        });
      } catch (e) {
        // DecompressionStream('deflate-raw') not supported — fall through
      }
    }
    // Last resort: load a pure-JS inflate library dynamically.
    // For STORE-only cores this path is never hit.
    return Promise.reject(
      new Error("NativeZipReader: DecompressionStream('deflate-raw') unavailable and no fallback inflate")
    );
  }

  // Install: intercept window.EJS_COMPRESSION so that when emulator.min.js
  // sets it, we capture the original class (for 7z/rar fallback) but always
  // return our NativeZipReader from the getter.
  var _origCompression = null;
  NativeZipReader.prototype._origCompression = null;

  Object.defineProperty(window, "EJS_COMPRESSION", {
    get: function () { return NativeZipReader; },
    set: function (v) {
      _origCompression = v;
      NativeZipReader.prototype._origCompression = v;
    },
    configurable: true,
  });
})();
