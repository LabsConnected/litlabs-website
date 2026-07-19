"use client";

import { useMemo, useState } from "react";
import { Menu, MoreHorizontal, Plus, Search, Trash2, X } from "lucide-react";
import type { BuilderSession } from "../hooks/useBuilderSessions";

type Props = {
  sessions: BuilderSession[];
  activeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onPin: (id: string) => void;
  onDuplicate: (session: BuilderSession) => void;
  onDelete: (id: string) => void;
  onDeleteAll: () => void;
};

function exportSession(session: BuilderSession) {
  const blob = new Blob([JSON.stringify(session, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${session.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "chat"}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function SessionSidebar(props: Props) {
  const [query, setQuery] = useState("");
  const [menuId, setMenuId] = useState<string | null>(null);
  const filtered = useMemo(() => props.sessions.filter((session) => session.title.toLowerCase().includes(query.toLowerCase())).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt.localeCompare(a.updatedAt)), [props.sessions, query]);
  const today = new Date().toDateString();
  const groups = [
    { label: "Today", items: filtered.filter((session) => new Date(session.updatedAt).toDateString() === today) },
    { label: "Previous", items: filtered.filter((session) => new Date(session.updatedAt).toDateString() !== today) },
  ];

  return (
    <>
      {!props.open && <button onClick={() => props.onOpenChange(true)} className="absolute left-2 top-[72px] z-30 grid h-9 w-9 place-items-center rounded-xl border border-white/10 bg-[#101018]/95 text-white/60 shadow-xl hover:text-white" aria-label="Open sessions"><Menu size={16} /></button>}
      {props.open && <button className="fixed inset-0 z-40 bg-black/55 md:hidden" onClick={() => props.onOpenChange(false)} aria-label="Close sessions" />}
      <aside className={`${props.open ? "translate-x-0" : "-translate-x-full"} fixed inset-y-0 left-0 z-50 flex w-[min(310px,88vw)] flex-col border-r border-white/10 bg-[#090910]/98 shadow-2xl transition-transform md:relative md:inset-auto md:z-20 md:w-64 md:shrink-0 md:shadow-none`}>
        <div className="flex items-center justify-between border-b border-white/8 px-3 py-3"><strong className="text-xs text-white">Chat sessions</strong><button onClick={() => props.onOpenChange(false)} className="rounded-lg p-1.5 text-white/40 hover:bg-white/8 hover:text-white"><X size={15} /></button></div>
        <div className="space-y-2 p-3">
          <button onClick={props.onNew} className="flex w-full items-center justify-center gap-2 rounded-xl bg-violet-500 py-2.5 text-xs font-black text-white"><Plus size={14} />New chat</button>
          <label className="flex items-center gap-2 rounded-xl border border-white/8 bg-white/[.035] px-3 py-2"><Search size={13} className="text-white/30" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" className="min-w-0 flex-1 bg-transparent text-xs text-white outline-none placeholder:text-white/25" /></label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {groups.map((group) => group.items.length > 0 && <section key={group.label} className="mt-3"><div className="px-2 text-[9px] font-black uppercase tracking-[.18em] text-white/25">{group.label}</div><div className="mt-1 space-y-1">{group.items.map((session) => <div key={session.id} className="group relative"><button onClick={() => { props.onSelect(session.id); if (window.innerWidth < 768) props.onOpenChange(false); }} className={`flex w-full items-center gap-2 rounded-xl px-3 py-2.5 pr-9 text-left text-xs transition ${props.activeId === session.id ? "bg-violet-400/12 text-violet-100" : "text-white/55 hover:bg-white/5 hover:text-white"}`}><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${session.pinned ? "bg-amber-300" : "bg-white/20"}`} /><span className="min-w-0 flex-1 truncate">{session.title}</span></button><button onClick={() => setMenuId(menuId === session.id ? null : session.id)} className="absolute right-2 top-2 rounded-lg p-1.5 text-white/25 opacity-60 hover:bg-white/8 hover:text-white md:opacity-0 md:group-hover:opacity-100"><MoreHorizontal size={13} /></button>{menuId === session.id && <div className="absolute right-2 top-9 z-30 w-36 rounded-xl border border-white/10 bg-[#171721] p-1 shadow-2xl">{[
            { label: "Rename", action: () => { const title = window.prompt("Rename session", session.title); if (title) props.onRename(session.id, title); } },
            { label: session.pinned ? "Unpin" : "Pin", action: () => props.onPin(session.id) },
            { label: "Duplicate", action: () => props.onDuplicate(session) },
            { label: "Export", action: () => exportSession(session) },
            { label: "Delete", action: () => { if (window.confirm(`Delete “${session.title}”?`)) props.onDelete(session.id); }, danger: true },
          ].map((item) => <button key={item.label} onClick={() => { item.action(); setMenuId(null); }} className={`block w-full rounded-lg px-2 py-1.5 text-left text-[10px] hover:bg-white/8 ${item.danger ? "text-rose-300" : "text-white/65"}`}>{item.label}</button>)}</div>}</div>)}</div></section>)}
        </div>
        <div className="border-t border-white/8 p-3"><div className="flex items-center justify-between text-[9px] text-white/25"><span>{props.sessions.length} session{props.sessions.length === 1 ? "" : "s"}</span><button onClick={() => { if (window.confirm("Delete all chat sessions? This cannot be undone.")) props.onDeleteAll(); }} className="flex items-center gap-1 text-rose-300/60 hover:text-rose-300"><Trash2 size={10} />Delete all</button></div></div>
      </aside>
    </>
  );
}
