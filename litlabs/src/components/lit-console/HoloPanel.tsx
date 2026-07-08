"use client";

import { useEffect, useState } from "react";
import { useLitConsoleTheme } from "./useLitConsoleTheme";
import { X, Maximize2, Minimize2, ExternalLink } from "lucide-react";

type HoloPanelProps = {
  onClose: () => void;
  url: string;
  title?: string;
};

export default function HoloPanel({ onClose, url, title = "Holo View" }: HoloPanelProps) {
  const LC = useLitConsoleTheme();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return () => setMounted(false);
  }, []);

  const isExternal = url.startsWith("http://") || url.startsWith("https://");

  return (
    <div
      className={`fixed inset-0 z-50 flex flex-col transition-opacity duration-300 ${
        mounted ? "opacity-100" : "opacity-0"
      }`}
      style={{ backgroundColor: `${LC.bg}f0`, backdropFilter: "blur(32px)" }}
    >
      {/* Scanline effect */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.03]"
        style={{
          background: `repeating-linear-gradient(
            0deg,
            transparent,
            transparent 2px,
            ${LC.accentCyan}10 2px,
            transparent 4px
          )`,
          backgroundSize: "100% 8px",
          animation: "scanline 8s linear infinite",
        }}
      />

      {/* Holographic glow border */}
      <div
        className="absolute inset-0 pointer-events-none rounded-2xl"
        style={{
          boxShadow: `inset 0 0 60px ${LC.accentCyan}15, 0 0 120px ${LC.accentCyan}08`,
          border: `1px solid ${LC.accentCyan}30`,
          margin: "8px",
          borderRadius: "16px",
        }}
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 shrink-0">
        <div className="flex items-center gap-2">
          <div
            className="w-2 h-2 rounded-full animate-pulse"
            style={{
              backgroundColor: LC.accentCyan,
              boxShadow: `0 0 12px ${LC.accentCyan}`,
            }}
          />
          <span className="text-xs font-black uppercase tracking-[0.2em]" style={{ color: LC.accentCyan }}>
            HOLO
          </span>
          <span className="text-sm font-bold" style={{ color: LC.text }}>
            {title}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {isExternal && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded-full p-2 transition hover:bg-white/10"
              style={{ color: LC.textMuted }}
              title="Open in new tab"
            >
              <ExternalLink size={16} />
            </a>
          )}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="rounded-full p-2 transition hover:bg-white/10"
            style={{ color: LC.textMuted }}
            title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
          >
            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
          </button>
          <button
            onClick={onClose}
            className="rounded-full p-2 transition hover:bg-white/10"
            style={{ color: LC.textMuted }}
            title="Close holo"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Content */}
      <div
        className={`flex-1 mx-4 mb-4 rounded-xl overflow-hidden border transition-all duration-300 ${
          mounted ? "opacity-100 scale-100" : "opacity-0 scale-95"
        }`}
        style={{
          backgroundColor: `${LC.bgPanel}90`,
          borderColor: `${LC.accentCyan}20`,
          boxShadow: `0 0 40px ${LC.accentCyan}10`,
        }}
      >
        {isExternal ? (
          <iframe
            src={url}
            className="w-full h-full border-0"
            style={{ backgroundColor: "#fff" }}
            title={title}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center p-8 text-center" style={{ color: LC.textMuted }}>
            <p>Internal content view</p>
            <p className="text-xs mt-2 opacity-50">{url}</p>
          </div>
        )}
      </div>
    </div>
  );
}
