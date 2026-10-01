"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import LiTTPresence from "./LiTTPresence";

/**
 * FirstRunWelcome — the dedicated welcome screen for fresh users.
 *
 * Shown when a user arrives in Studio with zero projects. This is the
 * single entry point for first-run: one prompt, one action, no competing CTAs.
 *
 * Flow:
 *  1. User sees "Welcome" + "What do you want to build?"
 *  2. User types their idea and submits
 *  3. Parent creates the project, selects it, preloads chat
 *  4. User lands in Studio ready to build
 */
export default function FirstRunWelcome({
  displayName,
  onSubmit,
  isCreating,
  error,
  onRetry,
}: {
  displayName?: string | null;
  onSubmit: (idea: string) => void;
  isCreating: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const [idea, setIdea] = useState("");
  const greetingName = displayName?.trim();
  const canSubmit = idea.trim().length > 0 && !isCreating;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canSubmit) {
      onSubmit(idea.trim());
    }
  };

  return (
    <div
      className="relative flex min-h-full flex-col items-center justify-center overflow-hidden px-4 py-8"
      style={{ color: "var(--text-primary)" }}
      data-testid="first-run-welcome"
      aria-label="Welcome to LiTT"
    >
      <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-6">
        {/* LiTT presence */}
        <div className="relative grid min-h-[120px] place-items-center">
          <LiTTPresence state="idle" variant="empty-state" size="xl" />
          <span
            className="glass-status-pill absolute -bottom-2"
            style={{
              borderColor: "var(--glass-border-green)",
              color: "var(--glass-green)",
            }}
          >
            LiTT · Ready
          </span>
        </div>

        {/* Welcome headline */}
        <div className="max-w-xl text-center">
          <h1
            className="text-2xl font-black tracking-tight sm:text-3xl"
            style={{ color: "var(--text-primary)" }}
          >
            {greetingName ? `Welcome, ${greetingName}` : "Welcome to LiTT"}
          </h1>
          <p
            className="mx-auto mt-3 max-w-lg text-[15px] leading-relaxed sm:text-base"
            style={{ color: "var(--text-secondary)" }}
          >
            What do you want to build?
          </p>
          <p
            className="mx-auto mt-2 max-w-lg text-[13px] leading-relaxed"
            style={{ color: "var(--text-muted)" }}
          >
            Describe your idea in plain words. LiTT will set up your project
            and start building with you.
          </p>
        </div>

        {/* Idea input */}
        <form onSubmit={handleSubmit} className="w-full max-w-xl" data-testid="first-run-form">
          <div
            className="flex flex-col gap-3 rounded-2xl border p-3"
            style={{
              borderColor: "var(--studio-border-strong)",
              backgroundColor: "rgba(255,255,255,0.02)",
            }}
          >
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="e.g. A website for my roofing business with online booking…"
              rows={3}
              disabled={isCreating}
              className="w-full resize-none bg-transparent px-2 py-1 text-[15px] outline-none placeholder:text-zinc-600"
              style={{ color: "var(--text-primary)" }}
              data-testid="first-run-idea-input"
              aria-label="What do you want to build?"
            />
            <div className="flex items-center justify-end">
              <button
                type="submit"
                disabled={!canSubmit}
                className="flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-bold transition-all disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  backgroundColor: "var(--litt-primary)",
                  color: "#000",
                }}
                data-testid="first-run-submit"
              >
                {isCreating ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Creating your project…
                  </>
                ) : (
                  <>
                    <Sparkles size={16} />
                    Start building
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </div>
        </form>

        {/* Error recovery */}
        {error && (
          <div
            className="w-full max-w-xl rounded-xl border p-4 text-center"
            style={{
              borderColor: "#fca5a5",
              backgroundColor: "rgba(252,165,165,0.08)",
            }}
            role="alert"
            data-testid="first-run-error"
          >
            <p className="text-sm font-bold" style={{ color: "#fca5a5" }}>
              Couldn't create your project
            </p>
            <p className="mt-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
              {error}
            </p>
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 rounded-lg border px-4 py-2 text-sm font-bold"
              style={{
                borderColor: "var(--studio-border-strong)",
                color: "var(--text-primary)",
              }}
              data-testid="first-run-retry"
            >
              Try again
            </button>
          </div>
        )}

        {/* Subtle hint — no competing CTAs */}
        <p
          className="text-[12px]"
          style={{ color: "var(--text-muted)" }}
        >
          No setup needed. Just describe it and go.
        </p>
      </div>
    </div>
  );
}
