"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  Rocket,
  TrendingUp,
  Wrench,
  ShieldCheck,
  ArrowRight,
  Loader2,
  PenTool,
} from "lucide-react";

type Goal = "build" | "create" | "grow" | "maintain";
type Source = "new" | "existing";

const GOAL_OPTIONS: { id: Goal; label: string; description: string; icon: React.ReactNode; agent: string }[] = [
  {
    id: "build",
    label: "Build a website",
    description: "Launch a new site from scratch",
    icon: <Rocket className="h-5 w-5" />,
    agent: "litt-launch-agent",
  },
  {
    id: "create",
    label: "Create content",
    description: "Generate branded posts, images, and captions",
    icon: <PenTool className="h-5 w-5" />,
    agent: "spark-content-agent",
  },
  {
    id: "grow",
    label: "Grow my audience",
    description: "Build landing pages and campaigns",
    icon: <TrendingUp className="h-5 w-5" />,
    agent: "litt-growth-agent",
  },
  {
    id: "maintain",
    label: "Maintain my site",
    description: "Monitor and fix issues on an existing site",
    icon: <Wrench className="h-5 w-5" />,
    agent: "litt-site-care-agent",
  },
];

const SOURCE_OPTIONS: { id: Source; label: string; description: string }[] = [
  { id: "new", label: "Starting new", description: "I do not have a project yet" },
  { id: "existing", label: "Improving existing", description: "I have a project to improve" },
];

export default function StartPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const presetAgent = searchParams.get("agent");
  const { getToken, isSignedIn } = useClerkAuth();

  const [step, setStep] = useState(0);
  const [goal, setGoal] = useState<Goal | null>(presetAgent === "litt-launch-agent" ? "build" : null);
  const [source, setSource] = useState<Source | null>(null);
  const [brief, setBrief] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedGoal = GOAL_OPTIONS.find((g) => g.id === goal);
  const agentSlug = selectedGoal?.agent ?? "litt-launch-agent";

  const handleSubmit = async () => {
    if (!brief.trim()) {
      setError("Please describe what you want to accomplish.");
      return;
    }
    if (!isSignedIn) {
      const redirect = encodeURIComponent(`/start?agent=${agentSlug}`);
      router.push(`/sign-in?redirect_url=${redirect}`);
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken?.();
      const res = await fetch("/api/start/mission", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          goal,
          source,
          brief: brief.trim(),
          agentSlug,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || "Failed to start. Please try again.");
        setSubmitting(false);
        return;
      }

      // Redirect to the workspace or run page
      if (data.runId) {
        router.push(`/launch-agent/${data.runId}`);
      } else if (data.projectId) {
        router.push(`/studio?agent=${agentSlug}&project=${data.projectId}`);
      } else {
        router.push("/dashboard");
      }
    } catch {
      setError("Network error. Please try again.");
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950">
      <div className="mx-auto max-w-2xl px-6 py-16">
        {/* Header */}
        <div className="mb-12 text-center">
          <h1 className="text-3xl font-black text-white">What do you want LiTT to help you finish?</h1>
          <p className="mt-2 text-sm text-neutral-500">
            Answer three quick questions and we will set everything up for you.
          </p>
        </div>

        {/* Progress */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className={`h-1.5 w-12 rounded-full transition-colors ${
                i <= step ? "bg-cyan-500" : "bg-neutral-800"
              }`}
            />
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-6 rounded-lg border border-red-900 bg-red-950/50 p-3 text-sm text-red-400">
            {error}
          </div>
        )}

        {/* Step 0: Goal */}
        {step === 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">What are you trying to accomplish?</h2>
            <div className="grid gap-3">
              {GOAL_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setGoal(opt.id);
                    setStep(1);
                  }}
                  className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-all hover:border-cyan-600 hover:bg-neutral-900 ${
                    goal === opt.id ? "border-cyan-600 bg-neutral-900" : "border-neutral-800 bg-neutral-950"
                  }`}
                >
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-neutral-800 text-cyan-400">
                    {opt.icon}
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white">{opt.label}</div>
                    <div className="text-xs text-neutral-500">{opt.description}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-neutral-600" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Source */}
        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">Are you starting new or improving something existing?</h2>
            <div className="grid gap-3">
              {SOURCE_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  onClick={() => {
                    setSource(opt.id);
                    setStep(2);
                  }}
                  className={`flex items-center gap-4 rounded-xl border p-4 text-left transition-all hover:border-cyan-600 hover:bg-neutral-900 ${
                    source === opt.id ? "border-cyan-600 bg-neutral-900" : "border-neutral-800 bg-neutral-950"
                  }`}
                >
                  <div className="flex-1">
                    <div className="text-sm font-bold text-white">{opt.label}</div>
                    <div className="text-xs text-neutral-500">{opt.description}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-neutral-600" />
                </button>
              ))}
            </div>
            <button
              onClick={() => setStep(0)}
              className="text-xs text-neutral-500 hover:text-neutral-300"
            >
              ← Back
            </button>
          </div>
        )}

        {/* Step 2: Brief */}
        {step === 2 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white">Describe what you need</h2>
            <p className="text-xs text-neutral-500">
              {selectedGoal && `Selected agent: ${selectedGoal.label}`}
              {source && ` · ${source === "new" ? "Starting new" : "Improving existing"}`}
            </p>
            <textarea
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="e.g., I need a landing page for my music studio. It should show my services, have a contact form, and look dark and modern."
              rows={5}
              className="w-full rounded-xl border border-neutral-800 bg-neutral-900 p-4 text-sm text-white placeholder-neutral-600 focus:border-cyan-600 focus:outline-none"
              autoFocus
            />
            <div className="flex items-center gap-3">
              <button
                onClick={handleSubmit}
                disabled={submitting || !brief.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-cyan-600 px-6 py-3 text-sm font-bold text-white hover:bg-cyan-500 disabled:opacity-50"
              >
                {submitting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <Rocket className="h-4 w-4" />
                    {isSignedIn ? "Start" : "Sign in & Start"}
                  </>
                )}
              </button>
              <button
                onClick={() => setStep(1)}
                className="text-xs text-neutral-500 hover:text-neutral-300"
              >
                ← Back
              </button>
            </div>
            {!isSignedIn && (
              <p className="text-xs text-neutral-600">
                You will be asked to sign in. Your answers will be preserved.
              </p>
            )}
          </div>
        )}

        {/* Trust indicator */}
        <div className="mt-12 flex items-center justify-center gap-2 text-xs text-neutral-600">
          <ShieldCheck className="h-4 w-4" />
          You approve every important action. Nothing deploys without your say-so.
        </div>
      </div>
    </div>
  );
}
