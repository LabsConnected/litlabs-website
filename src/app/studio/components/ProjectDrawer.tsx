"use client";

import Link from "next/link";

export default function ProjectDrawer({ open, onClose, activeProjectId, onSelect }: { open: boolean; onClose: () => void; activeProjectId: string | null; onSelect: (projectId: string) => void }) {
  if (!open) return null;
  return <div className="absolute inset-0 z-80 bg-black/60" onClick={onClose}><aside className="h-full w-[min(360px,88vw)] border-r border-white/10 bg-[#09090f] p-4" onClick={(e) => e.stopPropagation()}><div className="flex items-center justify-between"><h2 className="text-sm font-black text-white">Projects</h2><button onClick={onClose} className="text-white/60">✕</button></div>{activeProjectId ? <button onClick={() => onSelect(activeProjectId)} className="mt-4 w-full rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-3 text-left text-xs text-cyan-200">Current project · {activeProjectId}</button> : <p className="mt-4 text-xs text-white/50">Choose a project to continue building.</p>}<Link href="/projects" className="mt-4 inline-flex text-xs font-bold text-cyan-300">Browse all projects →</Link></aside></div>;
}
