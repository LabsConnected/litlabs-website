"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type BuilderMessage = { role: "user" | "assistant"; content: string; createdAt?: number };
export type BuilderSessionContext = {
  projectId: string | null;
  repositoryState: "none" | "connected" | "partial" | "read-only";
  selectedAgent: string;
  terminalSessionIds: string[];
  activeTerminalSessionId: string | null;
};
export type BuilderSession = {
  id: string;
  title: string;
  pinned: boolean;
  messages: BuilderMessage[];
  context: BuilderSessionContext;
  createdAt: string;
  updatedAt: string;
};

const STORAGE_KEY = "littree:builder:sessions:v1";
const ACTIVE_KEY = "littree:builder:active-session:v1";
const defaultContext = (): BuilderSessionContext => ({ projectId: null, repositoryState: "none", selectedAgent: "litt", terminalSessionIds: [], activeTerminalSessionId: null });
const makeSession = (title = "New chat"): BuilderSession => { const now = new Date().toISOString(); return { id: crypto.randomUUID(), title, pinned: false, messages: [], context: defaultContext(), createdAt: now, updatedAt: now }; };

function loadLocal(): BuilderSession[] {
  try { const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
}

export function useBuilderSessions() {
  const [sessions, setSessions] = useState<BuilderSession[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const hydrated = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const local = loadLocal();
    const initial = local.length ? local : [makeSession()];
    setSessions(initial);
    setActiveId(localStorage.getItem(ACTIVE_KEY) || initial[0].id);
    hydrated.current = true;
    fetch("/api/builder/sessions", { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((payload) => {
      if (!payload?.sessions?.length) return;
      const remote: BuilderSession[] = (payload.sessions as Record<string, unknown>[]).map((item): BuilderSession => ({
        id: String(item.id), title: String(item.title || "New chat"), pinned: item.pinned === true,
        messages: Array.isArray(item.messages) ? item.messages as BuilderMessage[] : [],
        context: { ...defaultContext(), ...(item.context as Partial<BuilderSessionContext> ?? {}) },
        createdAt: String(item.created_at), updatedAt: String(item.updated_at),
      }));
      setSessions(remote);
      setActiveId((current) => remote.some((session) => session.id === current) ? current : remote[0].id);
    }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!hydrated.current || !sessions.length) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    localStorage.setItem(ACTIVE_KEY, activeId);
    if (syncTimer.current) clearTimeout(syncTimer.current);
    const changed = sessions.find((session) => session.id === activeId);
    if (changed) syncTimer.current = setTimeout(() => { void fetch("/api/builder/sessions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changed) }); }, 900);
    return () => { if (syncTimer.current) clearTimeout(syncTimer.current); };
  }, [sessions, activeId]);

  const activeSession = useMemo(() => sessions.find((session) => session.id === activeId) ?? sessions[0], [sessions, activeId]);
  const update = useCallback((id: string, transform: (session: BuilderSession) => BuilderSession) => setSessions((current) => current.map((session) => session.id === id ? { ...transform(session), updatedAt: new Date().toISOString() } : session)), []);
  const create = useCallback((source?: BuilderSession) => { const session = makeSession(source ? `${source.title} copy` : "New chat"); if (source) { session.messages = source.messages.map((message) => ({ ...message })); session.context = { ...source.context, terminalSessionIds: [] , activeTerminalSessionId: null }; } setSessions((current) => [session, ...current]); setActiveId(session.id); return session.id; }, []);
  const remove = useCallback((id: string) => { setSessions((current) => { const remaining = current.filter((session) => session.id !== id); const next = remaining.length ? remaining : [makeSession()]; setActiveId((active) => active === id ? next[0].id : active); return next; }); void fetch(`/api/builder/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" }); }, []);
  const removeAll = useCallback(() => { const next = makeSession(); setSessions([next]); setActiveId(next.id); void fetch("/api/builder/sessions", { method: "DELETE" }); }, []);
  const setMessages = useCallback((value: BuilderMessage[] | ((current: BuilderMessage[]) => BuilderMessage[])) => { if (!activeId) return; update(activeId, (session) => ({ ...session, messages: typeof value === "function" ? value(session.messages) : value })); }, [activeId, update]);
  const rename = useCallback((id: string, title: string) => update(id, (session) => ({ ...session, title: title.trim().slice(0, 120) || session.title })), [update]);
  const togglePin = useCallback((id: string) => update(id, (session) => ({ ...session, pinned: !session.pinned })), [update]);
  const updateContext = useCallback((patch: Partial<BuilderSessionContext>) => { if (activeId) update(activeId, (session) => ({ ...session, context: { ...session.context, ...patch } })); }, [activeId, update]);

  return { sessions, activeSession, activeId, setActiveId, create, remove, removeAll, setMessages, rename, togglePin, updateContext };
}
