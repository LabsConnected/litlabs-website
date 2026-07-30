"use client";

import { useState } from "react";

export default function ImageGenPopover({ open, onClose, initialPrompt = "", onInsert }: { open: boolean; onClose: () => void; initialPrompt?: string; onInsert: (url: string, name: string) => void }) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const generate = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/media/image", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt }) });
      const data = await response.json();
      const url = data.url || data.imageUrl;
      if (url) { onInsert(url, `generated-${Date.now()}.png`); onClose(); }
    } finally { setBusy(false); }
  };
  return <div className="absolute inset-0 z-80 grid place-items-center bg-black/70 p-4"><div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#09090f] p-4"><h2 className="text-sm font-black text-white">Generate image</h2><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} className="mt-3 min-h-24 w-full rounded-xl border border-white/10 bg-white/5 p-3 text-sm text-white" /><div className="mt-3 flex justify-end gap-2"><button onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-white/60">Cancel</button><button onClick={() => void generate()} disabled={!prompt.trim() || busy} className="rounded-lg bg-cyan-500/15 px-3 py-2 text-xs font-bold text-cyan-300 disabled:opacity-40">{busy ? "Generating…" : "Generate"}</button></div></div></div>;
}
