"use client";

/**
 * LoopsTool — Project Loops surface inside Studio
 *
 * The user lands here, defines a goal + acceptance criteria, picks a repo
 * and base branch, then watches the cycle:
 *
 *   Inspecting → Planning → Editing → Testing → Reviewing → Awaiting approval
 *
 * When the runner lands in `awaiting_approval`, the user can:
 *   - Approve (request another loop iteration)
 *   - Ship (open a PR)
 *   - Edit instructions (re-run with new goal text)
 *   - Revert (drop the working branch)
 *
 * All backed by /api/loops + /api/loops/[id]/*.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import {
  CheckCircle2,
  Circle,
  ClipboardCopy,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  Loader2,
  Plus,
  Rocket,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Undo2,
  XCircle,
  Zap,
} from "lucide-react";
import {
  PHASE_LABELS,
  STATUS_LABELS,
  type LoopEvent,
  type LoopPhase,
  type ProjectLoop,
} from "@/types/project-loops";

const PHASE_ORDER: LoopPhase[] = [
  "inspecting",
  "planning",
  "editing",
  "testing",
  "reviewing",
  "awaiting_approval",
  "shipping",
  "done",
];

const DEFAULT_CRITERIA = [
  "TypeScript passes",
  "Tests pass",
  "Mobile layout works",
  "Performance score exceeds 75",
];

type ListResp = { loops?: ProjectLoop[]; error?: string };
type LoopResp = { loop?: ProjectLoop; error?: string };
type EventsResp = { events?: LoopEvent[]; error?: string };

const POLL_MS = 1500;

export default function LoopsTool() {
  const { resolvedColors: T } = useTheme();

  /* ── list + selected loop ─────────────────────────────────────── */
  const [loops, setLoops] = useState<ProjectLoop[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [active, setActive] = useState<ProjectLoop | null>(null);
  const [events, setEvents] = useState<LoopEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ── create form ──────────────────────────────────────────────── */
  const [showForm, setShowForm] = useState(false);
  const [repo, setRepo] = useState("LabsConnected/litlabs-website");
  const [baseBranch, setBaseBranch] = useState("main");
  const [goal, setGoal] = useState(
    "Fix the mobile Studio navigation and improve Lighthouse performance.",
  );
  const [criteria, setCriteria] = useState<string[]>(DEFAULT_CRITERIA);
  const [submitting, setSubmitting] = useState(false);

  /* ── approval form ────────────────────────────────────────────── */
  const [approvalNote, setApprovalNote] = useState("");
  const [approving, setApproving] = useState(false);

  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ── list loops on mount ──────────────────────────────────────── */
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/loops", { cache: "no-store" });
        const data = (await res.json()) as ListResp;
        if (!alive) return;
        if (data.loops) {
          setLoops(data.loops);
          if (data.loops.length > 0 && !activeId) {
            setActiveId(data.loops[0].id);
          }
        }
        if (data.error) setError(data.error);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Network error");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── fetch active loop + events when activeId changes ─────────── */
  useEffect(() => {
    if (!activeId) {
      setActive(null);
      setEvents([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const [loopRes, eventsRes] = await Promise.all([
          fetch(`/api/loops/${activeId}`, { cache: "no-store" }),
          fetch(`/api/loops/${activeId}/events?limit=300`, { cache: "no-store" }),
        ]);
        const loop = ((await loopRes.json()) as LoopResp).loop;
        const evs = ((await eventsRes.json()) as EventsResp).events ?? [];
        if (!alive) return;
        setActive(loop ?? null);
        setEvents(evs);
      } catch (err) {
        if (alive) setError(err instanceof Error ? err.message : "Network error");
      }
    })();
    return () => {
      alive = false;
    };
  }, [activeId]);

  /* ── poll while the loop is alive ─────────────────────────────── */
  useEffect(() => {
    if (!activeId) return;
    const tick = async () => {
      try {
        const [loopRes, eventsRes] = await Promise.all([
          fetch(`/api/loops/${activeId}`, { cache: "no-store" }),
          fetch(
            `/api/loops/${activeId}/events?since=${encodeURIComponent(
              events[events.length - 1]?.at ?? "",
            )}&limit=200`,
            { cache: "no-store" },
          ),
        ]);
        const loop = ((await loopRes.json()) as LoopResp).loop;
        const evs = ((await eventsRes.json()) as EventsResp).events ?? [];
        if (loop) setActive(loop);
        if (evs.length > 0) setEvents((prev) => [...prev, ...evs]);
      } catch {
        /* swallow poll errors */
      }
      pollRef.current = setTimeout(tick, POLL_MS);
    };
    pollRef.current = setTimeout(tick, POLL_MS);
    return () => {
      if (pollRef.current) clearTimeout(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, active?.status, events.length]);

  /* ── handlers ─────────────────────────────────────────────────── */
  const refreshList = useCallback(async () => {
    const res = await fetch("/api/loops", { cache: "no-store" });
    const data = (await res.json()) as ListResp;
    if (data.loops) setLoops(data.loops);
  }, []);

  const startLoop = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/loops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repo,
          baseBranch,
          goal,
          acceptanceCriteria: criteria.filter((c) => c.trim()),
        }),
      });
      const data = (await res.json()) as LoopResp;
      if (!res.ok || !data.loop) {
        throw new Error(data.error || "Failed to create loop");
      }
      await refreshList();
      setActiveId(data.loop.id);
      setActive(data.loop);
      setEvents([]);
      setShowForm(false);

      // Kick off the run
      await fetch(`/api/loops/${data.loop.id}/iterate`, { method: "POST" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create loop");
    } finally {
      setSubmitting(false);
    }
  }, [repo, baseBranch, goal, criteria, refreshList]);

  const iterate = useCallback(async () => {
    if (!activeId) return;
    setError(null);
    await fetch(`/api/loops/${activeId}/iterate`, { method: "POST" });
  }, [activeId]);

  const approve = useCallback(
    async (decision: "approve" | "iterate" | "edit_instructions" | "revert" | "ship") => {
      if (!activeId) return;
      setApproving(true);
      setError(null);
      try {
        const res = await fetch(`/api/loops/${activeId}/approve`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision, note: approvalNote }),
        });
        const data = (await res.json()) as { error?: string };
        if (!res.ok) throw new Error(data.error || "Failed to record decision");
        setApprovalNote("");
        if (decision === "ship" || decision === "revert") {
          // Re-fetch the loop to pick up the new status / PR URL
          const loopRes = await fetch(`/api/loops/${activeId}`, { cache: "no-store" });
          const updated = ((await loopRes.json()) as LoopResp).loop;
          if (updated) setActive(updated);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed");
      } finally {
        setApproving(false);
      }
    },
    [activeId, approvalNote],
  );

  const removeLoop = useCallback(
    async (id: string) => {
      await fetch(`/api/loops/${id}`, { method: "DELETE" });
      if (activeId === id) {
        setActiveId(null);
        setActive(null);
        setEvents([]);
      }
      await refreshList();
    },
    [activeId, refreshList],
  );

  /* ── derived view state ───────────────────────────────────────── */
  const currentPhaseIndex = useMemo(() => {
    if (!active) return -1;
    const i = PHASE_ORDER.indexOf(active.phase);
    if (i >= 0) return i;
    if (active.status === "completed") return PHASE_ORDER.length - 1;
    return -1;
  }, [active]);

  const isRunning = !!active && ["planning", "executing", "testing", "reviewing"].includes(active.status);
  const isAwaiting = active?.status === "awaiting_approval";
  const isDone = active?.status === "completed" || active?.status === "failed" || active?.status === "cancelled";

  /* ── styles ───────────────────────────────────────────────────── */
  const cardBase = "rounded-2xl border";
  const cardStyle = {
    backgroundColor: T.boxBg,
    borderColor: `${T.borderColor}30`,
  };
  const muted = { color: T.textMuted };

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:p-4">
      {/* ── Brand / hero ──────────────────────────────────────────── */}
      <header
        className={`${cardBase} relative overflow-hidden p-4 sm:p-5`}
        style={{
          ...cardStyle,
          background: `radial-gradient(circle at 80% 0%, ${T.accentColor}22, transparent 60%), ${T.boxBg}`,
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl"
            style={{
              backgroundColor: `${T.accentColor}22`,
              color: T.accentColor,
              boxShadow: `0 0 24px ${T.accentColor}40`,
            }}
          >
            <Rocket size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="text-[10px] font-black uppercase tracking-[.18em]"
              style={{ color: T.accentColor }}
            >
              Project Loops
            </p>
            <h1 className="mt-0.5 text-lg font-black leading-tight sm:text-xl">
              Stop chatting. Start shipping.
            </h1>
            <p className="mt-1 text-xs" style={muted}>
              Connect a repo, name the outcome, and an AI team will
              inspect → plan → edit → test → review → ask for approval.
            </p>
          </div>
          <button
            onClick={() => setShowForm((s) => !s)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-[11px] font-black uppercase tracking-wider transition hover:opacity-90"
            style={{
              backgroundColor: T.accentColor,
              color: T.bgColor,
              boxShadow: `0 0 18px ${T.accentColor}55`,
            }}
          >
            <Plus size={14} /> New loop
          </button>
        </div>

        {showForm && (
          <div className="mt-4 grid gap-3 border-t pt-4" style={{ borderColor: `${T.borderColor}30` }}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Repository" hint="owner/name on GitHub">
                <input
                  className="w-full rounded-lg border bg-black/30 px-2.5 py-1.5 text-sm"
                  style={{ borderColor: `${T.borderColor}40`, color: T.textColor }}
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  placeholder="LabsConnected/litlabs-website"
                />
              </Field>
              <Field label="Base branch">
                <input
                  className="w-full rounded-lg border bg-black/30 px-2.5 py-1.5 text-sm"
                  style={{ borderColor: `${T.borderColor}40`, color: T.textColor }}
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  placeholder="main"
                />
              </Field>
            </div>
            <Field label="Goal" hint="One clear outcome. The AI will break it down.">
              <textarea
                rows={3}
                className="w-full rounded-lg border bg-black/30 px-2.5 py-2 text-sm"
                style={{ borderColor: `${T.borderColor}40`, color: T.textColor }}
                value={goal}
                onChange={(e) => setGoal(e.target.value)}
              />
            </Field>
            <div>
              <p className="mb-1 text-[10px] font-black uppercase tracking-wider" style={muted}>
                Acceptance criteria
              </p>
              <div className="space-y-1.5">
                {criteria.map((c, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      className="flex-1 rounded-lg border bg-black/30 px-2.5 py-1.5 text-xs"
                      style={{ borderColor: `${T.borderColor}40`, color: T.textColor }}
                      value={c}
                      onChange={(e) =>
                        setCriteria((prev) => prev.map((p, idx) => (idx === i ? e.target.value : p)))
                      }
                    />
                    <button
                      onClick={() => setCriteria((prev) => prev.filter((_, idx) => idx !== i))}
                      className="rounded-md p-1 hover:bg-white/5"
                      style={muted}
                      aria-label="Remove criterion"
                    >
                      <XCircle size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={() => setCriteria((prev) => [...prev, ""])}
                  className="text-[10px] font-bold uppercase tracking-wider hover:underline"
                  style={{ color: T.accentColor }}
                >
                  + add criterion
                </button>
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setShowForm(false)}
                className="rounded-lg px-3 py-1.5 text-xs font-bold hover:bg-white/5"
                style={muted}
              >
                Cancel
              </button>
              <button
                onClick={startLoop}
                disabled={submitting || !repo.trim() || !goal.trim()}
                className="inline-flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-black uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50"
                style={{ backgroundColor: T.accentColor, color: T.bgColor }}
              >
                {submitting ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                Start loop
              </button>
            </div>
          </div>
        )}
      </header>

      {error && (
        <div
          className={`${cardBase} p-3 text-xs`}
          style={{ ...cardStyle, borderColor: "#f8717130", color: "#fca5a5" }}
        >
          {error}
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[260px_1fr]">
        {/* ── List of loops ──────────────────────────────────────── */}
        <aside className={`${cardBase} p-2`} style={cardStyle}>
          <div className="px-2 pb-2 pt-1 text-[10px] font-black uppercase tracking-[.2em]" style={muted}>
            Recent loops
          </div>
          {loading ? (
            <div className="grid place-items-center py-12">
              <Loader2 size={16} className="animate-spin" style={{ color: T.accentColor }} />
            </div>
          ) : loops.length === 0 ? (
            <div className="px-2 py-6 text-center text-xs" style={muted}>
              No loops yet. Start one above.
            </div>
          ) : (
            <ul className="space-y-1">
              {loops.map((l) => {
                const isActive = l.id === activeId;
                return (
                  <li key={l.id}>
                    <button
                      onClick={() => setActiveId(l.id)}
                      className="flex w-full items-start gap-2 rounded-xl border p-2 text-left transition"
                      style={{
                        backgroundColor: isActive ? `${T.accentColor}1a` : "transparent",
                        borderColor: isActive ? `${T.accentColor}55` : "transparent",
                        color: T.textColor,
                      }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1">
                          <GitBranch size={11} style={{ color: T.accentColor }} />
                          <span className="truncate text-[11px] font-black">{l.repo}</span>
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-[10px]" style={muted}>
                          {l.goal}
                        </p>
                        <div className="mt-1 flex items-center gap-1">
                          <StatusPill status={l.status} T={T} />
                          <span className="text-[9px]" style={muted}>
                            {l.iteration}/{l.maxIterations}
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLoop(l.id);
                        }}
                        className="grid h-6 w-6 place-items-center rounded-md opacity-30 hover:bg-white/5 hover:opacity-100"
                        style={muted}
                        aria-label="Delete loop"
                      >
                        <Trash2 size={11} />
                      </button>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        {/* ── Active loop surface ────────────────────────────────── */}
        <section className="flex min-w-0 flex-col gap-3">
          {!active ? (
            <EmptyState T={T} />
          ) : (
            <>
              {/* header card */}
              <div className={`${cardBase} p-4`} style={cardStyle}>
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span
                        className="rounded-full px-2 py-0.5 text-[9px] font-black uppercase tracking-wider"
                        style={{ backgroundColor: `${T.accentColor}22`, color: T.accentColor }}
                      >
                        {STATUS_LABELS[active.status]}
                      </span>
                      <span className="text-[10px]" style={muted}>
                        Iteration {active.iteration} of {active.maxIterations}
                      </span>
                    </div>
                    <h2 className="mt-2 text-base font-black leading-tight sm:text-lg">
                      {active.goal}
                    </h2>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={muted}>
                      <span className="inline-flex items-center gap-1">
                        <GitBranch size={10} /> {active.workingBranch}
                      </span>
                      <span>· base {active.baseBranch}</span>
                      <span>· {active.tokensUsed.toLocaleString()} tokens</span>
                      <span>· {active.fileChanges} files changed</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    {isRunning && (
                      <Loader2 size={20} className="animate-spin" style={{ color: T.accentColor }} />
                    )}
                    {isAwaiting && (
                      <ShieldCheck size={20} style={{ color: T.accentColor }} />
                    )}
                    {isDone && active.status === "completed" && (
                      <CheckCircle2 size={20} className="text-emerald-400" />
                    )}
                    {isDone && active.status === "failed" && (
                      <XCircle size={20} className="text-rose-400" />
                    )}
                  </div>
                </div>

                {/* phase rail */}
                <div className="mt-4 flex flex-wrap items-center gap-1">
                  {PHASE_ORDER.map((p, idx) => {
                    const isCurrent = p === active.phase;
                    const isPast = currentPhaseIndex > idx;
                    return (
                      <div key={p} className="flex items-center gap-1">
                        <div
                          className="flex items-center gap-1.5 rounded-full px-2 py-1 text-[10px] font-bold"
                          style={{
                            backgroundColor: isCurrent
                              ? `${T.accentColor}22`
                              : isPast
                                ? `${T.accentColor}10`
                                : "transparent",
                            color: isCurrent || isPast ? T.accentColor : T.textMuted,
                            border: `1px solid ${isCurrent ? `${T.accentColor}55` : "transparent"}`,
                          }}
                        >
                          {isPast ? (
                            <CheckCircle2 size={10} />
                          ) : isCurrent && isRunning ? (
                            <Loader2 size={10} className="animate-spin" />
                          ) : (
                            <Circle size={10} />
                          )}
                          {PHASE_LABELS[p]}
                        </div>
                        {idx < PHASE_ORDER.length - 1 && (
                          <span className="text-[10px]" style={muted}>
                            ↓
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* acceptance criteria + review */}
              {active.acceptanceCriteria.length > 0 && (
                <div className={`${cardBase} p-3`} style={cardStyle}>
                  <p className="mb-2 text-[10px] font-black uppercase tracking-[.18em]" style={muted}>
                    Acceptance criteria
                  </p>
                  <ul className="space-y-1 text-xs">
                    {active.acceptanceCriteria.map((c, i) => {
                      const passed = active.lastReview?.passed;
                      return (
                        <li
                          key={i}
                          className="flex items-center gap-2"
                          style={{ color: T.textColor }}
                        >
                          {passed ? (
                            <CheckCircle2 size={12} className="text-emerald-400" />
                          ) : (
                            <Circle size={12} style={muted} />
                          )}
                          <span>{c}</span>
                        </li>
                      );
                    })}
                  </ul>
                  {active.lastReview && (
                    <div className="mt-2 flex items-center gap-2 text-[10px]" style={muted}>
                      <Zap size={10} />
                      Reviewer score: {active.lastReview.score}/100
                    </div>
                  )}
                </div>
              )}

              {/* diff */}
              {active.lastDiff && active.lastDiff.files.length > 0 && (
                <div className={`${cardBase} p-3`} style={cardStyle}>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-[10px] font-black uppercase tracking-[.18em]" style={muted}>
                      Diff (iteration {active.lastDiff.iteration})
                    </p>
                    <span className="text-[10px]" style={muted}>
                      {active.lastDiff.files.length} file{active.lastDiff.files.length === 1 ? "" : "s"}
                    </span>
                  </div>
                  <ul className="space-y-1">
                    {active.lastDiff.files.map((f) => (
                      <li
                        key={f.path}
                        className="flex items-center gap-2 rounded-lg border p-2 text-[11px]"
                        style={{ borderColor: `${T.borderColor}20` }}
                      >
                        <span
                          className="rounded-md px-1.5 py-0.5 text-[9px] font-black uppercase"
                          style={{
                            backgroundColor:
                              f.status === "added"
                                ? "#22c55e22"
                                : f.status === "deleted"
                                  ? "#ef444422"
                                  : `${T.accentColor}22`,
                            color:
                              f.status === "added"
                                ? "#22c55e"
                                : f.status === "deleted"
                                  ? "#ef4444"
                                  : T.accentColor,
                          }}
                        >
                          {f.status}
                        </span>
                        <code className="flex-1 truncate font-mono text-[11px]" style={{ color: T.textColor }}>
                          {f.path}
                        </code>
                        <span className="text-[10px]" style={muted}>
                          +{f.additions}/-{f.deletions}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* approval gate */}
              {isAwaiting && (
                <div
                  className={`${cardBase} p-3`}
                  style={{
                    ...cardStyle,
                    background: `linear-gradient(135deg, ${T.accentColor}1a, ${T.boxBg})`,
                    borderColor: `${T.accentColor}55`,
                  }}
                >
                  <p className="text-[10px] font-black uppercase tracking-[.18em]" style={{ color: T.accentColor }}>
                    Awaiting your approval
                  </p>
                  <p className="mt-1 text-xs" style={muted}>
                    Review the diff above, then decide what happens next.
                  </p>
                  <textarea
                    rows={2}
                    placeholder="Optional note for the AI team…"
                    value={approvalNote}
                    onChange={(e) => setApprovalNote(e.target.value)}
                    className="mt-2 w-full rounded-lg border bg-black/30 px-2.5 py-1.5 text-xs"
                    style={{ borderColor: `${T.borderColor}40`, color: T.textColor }}
                  />
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <ActionButton
                      onClick={() => approve("ship")}
                      disabled={approving}
                      tone="primary"
                      T={T}
                    >
                      <GitPullRequest size={12} /> Ship
                    </ActionButton>
                    <ActionButton
                      onClick={() => approve("iterate")}
                      disabled={approving}
                      tone="ghost"
                      T={T}
                    >
                      <Sparkles size={12} /> Run another loop
                    </ActionButton>
                    <ActionButton
                      onClick={() => approve("edit_instructions")}
                      disabled={approving}
                      tone="ghost"
                      T={T}
                    >
                      <ClipboardCopy size={12} /> Edit instructions
                    </ActionButton>
                    <ActionButton
                      onClick={() => approve("revert")}
                      disabled={approving}
                      tone="danger"
                      T={T}
                    >
                      <Undo2 size={12} /> Revert
                    </ActionButton>
                  </div>
                </div>
              )}

              {/* non-awaiting run controls */}
              {!isAwaiting && !isDone && (
                <div className={`${cardBase} p-3`} style={cardStyle}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-black uppercase tracking-[.18em]" style={muted}>
                      {isRunning ? "Loop is running" : "Loop ready"}
                    </p>
                    <div className="flex items-center gap-2">
                      <ActionButton
                        onClick={iterate}
                        disabled={isRunning}
                        tone="primary"
                        T={T}
                      >
                        {isRunning ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <Sparkles size={12} />
                        )}
                        {isRunning ? "Running…" : "Start loop"}
                      </ActionButton>
                    </div>
                  </div>
                </div>
              )}

              {/* shipped state */}
              {active.pullRequestUrl && (
                <div
                  className={`${cardBase} p-3`}
                  style={{
                    ...cardStyle,
                    borderColor: "#22c55e40",
                    background: `linear-gradient(135deg, #22c55e14, ${T.boxBg})`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    <GitPullRequest size={14} className="text-emerald-400" />
                    <p className="text-xs font-black text-emerald-300">Pull request opened</p>
                  </div>
                  <a
                    href={active.pullRequestUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300 hover:underline"
                  >
                    {active.pullRequestUrl} <ExternalLink size={10} />
                  </a>
                </div>
              )}

              {/* live event log */}
              <div className={`${cardBase} p-3`} style={cardStyle}>
                <p className="mb-2 text-[10px] font-black uppercase tracking-[.18em]" style={muted}>
                  Live event log
                </p>
                {events.length === 0 ? (
                  <p className="text-xs" style={muted}>
                    No events yet. Press <strong>Start loop</strong> to begin.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {events.slice(-30).map((ev) => (
                      <li
                        key={ev.id}
                        className="flex items-start gap-2 rounded-md border p-1.5 text-[11px]"
                        style={{ borderColor: `${T.borderColor}20` }}
                      >
                        <span style={{ color: phaseColor(ev.level, T) }}>
                          {ev.level === "success" ? (
                            <CheckCircle2 size={11} />
                          ) : ev.level === "warn" ? (
                            <Zap size={11} />
                          ) : ev.level === "error" ? (
                            <XCircle size={11} />
                          ) : ev.level === "phase" ? (
                            <Loader2 size={11} className="animate-spin" />
                          ) : (
                            <Terminal size={11} />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1">
                            {ev.role && (
                              <span
                                className="rounded-md px-1 py-0.5 text-[8px] font-black uppercase tracking-wider"
                                style={{
                                  backgroundColor: `${T.accentColor}22`,
                                  color: T.accentColor,
                                }}
                              >
                                {ev.role}
                              </span>
                            )}
                            <span className="text-[10px]" style={muted}>
                              {PHASE_LABELS[ev.phase]}
                            </span>
                          </div>
                          <p className="mt-0.5" style={{ color: T.textColor }}>
                            {ev.message}
                          </p>
                          {ev.detail && (
                            <pre
                              className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded-md border p-1.5 text-[9px]"
                              style={{
                                borderColor: `${T.borderColor}20`,
                                backgroundColor: "rgba(0,0,0,.3)",
                                color: T.textMuted,
                              }}
                            >
                              {ev.detail}
                            </pre>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <p className="text-center text-[9px]" style={muted}>
                Stop chatting. Start shipping. 🎯
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

/* ── Sub-components ──────────────────────────────────────────────── */

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <p className="mb-1 text-[10px] font-black uppercase tracking-wider text-slate-400">
        {label}
      </p>
      {children}
      {hint && (
        <p className="mt-1 text-[9px]" style={{ color: "rgba(255,255,255,.4)" }}>
          {hint}
        </p>
      )}
    </label>
  );
}

function ActionButton({
  onClick,
  disabled,
  tone,
  children,
  T,
}: {
  onClick: () => void;
  disabled?: boolean;
  tone: "primary" | "ghost" | "danger";
  children: React.ReactNode;
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const style =
    tone === "primary"
      ? { backgroundColor: T.accentColor, color: T.bgColor }
      : tone === "danger"
        ? { border: `1px solid #ef444455`, color: "#fca5a5" }
        : { border: `1px solid ${T.borderColor}40`, color: T.textColor };
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black uppercase tracking-wider transition disabled:cursor-not-allowed disabled:opacity-50 hover:opacity-90"
      style={style}
    >
      {children}
    </button>
  );
}

function StatusPill({
  status,
  T,
}: {
  status: ProjectLoop["status"];
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  const colorMap: Record<ProjectLoop["status"], string> = {
    draft: "#94a3b8",
    planning: "#a78bfa",
    executing: T.accentColor,
    testing: "#22d3ee",
    reviewing: "#fbbf24",
    awaiting_approval: "#fb7185",
    completed: "#22c55e",
    failed: "#ef4444",
    cancelled: "#94a3b8",
  };
  const color = colorMap[status];
  return (
    <span
      className="rounded-md px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
      style={{ backgroundColor: `${color}22`, color }}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}

function EmptyState({
  T,
}: {
  T: ReturnType<typeof useTheme>["resolvedColors"];
}) {
  return (
    <div
      className="rounded-2xl border p-8 text-center"
      style={{
        borderColor: `${T.borderColor}30`,
        backgroundColor: T.boxBg,
      }}
    >
      <div
        className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl"
        style={{
          backgroundColor: `${T.accentColor}22`,
          color: T.accentColor,
          boxShadow: `0 0 24px ${T.accentColor}40`,
        }}
      >
        <Rocket size={20} />
      </div>
      <p className="text-sm font-black" style={{ color: T.textColor }}>
        Pick a loop to see it run
      </p>
      <p className="mt-1 text-[11px]" style={{ color: T.textMuted }}>
        Or start a new one with the button above.
      </p>
    </div>
  );
}

function phaseColor(
  level: LoopEvent["level"],
  T: ReturnType<typeof useTheme>["resolvedColors"],
): string {
  switch (level) {
    case "success":
      return "#22c55e";
    case "warn":
      return "#fbbf24";
    case "error":
      return "#ef4444";
    case "phase":
      return T.accentColor;
    default:
      return T.textMuted;
  }
}


