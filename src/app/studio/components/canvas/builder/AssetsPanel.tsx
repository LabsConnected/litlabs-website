"use client";

/**
 * AssetsPanel — shows user's media assets (images, videos) that can
 * be dragged onto the canvas. Currently a placeholder that will
 * connect to the gallery/assets system.
 */

import { Image as ImageIcon, Video, Music, FolderOpen } from "lucide-react";

export function AssetsPanel() {
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-4">
      <FolderOpen size={28} style={{ color: "var(--text-muted)", opacity: 0.4 }} />
      <div className="text-[10px] font-black uppercase tracking-[0.1em]" style={{ color: "var(--text-muted)" }}>
        Assets
      </div>
      <p className="text-center text-[11px]" style={{ color: "var(--text-muted)" }}>
        Your generated images, videos, and music will appear here. Drag them onto the canvas to use them.
      </p>
      <div className="flex gap-2 mt-2">
        <div className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--glass-border)" }}>
          <ImageIcon size={12} style={{ color: "var(--glass-purple)" }} />
          <span className="text-[10px] font-bold" style={{ color: "var(--glass-text-3)" }}>Images</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--glass-border)" }}>
          <Video size={12} style={{ color: "var(--glass-purple)" }} />
          <span className="text-[10px] font-bold" style={{ color: "var(--glass-text-3)" }}>Videos</span>
        </div>
        <div className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5" style={{ borderColor: "var(--glass-border)" }}>
          <Music size={12} style={{ color: "var(--glass-purple)" }} />
          <span className="text-[10px] font-bold" style={{ color: "var(--glass-text-3)" }}>Music</span>
        </div>
      </div>
    </div>
  );
}
