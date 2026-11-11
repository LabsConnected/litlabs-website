"use client";

/**
 * GlobalLittStudioPanel — Phase 2 persistent operator surface for Global LiTT.
 *
 * Send lanes (ART-20261111-025):
 * - VIEWED-PROJECT mode (viewedProjectId present — the overlay was opened
 *   inside a Studio project): messages run through the canonical Studio
 *   messages route (POST /api/studio/conversations/[id]/messages with
 *   projectId = the viewed project), so the run resolves exactly like a
 *   docked-chat run — canonical runtime context, workspace transport,
 *   native tools, ACT approval gates, persisted run/Activity records
 *   (#899's resolution applies verbatim; this panel builds no second
 *   resolver). The panel keeps a per-project canonical conversation
 *   (id + revision cached in localStorage); history is server-persisted.
 * - PLAIN mode (no viewed project): the legacy /api/gemini/chat lane with
 *   globalLittProjectId. That lane has no workspace, so file/execution
 *   asks decline honestly there — correct when the user isn't acting
 *   inside any project.
 *
 * A canonical refusal (409 with a code, e.g. PROJECT_MISMATCH) is surfaced
 * verbatim. The panel NEVER silently falls back to the tool-less lane
 * while a project is being viewed — that silent downgrade is the defect
 * this split fixes: previously every overlay send went to /api/gemini/chat
 * with a hard-coded "no tools" capability block, so the model declined
 * file requests in prose even with a Ready project on screen.
 *
 * Mobile: full-screen sheet at 390px with safe-area handling.
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { X, Send, Loader2 } from "lucide-react";
import { useGlobalLitt } from "@/components/global-litt/GlobalLittProvider";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { ApprovalCard } from "@/app/(app)/studio/components/ApprovalCard";
import { submitApprovalAndPoll } from "@/app/(app)/studio/lib/approval-polling";

/** A paused run attached to a canonical message row — the same payload
 *  the docked chat's rehydration consumes (tool, reason, frozen inputs). */
interface PanelPendingApproval {
  toolId: string;
  reason: string;
  pausedRunId: string;
  inputs?: Record<string, unknown>;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  pendingApproval?: PanelPendingApproval;
}

interface CanonicalMessageRow {
  role?: unknown;
  content?: unknown;
  status?: unknown;
  pendingApproval?: unknown;
}

const APPROVAL_NOTE =
  "\n\n(Waiting for approval — open this project's chat to approve or reject.)";

function parsePendingApproval(raw: unknown): PanelPendingApproval | null {
  if (typeof raw !== "object" || raw === null) return null;
  const gate = raw as Record<string, unknown>;
  if (typeof gate.pausedRunId !== "string" || !gate.pausedRunId) return null;
  if (typeof gate.toolId !== "string" || !gate.toolId) return null;
  return {
    toolId: gate.toolId,
    reason: typeof gate.reason === "string" ? gate.reason : "Approval required",
    pausedRunId: gate.pausedRunId,
    inputs:
      typeof gate.inputs === "object" && gate.inputs !== null && !Array.isArray(gate.inputs)
        ? (gate.inputs as Record<string, unknown>)
        : undefined,
  };
}

function toPanelMessages(rows: CanonicalMessageRow[]): Message[] {
  const out: Message[] = [];
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    if (typeof row.content !== "string") continue;
    // "failed" assistant rows are kept: their content is the run's
    // truthful failure report (e.g. a quality-gate verdict), and the
    // docked transcript renders them. Filtering them out here made a
    // failed run look like silence — the user saw their message and
    // then nothing at all.
    if (
      row.status !== "completed" &&
      row.status !== "awaiting_approval" &&
      !(row.role === "assistant" && row.status === "failed")
    ) {
      continue;
    }
    // Approve-in-chat (2026-11-11): when the row carries the paused run,
    // the panel renders the canonical ApprovalCard inline — actionable
    // HERE, in this chat. The go-elsewhere note remains only as the
    // fallback for a gate whose paused-run identity did not survive.
    const gate = row.status === "awaiting_approval" ? parsePendingApproval(row.pendingApproval) : null;
    out.push({
      role: row.role,
      content:
        row.status === "awaiting_approval" && !gate
          ? row.content + APPROVAL_NOTE
          : row.content,
      ...(gate ? { pendingApproval: gate } : {}),
    });
  }
  return out;
}

function generateClientRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export default function GlobalLittStudioPanel({
  onClose,
  viewedProjectId,
}: {
  onClose: () => void;
  /** The Studio project the user is viewing when the overlay opens. */
  viewedProjectId?: string | null;
}) {
  const { projectId, project } = useGlobalLitt();
  const { getToken } = useClerkAuth();
  const canonicalProjectId =
    typeof viewedProjectId === "string" && viewedProjectId
      ? viewedProjectId
      : null;

  const [messages, setMessages] = useState<Message[]>(() => {
    // Canonical mode: history is server-persisted and loaded on mount.
    if (canonicalProjectId) return [];
    // Restore conversation across navigation/reload (same browser).
    // Server-side cross-device history is a Phase 3 item.
    try {
      const raw = localStorage.getItem("global-litt-studio-messages");
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          return parsed.filter(
            (m): m is Message =>
              m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
          ).slice(-50);
        }
      }
    } catch {
      // Corrupt storage — start fresh
    }
    return [];
  });
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Persist conversation to localStorage so it survives navigation/reload.
  // Plain mode only — canonical-mode history lives server-side.
  useEffect(() => {
    if (canonicalProjectId) return;
    try {
      localStorage.setItem("global-litt-studio-messages", JSON.stringify(messages.slice(-50)));
    } catch {
      // Storage full or unavailable — conversation stays in memory only
    }
  }, [messages, canonicalProjectId]);

  // Focus input on open (desktop only — mobile keyboard would jump)
  useEffect(() => {
    if (window.innerWidth > 640) {
      inputRef.current?.focus();
    }
  }, []);

  // Escape to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // ── Canonical (viewed-project) lane ──────────────────────────────────
  // Same auth pattern as every other Studio surface: same-origin cookies
  // normally carry Clerk auth; an explicit bearer keeps calls working
  // across proxy/CDN boundaries.
  const authHeaders = useCallback(
    async (json = false): Promise<HeadersInit> => {
      const token = await getToken?.();
      return {
        ...(json ? { "Content-Type": "application/json" } : {}),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      };
    },
    [getToken],
  );

  const convRef = useRef<{ conversationId: string; revision: number } | null>(null);
  const ensurePromiseRef = useRef<Promise<{ conversationId: string; revision: number }> | null>(null);
  const cacheKey = canonicalProjectId
    ? `global-litt-overlay-conversation:${canonicalProjectId}`
    : null;

  /** Reload the canonical thread from the server (source of truth) and
   *  track the conversation revision. Returns the revision, or null when
   *  the conversation could not be loaded (e.g. it no longer exists). */
  const loadCanonicalMessages = useCallback(
    async (conversationId: string): Promise<number | null> => {
      const res = await fetch(`/api/studio/conversations/${conversationId}/messages`, {
        cache: "no-store",
        credentials: "include",
        headers: await authHeaders(),
      });
      if (!res.ok) return null;
      const data = (await res.json().catch(() => null)) as {
        messages?: CanonicalMessageRow[];
        revision?: number;
      } | null;
      if (!data) return null;
      setMessages(toPanelMessages(data.messages ?? []));
      const revision = typeof data.revision === "number" ? data.revision : null;
      if (revision !== null && convRef.current?.conversationId === conversationId) {
        convRef.current.revision = revision;
        if (cacheKey) {
          try {
            localStorage.setItem(cacheKey, JSON.stringify(convRef.current));
          } catch {
            // Cache is an optimization only
          }
        }
      }
      return revision;
    },
    [authHeaders, cacheKey],
  );

  /** Resolve the per-project canonical conversation for the overlay:
   *  the cached one when it still exists, otherwise create-or-reuse via
   *  the canonical conversations route (its empty-conversation hygiene
   *  applies). The conversation is bound to the viewed project, so the
   *  messages route resolves the run in that project at priority 1. */
  const ensureConversation = useCallback((): Promise<{
    conversationId: string;
    revision: number;
  }> => {
    if (!canonicalProjectId) {
      return Promise.reject(new Error("No viewed project"));
    }
    if (convRef.current) return Promise.resolve(convRef.current);
    if (ensurePromiseRef.current) return ensurePromiseRef.current;
    const promise = (async () => {
      if (cacheKey) {
        try {
          const raw = localStorage.getItem(cacheKey);
          if (raw) {
            const cached = JSON.parse(raw) as {
              conversationId?: unknown;
              revision?: unknown;
            };
            if (typeof cached.conversationId === "string") {
              convRef.current = {
                conversationId: cached.conversationId,
                revision: typeof cached.revision === "number" ? cached.revision : 1,
              };
              const revision = await loadCanonicalMessages(cached.conversationId);
              if (revision !== null) return convRef.current;
              convRef.current = null; // Stale id — fall through to create
            }
          }
        } catch {
          // Corrupt cache — create fresh below
        }
      }
      const res = await fetch("/api/studio/conversations", {
        method: "POST",
        credentials: "include",
        headers: await authHeaders(true),
        body: JSON.stringify({
          projectId: canonicalProjectId,
          activeAgentSlug: "litt",
        }),
      });
      if (!res.ok) {
        throw new Error(`Couldn't open this project's chat (${res.status}).`);
      }
      const data = (await res.json().catch(() => null)) as {
        conversation?: { id?: unknown; revision?: unknown };
      } | null;
      const conversationId =
        typeof data?.conversation?.id === "string" ? data.conversation.id : null;
      if (!conversationId) {
        throw new Error("Couldn't open this project's chat.");
      }
      const revision =
        typeof data?.conversation?.revision === "number"
          ? data.conversation.revision
          : 1;
      convRef.current = { conversationId, revision };
      if (cacheKey) {
        try {
          localStorage.setItem(cacheKey, JSON.stringify(convRef.current));
        } catch {
          // Cache is an optimization only
        }
      }
      return convRef.current;
    })();
    ensurePromiseRef.current = promise;
    // A failed resolution must not poison later attempts.
    promise.catch(() => {
      if (ensurePromiseRef.current === promise) ensurePromiseRef.current = null;
    });
    return promise;
  }, [canonicalProjectId, cacheKey, authHeaders, loadCanonicalMessages]);

  // Load the canonical thread when the panel opens in a project.
  useEffect(() => {
    if (!canonicalProjectId) return;
    let cancelled = false;
    void (async () => {
      try {
        await ensureConversation();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't open this project's chat.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canonicalProjectId, ensureConversation]);

  /** Send through the canonical messages route. Refusals are thrown with
   *  the server's own wording; a stale-revision 409 reloads and retries
   *  once (the same recovery the docked chat performs). */
  const sendCanonical = useCallback(
    async (text: string) => {
      const conv = await ensureConversation();
      const clientRequestId = generateClientRequestId();
      const postMessage = async (revision: number) =>
        fetch(`/api/studio/conversations/${conv.conversationId}/messages`, {
          method: "POST",
          credentials: "include",
          headers: await authHeaders(true),
          body: JSON.stringify({
            message: text,
            clientRequestId,
            expectedRevision: revision,
            requestedAgentSlug: "litt",
            // The viewed project — the server reconciles it against the
            // conversation's bound project (identical to the docked chat).
            projectId: canonicalProjectId,
          }),
        });

      let response = await postMessage(conv.revision);
      if (response.status === 409) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          detail?: string;
          code?: string;
        } | null;
        const isStaleRevision =
          !data?.code && (data?.error ?? "").toLowerCase().includes("revision");
        if (!isStaleRevision) {
          // A coded refusal (PROJECT_MISMATCH, PROJECT_NOT_AVAILABLE, …)
          // is a real rejection — surface it verbatim. The user message
          // was persisted before the gate, so reload to show the truth.
          await loadCanonicalMessages(conv.conversationId);
          throw new Error(
            data?.detail
              ? `${data?.error ?? "Request refused"}: ${data.detail}`
              : data?.error || "The request was refused (409).",
          );
        }
        const freshRevision = await loadCanonicalMessages(conv.conversationId);
        response = await postMessage(freshRevision ?? conv.revision);
        if (!response.ok) {
          const retryData = (await response.json().catch(() => null)) as {
            error?: string;
            detail?: string;
          } | null;
          await loadCanonicalMessages(conv.conversationId);
          throw new Error(
            retryData?.detail
              ? `${retryData?.error ?? "Request failed"}: ${retryData.detail}`
              : retryData?.error || `Request failed (${response.status})`,
          );
        }
      } else if (!response.ok) {
        const data = (await response.json().catch(() => null)) as {
          error?: string;
          detail?: string;
        } | null;
        throw new Error(
          data?.detail
            ? `${data?.error ?? "Request failed"}: ${data.detail}`
            : data?.error || `Request failed (${response.status})`,
        );
      }
      // Drain the body — an SSE response closes when the run settles; a
      // JSON response is already final. The persisted messages are the
      // source of truth for what the run did.
      await response.text().catch(() => "");
      await loadCanonicalMessages(conv.conversationId);
    },
    [ensureConversation, authHeaders, canonicalProjectId, loadCanonicalMessages],
  );

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || busy) return;
    if (!canonicalProjectId && !projectId) return;

    setInput("");
    setError(null);
    setBusy(true);
    setMessages((prev) => [...prev, { role: "user", content: text }]);

    try {
      if (canonicalProjectId) {
        await sendCanonical(text);
        return;
      }

      // Plain mode — no project is being viewed, so there is no workspace
      // to inherit. The legacy lane answers chat and honestly declines
      // file/execution requests.
      const response = await fetch("/api/gemini/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentSlug: "litt",
          message: text,
          history: messages.slice(-10).map((m) => ({ role: m.role, content: m.content })),
          stream: false,
          userName: "Member",
          capabilities: {
            repository: "none",
            repositoryIndexed: false,
            terminalExecution: "unavailable",
            writeAccess: false,
            connectedProviders: [],
            availableTools: [],
            connectionSummary: "global litt studio",
          },
          pageContext: {
            surface: "global_litt_studio",
            route: "/studio",
            pageTitle: "Studio",
            authenticated: true,
          },
          globalLittProjectId: projectId,
        }),
      });

      // Debug: show HTTP status
      if (!response.ok) {
        const errText = await response.text().catch(() => "no body");
        throw new Error(`HTTP ${response.status}: ${errText.slice(0, 200)}`);
      }

      const data = await response.json();
      const reply =
        data.response || data.text || data.message || data.content ||
        "I'm here. What do you need?";

      setMessages((prev) => [...prev, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }, [input, busy, projectId, canonicalProjectId, messages, sendCanonical]);

  // ── Approve in chat (2026-11-11 directive) ─────────────────────────
  // A paused run in the viewed conversation is decided HERE, in the
  // overlay, through the same approvals endpoint + polling contract the
  // docked chat uses (submitApprovalAndPoll) — same gates, same
  // decisions, no second mechanism. Local state only mirrors the card
  // lifecycle phases the canonical ApprovalCard renders.
  const [gateState, setGateState] = useState<{
    pausedRunId: string;
    phase: "idle" | "submitting" | "executing" | "failed";
    error: string | null;
    retryable: boolean;
    expired: boolean;
  } | null>(null);
  const gateCancelRef = useRef<(() => void) | null>(null);
  const gateDecisionRef = useRef<"approved" | "rejected">("approved");
  useEffect(() => () => {
    gateCancelRef.current?.();
  }, []);

  const resolveGate = useCallback(
    (gate: PanelPendingApproval, decision: "approved" | "rejected") => {
      const conversationId = convRef.current?.conversationId;
      if (!conversationId) return;
      gateDecisionRef.current = decision;
      gateCancelRef.current?.();
      setGateState({ pausedRunId: gate.pausedRunId, phase: "submitting", error: null, retryable: true, expired: false });
      gateCancelRef.current = submitApprovalAndPoll({
        conversationId,
        pausedRunId: gate.pausedRunId,
        decision,
        onAccepted: () => {
          if (decision === "rejected") {
            // Nothing runs server-side after a rejection — the thread
            // reload shows the settled transcript and the card unmounts.
            setGateState(null);
            void loadCanonicalMessages(conversationId);
          } else {
            setGateState((s) => (s?.pausedRunId === gate.pausedRunId ? { ...s, phase: "executing" } : s));
          }
        },
        onCompleted: () => {
          setGateState(null);
          void loadCanonicalMessages(conversationId);
        },
        onFailed: (error, info) => {
          if (info?.decisionRecorded) {
            // The decision landed and the run settled — the transcript
            // is the truth now; reload it and drop the dead card.
            setGateState(null);
            void loadCanonicalMessages(conversationId);
            return;
          }
          setGateState({
            pausedRunId: gate.pausedRunId,
            phase: "failed",
            error,
            retryable: info?.retryable ?? true,
            expired: info?.expired ?? false,
          });
        },
      });
    },
    [loadCanonicalMessages],
  );

  const retryGate = useCallback(
    async (gate: PanelPendingApproval) => {
      const conversationId = convRef.current?.conversationId;
      if (!conversationId) return;
      if (!gateState?.expired) {
        resolveGate(gate, "approved");
        return;
      }
      // Expired gate: re-request a fresh one through the same endpoint
      // the docked chat uses, then reload — the rows carry the new gate.
      try {
        const res = await fetch(`/api/studio/conversations/${conversationId}/approvals/re-request`, {
          method: "POST",
          credentials: "include",
          headers: await authHeaders(true),
          body: JSON.stringify({ pausedRunId: gate.pausedRunId }),
        });
        if (!res.ok) throw new Error(`Re-request failed (${res.status})`);
        setGateState(null);
        await loadCanonicalMessages(conversationId);
      } catch (err) {
        setGateState({
          pausedRunId: gate.pausedRunId,
          phase: "failed",
          error: err instanceof Error ? err.message : "Could not re-request the approval.",
          retryable: true,
          expired: true,
        });
      }
    },
    [gateState?.expired, resolveGate, authHeaders, loadCanonicalMessages],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage();
    }
  };

  // Only the LATEST gated message gets the actionable card — a decided
  // run's row can briefly coexist with a newer gate after a reload, and
  // exactly one live decision surface may exist per conversation.
  const lastGateIndex = messages.reduce(
    (acc, m, i) => (m.pendingApproval ? i : acc),
    -1,
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Global LiTT"
      data-testid="global-litt-studio-panel"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Panel — bottom sheet on mobile, centered dialog on desktop */}
      <div
        className="relative flex w-full flex-col overflow-hidden bg-[#0a0a0f] sm:max-w-2xl sm:rounded-2xl"
        style={{
          height: "min(85vh, 700px)",
          maxHeight: "calc(100dvh - env(safe-area-inset-top) - 1rem)",
          marginBottom: "env(safe-area-inset-bottom)",
          border: "1px solid rgba(255,255,255,0.1)",
        }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
          <div className="flex items-center gap-2">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-full"
              style={{ backgroundColor: "var(--color-accent)" }}
            >
              <span className="text-sm font-bold text-black">L</span>
            </div>
            <div>
              <div className="text-sm font-semibold text-white">Global LiTT</div>
              <div className="text-xs text-white/50">
                {project?.name || "Your persistent operator"}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Global LiTT"
            className="rounded-lg p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
          >
            <X size={20} />
          </button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4" data-testid="global-litt-messages">
          {messages.length === 0 && (
            <div className="flex h-full items-center justify-center text-center">
              <div className="max-w-xs">
                <div className="mb-2 text-sm font-medium text-white/80">
                  Hey, I&apos;m LiTT.
                </div>
                <div className="text-sm text-white/50">
                  I remember our conversations across Studio. Ask me anything,
                  or tell me what to build.
                </div>
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i}>
              <div
                className={`mb-3 flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    m.role === "user"
                      ? "text-black"
                      : "border border-white/10 bg-white/5 text-white"
                  }`}
                  style={
                    m.role === "user"
                      ? { backgroundColor: "var(--color-accent)" }
                      : undefined
                  }
                >
                  {m.content}
                </div>
              </div>
              {m.pendingApproval && i === lastGateIndex && (
                <div className="mb-3 flex justify-start">
                  <div className="w-[85%]">
                    <ApprovalCard
                      approval={m.pendingApproval}
                      phase={
                        gateState?.pausedRunId === m.pendingApproval.pausedRunId
                          ? gateState.phase
                          : "idle"
                      }
                      error={
                        gateState?.pausedRunId === m.pendingApproval.pausedRunId
                          ? gateState.error
                          : null
                      }
                      retryable={
                        gateState?.pausedRunId === m.pendingApproval.pausedRunId
                          ? gateState.retryable
                          : true
                      }
                      expired={
                        gateState?.pausedRunId === m.pendingApproval.pausedRunId
                          ? gateState.expired
                          : false
                      }
                      onResolve={(decision) => {
                        if (m.pendingApproval) resolveGate(m.pendingApproval, decision);
                      }}
                      onRetry={() => {
                        if (m.pendingApproval) void retryGate(m.pendingApproval);
                      }}
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
          {busy && (
            <div className="mb-3 flex justify-start">
              <div className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-2.5">
                <Loader2 size={16} className="animate-spin text-white/60" />
                <span className="text-sm text-white/60">Thinking…</span>
              </div>
            </div>
          )}
          {error && (
            <div className="mb-3 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
              {error}
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Composer — safe-area aware */}
        <div
          className="border-t border-white/10 px-4 pt-3"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask LiTT anything…"
              rows={1}
              disabled={busy}
              className="max-h-32 flex-1 resize-none rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/40 outline-none focus:border-white/25 disabled:opacity-50"
              style={{ fontSize: "16px" }} // Prevents iOS zoom
              data-testid="global-litt-composer"
            />
            <button
              type="button"
              onClick={() => void sendMessage()}
              disabled={busy || !input.trim()}
              aria-label="Send message"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-black transition-opacity disabled:opacity-40"
              style={{ backgroundColor: "var(--color-accent)" }}
              data-testid="global-litt-send"
            >
              {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
            </button>
          </div>
          <div className="mt-2 pb-1 text-center text-[11px] text-white/30">
            Persistent across Studio • Remembers this conversation
          </div>
        </div>
      </div>
    </div>
  );
}
