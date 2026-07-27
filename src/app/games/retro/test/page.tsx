"use client";

import { useState, useRef, useCallback, useEffect } from "react";

// ─── iNES header validation ─────────────────────────────────────
function isLikelyNesRom(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 16 &&
    bytes[0] === 0x4e &&
    bytes[1] === 0x45 &&
    bytes[2] === 0x53 &&
    bytes[3] === 0x1a
  );
}

// ─── ROM upload ─────────────────────────────────────────────────
async function handleRomUpload(file: File): Promise<{ url: string; name: string; size: number; valid: boolean }> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const valid = isLikelyNesRom(bytes);
  const url = URL.createObjectURL(file);
  return { url, name: file.name, size: file.size, valid };
}

type LaunchMode = "iframe" | "direct";

export default function EmulatorTestPage() {
  const [romInfo, setRomInfo] = useState<{ url: string; name: string; size: number; valid: boolean } | null>(null);
  const [useCdn, setUseCdn] = useState(false);
  const [coreChoice, setCoreChoice] = useState("nes");
  const [launchMode, setLaunchMode] = useState<LaunchMode>("direct");
  const [events, setEvents] = useState<Array<{ type: string; text?: string; message?: string; timestamp: number }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [preflight, setPreflight] = useState<string | null>(null);
  const [launched, setLaunched] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const romUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Listen for iframe events (iframe mode only) ──────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data || event.data.source !== "arcade") return;
      const { type, text, message } = event.data;
      setEvents((prev) => [...prev.slice(-50), { type, text, message, timestamp: Date.now() }]);
      if (type === "runtime.error") {
        setError(message || "Unknown runtime error");
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ─── ROM upload ───────────────────────────────────────────────
  const onFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (romUrlRef.current) URL.revokeObjectURL(romUrlRef.current);
    const info = await handleRomUpload(file);
    romUrlRef.current = info.url;
    setRomInfo(info);
    setError(null);
    setEvents([]);
    setLaunched(false);
  }, []);

  // ─── Launch emulator ──────────────────────────────────────────
  const launch = useCallback(() => {
    if (!romInfo) return;
    setError(null);
    setEvents([]);
    setLaunched(true);

    if (launchMode === "iframe") {
      const dataPath = useCdn ? "https://cdn.emulatorjs.org/4.2.3/data/" : "/emulatorjs/4.2.3/data/";
      const params = new URLSearchParams({
        core: coreChoice,
        rom: romInfo.url,
        name: romInfo.name.replace(/\.[^.]+$/, ""),
        dataPath,
      });
      if (useCdn) params.set("cdnTest", "1");
      if (iframeRef.current) {
        iframeRef.current.src = `/arcade-runtime/emulator-session.html?${params.toString()}`;
      }
    }
    // In "direct" mode, the iframe srcDoc is set via the render below
  }, [romInfo, coreChoice, useCdn, launchMode]);

  // ─── Cleanup blob URL on unmount ──────────────────────────────
  useEffect(() => {
    return () => {
      if (romUrlRef.current) URL.revokeObjectURL(romUrlRef.current);
    };
  }, []);

  // ─── Asset preflight check ────────────────────────────────────
  const runPreflight = useCallback(async () => {
    const dataPath = useCdn ? "https://cdn.emulatorjs.org/4.2.3/data/" : "/emulatorjs/4.2.3/data/";
    const checks: string[] = [];
    const files = ["loader.js", "emulator.min.js", "emulator.min.css", "version.json"];
    const coreFile = coreChoice === "nes" ? "fceumm-wasm.data" : `${coreChoice}-wasm.data`;
    files.push(`cores/${coreFile}`);

    for (const f of files) {
      try {
        const res = await fetch(`${dataPath}${f}`, { method: "GET", cache: "no-store" });
        const ct = res.headers.get("content-type") || "";
        const buf = await res.arrayBuffer();
        const bytes = new Uint8Array(buf, 0, Math.min(6, buf.byteLength));
        const sig = Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join(" ");
        if (!res.ok) {
          checks.push(`FAIL ${f}: HTTP ${res.status}`);
        } else if (ct.includes("text/html")) {
          checks.push(`FAIL ${f}: returned HTML (content-type: ${ct})`);
        } else if (f.endsWith(".data") && !(bytes[0] === 0x37 && bytes[1] === 0x7a)) {
          checks.push(`FAIL ${f}: wrong signature (sig: ${sig}, expected 7z: 37 7a bc af)`);
        } else {
          checks.push(`OK   ${f}: ${res.status} ${ct} ${buf.byteLength}b sig:${sig}`);
        }
      } catch (err) {
        checks.push(`FAIL ${f}: ${err instanceof Error ? err.message : "fetch error"}`);
      }
    }
    setPreflight(checks.join("\n"));
  }, [useCdn, coreChoice]);

  // ─── Direct mode iframe srcDoc (matches working demo exactly) ─
  const directSrcDoc = romInfo && launched && launchMode === "direct" ? `<!doctype html>
<html><head><style>body,html{margin:0;padding:0;background:#000}#game{width:100%;height:100%}</style></head>
<body><div id="game"></div>
<script>
EJS_player="#game";
EJS_core=${JSON.stringify(coreChoice)};
EJS_gameName=${JSON.stringify(romInfo.name.replace(/\.[^.]+$/, ""))};
EJS_color="#0064ff";
EJS_startOnLoaded=true;
EJS_pathtodata=${JSON.stringify(useCdn ? "https://cdn.emulatorjs.org/4.2.3/data/" : "/emulatorjs/4.2.3/data/")};
EJS_gameUrl=${JSON.stringify(romInfo.url)};
EJS_threads=false;
</script>
<script src=${JSON.stringify(useCdn ? "https://cdn.emulatorjs.org/4.2.3/data/loader.js" : "/emulatorjs/4.2.3/data/loader.js")}></script>
</body></html>` : undefined;

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Emulator Test — NES Vertical Slice</h1>
        <p className="text-zinc-400 mb-6">
          Matches the working demo.emulatorjs.org configuration. Upload a NES ROM and launch.
        </p>

        {/* ─── ROM Upload ─── */}
        <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">1. ROM</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept=".nes"
            onChange={onFileSelect}
            className="block mb-3 text-sm"
          />
          {romInfo && (
            <div className="text-sm space-y-1">
              <div>Name: {romInfo.name}</div>
              <div>Size: {romInfo.size.toLocaleString()} bytes</div>
              <div>iNES header: {romInfo.valid ? "✓ valid (4E 45 53 1A)" : "✗ invalid"}</div>
            </div>
          )}
        </div>

        {/* ─── Configuration ─── */}
        <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">2. Configuration</h2>
          <div className="flex flex-wrap gap-4 items-center mb-3">
            <label className="text-sm">
              Core:
              <select
                value={coreChoice}
                onChange={(e) => setCoreChoice(e.target.value)}
                className="ml-2 bg-zinc-800 border border-zinc-700 rounded px-2 py-1"
              >
                <option value="nes">nes (→ fceumm)</option>
                <option value="nestopia">nestopia</option>
              </select>
            </label>
            <label className="text-sm flex items-center gap-2">
              <input type="checkbox" checked={useCdn} onChange={(e) => setUseCdn(e.target.checked)} />
              Use official CDN
            </label>
            <label className="text-sm flex items-center gap-2">
              Mode:
              <select
                value={launchMode}
                onChange={(e) => setLaunchMode(e.target.value as LaunchMode)}
                className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1"
              >
                <option value="direct">direct (matches demo)</option>
                <option value="iframe">iframe (postMessage)</option>
              </select>
            </label>
          </div>
          <button
            onClick={runPreflight}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 mr-2"
          >
            Run Preflight
          </button>
          {preflight && (
            <pre className="mt-3 p-3 bg-zinc-950 rounded text-xs font-mono whitespace-pre-wrap">{preflight}</pre>
          )}
        </div>

        {/* ─── Launch ─── */}
        <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">3. Launch</h2>
          <button
            onClick={launch}
            disabled={!romInfo}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded font-medium"
          >
            Launch
          </button>
          {error && <div className="mt-3 text-red-400 text-sm">Error: {error}</div>}
        </div>

        {/* ─── Emulator ─── */}
        {launched && romInfo && (
          <div className="mb-6">
            <div className="aspect-video w-full bg-black rounded-lg overflow-hidden border border-zinc-800">
              {launchMode === "direct" ? (
                <iframe
                  key="direct"
                  title="Emulator"
                  srcDoc={directSrcDoc}
                  className="w-full h-full"
                  allow="autoplay; gamepad; fullscreen; cross-origin-isolated"
                />
              ) : (
                <iframe
                  ref={iframeRef}
                  key="iframe"
                  title="Emulator"
                  className="w-full h-full"
                  allow="autoplay; gamepad; fullscreen"
                />
              )}
            </div>
          </div>
        )}

        {/* ─── Event log (iframe mode only) ─── */}
        {launchMode === "iframe" && events.length > 0 && (
          <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
            <h2 className="text-lg font-semibold mb-3">Runtime Events</h2>
            <div className="max-h-48 overflow-y-auto text-xs font-mono space-y-1">
              {events.map((evt, i) => (
                <div key={i} className="text-zinc-300">
                  <span className="text-zinc-500">{new Date(evt.timestamp).toLocaleTimeString()}</span>{" "}
                  <span className="text-indigo-400">{evt.type}</span>
                  {evt.text && <span className="text-zinc-400"> — {evt.text}</span>}
                  {evt.message && <span className="text-red-400"> — {evt.message}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
