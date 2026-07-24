"use client";

import { RefreshCw, ExternalLink } from "lucide-react";

export default function PreviewPanel() {
  return (
    <div className="rounded-2xl border border-white/10 bg-black/30 p-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-[9px] font-black uppercase tracking-[0.2em] text-cyan-300">Preview</p>
        <button className="rounded-lg p-1 text-white/40 hover:bg-white/8 hover:text-white" aria-label="Refresh preview">
          <RefreshCw size={12} />
        </button>
      </div>
      <div className="grid h-32 place-items-center rounded-xl border border-dashed border-white/10 text-white/30">
        <div className="text-center">
          <ExternalLink size={20} className="mx-auto mb-1 opacity-40" />
          <p className="text-[10px]">No preview running</p>
        </div>
      </div>
    </div>
  );
}
