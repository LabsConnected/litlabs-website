"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import CommandStudio from "@/app/studio/components/CommandStudio";
import { Lock, Sparkles, Terminal, ExternalLink } from "lucide-react";

function StudioPreviewHub() {
  const { tokens } = useTheme();
  const [isEmbedded, setIsEmbedded] = useState(false);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    // Detect if we're in an embedded preview (iframe) or preview mode
    const embedded =
      window.self !== window.top ||
      new URL(window.location.href).searchParams.has("embed");
    setIsEmbedded(embedded);
    setIsLoaded(true);
  }, []);

  if (!isLoaded) {
    return (
      <div
        className="relative flex min-h-screen items-center justify-center overflow-hidden p-6"
        style={{ backgroundColor: tokens.background }}
      >
        <div className="pointer-events-none absolute inset-0">
          <div
            className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px] opacity-20"
            style={{ backgroundColor: tokens.primary }}
          />
        </div>
        <div className="relative flex flex-col items-center gap-4">
          <div className="relative">
            <div
              className="absolute inset-0 animate-ping rounded-full opacity-20"
              style={{ backgroundColor: tokens.primary }}
            />
            <div
              className="relative flex h-12 w-12 items-center justify-center rounded-full"
              style={{
                backgroundColor: `${tokens.primary}15`,
                border: `1px solid ${tokens.primary}30`,
              }}
            >
              <Terminal size={20} style={{ color: tokens.primary }} />
            </div>
          </div>
          <div className="text-center">
            <div
              className="text-xs font-black uppercase tracking-widest"
              style={{ color: tokens.textMuted }}
            >
              Initializing Preview
            </div>
            <div className="mt-1 flex items-center justify-center gap-1">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-1 w-1 rounded-full animate-pulse"
                  style={{
                    backgroundColor: tokens.primary,
                    animationDelay: `${i * 150}ms`,
                  }}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Public preview mode (no auth required for visual inspection)
  return (
    <div className="relative h-screen flex flex-col overflow-hidden">
      {isEmbedded && (
        <div
          className="flex items-center justify-between border-b px-4 py-2.5 text-xs"
          style={{
            backgroundColor: tokens.surface,
            borderColor: tokens.border,
          }}
        >
          <div className="flex items-center gap-2" style={{ color: tokens.textMuted }}>
            <Lock size={14} />
            <span>Preview Mode • Clerk disabled in embedded view</span>
          </div>
          <a
            href="/studio"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 rounded px-3 py-1.5 transition hover:bg-white/10"
            style={{ color: tokens.primary }}
            title="Open fully authenticated Studio in new window"
          >
            <span>Open Authenticated</span>
            <ExternalLink size={12} />
          </a>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        <Suspense
          fallback={
            <div
              className="relative flex h-full items-center justify-center overflow-hidden p-6"
              style={{ backgroundColor: tokens.background }}
            >
              <div className="pointer-events-none absolute inset-0">
                <div
                  className="absolute left-1/2 top-1/2 h-64 w-64 -translate-x-1/2 -translate-y-1/2 rounded-full blur-[80px] opacity-20"
                  style={{ backgroundColor: tokens.primary }}
                />
              </div>
              <div className="relative flex flex-col items-center gap-4">
                <div className="relative">
                  <div
                    className="absolute inset-0 animate-ping rounded-full opacity-20"
                    style={{ backgroundColor: tokens.primary }}
                  />
                  <div
                    className="relative flex h-12 w-12 items-center justify-center rounded-full"
                    style={{
                      backgroundColor: `${tokens.primary}15`,
                      border: `1px solid ${tokens.primary}30`,
                    }}
                  >
                    <Terminal size={20} style={{ color: tokens.primary }} />
                  </div>
                </div>
                <div className="text-center">
                  <div
                    className="text-xs font-black uppercase tracking-widest"
                    style={{ color: tokens.textMuted }}
                  >
                    Loading Studio
                  </div>
                </div>
              </div>
            </div>
          }
        >
          <CommandStudio previewMode={true} />
        </Suspense>
      </div>
    </div>
  );
}

export default StudioPreviewHub;
