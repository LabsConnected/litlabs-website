"use client";

/**
 * ChatJobsView — the Jobs tab body of the Studio chat panel: the current
 * run's plan steps, the live task steps, the checks summary, the work
 * log, pending approvals and the run's changes. It owns the ONLY mount
 * of the run-status runtime strip (ActionRunStatusPanel) — Larry ruled
 * 2026-11-18 that the strip lives ONLY in Jobs, never in Chat.
 *
 * ONE implementation, two homes: the Board layout's BoardChatPanel Jobs
 * tab and the Regular layout's LiTTPanel Jobs tab both render this
 * component, so the two layouts can never drift apart. (The body lived
 * inside BoardChatPanel until the Regular layout grew its own Jobs tab;
 * the extraction changed nothing about what renders.) Jobs is fed by
 * REAL state only: the execution store, the action-run projection
 * (ActionRunStatusPanel), StudioHealthPanel in approvals mode, and
 * RunChangesPanel. Where a feed has not been wired by the parent yet
 * (projectId / conversationId not passed), the section shows an honest
 * empty state instead of invented data.
 *
 * Single-home doctrine: Checks keeps ONE home per layout. The Checks
 * step inside Jobs is a SUMMARY of the check results the current run
 * recorded in the execution store, plus a summon of the layout's Checks
 * surface (onOpenChecks) — never a second mounted StudioHealthPanel
 * mode="checks" instance. ACC-08: when the live store holds no check
 * results (a server-side resumed run's events never reached this
 * client), the summary falls back to the project's PERSISTED check
 * run from the checks GET, labelled with its provenance — the empty
 * sentence is reserved for projects with no saved run at all.
 *
 * The data-testids keep their historical "board-chat-jobs*" names so
 * the board's existing test pins stay valid in both layouts.
 */

import { useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle2, LoaderCircle, ShieldCheck, XCircle } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { approvalForConversation, useExecutionStore } from "../stores/useExecutionStore";
import { ActionRunStatusPanel } from "./ActionRunStatusPanel";
import StudioHealthPanel from "./StudioHealthPanel";
import RunChangesPanel from "./RunChangesPanel";

export interface ChatJobsViewProps {
  /** Project in scope, for the approvals queue and run changes. */
  projectId?: string | null;
  /** Conversation in scope, for the live task steps and approval gates. */
  conversationId?: string | null;
  /** Busy flag forwarded to RunChangesPanel; defaults to the execution store's isRunning. */
  jobsBusy?: boolean;
  /** Refresh key forwarded to RunChangesPanel / approvals (e.g. workspace revision). */
  jobsRefreshKey?: unknown;
  /** Summon the layout's one Checks surface (board panel / Regular rail tab). */
  onOpenChecks?: () => void;
}

/** One persisted check result, as the checks GET returns it inside
 *  the persisted run set (ACC-08 durable fallback). */
interface PersistedCheck {
  label: string;
  status: "not_run" | "running" | "passed" | "failed" | "unavailable" | "not_configured";
  error?: string | null;
}

interface PersistedCheckRun {
  checks: PersistedCheck[];
  conversationId: string | null;
  createdAt: string;
}

const PERSISTED_CHECK_STATUSES: ReadonlySet<string> = new Set([
  "not_run",
  "running",
  "passed",
  "failed",
  "unavailable",
  "not_configured",
]);

function isPersistedCheck(value: unknown): value is PersistedCheck {
  if (!value || typeof value !== "object") return false;
  const check = value as Partial<PersistedCheck>;
  return (
    typeof check.label === "string" &&
    typeof check.status === "string" &&
    PERSISTED_CHECK_STATUSES.has(check.status)
  );
}

export default function ChatJobsView({
  projectId = null,
  conversationId = null,
  jobsBusy,
  jobsRefreshKey,
  onOpenChecks,
}: ChatJobsViewProps) {
  const { tokens } = useTheme();
  const { getToken } = useClerkAuth();
  const isRunning = useExecutionStore((s) => s.isRunning);
  const events = useExecutionStore((s) => s.events);
  // ACC-06a item 4: the "approval waiting" notice is scoped to this
  // view's conversation — another project's gate is not announced
  // in this session.
  const pendingApproval = approvalForConversation(
    useExecutionStore((s) => s.pendingApproval),
    conversationId,
  );

  // The plan as a green-check list: the run's own recorded steps (the
  // same execution events the transcript's live progress reads) — real
  // work, checked off as it lands.
  const planSteps = events
    .filter((e) => !e.lowLevel && e.summary?.trim())
    .slice(-6);
  // The work log: every recorded execution event, low-level included —
  // the execution details that used to clutter the conversation.
  const workLog = events.filter((e) => e.summary?.trim()).slice(-30);
  // Checks summary for Jobs: the latest recorded result per named
  // check from the run's own build_result events. A summary only —
  // the full checks surface stays in the one Checks home.
  const checkResults = (() => {
    const byCheck = new Map<string, { success?: boolean; errorCount?: number }>();
    for (const e of events) {
      if (e.type === "build_result" && e.check) {
        byCheck.set(e.check, { success: e.success, errorCount: e.errorCount });
      }
    }
    return [...byCheck.entries()].map(([name, r]) => ({ name, ...r }));
  })();

  // ACC-08 Defect 1 — durable fallback for the Checks summary. The
  // live store above only holds THIS client's events: a run that
  // executed server-side (an approval-resumed run runs fire-and-
  // forget) or in another session leaves it empty even though its
  // checks ran and persisted. When the live store has no results,
  // read the project's persisted check run (the same checks GET the
  // Checks panel reads) and show those results with their provenance
  // instead of the false "No checks have run" sentence. The live
  // store stays authoritative whenever it has results.
  const [persistedRun, setPersistedRun] = useState<PersistedCheckRun | null>(null);
  const persistedFetchKeyRef = useRef<string | null>(null);
  useEffect(() => {
    // A different project must never render the previous project's
    // saved results while its own load is in flight.
    setPersistedRun(null);
    persistedFetchKeyRef.current = null;
  }, [projectId]);
  useEffect(() => {
    if (isRunning) {
      // A fresh run invalidates the saved set as the summary source;
      // when it stops, the effect re-runs and re-reads the record.
      persistedFetchKeyRef.current = null;
      return;
    }
    if (!projectId || checkResults.length > 0) return;
    const fetchKey = `${projectId}:${conversationId ?? ""}`;
    if (persistedFetchKeyRef.current === fetchKey) return;
    persistedFetchKeyRef.current = fetchKey;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getToken?.().catch(() => null);
        const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/checks`, {
          cache: "no-store",
          credentials: "include",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) return;
        const data = (await response.json().catch(() => null)) as {
          checks?: unknown;
          checkRun?: { conversationId?: unknown; createdAt?: unknown } | null;
        } | null;
        // Only a payload carrying a checkRun is a persisted run; the
        // placeholder set (no run saved yet) keeps the empty state.
        if (cancelled || !data?.checkRun || !Array.isArray(data.checks)) return;
        const checks = data.checks.filter(isPersistedCheck);
        if (checks.length === 0) return;
        setPersistedRun({
          checks,
          conversationId:
            typeof data.checkRun.conversationId === "string" ? data.checkRun.conversationId : null,
          createdAt: typeof data.checkRun.createdAt === "string" ? data.checkRun.createdAt : "",
        });
      } catch {
        // Best-effort: a failed read leaves the honest empty state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId, conversationId, checkResults.length, isRunning, getToken]);

  const changesBusy = jobsBusy ?? isRunning;

  const sectionTitle = (text: string) => (
    <p
      className="mb-1.5 text-[10px] font-bold uppercase tracking-wider"
      style={{ color: tokens.textMuted }}
    >
      {text}
    </p>
  );

  return (
    <div
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3"
      data-testid="board-chat-jobs"
    >
      {/* Plan + live task steps for the current run */}
      <section data-testid="board-chat-jobs-plan">
        {sectionTitle("Plan")}
        {planSteps.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {planSteps.map((step, index) => {
              const isLast = index === planSteps.length - 1;
              const pending = isRunning && isLast;
              return (
                <li
                  key={step.id}
                  className="flex items-start gap-1.5 text-[11px] leading-4"
                  style={{ color: tokens.text }}
                >
                  {pending ? (
                    <LoaderCircle
                      size={13}
                      className="mt-0.5 shrink-0 animate-spin"
                      style={{ color: tokens.textMuted }}
                      aria-hidden
                    />
                  ) : (
                    <CheckCircle2
                      size={13}
                      className="mt-0.5 shrink-0"
                      style={{ color: "var(--litt-primary, #2FBF5A)" }}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 flex-1">{step.summary}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[11px] leading-4" style={{ color: tokens.textMuted }}>
            No plan yet — when LiTT starts a run, its steps land here.
          </p>
        )}
      </section>

      {/* Live task steps (build, checks, deploy, preview) from the
          action-run projection — the same real feed the status
          panel reads. It renders nothing until a projection
          exists, so no placeholder is invented here. */}
      {conversationId ? (
        <div data-testid="board-chat-jobs-live-steps">
          <ActionRunStatusPanel conversationId={conversationId} busy={isRunning} />
        </div>
      ) : (
        <p
          className="text-[11px] leading-4"
          style={{ color: tokens.textMuted }}
          data-testid="board-chat-jobs-live-steps-empty"
        >
          Live task steps appear here once a conversation run is in scope.
        </p>
      )}

      {/* Checks — summary + summon of the one Checks surface */}
      <section data-testid="board-chat-jobs-checks">
        {sectionTitle("Checks")}
        {checkResults.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {checkResults.map((result) => (
              <li
                key={result.name}
                className="flex items-center gap-1.5 text-[11px] leading-4"
                style={{ color: tokens.text }}
              >
                {result.success === false ? (
                  <XCircle size={13} className="shrink-0" style={{ color: "#ef4444" }} aria-hidden />
                ) : (
                  <CheckCircle2
                    size={13}
                    className="shrink-0"
                    style={{ color: "var(--litt-primary, #2FBF5A)" }}
                    aria-hidden
                  />
                )}
                <span className="min-w-0 flex-1">
                  {result.name}
                  {result.success === false && result.errorCount
                    ? ` — ${result.errorCount} error${result.errorCount === 1 ? "" : "s"}`
                    : result.success === false
                      ? " — failed"
                      : " — passed"}
                </span>
              </li>
            ))}
          </ul>
        ) : persistedRun ? (
          <>
            <ul className="flex flex-col gap-1" data-testid="board-chat-jobs-checks-persisted">
              {persistedRun.checks.map((check) => (
                <li
                  key={check.label}
                  className="flex items-center gap-1.5 text-[11px] leading-4"
                  style={{ color: tokens.text }}
                >
                  {check.status === "passed" ? (
                    <CheckCircle2
                      size={13}
                      className="shrink-0"
                      style={{ color: "var(--litt-primary, #2FBF5A)" }}
                      aria-hidden
                    />
                  ) : check.status === "failed" ? (
                    <XCircle size={13} className="shrink-0" style={{ color: "#ef4444" }} aria-hidden />
                  ) : check.status === "unavailable" ? (
                    <AlertCircle size={13} className="shrink-0" style={{ color: "#e3b341" }} aria-hidden />
                  ) : (
                    <AlertCircle size={13} className="shrink-0" style={{ color: tokens.textMuted }} aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    {check.label}
                    {check.status === "passed"
                      ? " — passed"
                      : check.status === "failed"
                        ? " — failed"
                        : check.status === "unavailable"
                          ? " — could not run"
                          : check.status === "not_configured"
                            ? " — not configured"
                            : check.status === "running"
                              ? " — running"
                              : " — not run"}
                  </span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-[10px] leading-4" style={{ color: tokens.textMuted }}>
              {persistedRun.conversationId && conversationId && persistedRun.conversationId === conversationId
                ? "Saved results from this conversation's last completed build"
                : "Latest saved results for this project"}
              {persistedRun.createdAt
                ? ` · ${new Date(persistedRun.createdAt).toLocaleString()}`
                : ""}
            </p>
          </>
        ) : (
          <p className="text-[11px] leading-4" style={{ color: tokens.textMuted }}>
            No checks have run for this conversation yet.
          </p>
        )}
        {onOpenChecks && (
          <button
            type="button"
            data-testid="board-chat-jobs-open-checks"
            className="mt-2 rounded-full border px-3 py-1.5 text-[11px] font-semibold"
            style={{ borderColor: tokens.border, color: tokens.text }}
            onClick={onOpenChecks}
          >
            Open Checks panel
          </button>
        )}
      </section>

      {/* Work log / execution details */}
      <section data-testid="board-chat-jobs-worklog">
        {sectionTitle("Work log")}
        {workLog.length > 0 ? (
          <ul className="flex flex-col gap-1">
            {workLog.map((event) => (
              <li
                key={event.id}
                className="flex items-start gap-1.5 text-[11px] leading-4"
                style={{ color: tokens.text }}
              >
                <span
                  className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      event.success === false
                        ? "#ef4444"
                        : "var(--litt-primary, #2FBF5A)",
                  }}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">{event.summary}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[11px] leading-4" style={{ color: tokens.textMuted }}>
            No work logged yet — when LiTT runs, every step lands here.
          </p>
        )}
      </section>

      {/* Approvals — the queue's chat-panel home now that the Inspector
          window is retired. This is the one named approvals mount;
          checks are NOT mounted here. */}
      <section data-testid="board-chat-jobs-approvals">
        {sectionTitle("Approvals")}
        {pendingApproval && (
          <p
            className="mb-2 flex items-start gap-1.5 text-[11px] leading-4"
            style={{ color: "#e3b341" }}
            data-testid="board-chat-jobs-pending-approval"
          >
            <ShieldCheck size={13} className="mt-0.5 shrink-0" aria-hidden />
            <span>
              Approval waiting in chat: {pendingApproval.toolId}
              {pendingApproval.reason ? ` — ${pendingApproval.reason}` : ""}
            </span>
          </p>
        )}
        {projectId ? (
          <StudioHealthPanel
            mode="approvals"
            projectId={projectId}
            conversationId={conversationId}
            refreshKey={typeof jobsRefreshKey === "number" ? jobsRefreshKey : 0}
          />
        ) : (
          <p className="text-[11px] leading-4" style={{ color: tokens.textMuted }}>
            Approvals appear here once a project is open.
          </p>
        )}
      </section>

      {/* Changes — what the latest run changed, with diffs */}
      <section data-testid="board-chat-jobs-changes">
        {sectionTitle("Changes")}
        {projectId ? (
          <RunChangesPanel
            projectId={projectId}
            busy={changesBusy}
            refreshKey={jobsRefreshKey}
          />
        ) : (
          <p className="text-[11px] leading-4" style={{ color: tokens.textMuted }}>
            Changes appear here once a project is open.
          </p>
        )}
      </section>
    </div>
  );
}
