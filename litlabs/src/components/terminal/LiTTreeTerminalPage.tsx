"use client";

import { useRef } from "react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { LiTTreeTerminal, LiTTreeTerminalHandle } from "./LiTTreeTerminal";
import { TERMINAL_THEME } from "./terminal-theme";

/**
 * Full-page wrapper for the unified LiTTree Terminal.
 * Auto-selects demo vs real mode based on auth state.
 */
export default function LiTTreeTerminalPage() {
  const { isSignedIn, isLoaded } = useClerkAuth();
  const termRef = useRef<LiTTreeTerminalHandle>(null);

  // Use real mode for authenticated users, demo for everyone else
  const mode = isLoaded && isSignedIn ? "real" : "demo";

  return (
    <main
      className="min-h-screen flex flex-col"
      style={{ backgroundColor: TERMINAL_THEME.ui.bg }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-4 py-2 border-b shrink-0"
        style={{
          backgroundColor: TERMINAL_THEME.ui.bgSecondary,
          borderColor: TERMINAL_THEME.ui.border,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black"
            style={{
              background: `linear-gradient(135deg, ${TERMINAL_THEME.ui.accent}, #ec4899)`,
              color: "#fff",
            }}
          >
            L
          </div>
          <div>
            <div
              className="text-[10px] font-black uppercase tracking-[0.25em]"
              style={{ color: TERMINAL_THEME.ui.accent }}
            >
              LiTTree LabStudios
            </div>
            <div
              className="text-sm font-bold -mt-0.5"
              style={{ color: TERMINAL_THEME.ui.text }}
            >
              Terminal
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 text-xs">
          <span
            className="font-mono px-2 py-1 rounded"
            style={{
              backgroundColor: TERMINAL_THEME.ui.bgTertiary,
              color: TERMINAL_THEME.ui.textMuted,
            }}
          >
            {mode === "real" ? "Shell Mode" : "Demo Mode"}
          </span>
        </div>
      </div>

      {/* Terminal fills remaining space */}
      <div className="flex-1 min-h-0">
        <LiTTreeTerminal
          ref={termRef}
          mode={mode}
          showAgentSidebar
          projectName="LiTTree LabStudios"
          className="h-full"
        />
      </div>
    </main>
  );
}
