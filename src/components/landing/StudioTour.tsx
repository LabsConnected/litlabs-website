"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clapperboard,
  FileCode2,
  ListChecks,
  MessageSquareText,
  Pause,
  Play,
  Rocket,
  RotateCcw,
  Terminal,
} from "lucide-react";
import { track } from "@/lib/analytics";

/**
 * StudioTour — Recorded guided tour of a full Studio build.
 *
 * This is an honestly CANNED walkthrough: scripted steps play back in
 * Studio-like chrome so visitors can see what full Studio can do. It is
 * NOT live and NOT interactive:
 * - no simulated chat input that pretends to call the model
 * - no fake cursors, typing indicators, or "live"/"real-time" wording
 * - every step is labeled "Recorded tour" / "recorded example"
 *
 * The final step embeds the real product trailer (public/demos/), so the
 * existing trailer asset stays integrated rather than duplicated.
 *
 * CTAs: "Try the live demo" -> /demo (the real capped demo lane),
 * "Start building free" -> /sign-up.
 */

const VIDEO_SOURCES = [
  { src: "/demos/litt-trailer.webm", type: "video/webm" },
  { src: "/demos/litt-trailer.mp4", type: "video/mp4" },
];
const POSTER_SRC = "/demos/litt-trailer-poster.jpg";

// How long each scripted step stays on screen during autoplay (ms).
const STEP_DWELL_MS = 5200;

interface TourStep {
  id: string;
  /** Short tab label. */
  label: string;
  icon: typeof Play;
  /** Heading inside the Studio chrome. */
  title: string;
  body: React.ReactNode;
}

/** Canned example brief — static text, never typed or sent anywhere. */
function BriefStepBody() {
  return (
    <div className="flex h-full flex-col justify-center gap-4 p-5 sm:p-8">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
        Example brief &middot; recorded
      </p>
      <blockquote className="max-w-xl rounded-2xl border border-white/10 bg-white/[0.04] p-5 text-left">
        <p className="text-base leading-7 text-white/85 sm:text-lg sm:leading-8">
          &ldquo;Build me a booking site for my dog-walking business &mdash;
          services, prices, online booking, and payments. Keep it friendly and
          mobile-first.&rdquo;
        </p>
      </blockquote>
      <p className="text-sm leading-6 text-white/45">
        One plain-language description is all a full Studio build starts with.
      </p>
    </div>
  );
}

function PlanStepBody() {
  const items = [
    { file: "Pages", detail: "Home, Services, Booking, Payments" },
    { file: "Design", detail: "Warm, friendly, mobile-first" },
    { file: "Data", detail: "Bookings, customers, payments" },
    { file: "Launch", detail: "Preview, verify, deploy" },
  ];
  return (
    <div className="flex h-full flex-col justify-center gap-4 p-5 sm:p-8">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
        LiTT&rsquo;s plan &middot; recorded
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item) => (
          <li
            key={item.file}
            className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-4"
          >
            <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-md bg-accent/12 text-accent">
              <Check size={13} strokeWidth={3} />
            </span>
            <span>
              <span className="block text-sm font-extrabold text-white">
                {item.file}
              </span>
              <span className="block text-sm text-white/50">{item.detail}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-sm leading-6 text-white/45">
        You see and approve the plan before any work begins.
      </p>
    </div>
  );
}

function BuildStepBody() {
  const files = [
    { path: "app/page.tsx", note: "Home page" },
    { path: "app/services/page.tsx", note: "Services & prices" },
    { path: "app/booking/page.tsx", note: "Booking flow" },
    { path: "app/api/payments/route.ts", note: "Payments" },
    { path: "components/booking-calendar.tsx", note: "Calendar widget" },
  ];
  return (
    <div className="grid h-full gap-0 sm:grid-cols-[1fr_1.4fr]">
      <div className="border-b border-white/8 p-5 sm:border-b-0 sm:border-r sm:p-6">
        <p className="mb-3 text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
          Files &middot; recorded
        </p>
        <ul className="space-y-1.5">
          {files.map((f) => (
            <li
              key={f.path}
              className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-3 py-2 font-mono text-[12px] text-white/70"
            >
              <FileCode2 size={13} className="shrink-0 text-accent" />
              <span className="truncate">{f.path}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col justify-center gap-3 p-5 sm:p-6">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
          <Terminal size={11} className="mr-1.5 inline-block text-accent" />
          Build log &middot; recorded
        </p>
        <pre className="overflow-x-auto rounded-xl border border-white/10 bg-[#05070d] p-4 font-mono text-[12px] leading-6 text-white/60">
{`$ litt build "dog-walking site"
  plan approved ............ ok
  5 files written .......... ok
  tests .................... 14 passed
  preview .................. ready`}
        </pre>
        <p className="text-sm leading-6 text-white/45">
          Real files land in your project &mdash; nothing is mocked away.
        </p>
      </div>
    </div>
  );
}

function PreviewStepBody() {
  return (
    <div className="flex h-full flex-col justify-center gap-4 p-5 sm:p-8">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
        Preview &middot; recorded example
      </p>
      {/* A static, clearly-labeled mock of the example site — no fake URL. */}
      <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#0b0f16]">
        <div className="flex items-center gap-1.5 border-b border-white/8 bg-white/[0.03] px-4 py-2.5">
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
          <span className="ml-3 text-[11px] font-bold uppercase tracking-[0.14em] text-white/35">
            Example preview &mdash; recorded
          </span>
        </div>
        <div className="p-5 sm:p-7">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-accent">
            Happy Tails Walking Co.
          </p>
          <p className="mt-2 text-xl font-black text-white sm:text-2xl">
            Dog walking, booked in 60 seconds.
          </p>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {["Solo walk $25", "Group walk $18", "Puppy visit $30"].map(
              (service) => (
                <div
                  key={service}
                  className="rounded-lg border border-white/10 bg-white/[0.03] px-2 py-3 text-center text-[11px] font-bold text-white/65"
                >
                  {service}
                </div>
              ),
            )}
          </div>
          <div className="mt-4 inline-flex items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-sm font-extrabold text-black">
            Book a walk <Rocket size={14} />
          </div>
        </div>
      </div>
      <p className="text-sm leading-6 text-white/45">
        The preview updates as the build runs &mdash; then it&rsquo;s one tap
        to deploy.
      </p>
    </div>
  );
}

function TrailerStepBody() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-5 sm:p-8">
      <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-white/40">
        Product trailer &middot; recorded
      </p>
      <div className="w-full max-w-[300px] overflow-hidden rounded-[1.75rem] border border-white/10 shadow-[0_30px_80px_rgba(0,0,0,.55)]">
        <video
          className="aspect-[9/16] w-full object-cover"
          autoPlay
          muted
          loop
          playsInline
          poster={POSTER_SRC}
          controls
          preload="metadata"
          aria-label="Recorded LiTT product trailer"
        >
          {VIDEO_SOURCES.map((s) => (
            <source key={s.src} src={s.src} type={s.type} />
          ))}
        </video>
      </div>
      <p className="max-w-md text-center text-sm leading-6 text-white/45">
        A real LiTT session, on a real project. This is what the full Studio
        feels like.
      </p>
    </div>
  );
}

const TOUR_STEPS: TourStep[] = [
  {
    id: "brief",
    label: "The brief",
    icon: MessageSquareText,
    title: "Step 1 — Describe your idea",
    body: <BriefStepBody />,
  },
  {
    id: "plan",
    label: "The plan",
    icon: ListChecks,
    title: "Step 2 — LiTT plans the build",
    body: <PlanStepBody />,
  },
  {
    id: "build",
    label: "The build",
    icon: FileCode2,
    title: "Step 3 — Files take shape",
    body: <BuildStepBody />,
  },
  {
    id: "preview",
    label: "The preview",
    icon: Play,
    title: "Step 4 — Preview the result",
    body: <PreviewStepBody />,
  },
  {
    id: "trailer",
    label: "Real session",
    icon: Clapperboard,
    title: "Step 5 — A real session",
    body: <TrailerStepBody />,
  },
];

export function StudioTour() {
  const [active, setActive] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    // Never autoplay the scripted tour for users who prefer reduced motion.
    if (mq.matches) setPlaying(false);
    const onChange = (e: MediaQueryListEvent) => {
      setReducedMotion(e.matches);
      if (e.matches) setPlaying(false);
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!playing || reducedMotion) return;
    timer.current = setInterval(() => {
      setActive((i) => {
        if (i >= TOUR_STEPS.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, STEP_DWELL_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, reducedMotion]);

  const goTo = (index: number) => {
    setActive(Math.max(0, Math.min(TOUR_STEPS.length - 1, index)));
  };

  const togglePlay = () => {
    if (!playing && active >= TOUR_STEPS.length - 1) {
      setActive(0); // Replay from the start.
    }
    setPlaying((p) => !p);
  };

  const step = TOUR_STEPS[active];
  const StepIcon = step.icon;

  return (
    <section
      id="studio-tour"
      aria-labelledby="studio-tour-heading"
      className="litt-section relative overflow-hidden border-t border-white/8 bg-[#05070d]"
    >
      <div className="pointer-events-none absolute left-1/2 top-0 h-[380px] w-[680px] -translate-x-1/2 rounded-full bg-accent/6 blur-[140px]" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow">
            <Clapperboard size={13} aria-hidden /> Recorded tour
          </div>
          <h2
            id="studio-tour-heading"
            className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-white"
          >
            Guided demo &mdash;{" "}
            <span className="litt-gradient-text">see what LiTT can do.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-white/52 sm:text-lg sm:leading-8">
            A scripted, step-by-step walkthrough of a full Studio build &mdash;
            brief to plan to files to preview to launch. This page section is a
            recording: nothing here is interactive, no messages are sent, and no
            model is called.
          </p>
        </div>

        <div data-reveal className="mx-auto mt-12 max-w-4xl">
          {/* Studio-like chrome, honestly labeled as a recording. */}
          <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-[#070a12] shadow-[0_30px_80px_rgba(0,0,0,.55)]">
            <div className="flex items-center gap-3 border-b border-white/8 bg-white/[0.03] px-4 py-3 sm:px-5">
              <span className="flex gap-1.5" aria-hidden>
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
                <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
              </span>
              <span className="truncate text-xs font-bold text-white/45">
                Studio &mdash; full build
              </span>
              <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-full border border-accent/30 bg-accent/10 px-3 py-1 text-[11px] font-extrabold uppercase tracking-[0.14em] text-accent">
                <Clapperboard size={12} aria-hidden /> Recorded tour
              </span>
            </div>

            {/* Step body */}
            <div
              className="min-h-[420px] sm:min-h-[460px]"
              role="region"
              aria-live="polite"
              aria-label={`Tour step ${active + 1} of ${TOUR_STEPS.length}: ${step.title}`}
            >
              <div key={step.id} className="h-full">
                {step.body}
              </div>
            </div>

            {/* Stepper controls */}
            <div className="flex flex-wrap items-center gap-3 border-t border-white/8 bg-white/[0.02] px-4 py-3 sm:px-5">
              <button
                type="button"
                onClick={togglePlay}
                aria-label={playing ? "Pause the tour" : "Play the tour"}
                className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-white/[0.05] text-white transition hover:border-accent/50 hover:text-accent"
              >
                {playing ? (
                  <Pause size={15} aria-hidden />
                ) : active >= TOUR_STEPS.length - 1 ? (
                  <RotateCcw size={15} aria-hidden />
                ) : (
                  <Play size={15} aria-hidden className="ml-0.5" />
                )}
              </button>
              <button
                type="button"
                onClick={() => goTo(active - 1)}
                disabled={active === 0}
                aria-label="Previous tour step"
                className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-white/[0.05] text-white transition hover:border-accent/50 hover:text-accent disabled:opacity-30 disabled:hover:border-white/12 disabled:hover:text-white"
              >
                <ChevronLeft size={16} aria-hidden />
              </button>
              <button
                type="button"
                onClick={() => goTo(active + 1)}
                disabled={active === TOUR_STEPS.length - 1}
                aria-label="Next tour step"
                className="grid h-9 w-9 place-items-center rounded-full border border-white/12 bg-white/[0.05] text-white transition hover:border-accent/50 hover:text-accent disabled:opacity-30 disabled:hover:border-white/12 disabled:hover:text-white"
              >
                <ChevronRight size={16} aria-hidden />
              </button>

              <ol className="ml-1 flex flex-wrap items-center gap-1.5" aria-label="Tour steps">
                {TOUR_STEPS.map((s, i) => {
                  const SIcon = s.icon;
                  const isActive = i === active;
                  return (
                    <li key={s.id}>
                      <button
                        type="button"
                        onClick={() => goTo(i)}
                        aria-label={`Go to step ${i + 1}: ${s.label}`}
                        aria-current={isActive ? "step" : undefined}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-bold transition ${
                          isActive
                            ? "border-accent/50 bg-accent/12 text-accent"
                            : "border-white/10 bg-white/[0.03] text-white/45 hover:border-white/25 hover:text-white/75"
                        }`}
                      >
                        <SIcon size={12} aria-hidden />
                        <span className="hidden sm:inline">{s.label}</span>
                        <span className="sm:hidden">{i + 1}</span>
                      </button>
                    </li>
                  );
                })}
              </ol>

              <span className="ml-auto hidden items-center gap-1.5 text-[11px] font-bold text-white/35 md:inline-flex">
                <StepIcon size={12} aria-hidden className="text-accent" />
                {step.title}
              </span>
            </div>
          </div>

          <p className="mt-4 text-center text-xs leading-5 text-white/35">
            Recorded demonstration. For the real thing, try the interactive
            demo lane or start building free.
          </p>

          {/* CTAs */}
          <div
            data-reveal
            className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center"
          >
            <Link
              href="/demo"
              className="litt-primary-button"
              onClick={() =>
                track("tour_cta_click", { source: "studio_tour", target: "demo" })
              }
            >
              Try the live demo <Play size={14} aria-hidden />
            </Link>
            <Link
              href="/sign-up"
              className="litt-secondary-button"
              onClick={() =>
                track("tour_cta_click", {
                  source: "studio_tour",
                  target: "signup",
                })
              }
            >
              Start building free <ChevronRight size={14} aria-hidden />
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
