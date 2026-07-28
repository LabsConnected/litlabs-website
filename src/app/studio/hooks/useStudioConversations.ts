"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  type StudioConversation,
  type StudioMessage,
  type AgentId,
  type ProjectContext,
  createConversation,
  migrateSession,
  type LegacyBuilderSession,
} from "../types/conversation";

/**
 * useStudioConversations — the single source of truth for
 * conversations, messages, agent selection, and project context.
 *
 * Phase 2.1 — replaces:
 * - useBuilderSessions (session-scoped messages + context)
 * - useStudioAgentStore threads (global per-agent message arrays)
 *
 * Features:
 * - One conversation = one message list + one agent + one project context
 * - New chat creates a genuinely empty conversation
 * - Selecting history changes the visible transcript
 * - Rename updates the active conversation
 * - Delete removes the correct conversation
 * - Duplicate copies messages but clears terminal-session associations
 * - LiTT/Spark selection is stored with the conversation
 * - Switching agents preserves transcript, changes who handles next message
 * - Refresh restores the selected conversation
 * - Two tabs don't silently overwrite newer data (updatedAt conflict check)
 *
 * Persistence:
 * - localStorage for immediate offline fallback
 * - /api/builder/sessions for authenticated persistence
 * - Migration from legacy keys: littree:builder:sessions:v1
 */

const STORAGE_KEY = "littree:studio:conversations:v2";
const ACTIVE_KEY = "littree:studio:active-conversation:v2";
const MIGRATED_KEY = "littree:studio:migrated-v2";

// Legacy keys for migration
const LEGACY_SESSIONS_KEY = "littree:builder:sessions:v1";
const LEGACY_ACTIVE_KEY = "littree:builder:active-session:v1";

function loadLocal(): StudioConversation[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? (parsed as StudioConversation[]) : [];
  } catch {
    return [];
  }
}

function loadLegacySessions(): LegacyBuilderSession[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(LEGACY_SESSIONS_KEY) || "[]");
    return Array.isArray(parsed) ? (parsed as LegacyBuilderSession[]) : [];
  } catch {
    return [];
  }
}

function migrateLegacyData(): StudioConversation[] {
  const alreadyMigrated = localStorage.getItem(MIGRATED_KEY) === "1";
  if (alreadyMigrated) return [];

  const legacy = loadLegacySessions();
  if (legacy.length === 0) {
    localStorage.setItem(MIGRATED_KEY, "1");
    return [];
  }

  const migrated = legacy.map(migrateSession);
  localStorage.setItem(MIGRATED_KEY, "1");
  return migrated;
}

export function useStudioConversations() {
  const [conversations, setConversations] = useState<StudioConversation[]>([]);
  const [activeId, setActiveId] = useState<string>("");
  const hydrated = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Hydration: load local, migrate legacy, fetch remote ──────
  useEffect(() => {
    // 1. Migrate legacy data (one-time)
    const migrated = migrateLegacyData();

    // 2. Load v2 conversations
    const local = loadLocal();

    // 3. Combine: migrated + existing v2
    const initial = [...migrated, ...local];
    const final = initial.length ? initial : [createConversation()];

    setConversations(final);
    setActiveId(localStorage.getItem(ACTIVE_KEY) || final[0].id);
    hydrated.current = true;

    // 4. Fetch remote (authenticated users)
    fetch("/api/builder/sessions", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload) => {
        if (!payload?.sessions?.length) return;
        const remote: StudioConversation[] = (payload.sessions as Record<string, unknown>[]).map(
          (item): StudioConversation => {
            // Remote sessions may be in legacy format or v2
            const session = item as unknown as LegacyBuilderSession;
            if (session.context && session.context.selectedAgent) {
              return migrateSession(session);
            }
            // Already v2 format
            return item as unknown as StudioConversation;
          },
        );
        setConversations((current) => {
          // Merge: remote takes precedence for matching IDs (newer updatedAt)
          const byId = new Map<string, StudioConversation>();
          for (const c of current) byId.set(c.id, c);
          for (const r of remote) {
            const existing = byId.get(r.id);
            if (!existing || r.updatedAt > existing.updatedAt) {
              byId.set(r.id, r);
            }
          }
          return Array.from(byId.values());
        });
        setActiveId((current) =>
          remote.some((c) => c.id === current) ? current : remote[0].id,
        );
      })
      .catch(() => undefined);
  }, []);

  // ── Persistence: localStorage + debounced remote sync ────────
  useEffect(() => {
    if (!hydrated.current || !conversations.length) return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations));
    localStorage.setItem(ACTIVE_KEY, activeId);

    // Also clean up legacy keys after successful migration
    if (localStorage.getItem(MIGRATED_KEY) === "1") {
      localStorage.removeItem(LEGACY_SESSIONS_KEY);
      localStorage.removeItem(LEGACY_ACTIVE_KEY);
    }

    if (syncTimer.current) clearTimeout(syncTimer.current);
    const active = conversations.find((c) => c.id === activeId);
    if (active) {
      syncTimer.current = setTimeout(() => {
        void fetch("/api/builder/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: active.id,
            title: active.title,
            pinned: active.pinned,
            messages: active.messages.map((m) => ({
              role: m.role,
              content: m.content,
              createdAt: m.createdAt,
            })),
            context: {
              projectId: active.project.projectId,
              repositoryState: active.project.repositoryState,
              selectedAgent: active.selectedAgentId,
              terminalSessionIds: active.terminalSessionIds,
              activeTerminalSessionId: active.activeTerminalSessionId,
            },
            createdAt: active.createdAt,
            updatedAt: active.updatedAt,
          }),
        });
      }, 900);
    }
    return () => {
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, [conversations, activeId]);

  // ── Derived state ─────────────────────────────────────────────
  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeId) ?? conversations[0],
    [conversations, activeId],
  );

  const messages = useMemo(
    () => activeConversation?.messages ?? [],
    [activeConversation],
  );

  const selectedAgentId = useMemo(
    () => activeConversation?.selectedAgentId ?? "litt",
    [activeConversation],
  );

  // ── Mutations ─────────────────────────────────────────────────

  const update = useCallback(
    (id: string, transform: (c: StudioConversation) => StudioConversation) => {
      setConversations((current) =>
        current.map((c) =>
          c.id === id
            ? { ...transform(c), updatedAt: new Date().toISOString() }
            : c,
        ),
      );
    },
    [],
  );

  const create = useCallback(
    (source?: StudioConversation): string => {
      const conv = createConversation(source ? `${source.title} copy` : "New chat");
      if (source) {
        // Duplicate: copy messages but clear terminal associations
        conv.messages = source.messages.map((m) => ({ ...m, id: crypto.randomUUID() }));
        conv.project = { ...source.project };
        conv.selectedAgentId = source.selectedAgentId;
        conv.terminalSessionIds = [];
        conv.activeTerminalSessionId = null;
      }
      setConversations((current) => [conv, ...current]);
      setActiveId(conv.id);
      return conv.id;
    },
    [],
  );

  const remove = useCallback((id: string) => {
    setConversations((current) => {
      const remaining = current.filter((c) => c.id !== id);
      const next = remaining.length ? remaining : [createConversation()];
      setActiveId((active) => (active === id ? next[0].id : active));
      return next;
    });
    void fetch(`/api/builder/sessions?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  }, []);

  const removeAll = useCallback(() => {
    const next = createConversation();
    setConversations([next]);
    setActiveId(next.id);
    void fetch("/api/builder/sessions", { method: "DELETE" });
  }, []);

  const rename = useCallback(
    (id: string, title: string) =>
      update(id, (c) => ({ ...c, title: title.trim().slice(0, 120) || c.title })),
    [update],
  );

  const togglePin = useCallback(
    (id: string) => update(id, (c) => ({ ...c, pinned: !c.pinned })),
    [update],
  );

  const setMessages = useCallback(
    (value: StudioMessage[] | ((current: StudioMessage[]) => StudioMessage[])) => {
      if (!activeId) return;
      update(activeId, (c) => ({
        ...c,
        messages: typeof value === "function" ? value(c.messages) : value,
      }));
    },
    [activeId, update],
  );

  const setSelectedAgent = useCallback(
    (agentId: AgentId) => {
      if (!activeId) return;
      // Switching agents preserves transcript, changes who handles next message
      update(activeId, (c) => ({ ...c, selectedAgentId: agentId }));
    },
    [activeId, update],
  );

  const updateProject = useCallback(
    (patch: Partial<ProjectContext>) => {
      if (!activeId) return;
      update(activeId, (c) => ({ ...c, project: { ...c.project, ...patch } }));
    },
    [activeId, update],
  );

  const updateTerminalSessions = useCallback(
    (patch: { terminalSessionIds?: string[]; activeTerminalSessionId?: string | null }) => {
      if (!activeId) return;
      update(activeId, (c) => ({
        ...c,
        terminalSessionIds: patch.terminalSessionIds ?? c.terminalSessionIds,
        activeTerminalSessionId:
          patch.activeTerminalSessionId !== undefined
            ? patch.activeTerminalSessionId
            : c.activeTerminalSessionId,
      }));
    },
    [activeId, update],
  );

  // ── Cross-tab conflict prevention ─────────────────────────────
  useEffect(() => {
    const handler = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY && e.newValue) {
        try {
          const remote = JSON.parse(e.newValue) as StudioConversation[];
          if (!Array.isArray(remote)) return;
          setConversations((current) => {
            // Don't overwrite newer local data
            const byId = new Map<string, StudioConversation>();
            for (const c of current) byId.set(c.id, c);
            for (const r of remote) {
              const existing = byId.get(r.id);
              if (!existing || r.updatedAt > existing.updatedAt) {
                byId.set(r.id, r);
              }
            }
            return Array.from(byId.values());
          });
        } catch {
          // ignore parse errors
        }
      }
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, []);

  return {
    conversations,
    activeConversation,
    activeId,
    messages,
    selectedAgentId,
    setActiveId,
    create,
    remove,
    removeAll,
    rename,
    togglePin,
    setMessages,
    setSelectedAgent,
    updateProject,
    updateTerminalSessions,
  };
}

export type StudioConversationsApi = ReturnType<typeof useStudioConversations>;
