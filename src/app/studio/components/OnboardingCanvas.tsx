"use client";

import { useEffect, useState, useCallback } from "react";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import type { StudioTool } from "./StudioSidebar";
import {
  Check,
  Circle,
  Loader2,
  ArrowRight,
  X,
  Rocket,
  Image as ImageIcon,
  UploadCloud,
  GitBranch,
} from "lucide-react";

type StepStatus = "pending" | "active" | "completed";

interface OnboardingStep {
  id: string;
  index: number;
  title: string;
  description: string;
  icon: typeof GitBranch;
  ctaLabel: string;
  ctaAction: () => void;
  externalLink?: boolean;
}

const DISMISS_KEY = "litlabs:studio:onboarding-dismissed";

export default function OnboardingCanvas({
  onToolChange,
}: {
  onToolChange: (tool: StudioTool) => void;
}) {
  const { resolvedColors: T } = useTheme();
  const { isLoaded, isSignedIn } = useClerkAuth();
  const [dismissed, setDismissed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasProjects, setHasProjects] = useState(false);
  const [hasMissions, setHasMissions] = useState(false);
  const [hasArtifacts, setHasArtifacts] = useState(false);
  const [hasDeployments, setHasDeployments] = useState(false);

  useEffect(() => {
    try {
      setDismissed(localStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  const fetchData = useCallback(async () => {
    if (!isLoaded || !isSignedIn) {
      setLoading(false);
      return;
    }
    try {
      const [projectsRes, missionsRes, dashboardRes] = await Promise.allSettled([
        fetch("/api/projects", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/agent-tasks", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/dashboard", { cache: "no-store" }).then((r) => r.json()),
      ]);

      if (projectsRes.status === "fulfilled") {
        setHasProjects((projectsRes.value.projects ?? []).length > 0);
      }
      if (missionsRes.status === "fulfilled") {
        setHasMissions((missionsRes.value.tasks ?? []).length > 0);
      }
      if (dashboardRes.status === "fulfilled") {
        const d = dashboardRes.value;
        setHasArtifacts((d.deployments ?? []).length > 0 || (d.events ?? []).length > 0);
        setHasDeployments((d.deployments ?? []).length > 0);
      }
    } catch {
      // ignore — show all pending
    } finally {
      setLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // ignore
    }
  };

  if (dismissed) {
    return (
      <div className="flex h-full w-full items-center justify-center overflow-auto p-6">
        <div className="flex max-w-md flex-col items-center text-center">
          <div
            className="mb-4 grid h-12 w-12 place-items-center rounded-xl border"
            style={{
              borderColor: `${T.accentColor}30`,
              backgroundColor: `${T.accentColor}08`,
            }}
          >
            <span className="text-xl">🚀</span>
          </div>
          <h1
            className="mb-1 text-lg font-black tracking-tight text-white/90"
          >
            Welcome back
          </h1>
          <p className="mb-4 text-xs text-white/70">
            Ask LiTT in the panel to start building, or pick a tool from the rail.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            {(["image", "video", "code", "terminal"] as StudioTool[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => onToolChange(t)}
                className="rounded-lg border border-white/8 bg-white/3 px-3 py-1.5 text-[10px] font-bold text-white/70 transition hover:bg-white/8 hover:text-white"
              >
                {t === "code" ? "Code Editor" : t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const steps: OnboardingStep[] = [
    {
      id: "repo",
      index: 0,
      title: "Connect a Repository",
      description: "Link a GitHub repo so LiTT can read files, run commands, and deploy.",
      icon: GitBranch,
      ctaLabel: "Connect GitHub",
      ctaAction: () => {
        if (typeof window !== "undefined") {
          window.location.assign("/projects");
        }
      },
      externalLink: true,
    },
    {
      id: "mission",
      index: 1,
      title: "Start a Mission",
      description: "Create a mission and let LiTT break it into actionable steps.",
      icon: Rocket,
      ctaLabel: "Open Agents",
      ctaAction: () => onToolChange("agents"),
    },
    {
      id: "artifact",
      index: 2,
      title: "Create Your First Artifact",
      description: "Generate an image, video, or code snippet to see the creative engine in action.",
      icon: ImageIcon,
      ctaLabel: "Create Image",
      ctaAction: () => onToolChange("image"),
    },
    {
      id: "deploy",
      index: 3,
      title: "Deploy Your Work",
      description: "Ship your project to production with the pipeline tool.",
      icon: UploadCloud,
      ctaLabel: "Open Pipeline",
      ctaAction: () => onToolChange("pipeline"),
    },
  ];

  const completionFlags = [hasProjects, hasMissions, hasArtifacts, hasDeployments];
  const completedCount = completionFlags.filter(Boolean).length;
  const progressPct = Math.round((completedCount / steps.length) * 100);
  const activeIndex = completionFlags.findIndex((f) => !f);
  const allDone = completedCount === steps.length;

  const getStepStatus = (idx: number): StepStatus => {
    if (completionFlags[idx]) return "completed";
    if (idx === activeIndex) return "active";
    return "pending";
  };

  if (loading) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={24} className="animate-spin" style={{ color: T.accentColor }} />
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/60">
            Loading your studio
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full w-full items-center justify-center overflow-auto p-6">
      <div className="flex w-full max-w-lg flex-col">
        {/* Header */}
        <div className="mb-5 flex items-start justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-black tracking-tight text-white/90">
              {allDone ? "You're all set!" : "Set up your Studio"}
            </h1>
            <p className="text-xs text-white/70">
              {allDone
                ? "Every step is complete. Start building something great."
                : "Complete these steps to get the most out of LiTTree LabStudios."}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-white/60 hover:bg-white/8 hover:text-white/80"
            aria-label="Dismiss onboarding"
            title="Dismiss"
          >
            <X size={14} />
          </button>
        </div>

        {/* Progress bar */}
        <div className="mb-6 flex items-center gap-3">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/6">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${progressPct}%`,
                backgroundColor: T.accentColor,
                boxShadow: `0 0 8px ${T.accentColor}80`,
              }}
            />
          </div>
          <span className="text-[10px] font-black tabular-nums text-white/65">
            {completedCount}/{steps.length}
          </span>
        </div>

        {/* Steps */}
        <div className="flex flex-col gap-1">
          {steps.map((step) => {
            const status = getStepStatus(step.index);
            const Icon = step.icon;
            const isLast = step.index === steps.length - 1;

            return (
              <div key={step.id}>
                <div className="flex gap-3">
                  {/* Step rail */}
                  <div className="flex flex-col items-center">
                    <div
                      className="grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 transition-all"
                      style={{
                        borderColor:
                          status === "completed"
                            ? T.success
                            : status === "active"
                              ? T.accentColor
                              : "rgba(255,255,255,0.12)",
                        backgroundColor:
                          status === "completed"
                            ? `${T.success}15`
                            : status === "active"
                              ? `${T.accentColor}10`
                              : "transparent",
                        boxShadow:
                          status === "active"
                            ? `0 0 12px ${T.accentColor}40`
                            : "none",
                      }}
                    >
                      {status === "completed" ? (
                        <Check size={14} style={{ color: T.success }} />
                      ) : status === "active" ? (
                        <Icon size={14} style={{ color: T.accentColor }} />
                      ) : (
                        <Circle size={6} style={{ color: "rgba(255,255,255,0.25)" }} />
                      )}
                    </div>
                    {!isLast && (
                      <div
                        className="w-0.5 flex-1"
                        style={{
                          backgroundColor:
                            status === "completed"
                              ? `${T.success}40`
                              : "rgba(255,255,255,0.06)",
                          minHeight: 24,
                        }}
                      />
                    )}
                  </div>

                  {/* Step content */}
                  <div
                    className={`flex flex-1 flex-col gap-1.5 pb-4 ${status === "pending" ? "opacity-40" : ""}`}
                  >
                    <div className="flex items-center gap-2">
                      <span
                        className="text-[11px] font-black"
                        style={{
                          color:
                            status === "completed"
                              ? T.success
                              : status === "active"
                                ? "rgba(255,255,255,0.9)"
                                : "rgba(255,255,255,0.5)",
                        }}
                      >
                        {step.title}
                      </span>
                      {status === "completed" && (
                        <span
                          className="rounded-full px-1.5 py-0.5 text-[8px] font-black uppercase tracking-wider"
                          style={{
                            backgroundColor: `${T.success}15`,
                            color: T.success,
                          }}
                        >
                          Done
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] leading-relaxed text-white/65">
                      {step.description}
                    </p>
                    {status === "active" && (
                      <button
                        type="button"
                        onClick={step.ctaAction}
                        className="mt-1 flex w-fit items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-black transition hover:scale-[1.02]"
                        style={{
                          backgroundColor: `${T.accentColor}15`,
                          color: T.accentColor,
                          border: `1px solid ${T.accentColor}30`,
                        }}
                        aria-label={step.ctaLabel}
                      >
                        {step.ctaLabel}
                        <ArrowRight size={11} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        {allDone && (
          <div className="mt-2 flex flex-col items-center gap-2 rounded-xl border border-white/8 bg-white/2 p-4 text-center">
            <span className="text-lg">🎉</span>
            <span className="text-[11px] font-bold text-white/70">
              Your Studio is fully configured.
            </span>
            <button
              type="button"
              onClick={dismiss}
              className="text-[9px] font-bold text-white/60 hover:text-white/80"
            >
              Dismiss setup guide
            </button>
          </div>
        )}
        {!allDone && (
          <button
            type="button"
            onClick={dismiss}
            className="mt-3 self-center text-[9px] font-bold text-white/60 hover:text-white/80"
          >
            Skip setup
          </button>
        )}
      </div>
    </div>
  );
}
