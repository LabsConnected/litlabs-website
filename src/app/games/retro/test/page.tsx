"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import {
  EmulatorSessionController,
  isLikelyNesRom,
  computeSha256,
  type EmulatorSessionState,
  type RuntimeEvent,
  type EmulatorFailure,
  type AssetCheck,
  type DiagnosticReport,
} from "@/lib/arcade/EmulatorSessionController";

// ─── ROM upload ─────────────────────────────────────────────────
interface RomInfo {
  url: string;
  name: string;
  size: number;
  extension: string;
  sha256: string;
  inesValid: boolean;
}

async function handleRomUpload(file: File): Promise<RomInfo> {
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  const inesValid = isLikelyNesRom(bytes);
  const sha256 = await computeSha256(buf);
  const url = URL.createObjectURL(file);
  const ext = file.name.match(/(\.[^.]+)$/)?.[1] || "";
  return {
    url,
    name: file.name,
    size: file.size,
    extension: ext,
    sha256,
    inesValid,
  };
}

export default function EmulatorTestPage() {
  const [romInfo, setRomInfo] = useState<RomInfo | null>(null);
  const [useCdn, setUseCdn] = useState(false);
  const [sessionState, setSessionState] = useState<EmulatorSessionState>("idle");
  const [events, setEvents] = useState<RuntimeEvent[]>([]);
  const [failure, setFailure] = useState<EmulatorFailure | null>(null);
  const [assetChecks, setAssetChecks] = useState<AssetCheck[]>([]);
  const [preflightOk, setPreflightOk] = useState<boolean | null>(null);
  const [launched, setLaunched] = useState(false);
  const [report, setReport] = useState<DiagnosticReport | null>(null);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const controllerRef = useRef<EmulatorSessionController | null>(null);
  const romUrlRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ─── ROM upload ───────────────────────────────────────────────
  const onFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (romUrlRef.current) URL.revokeObjectURL(romUrlRef.current);
    const info = await handleRomUpload(file);
    romUrlRef.current = info.url;
    setRomInfo(info);
    setSessionState("idle");
    setFailure(null);
    setEvents([]);
    setAssetChecks([]);
    setPreflightOk(null);
    setLaunched(false);
    setReport(null);
  }, []);

  // ─── Create controller ────────────────────────────────────────
  const createController = useCallback(() => {
    if (!romInfo) return null;
    const dataPath = useCdn
      ? "https://cdn.emulatorjs.org/4.2.3/data/"
      : "/emulatorjs/4.2.3/data/";
    return new EmulatorSessionController(
      {
        romUrl: romInfo.url,
        romName: romInfo.name.replace(/\.[^.]+$/, ""),
        romSize: romInfo.size,
        romExtension: romInfo.extension,
        romSha256: romInfo.sha256,
        inesValid: romInfo.inesValid,
        core: "nes",
        dataPath,
        useCdn,
        color: "#6366f1",
      },
      {
        onStateChange: (state) => setSessionState(state),
        onEvent: (evt) => setEvents((prev) => [...prev.slice(-100), evt]),
        onFailure: (f) => setFailure(f),
      },
    );
  }, [romInfo, useCdn]);

  // ─── Run preflight ────────────────────────────────────────────
  const runPreflight = useCallback(async () => {
    const controller = createController();
    if (!controller) return;
    controllerRef.current = controller;
    const result = await controller.runPreflight();
    setAssetChecks(result.checks);
    setPreflightOk(result.ok);
  }, [createController]);

  // ─── Launch ───────────────────────────────────────────────────
  const launch = useCallback(async () => {
    if (!romInfo || !iframeRef.current) return;
    const controller = createController();
    if (!controller) return;
    controllerRef.current = controller;
    setLaunched(true);
    setFailure(null);
    setEvents([]);
    await controller.launch(iframeRef.current);
  }, [romInfo, createController]);

  // ─── Try next core (fallback) ─────────────────────────────────
  const tryNextCore = useCallback(async () => {
    if (!controllerRef.current) return;
    const ok = await controllerRef.current.tryNextCore();
    if (!ok) {
      setFailure({
        code: "UNKNOWN_RUNTIME_ERROR",
        message: "All core fallbacks exhausted (nes → nestopia → nestopia-legacy)",
        stage: sessionState,
      });
    }
    setFailure(null);
  }, [sessionState]);

  // ─── Shutdown ─────────────────────────────────────────────────
  const shutdown = useCallback(() => {
    controllerRef.current?.shutdown();
    setLaunched(false);
    setSessionState("stopped");
  }, []);

  // ─── Generate diagnostic report ───────────────────────────────
  const generateReport = useCallback(() => {
    if (!controllerRef.current) return;
    const r = controllerRef.current.getDiagnosticReport();
    r.assetChecks = assetChecks;
    setReport(r);
  }, [assetChecks]);

  // ─── Copy report ──────────────────────────────────────────────
  const copyReport = useCallback(() => {
    if (!report) return;
    const text = JSON.stringify(report, null, 2);
    navigator.clipboard.writeText(text);
  }, [report]);

  // ─── Download report ──────────────────────────────────────────
  const downloadReport = useCallback(() => {
    if (!report) return;
    const text = JSON.stringify(report, null, 2);
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `emulator-diagnostic-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [report]);

  // ─── Cleanup on unmount ───────────────────────────────────────
  useEffect(() => {
    return () => {
      controllerRef.current?.shutdown();
      if (romUrlRef.current) URL.revokeObjectURL(romUrlRef.current);
    };
  }, []);

  const stateColor: Record<EmulatorSessionState, string> = {
    idle: "text-zinc-400",
    validating_rom: "text-yellow-400",
    checking_assets: "text-yellow-400",
    preparing_runtime: "text-blue-400",
    waiting_for_user: "text-blue-400",
    downloading_core: "text-blue-400",
    decompressing_core: "text-blue-400",
    initializing_wasm: "text-blue-400",
    mounting_rom: "text-blue-400",
    waiting_for_first_frame: "text-blue-400",
    running: "text-green-400",
    paused: "text-yellow-400",
    recovering: "text-orange-400",
    failed: "text-red-400",
    stopped: "text-zinc-400",
  };

  return (
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold mb-2">Emulator Test — NES Vertical Slice</h1>
        <p className="text-zinc-400 mb-6">
          Full runtime with state machine, core fallback, watchdogs, and real diagnostics.
        </p>

        {/* ─── ROM Upload ─── */}
        <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">1. ROM</h2>
          <input
            ref={fileInputRef}
            type="file"
            accept=".nes,.sfc,.smc,.gb,.gbc,.gba,.md,.gen"
            onChange={onFileSelect}
            className="block mb-3 text-sm"
          />
          {romInfo && (
            <div className="text-sm space-y-1">
              <div>Name: {romInfo.name}</div>
              <div>Size: {romInfo.size.toLocaleString()} bytes</div>
              <div>Extension: {romInfo.extension}</div>
              <div>iNES header: {romInfo.inesValid ? "✓ valid (4E 45 53 1A)" : "✗ invalid"}</div>
              <div>SHA-256: <code className="text-xs text-zinc-500">{romInfo.sha256.slice(0, 32)}...</code></div>
            </div>
          )}
        </div>

        {/* ─── Configuration ─── */}
        <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">2. Configuration</h2>
          <label className="text-sm flex items-center gap-2 mb-3">
            <input type="checkbox" checked={useCdn} onChange={(e) => setUseCdn(e.target.checked)} />
            Use official CDN (diagnostic control test)
          </label>
          <div className="flex gap-2">
            <button
              onClick={runPreflight}
              disabled={!romInfo}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 rounded border border-zinc-700"
            >
              Run Preflight
            </button>
            <button
              onClick={launch}
              disabled={!romInfo}
              className="px-4 py-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 rounded font-medium"
            >
              Launch
            </button>
            {launched && (
              <button
                onClick={shutdown}
                className="px-3 py-1.5 text-sm bg-red-900 hover:bg-red-800 rounded border border-red-800"
              >
                Shutdown
              </button>
            )}
          </div>

          {/* Preflight results */}
          {assetChecks.length > 0 && (
            <div className="mt-3">
              <div className="text-sm mb-2">
                Preflight: {preflightOk ? <span className="text-green-400">✓ ALL OK</span> : <span className="text-red-400">✗ FAILURES</span>}
              </div>
              <pre className="p-3 bg-zinc-950 rounded text-xs font-mono whitespace-pre-wrap">
                {assetChecks.map((c) => {
                  const sig = c.signatureValid === true ? " 7z✓" : c.signatureValid === false ? " WRONG-SIG✗" : "";
                  return `${c.ok ? "OK  " : "FAIL"} ${c.url.replace(/.*\/data\//, "")} | ${c.status} | ${c.contentType || "?"} | ${c.contentLength || 0}b${sig}${c.error ? " | " + c.error : ""}\n`;
                }).join("")}
              </pre>
            </div>
          )}
        </div>

        {/* ─── State + Failure ─── */}
        <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <div className="flex items-center gap-4 mb-2">
            <h2 className="text-lg font-semibold">3. Runtime</h2>
            <div className="text-sm">
              State: <span className={`font-mono ${stateColor[sessionState]}`}>{sessionState}</span>
            </div>
          </div>
          {failure && (
            <div className="mt-2 p-3 bg-red-950/50 border border-red-900 rounded text-sm">
              <div className="text-red-400 font-mono">{failure.code}</div>
              <div className="text-red-300">{failure.message}</div>
              <div className="text-zinc-500 text-xs mt-1">Stage: {failure.stage}</div>
              <button
                onClick={tryNextCore}
                className="mt-2 px-3 py-1 text-xs bg-orange-900 hover:bg-orange-800 rounded border border-orange-800"
              >
                Try Next Core (fallback)
              </button>
            </div>
          )}
        </div>

        {/* ─── Emulator ─── */}
        {launched && (
          <div className="mb-6">
            <div className="aspect-video w-full bg-black rounded-lg overflow-hidden border border-zinc-800">
              <iframe
                ref={iframeRef}
                title="Emulator"
                className="w-full h-full"
                allow="autoplay; gamepad; fullscreen; cross-origin-isolated"
              />
            </div>
          </div>
        )}

        {/* ─── Event log ─── */}
        {events.length > 0 && (
          <div className="mb-6 p-4 bg-zinc-900 rounded-lg border border-zinc-800">
            <h2 className="text-lg font-semibold mb-3">Runtime Events ({events.length})</h2>
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

        {/* ─── Diagnostics ─── */}
        <div className="p-4 bg-zinc-900 rounded-lg border border-zinc-800">
          <h2 className="text-lg font-semibold mb-3">Diagnostics</h2>
          <div className="flex gap-2 mb-3">
            <button
              onClick={generateReport}
              className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700"
            >
              Generate Report
            </button>
            {report && (
              <>
                <button
                  onClick={copyReport}
                  className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700"
                >
                  Copy JSON
                </button>
                <button
                  onClick={downloadReport}
                  className="px-3 py-1.5 text-sm bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700"
                >
                  Download JSON
                </button>
              </>
            )}
          </div>
          {report && (
            <pre className="p-3 bg-zinc-950 rounded text-xs font-mono overflow-x-auto max-h-64 overflow-y-auto">
              {JSON.stringify(report, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
