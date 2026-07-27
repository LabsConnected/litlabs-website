"use client";

import { useState, useRef, useCallback, useEffect } from "react";
// ROM upload and validation utilities are defined inline below.

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

// ─── Runtime state ──────────────────────────────────────────────
type RuntimeState =
  | "idle"
  | "rom_loaded"
  | "checking_assets"
  | "preparing_runtime"
  | "waiting_for_user"
  | "downloading_core"
  | "decompressing_core"
  | "initializing"
  | "running"
  | "error";

interface RuntimeEvent {
  type: string;
  text?: string;
  percent?: number;
  message?: string;
  timestamp: number;
}

export default function EmulatorTestPage() {
  const [romInfo, setRomInfo] = useState<{ url: string; name: string; size: number; valid: boolean } | null>(null);
  const [runtimeState, setRuntimeState] = useState<RuntimeState>("idle");
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [useCdn, setUseCdn] = useState(false);
  const [coreChoice, setCoreChoice] = useState("nes");
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const romUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── Listen for iframe events ─────────────────────────────────
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      if (!event.data || event.data.source !== "arcade") return;
      const { type, text, percent, message } = event.data;
      const evt: RuntimeEvent = { type, text, percent, message, timestamp: Date.now() };
      setEvents((prev) => [...prev.slice(-50), evt]);

      // Map events to runtime state
      switch (type) {
        case "runtime.booting":
          setRuntimeState("preparing_runtime");
          break;
        case "runtime.loader_ready":
          setRuntimeState("waiting_for_user");
          break;
        case "runtime.progress":
          if (text && /download.*core/i.test(text)) setRuntimeState("downloading_core");
          else if (text && /decompress.*core/i.test(text)) setRuntimeState("decompressing_core");
          break;
        case "runtime.core_decompression_completed":
          setRuntimeState("initializing");
          break;
        case "runtime.running":
          setRuntimeState("running");
          break;
        case "runtime.error":
          setRuntimeState("error");
          setError(message || "Unknown runtime error");
          break;
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // ─── ROM upload ───────────────────────────────────────────────
  const onFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Revoke previous URL
    if (romUrlRef.current) URL.revokeObjectURL(romUrlRef.current);
    const info = await handleRomUpload(file);
    romUrlRef.current = info.url;
    setRomInfo(info);
    setRuntimeState("rom_loaded");
    setError(null);
    setEvents([]);
  }, []);

  // ─── Launch emulator ──────────────────────────────────────────
  const launch = useCallback(() => {
    if (!romInfo) return;
    setRuntimeState("preparing_runtime");
    setError(null);
    setEvents([]);

    const params = new URLSearchParams({
      core: coreChoice,
      rom: romInfo.url,
      name: romInfo.name.replace(/\.[^.]+$/, ""),
      dataPath: "/emulatorjs/4.2.3/data/",
    });
    if (useCdn) params.set("cdnTest", "1");

    // Force iframe reload by updating src
    if (iframeRef.current) {
      iframeRef.current.src = `/arcade-runtime/emulator-session.html?${params.toString()}`;
    }
  }, [romInfo, coreChoice, useCdn]);

  // ─── Cleanup blob URL on unmount ──────────────────────────────
  useEffect(() => {
    return () => {
      if (romUrlRef.current) URL.revokeObjectURL(romUrlRef.current);
    };
  }, []);

  // ─── Asset preflight check ────────────────────────────────────
  const [preflight, setPreflight] = useState<string | null>(null);
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
        const cl = res.headers.get("content-length") || "?";
        if (!res.ok) {
          checks.push(`FAIL ${f}: HTTP ${res.status}`);
        } else if (ct.includes("text/html")) {
          checks.push(`FAIL ${f}: returned HTML (content-type: ${ct})`);
        } else {
          checks.push(`OK   ${f}: ${res.status} ${ct} ${cl}b`);
        }
      } catch (err) {
        checks.push(`FAIL ${f}: ${err instanceof Error ? err.message : "fetch error"}`);
      }
    }
    setPreflight(checks.join("\n"));
  }, [useCdn, coreChoice]);

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Emulator Test Page — NES Vertical Slice</h1>
        <p className="text-zinc-400 mb-6">
          Isolated test for EmulatorJS 4.2.3 with official 7z-compressed cores.
          Upload a legally owned NES ROM and click Launch.
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
              <div>iNES header: {romInfo.valid ? "✓ valid" : "✗ invalid (not a NES ROM?)"}</div>
              <div>Blob URL: <code className="text-xs text-zinc-400">{romInfo.url.slice(0, 50)}...</code></div>
            </div>
          )}
        </div>

        {/* ─── Configuration ─── */}
        <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">2. Configuration</h2>
          <div className="flex gap-4 items-center mb-3">
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
              <input
                type="checkbox"
                checked={useCdn}
                onChange={(e) => setUseCdn(e.target.checked)}
              />
              Use official CDN (diagnostic)
            </label>
          </div>
          <button
            onClick={runPreflight}
            className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700"
          >
            Run Asset Preflight
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
            disabled={!romInfo || runtimeState === "preparing_runtime"}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded font-medium"
          >
            Launch Emulator
          </button>
          <div className="mt-3 text-sm">
            State: <span className="font-mono text-indigo-400">{runtimeState}</span>
            {error && <div className="text-red-400 mt-1">Error: {error}</div>}
          </div>
        </div>

        {/* ─── Emulator iframe ─── */}
        {runtimeState !== "idle" && (
          <div className="mb-6">
            <div className="aspect-video w-full bg-black rounded-lg overflow-hidden border border-zinc-800">
              <iframe
                ref={iframeRef}
                title="Emulator"
                className="w-full h-full"
                allow="autoplay; gamepad; fullscreen"
              />
            </div>
          </div>
        )}

        {/* ─── Event log ─── */}
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">Runtime Events</h2>
          <div className="max-h-64 overflow-y-auto text-xs font-mono space-y-1">
            {events.length === 0 ? (
              <div className="text-zinc-500">No events yet.</div>
            ) : (
              events.map((evt, i) => (
                <div key={i} className="text-zinc-300">
                  <span className="text-zinc-500">{new Date(evt.timestamp).toLocaleTimeString()}</span>{" "}
                  <span className="text-indigo-400">{evt.type}</span>
                  {evt.text && <span className="text-zinc-400"> — {evt.text}</span>}
                  {evt.message && <span className="text-red-400"> — {evt.message}</span>}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
