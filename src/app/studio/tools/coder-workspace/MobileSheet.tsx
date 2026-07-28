/**
 * MobileSheet — bottom sheet for work tabs on mobile/tablet (<1024px).
 *
 * Triggered by a floating "▲ Work" button. Provides Files | Code | Preview |
 * Canvas | Terminal tabs. Mobile panes show truthful states — full file/code/
 * preview access is desktop-only until Phase 2+ enriches them.
 */

import { useState } from "react";
import { EmptyState } from "./StateViews";

interface ThemeColors {
  borderColor: string;
}

type MobileSheetTab = "files" | "code" | "preview" | "canvas" | "terminal";

export function MobileSheet({
  projectId,
  T,
}: {
  projectId: string;
  T: ThemeColors;
}) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<MobileSheetTab>("files");
  const tabs: { id: MobileSheetTab; label: string }[] = [
    { id: "files", label: "Files" },
    { id: "code", label: "Code" },
    { id: "preview", label: "Preview" },
    { id: "canvas", label: "Canvas" },
    { id: "terminal", label: "Terminal" },
  ];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-16 left-3 z-40 rounded-full border border-white/10 bg-black/80 px-3 py-1.5 text-[10px] font-bold text-white/70 backdrop-blur-xl lg:hidden"
        aria-label="Open work sheet"
      >
        ▲ Work
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Close work sheet"
            className="fixed inset-0 z-40 bg-black/60 lg:hidden"
            onClick={() => setOpen(false)}
          />
          <div
            className="fixed bottom-0 left-0 right-0 z-50 flex h-[70dvh] flex-col rounded-t-2xl border-t lg:hidden"
            style={{
              backgroundColor: "rgba(8,9,13,0.97)",
              borderColor: `${T.borderColor}30`,
            }}
          >
            <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-white/20" />
            <div className="flex shrink-0 items-center justify-between px-3 py-1.5">
              <div className="flex gap-1">
                {tabs.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider ${
                      tab === t.id ? "bg-white/10 text-white" : "text-white/40"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-white/40 hover:text-white/70"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-auto p-2">
              {!projectId ? (
                <EmptyState
                  title="No project"
                  body="Select a project to view files, code, preview, canvas, and terminal."
                />
              ) : tab === "files" || tab === "code" || tab === "preview" ? (
                <EmptyState
                  title={
                    tab === "files" ? "Files" : tab === "code" ? "Code" : "Preview"
                  }
                  body="Use the desktop layout for full file/code/preview access. Mobile panes will be enriched in Phase 2+."
                />
              ) : tab === "canvas" ? (
                <EmptyState
                  title="Canvas"
                  body="Canvas artifacts from LiTT runs will appear here. No runs have been executed yet."
                />
              ) : (
                <EmptyState
                  title="Terminal"
                  body="Terminal execution arrives in Phase 3."
                />
              )}
            </div>
          </div>
        </>
      )}
    </>
  );
}
