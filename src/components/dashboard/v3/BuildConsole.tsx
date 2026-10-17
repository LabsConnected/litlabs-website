"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Code2,
  Gamepad2,
  Image as ImageIcon,
  Layout,
  Music,
  Palette,
  Play,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  createManagedStudioProject,
  deriveProjectNameFromPrompt,
  takeSubmissionKey,
  type CreateSubmission,
} from "@/lib/projects/create-project-request";

/**
 * BuildConsole — the dashboard's one universal composer.
 *
 * "What do you want to make?" + plain-English prompt input + creation-type
 * shortcuts. Submits route through /api/litt/intent (the same intent router
 * the old guided-start flow used) so LiTT opens the right Studio workspace;
 * if the router is unreachable it falls back to a direct Studio handoff —
 * never a dead end.
 */

const LIME = "#a8ff2f";

// Project-scope intents for which the dashboard composer may mint a
// project up front — and only when the router reports an explicit,
// unambiguous new-project request (actionMatched && requestsNewProject).
// Media intents route to their creator surfaces instead; chat,
// questions, debug/research/deploy and file-scope work never create.
// "mixed" and "agent_task" stay eligible so an explicit request like
// "create a new website project" (classified mixed) still works — the
// requestsNewProject signal is what gates them, not the intent alone.
const BUILD_INTENTS = new Set([
  "code",
  "website",
  "game",
  "agent_task",
  "mixed",
]);

// Media/design intents route into the Studio surface that actually
// produces them — minting a blank-static project for an image, a video
// or a song was a silent misroute.
const INTENT_SURFACES: Record<string, { creator?: string; tool?: string }> = {
  image: { creator: "image" },
  video: { creator: "video" },
  music: { creator: "music" },
  design: { tool: "design" },
};

const SUGGESTIONS = [
  { label: "Website", href: "/studio?tool=chat", icon: Layout },
  { label: "Image", href: "/studio?creator=image", icon: ImageIcon },
  { label: "Video", href: "/studio?creator=video", icon: Play },
  { label: "Music", href: "/studio?creator=music", icon: Music },
  { label: "Code", href: "/studio?tool=chat", icon: Code2 },
  { label: "Design", href: "/studio?tool=design", icon: Palette },
  { label: "Game", href: "/studio?creator=game", icon: Gamepad2 },
];

export function BuildConsole({ initialPrompt = "" }: { initialPrompt?: string }) {
  const router = useRouter();
  const { getToken } = useClerkAuth();
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isRouting, setIsRouting] = useState(false);
  const [routingMessage, setRoutingMessage] = useState<string | null>(null);
  // Submission key bound to the prompt fingerprint: an identical retry
  // reuses it; an edited prompt mints a fresh key.
  const createSubmissionRef = useRef<CreateSubmission | null>(null);

  // Deep links (e.g. the legacy /create redirect) can pre-fill the composer.
  useEffect(() => {
    if (initialPrompt) setPrompt(initialPrompt);
  }, [initialPrompt]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = prompt.trim();
    if (!text || isRouting) return;
    setIsRouting(true);
    setRoutingMessage(null);
    let payload: {
      type?: "intent" | "clarification";
      request?: { question?: string };
      result?: {
        primaryIntent?: string;
        action?: string;
        actionMatched?: boolean;
        requestsNewProject?: boolean;
      };
      plan?: { id?: string };
      error?: string;
    };
    try {
      const response = await fetch("/api/litt/intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      payload = (await response.json()) as typeof payload;
      if (!response.ok) {
        setRoutingMessage(payload.error || "LiTT could not route that request — try again.");
        setIsRouting(false);
        return;
      }
      if (payload.type === "clarification") {
        setRoutingMessage(
          payload.request?.question || "Tell LiTT what you want to work on.",
        );
        setIsRouting(false);
        return;
      }
    } catch {
      // The router could not tell a build request from a chat request —
      // creating a project or redirecting into an existing one would be a
      // silent misroute, so surface a retryable error instead of guessing.
      setRoutingMessage("LiTT could not route that request — try again.");
      setIsRouting(false);
      return;
    }

    const primaryIntent = payload.result?.primaryIntent;
    const planId = payload.plan?.id;
    const action = payload.result?.action;
    // Strictly-true checks so missing or malformed metadata fails closed.
    const actionMatched = payload.result?.actionMatched === true;
    const requestsNewProject = payload.result?.requestsNewProject === true;

    // Media/design intents route to the Studio surface that produces them
    // (the same surfaces the suggestion chips deep-link to) — they never
    // mint a blank-static project. The actionMatched requirement keeps a
    // mere question mentioning an image ("how do images work?") in chat.
    const surface =
      actionMatched && typeof primaryIntent === "string" ? INTENT_SURFACES[primaryIntent] : undefined;
    if (surface) {
      const params = new URLSearchParams({ prompt: text });
      if (surface.creator) params.set("creator", surface.creator);
      if (surface.tool) params.set("tool", surface.tool);
      if (primaryIntent) params.set("intent", primaryIntent);
      if (planId) params.set("planId", planId);
      router.push(`/studio?${params.toString()}`);
      return;
    }

    // Only an explicit, unambiguous new-project request may mint a
    // project: a matched create/generate verb AND the router's
    // requestsNewProject signal AND a project-scope intent. "create" is
    // also the router's default action for unmatched prompts, so the
    // action alone cannot carry the signal — chat, questions,
    // comparisons, file-scope work ("write a function"), edits to an
    // existing project, and any missing/contradictory metadata fall
    // through to the non-creating Studio chat route. Only an explicit
    // build mints and pins ?project=<new id> — ?prompt= alone resolves
    // to the most-recently-touched project and runs inside it.
    const isBuildRequest =
      actionMatched &&
      requestsNewProject &&
      (action === "create" || action === "generate") &&
      typeof primaryIntent === "string" &&
      BUILD_INTENTS.has(primaryIntent);
    if (isBuildRequest) {
      createSubmissionRef.current = takeSubmissionKey(createSubmissionRef.current, text);
      try {
        const project = await createManagedStudioProject({
          name: deriveProjectNameFromPrompt(text),
          templateId: "blank-static",
          getToken,
          idempotencyKey: createSubmissionRef.current.key,
        });
        const params = new URLSearchParams({
          tool: "chat",
          prompt: text,
          project: project.id,
        });
        if (primaryIntent) params.set("intent", primaryIntent);
        if (planId) params.set("planId", planId);
        router.push(`/studio?${params.toString()}`);
        createSubmissionRef.current = null;
      } catch (err) {
        setRoutingMessage(
          err instanceof Error ? err.message : "Couldn't create your project. Try again.",
        );
        setIsRouting(false);
      }
      // On success isRouting intentionally stays true: the button must
      // not accept a second submission while the navigation is pending.
      return;
    }

    const params = new URLSearchParams({ tool: "chat", prompt: text });
    if (primaryIntent) params.set("intent", primaryIntent);
    if (planId) params.set("planId", planId);
    router.push(`/studio?${params.toString()}`);
    // Same here: isRouting stays true until the page unmounts.
  };

  return (
    <section
      id="dashboard-guided-start"
      data-testid="dashboard-composer"
      className="scroll-mt-24"
      aria-label="Create something new"
    >
      <div
        className="relative overflow-hidden rounded-3xl border p-6 shadow-2xl md:p-10"
        style={{
          background:
            "linear-gradient(135deg, rgba(38,52,18,.92), rgba(10,12,8,.9))",
          borderColor: "rgba(168,255,47,.22)",
          boxShadow:
            "0 0 80px rgba(168,255,47,.08), inset 0 1px rgba(255,255,255,.06)",
          backdropFilter: "blur(16px)",
        }}
      >
        {/* Soft lime glow, top-right */}
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full blur-3xl"
          style={{ background: "rgba(168,255,47,.09)" }}
          aria-hidden
        />

        <div className="relative z-10">
          <h1
            className="text-3xl font-bold tracking-tight text-white md:text-4xl"
            style={{ letterSpacing: "-0.02em" }}
          >
            What do you want to make?
          </h1>
          <p className="mt-2.5 max-w-2xl text-[15px] leading-relaxed text-zinc-400">
            Describe it in plain words. LiTT opens the right Studio workspace
            and gets to work.
          </p>

          <form
            onSubmit={submit}
            className="mt-6 flex flex-col gap-3 sm:flex-row"
            data-testid="dashboard-composer-form"
          >
            <label className="sr-only" htmlFor="dashboard-composer-prompt">
              What do you want to make?
            </label>
            <input
              id="dashboard-composer-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="A website for my landscaping business…"
              autoComplete="off"
              className="min-h-14 min-w-0 flex-1 rounded-2xl border bg-black/40 px-5 text-[15px] text-white outline-none transition placeholder:text-zinc-600"
              style={{ borderColor: "rgba(255,255,255,.12)" }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "rgba(168,255,47,.55)";
                e.currentTarget.style.boxShadow =
                  "0 0 0 3px rgba(168,255,47,.12)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "rgba(255,255,255,.12)";
                e.currentTarget.style.boxShadow = "none";
              }}
              aria-label="Describe what you want to make"
            />
            <button
              type="submit"
              disabled={!prompt.trim() || isRouting}
              aria-busy={isRouting}
              className="inline-flex min-h-14 shrink-0 items-center justify-center gap-2 rounded-2xl px-7 text-[15px] font-black transition hover:brightness-110 active:scale-[.98] disabled:cursor-not-allowed disabled:opacity-40"
              style={{ background: LIME, color: "#0c1204" }}
            >
              {isRouting ? "Starting…" : "Create"} <ArrowRight size={17} aria-hidden />
            </button>
          </form>

          {routingMessage && (
            <p
              className="mt-3 text-sm leading-relaxed"
              role="status"
              aria-live="polite"
              style={{ color: "#fbbf24" }}
            >
              {routingMessage}
            </p>
          )}

          <div className="mt-7">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-[.2em] text-zinc-500">
              Or start with a type
            </p>
            <div className="flex flex-wrap gap-2.5">
              {SUGGESTIONS.map(({ label, href, icon: Icon }) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => router.push(href)}
                  className="inline-flex min-h-11 items-center gap-2 rounded-full border px-4 py-2 text-[13px] font-semibold text-zinc-200 transition hover:-translate-y-0.5 hover:text-white active:translate-y-0"
                  style={{
                    borderColor: "rgba(168,255,47,.25)",
                    background: "rgba(168,255,47,.07)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "rgba(168,255,47,.55)";
                    e.currentTarget.style.background = "rgba(168,255,47,.13)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "rgba(168,255,47,.25)";
                    e.currentTarget.style.background = "rgba(168,255,47,.07)";
                  }}
                >
                  <Icon size={15} style={{ color: LIME }} aria-hidden /> {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
