"use client";

import type { ReactNode } from "react";
import { Check, CircleAlert, Loader2 } from "lucide-react";

/* ── StudioEmptyState ─────────────────────────────────────────────── */

export interface StudioEmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  testId?: string;
}

export function StudioEmptyState({
  icon,
  title,
  description,
  action,
  testId = "studio-empty-state",
}: StudioEmptyStateProps) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center justify-center gap-2 py-12 text-center"
    >
      <div
        className="grid h-10 w-10 place-items-center rounded-full"
        style={{ backgroundColor: "rgba(255,255,255,0.06)" }}
      >
        <div className="pointer-events-none" style={{ color: "var(--text-muted)" }}>
          {icon}
        </div>
      </div>
      <div
        className="text-[13px] font-semibold"
        style={{ color: "var(--text-secondary)" }}
      >
        {title}
      </div>
      {description && (
        <div
          className="max-w-xs text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          {description}
        </div>
      )}
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}

/* ── StudioErrorState ─────────────────────────────────────────────── */

export interface StudioErrorStateProps {
  title: string;
  reason?: string;
  onRetry?: () => void;
  onViewLogs?: () => void;
  testId?: string;
}

export function StudioErrorState({
  title,
  reason,
  onRetry,
  onViewLogs,
  testId = "studio-error-state",
}: StudioErrorStateProps) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center justify-center gap-2 py-12 text-center"
    >
      <div
        className="grid h-10 w-10 place-items-center rounded-full"
        style={{ backgroundColor: "#ef444414" }}
      >
        <CircleAlert
          size={20}
          style={{ color: "#ef4444" }}
          className="pointer-events-none"
        />
      </div>
      <div
        className="text-[13px] font-semibold"
        style={{ color: "var(--text-secondary)" }}
      >
        {title}
      </div>
      {reason && (
        <div
          className="max-w-xs text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          {reason}
        </div>
      )}
      {(onRetry || onViewLogs) && (
        <div className="flex gap-1.5 pt-1">
          {onRetry && (
            <button
              type="button"
              data-testid="studio-error-retry"
              onClick={onRetry}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition hover:bg-white/10"
              style={{
                borderColor: "#22d3ee66",
                backgroundColor: "#22d3ee12",
                color: "#22d3ee",
              }}
            >
              Retry
            </button>
          )}
          {onViewLogs && (
            <button
              type="button"
              data-testid="studio-error-view-logs"
              onClick={onViewLogs}
              className="rounded-lg border px-3 py-1.5 text-[11px] font-bold transition hover:bg-white/10"
              style={{
                borderColor: "rgba(255,255,255,0.07)",
                backgroundColor: "rgba(255,255,255,0.04)",
                color: "var(--text-secondary)",
              }}
            >
              View logs
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/* ── StudioLoadingState ───────────────────────────────────────────── */

export interface StudioLoadingStateProps {
  steps?: string[];
  currentStep?: number;
  label?: string;
  testId?: string;
}

type StepState = "done" | "current" | "todo";

function stepStateFor(index: number, currentStep: number): StepState {
  if (index < currentStep) return "done";
  if (index === currentStep) return "current";
  return "todo";
}

export function StudioLoadingState({
  steps,
  currentStep = 0,
  label = "Loading…",
  testId = "studio-loading-state",
}: StudioLoadingStateProps) {
  return (
    <div
      data-testid={testId}
      className="flex flex-col items-center justify-center gap-3 py-12 text-center"
    >
      {steps && steps.length > 0 ? (
        <div className="flex w-full max-w-xs flex-col gap-2">
          {steps.map((step, index) => {
            const state = stepStateFor(index, currentStep);
            return (
              <div
                key={step}
                data-testid="studio-loading-step"
                data-step-state={state}
                className="flex items-center gap-2.5 text-left"
              >
                <span className="grid h-5 w-5 shrink-0 place-items-center">
                  {state === "done" ? (
                    <Check
                      size={14}
                      style={{ color: "#22d3ee" }}
                      className="pointer-events-none"
                    />
                  ) : state === "current" ? (
                    <span
                      className="h-2.5 w-2.5 animate-pulse rounded-full"
                      style={{ backgroundColor: "#22d3ee" }}
                    />
                  ) : (
                    <span
                      className="h-2.5 w-2.5 rounded-full"
                      style={{ backgroundColor: "rgba(255,255,255,0.15)" }}
                    />
                  )}
                </span>
                <span
                  className="text-[12px]"
                  style={{
                    color:
                      state === "todo"
                        ? "var(--text-muted)"
                        : "var(--text-secondary)",
                    fontWeight: state === "current" ? 700 : 500,
                  }}
                >
                  {step}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <>
          <Loader2
            size={24}
            style={{ color: "#22d3ee" }}
            className="pointer-events-none animate-spin"
          />
          <div
            className="text-[12px] font-medium"
            style={{ color: "var(--text-muted)" }}
          >
            {label}
          </div>
        </>
      )}
    </div>
  );
}
