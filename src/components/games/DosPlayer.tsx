"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import {
  Upload,
  Link2,
  Play,
  X,
  Loader2,
  Monitor,
  Gamepad2,
  Maximize2,
  RotateCcw,
} from "lucide-react";

/* js-dos is loaded from /public/jsdos — it's a UMD script, not an ES module */
declare global {
  interface Window {
    Dos?: (
      root: HTMLDivElement,
      options: {
        url: string;
        onEvent?: (
          event: string,
          payload: { fs?: unknown; mainThread?: unknown; xip?: unknown },
        ) => void;
      },
    ) => { exit: () => Promise<void> };
  }
}

const JS_DOS_SCRIPT = "/jsdos/js-dos.js";
const JS_DOS_CSS = "/jsdos/js-dos.css";
const JS_DOS_CDN_SCRIPT = "https://v8.js-dos.com/latest/js-dos.js";
const JS_DOS_CDN_CSS = "https://v8.js-dos.com/latest/js-dos.css";

// Poll for window.Dos with a longer timeout — the 322KB script needs time to parse
const DOS_POLL_INTERVAL_MS = 100;
const DOS_POLL_TIMEOUT_MS = 8_000;

// Digger — a classic DOS game, bundled locally to avoid CDN death
const DEMO_BUNDLE_URL = "/jsdos/demo-digger.jsdos";

type LoadState = "idle" | "loading" | "ready" | "running" | "error";

const INIT_TIMEOUT_MS = 15_000;

export default function DosPlayer({
  bundleUrl,
  onClose,
}: {
  bundleUrl?: string;
  onClose?: () => void;
}) {
  const { resolvedColors: T } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const dosRootRef = useRef<HTMLDivElement>(null);
  const dosInstanceRef = useRef<{ exit: () => Promise<void> } | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [urlInput, setUrlInput] = useState(bundleUrl || "");
  const [scriptLoaded, setScriptLoaded] = useState(false);
  const [scriptSource, setScriptSource] = useState<"local" | "cdn" | "pending" | "failed">("pending");
  const [showDiagnostic, setShowDiagnostic] = useState(false);
  const [activeBundleUrl, setActiveBundleUrl] = useState<string | null>(null);
  const [initStartTime, setInitStartTime] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState<number | null>(null);

  /* Load the js-dos script + CSS once, with CDN fallback and polling */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Dos) {
      setScriptLoaded(true);
      setScriptSource("local");
      return;
    }

    let cancelled = false;

    // Load CSS
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = JS_DOS_CSS;
    document.head.appendChild(css);

    // Also load CDN CSS as backup
    const cdnCss = document.createElement("link");
    cdnCss.rel = "stylesheet";
    cdnCss.href = JS_DOS_CDN_CSS;
    document.head.appendChild(cdnCss);

    // Try loading script from local first, CDN as fallback
    const tryLoadScript = (src: string, isCdn: boolean): Promise<boolean> => {
      return new Promise((resolve) => {
        const script = document.createElement("script");
        script.src = src;
        script.async = true;
        if (isCdn) script.crossOrigin = "anonymous";

        const timeout = window.setTimeout(() => {
          resolve(false);
        }, 10_000);

        script.onload = () => {
          window.clearTimeout(timeout);
          // Poll for window.Dos — the script may need time to initialize
          const startTime = Date.now();
          const poll = window.setInterval(() => {
            if (cancelled) {
              window.clearInterval(poll);
              return;
            }
            if (window.Dos) {
              window.clearInterval(poll);
              resolve(true);
            } else if (Date.now() - startTime > DOS_POLL_TIMEOUT_MS) {
              window.clearInterval(poll);
              resolve(false);
            }
          }, DOS_POLL_INTERVAL_MS);
        };

        script.onerror = () => {
          window.clearTimeout(timeout);
          resolve(false);
        };

        document.head.appendChild(script);
      });
    };

    (async () => {
      // Try local first
      let success = await tryLoadScript(JS_DOS_SCRIPT, false);
      if (cancelled) return;

      if (success) {
        setScriptLoaded(true);
        setScriptSource("local");
        return;
      }

      // Try CDN
      success = await tryLoadScript(JS_DOS_CDN_SCRIPT, true);
      if (cancelled) return;

      if (success) {
        setScriptLoaded(true);
        setScriptSource("cdn");
      } else {
        setError("Failed to load js-dos engine from both local and CDN sources. Check your browser's content blocker or network connection.");
        setScriptSource("failed");
        setLoadState("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  /* Cleanup dos instance on unmount */
  useEffect(() => {
    return () => {
      if (dosInstanceRef.current) {
        dosInstanceRef.current.exit().catch(() => {});
        dosInstanceRef.current = null;
      }
    };
  }, []);

  /* 15-second initialization timeout */
  useEffect(() => {
    if (loadState !== "loading" && loadState !== "ready") return;
    if (initStartTime === null) return;

    const timer = window.setTimeout(() => {
      setLoadState((current) => {
        if (current === "loading" || current === "ready") {
          setElapsedMs(Date.now() - initStartTime);
          setError(
            `DOS emulator did not finish initializing within ${INIT_TIMEOUT_MS / 1000}s. ` +
              "The WASM runtime may be blocked by your browser or a content blocker. " +
              "Try again or upload a different .jsdos bundle.",
          );
          return "error";
        }
        return current;
      });
    }, INIT_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [loadState, initStartTime]);

  /* Track elapsed time while loading */
  useEffect(() => {
    if (loadState !== "loading" && loadState !== "ready") {
      if (initStartTime !== null) {
        setElapsedMs(Date.now() - initStartTime);
        setInitStartTime(null);
      }
      return;
    }
    const interval = window.setInterval(() => {
      if (initStartTime !== null) {
        setElapsedMs(Date.now() - initStartTime);
      }
    }, 500);
    return () => window.clearInterval(interval);
  }, [loadState, initStartTime]);

  const startEmulator = useCallback(async (url: string) => {
    if (!window.Dos || !dosRootRef.current) {
      setError("js-dos engine not ready — script is still loading or was blocked");
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    setError(null);
    setActiveBundleUrl(url);
    setInitStartTime(Date.now());
    setElapsedMs(null);

    // Clean up previous instance
    if (dosInstanceRef.current) {
      try {
        await dosInstanceRef.current.exit();
      } catch {
        // ignore
      }
      dosInstanceRef.current = null;
    }

    // Clear the container
    dosRootRef.current.innerHTML = "";

    try {
      const instance = window.Dos(dosRootRef.current, {
        url,
        onEvent: (event: string) => {
          if (event === "emu-ready") {
            setLoadState("running");
            setElapsedMs(Date.now() - (initStartTime ?? Date.now()));
            setInitStartTime(null);
          }
        },
      });
      dosInstanceRef.current = instance;
      setLoadState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start emulator");
      setLoadState("error");
      setInitStartTime(null);
    }
  }, [initStartTime]);

  const handleFileUpload = useCallback(
    async (file: File) => {
      // Create a blob URL for the uploaded .jsdos bundle
      const url = URL.createObjectURL(file);
      await startEmulator(url);
    },
    [startEmulator],
  );

  const handleUrlSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!urlInput.trim()) return;
      await startEmulator(urlInput.trim());
    },
    [urlInput, startEmulator],
  );

  const handleDemo = useCallback(() => {
    setUrlInput(DEMO_BUNDLE_URL);
    startEmulator(DEMO_BUNDLE_URL);
  }, [startEmulator]);

  const handleStop = useCallback(async () => {
    if (dosInstanceRef.current) {
      try {
        await dosInstanceRef.current.exit();
      } catch {
        // ignore
      }
      dosInstanceRef.current = null;
    }
    if (dosRootRef.current) dosRootRef.current.innerHTML = "";
    setLoadState("idle");
  }, []);

  const handleFullscreen = useCallback(() => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  }, []);

  return (
    <div
      ref={containerRef}
      className="relative w-full rounded-2xl border overflow-hidden"
      style={{
        backgroundColor: "#000",
        borderColor: `${T.borderColor}40`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b"
        style={{
          backgroundColor: `${T.boxBg}80`,
          borderColor: `${T.borderColor}30`,
        }}
      >
        <div className="flex items-center gap-2">
          <Monitor size={16} style={{ color: T.accentColor }} />
          <span
            className="text-xs font-black uppercase tracking-wider"
            style={{ color: T.headerColor }}
          >
            DOS Box Lab
          </span>
          {loadState === "running" && (
            <span
              className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full"
              style={{
                backgroundColor: "#22c55e20",
                color: "#22c55e",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e] animate-pulse" />
              LIVE
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {loadState === "running" && (
            <>
              <button
                onClick={handleFullscreen}
                className="p-1.5 rounded-lg hover:opacity-80 transition-opacity"
                style={{ color: T.textMuted }}
                title="Fullscreen"
              >
                <Maximize2 size={14} />
              </button>
              <button
                onClick={handleStop}
                className="p-1.5 rounded-lg hover:opacity-80 transition-opacity"
                style={{ color: "#ef4444" }}
                title="Stop & Reset"
              >
                <RotateCcw size={14} />
              </button>
            </>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:opacity-80 transition-opacity"
              style={{ color: T.textMuted }}
              title="Close"
            >
              <X size={14} />
            </button>
          )}
          <button
            onClick={() => setShowDiagnostic((v) => !v)}
            className="p-1.5 rounded-lg hover:opacity-80 transition-opacity"
            style={{ color: T.textMuted }}
            title="Diagnostics"
          >
            <Gamepad2 size={14} />
          </button>
        </div>
      </div>

      {/* Diagnostic panel */}
      {showDiagnostic && (
        <div
          className="px-4 py-3 border-b text-[10px] font-mono space-y-1"
          style={{
            backgroundColor: "#0a0a0a",
            borderColor: `${T.borderColor}30`,
            color: "#888",
          }}
        >
          <div style={{ color: "#aaa", fontWeight: "bold" }}>DIAGNOSTICS</div>
          <div>bundle: {activeBundleUrl ?? "—"}</div>
          <div>script: {scriptSource} (loaded: {String(scriptLoaded)})</div>
          <div>wasm: {typeof WebAssembly !== "undefined" ? "supported" : "NOT supported"}</div>
          <div>state: {loadState}</div>
          <div>elapsed: {elapsedMs !== null ? `${elapsedMs}ms` : "—"}</div>
          <div style={{ color: error ? "#ef4444" : "#888" }}>error: {error ?? "none"}</div>
        </div>
      )}

      {/* Body */}
      {loadState === "idle" && (
        <div
          className="p-6 sm:p-8 space-y-6"
          style={{ backgroundColor: `${T.bgColor}40` }}
        >
          <div className="text-center space-y-2">
            <div className="text-4xl">🕹️</div>
            <h3 className="text-lg font-black" style={{ color: T.headerColor }}>
              DOS Box Lab
            </h3>
            <p
              className="text-xs max-w-md mx-auto"
              style={{ color: T.textMuted }}
            >
              Run classic DOS games and apps right in your browser. Upload a{" "}
              <code className="font-mono">.jsdos</code> bundle or paste a URL to
              get started.
            </p>
          </div>

          {/* Upload zone */}
          <div className="max-w-md mx-auto">
            <label
              className="flex flex-col items-center justify-center gap-2 p-6 rounded-xl border-2 border-dashed cursor-pointer transition-all hover:opacity-80"
              style={{
                borderColor: `${T.accentColor}40`,
                backgroundColor: `${T.accentColor}08`,
              }}
            >
              <Upload size={24} style={{ color: T.accentColor }} />
              <span
                className="text-sm font-bold"
                style={{ color: T.textColor }}
              >
                Upload .jsdos bundle
              </span>
              <span className="text-[10px]" style={{ color: T.textMuted }}>
                Click to browse — .jsdos, .zip, or .exe files
              </span>
              <input
                type="file"
                accept=".jsdos,.zip,.exe"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileUpload(file);
                }}
              />
            </label>
          </div>

          {/* URL input */}
          <form
            onSubmit={handleUrlSubmit}
            className="max-w-md mx-auto flex gap-2"
          >
            <div
              className="flex-1 flex items-center gap-2 px-3 rounded-xl border"
              style={{
                backgroundColor: `${T.boxBg}80`,
                borderColor: `${T.borderColor}40`,
              }}
            >
              <Link2 size={14} style={{ color: T.textMuted }} />
              <input
                type="url"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="https://example.com/game.jsdos"
                className="flex-1 bg-transparent py-2 text-sm outline-none"
                style={{ color: T.textColor }}
              />
            </div>
            <button
              type="submit"
              disabled={!scriptLoaded || !urlInput.trim()}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-bold transition-all hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: T.accentColor, color: T.bgColor }}
            >
              <Play size={14} /> Run
            </button>
          </form>

          {/* Demo button */}
          <div className="max-w-md mx-auto text-center">
            {!scriptLoaded && scriptSource !== "failed" && (
              <div className="mb-3 flex items-center justify-center gap-2 text-[11px]" style={{ color: T.textMuted }}>
                <Loader2 size={12} className="animate-spin" />
                Loading DOS engine...
              </div>
            )}
            <button
              onClick={handleDemo}
              disabled={!scriptLoaded}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border transition-all hover:opacity-80 disabled:opacity-40"
              style={{
                borderColor: `${T.borderColor}40`,
                color: T.textMuted,
              }}
            >
              <Gamepad2 size={12} /> Try Demo Bundle
            </button>
          </div>

          {!scriptLoaded && (
            <div className="text-center">
              <Loader2
                size={16}
                className="animate-spin inline"
                style={{ color: T.textMuted }}
              />
              <span className="text-[10px] ml-2" style={{ color: T.textMuted }}>
                Loading js-dos engine...
              </span>
            </div>
          )}

          {/* Info */}
          <div
            className="max-w-md mx-auto rounded-xl border p-3 text-[10px]"
            style={{
              borderColor: `${T.borderColor}30`,
              backgroundColor: `${T.boxBg}40`,
              color: T.textMuted,
            }}
          >
            <p className="font-bold mb-1" style={{ color: T.textColor }}>
              How to get .jsdos bundles:
            </p>
            <ul className="space-y-0.5 opacity-80">
              <li>
                • Create bundles at{" "}
                <a
                  href="https://dos.zone"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                  style={{ color: T.linkColor }}
                >
                  dos.zone
                </a>
              </li>
              <li>• Upload .exe files — js-dos will auto-wrap them</li>
              <li>• Use .zip archives containing DOS programs</li>
              <li>• Only run software you legally own</li>
            </ul>
          </div>
        </div>
      )}

      {/* Error state */}
      {loadState === "error" && (
        <div className="flex items-center justify-center h-64 p-6">
          <div className="text-center space-y-3 max-w-sm">
            <div className="text-3xl">⚠️</div>
            <p className="text-sm font-bold" style={{ color: "#ef4444" }}>
              {error || "Something went wrong"}
            </p>
            {elapsedMs !== null && (
              <p className="text-[10px]" style={{ color: T.textMuted }}>
                Failed after {elapsedMs}ms
              </p>
            )}
            <div className="flex items-center justify-center gap-2">
              {activeBundleUrl && (
                <button
                  onClick={() => startEmulator(activeBundleUrl)}
                  className="px-4 py-2 rounded-xl text-xs font-bold border"
                  style={{
                    borderColor: `${T.borderColor}40`,
                    color: T.textColor,
                  }}
                >
                  Retry
                </button>
              )}
              <button
                onClick={() => {
                  setLoadState("idle");
                  setError(null);
                  setActiveBundleUrl(null);
                }}
                className="px-4 py-2 rounded-xl text-xs font-bold border"
                style={{
                  borderColor: `${T.borderColor}40`,
                  color: T.textColor,
                }}
              >
                Back
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Emulator container — in DOM during loading/ready/running so js-dos can attach */}
      {(loadState === "loading" || loadState === "ready" || loadState === "running") && (
        <div className="relative w-full" style={{ aspectRatio: "4/3" }}>
          <div ref={dosRootRef} className="absolute inset-0 w-full h-full" />
          {loadState !== "running" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/80">
              <Loader2
                size={24}
                className="animate-spin"
                style={{ color: T.accentColor }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
