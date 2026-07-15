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

// A free demo bundle from dos.zone — a simple DOS prompt
const DEMO_BUNDLE_URL = "https://cdn.dos.zone/original/2x/3007/game.jsdos";

type LoadState = "idle" | "loading" | "ready" | "running" | "error";

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

  /* Load the js-dos script + CSS once, with CDN fallback */
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.Dos) {
      // Defer setState to avoid cascading renders
      const id = setTimeout(() => setScriptLoaded(true), 0);
      return () => clearTimeout(id);
    }

    let css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = JS_DOS_CSS;
    document.head.appendChild(css);

    let script = document.createElement("script");
    script.src = JS_DOS_SCRIPT;
    script.async = true;

    const loadFromCdn = () => {
      // Local bundle didn't expose Dos; try CDN
      css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = JS_DOS_CDN_CSS;
      document.head.appendChild(css);

      script = document.createElement("script");
      script.src = JS_DOS_CDN_SCRIPT;
      script.async = true;
      script.crossOrigin = "anonymous";
      script.onload = () => {
        if (window.Dos) setScriptLoaded(true);
        else {
          setError("js-dos engine unavailable");
          setLoadState("error");
        }
      };
      script.onerror = () => {
        setError("Failed to load js-dos engine from CDN");
        setLoadState("error");
      };
      document.head.appendChild(script);
    };

    script.onload = () => {
      // Give the bundle a moment to register window.Dos
      setTimeout(() => {
        if (window.Dos) {
          setScriptLoaded(true);
        } else {
          loadFromCdn();
        }
      }, 500);
    };
    script.onerror = () => {
      loadFromCdn();
    };
    document.head.appendChild(script);

    return () => {
      // Don't remove — other instances may need it
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

  const startEmulator = useCallback(async (url: string) => {
    if (!window.Dos || !dosRootRef.current) {
      setError("js-dos engine not ready");
      setLoadState("error");
      return;
    }
    setLoadState("loading");
    setError(null);

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
          }
        },
      });
      dosInstanceRef.current = instance;
      setLoadState("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start emulator");
      setLoadState("error");
    }
  }, []);

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
        </div>
      </div>

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
                id="dos-file"
                name="dosFile"
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
                id="dos-url"
                name="dosUrl"
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

      {/* Loading state */}
      {loadState === "loading" && (
        <div className="flex items-center justify-center h-64">
          <div className="text-center space-y-3">
            <Loader2
              size={32}
              className="animate-spin mx-auto"
              style={{ color: T.accentColor }}
            />
            <p className="text-sm font-bold" style={{ color: T.textColor }}>
              Starting DOS emulator...
            </p>
            <p className="text-[10px]" style={{ color: T.textMuted }}>
              Loading WASM runtime & bundle
            </p>
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
            <button
              onClick={() => {
                setLoadState("idle");
                setError(null);
              }}
              className="px-4 py-2 rounded-xl text-xs font-bold border"
              style={{
                borderColor: `${T.borderColor}40`,
                color: T.textColor,
              }}
            >
              Try Again
            </button>
          </div>
        </div>
      )}

      {/* Emulator container — always in DOM when ready/running */}
      {(loadState === "ready" || loadState === "running") && (
        <div className="relative w-full" style={{ aspectRatio: "4/3" }}>
          <div ref={dosRootRef} className="absolute inset-0 w-full h-full" />
          {loadState === "ready" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/60">
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
