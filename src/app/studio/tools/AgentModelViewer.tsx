"use client";

/**
 * AgentModelViewer — lazy-loaded 3D model viewer using <model-viewer>.
 *
 * Only loaded when user clicks "View 3D" on an agent card.
 * Falls back to poster image if no model URL is provided or if
 * WebGL/model loading fails.
 *
 * Uses @google/model-viewer web component.
 */

import { useEffect, useRef, useState, createElement } from "react";
import { X, RotateCcw, Loader2, Boxes } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";

// model-viewer is a web component — use a typed createElement call
// to avoid JSX namespace issues across React versions.
type ModelViewerAttrs = {
  src?: string;
  poster?: string;
  "auto-rotate"?: boolean;
  "camera-controls"?: boolean;
  "shadow-intensity"?: string;
  "environment-image"?: string;
  "camera-orbit"?: string;
  "min-camera-orbit"?: string;
  "max-camera-orbit"?: string;
  "auto-rotate-delay"?: string;
  "rotation-per-second"?: string;
  exposure?: string;
  "interaction-prompt"?: string;
  reveal?: string;
  loading?: string;
  style?: React.CSSProperties;
  ref?: React.Ref<HTMLElement>;
};

export function AgentModelViewer({
  posterUrl,
  modelUrl,
  agentName,
  agentColor,
  onClose,
}: {
  posterUrl?: string;
  modelUrl?: string;
  agentName: string;
  agentColor: string;
  onClose: () => void;
}) {
  const { resolvedColors: T } = useTheme();
  const viewerRef = useRef<HTMLElement>(null);
  const [loading, setLoading] = useState(!!modelUrl);
  const [error, setError] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);

  useEffect(() => {
    import("@google/model-viewer").catch(() => {});
    if (!modelUrl || !viewerRef.current) return;
    const viewer = viewerRef.current;

    const handleLoad = () => setLoading(false);
    const handleError = () => { setError(true); setLoading(false); };

    viewer.addEventListener("load", handleLoad);
    viewer.addEventListener("error", handleError);

    return () => {
      viewer.removeEventListener("load", handleLoad);
      viewer.removeEventListener("error", handleError);
    };
  }, [modelUrl]);

  const resetCamera = () => {
    if (viewerRef.current) {
      // model-viewer camera reset via JS API
      (viewerRef.current as unknown as { resetTurntableRotation?: () => void })?.resetTurntableRotation?.();
      // Reset orbit by re-assigning
      viewerRef.current.setAttribute("camera-orbit", "0deg 75deg 105%");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col" style={{ background: "rgba(0,0,0,0.92)" }}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 shrink-0">
        <div className="flex items-center gap-2">
          <Boxes size={18} style={{ color: agentColor }} />
          <span className="text-sm font-black" style={{ color: agentColor }}>{agentName}</span>
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: T.textMuted }}>3D Viewer</span>
        </div>
        <div className="flex items-center gap-2">
          {modelUrl && !error && (
            <>
              <button
                onClick={() => setAutoRotate((v) => !v)}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition hover:opacity-80"
                style={{ borderColor: `${agentColor}40`, color: autoRotate ? agentColor : T.textMuted, background: autoRotate ? `${agentColor}15` : "transparent" }}
              >
                <RotateCcw size={11} /> Auto-rotate
              </button>
              <button
                onClick={resetCamera}
                className="flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[10px] font-bold transition hover:opacity-80"
                style={{ borderColor: `${T.borderColor}30`, color: T.textMuted }}
              >
                <RotateCcw size={11} /> Reset View
              </button>
            </>
          )}
          <button
            onClick={onClose}
            className="grid h-9 w-9 place-items-center rounded-lg transition hover:bg-white/10"
            style={{ color: T.textMuted }}
            aria-label="Close 3D viewer"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* Viewer area */}
      <div className="relative flex-1">
        {modelUrl && !error ? (
          <>
            {loading && (
              <div className="absolute inset-0 z-10 flex flex-col items-center justify-center">
                <Loader2 size={32} className="animate-spin" style={{ color: agentColor }} />
                <p className="mt-3 text-[11px] font-bold" style={{ color: T.textMuted }}>Loading 3D model...</p>
              </div>
            )}
            {createElement("model-viewer", {
              ref: viewerRef,
              src: modelUrl,
              poster: posterUrl,
              "camera-controls": true,
              "auto-rotate": autoRotate,
              "auto-rotate-delay": "3000",
              "rotation-per-second": "30deg",
              "shadow-intensity": "1",
              exposure: "0.9",
              "camera-orbit": "0deg 75deg 105%",
              "min-camera-orbit": "0deg 40deg 60%",
              "max-camera-orbit": "360deg 120deg 180%",
              "interaction-prompt": "auto",
              loading: "eager",
              reveal: "auto",
              style: { width: "100%", height: "100%", backgroundColor: "transparent" },
            } as ModelViewerAttrs)}
          </>
        ) : (
          /* Fallback: show poster image only */
          <div className="flex h-full flex-col items-center justify-center">
            {posterUrl ? (
              /* eslint-disable-next-line @next/next/no-img-element -- fallback poster */
              <img
                src={posterUrl}
                alt={agentName}
                className="max-h-[70vh] max-w-full rounded-xl object-contain"
                style={{ filter: "drop-shadow(0 16px 48px rgba(0,0,0,0.5))" }}
              />
            ) : (
              <div className="text-center">
                <Boxes size={48} className="mx-auto mb-3 opacity-30" style={{ color: T.textMuted }} />
                <p className="text-sm font-bold" style={{ color: T.textMuted }}>No 3D model available</p>
                <p className="text-[11px] mt-1" style={{ color: T.textMuted }}>
                  {error ? "3D model failed to load." : `${agentName} doesn't have a 3D model yet.`}
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Footer hint */}
      <div className="shrink-0 px-5 py-3 text-center text-[10px]" style={{ color: T.textMuted }}>
        {modelUrl && !error && !loading
          ? "Drag to rotate · Scroll to zoom · Touch to orbit"
          : "Premium artwork shown — 3D model coming soon"}
      </div>
    </div>
  );
}

export default AgentModelViewer;
