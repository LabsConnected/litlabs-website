"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, MoonStar, Pause, Play } from "lucide-react";

/**
 * HowItsMade — the mockup's interactive "How a webpage gets made" stepper.
 *
 * Replaces the old StudioTour trailer section: instead of watching a
 * recorded tour, visitors walk the six real steps themselves. Copy is the
 * approved mockup's, verbatim. Auto-play is opt-in only and is disabled
 * entirely under prefers-reduced-motion.
 */

const STEPS = [
  {
    title: "Describe it",
    sub: "Say what you want, plainly",
    body: "Open Studio and type one honest sentence about your page — who it's for, what it should do. No keywords, no code, no “prompt engineering.” Plain words are the whole instruction set.",
    art: "YOU TYPE:\n“A simple site for my dog-grooming business —\nservices, prices, and a booking button.”",
  },
  {
    title: "LiTT generates it",
    sub: "A real first draft appears",
    body: "LiTT builds the page from your sentence: layout, sections, real photos, and your words in place. This is a full draft — not a wireframe you still have to finish yourself.",
    art: "LITT BUILDS:\nHome · Services · Prices · Book\nPhotos placed ✓  Buttons wired ✓",
  },
  {
    title: "Preview it live",
    sub: "See exactly what visitors see",
    body: "The preview is the real page, not a picture of it. Check it on desktop and phone size before anyone else ever sees it — what you see is what ships.",
    art: "PREVIEW:\nDesktop ✓   Phone ✓   Nothing hidden",
  },
  {
    title: "Edit by talking",
    sub: "Change anything in a sentence",
    body: "Too dark? Say so. Wrong photo? Say which one. Every edit is just another plain sentence, and the preview updates while you watch.",
    art: "YOU SAY:\n“Make the header warmer and move\nthe booking button to the top.”  →  Done ✓",
  },
  {
    title: "LiTT verifies it",
    sub: "Checks run before publish",
    body: "Before anything goes live, LiTT checks the work: pages load, photos aren't broken, buttons do what they promise. If something fails, you hear about it — it never quietly ships broken.",
    art: "CHECKS:\nPages ✓  Photos ✓  Buttons ✓  Ready ✓",
  },
  {
    title: "Publish it",
    sub: "Live on your LiTT address",
    body: "One tap and the page is live at your own LiTT address — a real link you can text, post, and share. Changed your mind later? Edit and republish; the address stays the same.",
    art: "LIVE AT:\nyourname.litlabs.net  →  share it anywhere",
  },
] as const;

const AUTOPLAY_MS = 3400;

export function HowItsMade() {
  const [cur, setCur] = useState(0);
  const [auto, setAuto] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReducedMotion(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const stopAuto = useCallback(() => {
    setAuto(false);
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  const show = useCallback((i: number) => {
    setCur(((i % STEPS.length) + STEPS.length) % STEPS.length);
  }, []);

  useEffect(() => {
    if (!auto || reducedMotion) return;
    timer.current = setInterval(() => {
      setCur((c) => (c + 1) % STEPS.length);
    }, AUTOPLAY_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
      timer.current = null;
    };
  }, [auto, reducedMotion]);

  const pick = (i: number) => {
    stopAuto();
    show(i);
  };

  const focusStep = (i: number) => {
    const clamped = Math.max(0, Math.min(STEPS.length - 1, i));
    pick(clamped);
    tabRefs.current[clamped]?.focus();
  };

  const onTabKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case "ArrowDown":
      case "ArrowRight":
        e.preventDefault();
        focusStep(index + 1);
        break;
      case "ArrowUp":
      case "ArrowLeft":
        e.preventDefault();
        focusStep(index - 1);
        break;
      case "Home":
        e.preventDefault();
        focusStep(0);
        break;
      case "End":
        e.preventDefault();
        focusStep(STEPS.length - 1);
        break;
    }
  };

  const step = STEPS[cur];

  return (
    <section
      id="how-a-webpage-gets-made"
      aria-labelledby="how-its-made-title"
      className="litt-section relative overflow-hidden"
    >
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow justify-center">
            <MoonStar size={13} /> The After Midnight method
          </div>
          <h2
            id="how-its-made-title"
            className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-[#0E1510]"
          >
            How a webpage gets made — <span className="litt-gradient-text">even after midnight.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-[#63745F] sm:text-lg sm:leading-8">
            The same six steps the film just showed, at your pace. Walk them yourself — this is the whole process, nothing hidden.
          </p>
        </div>

        <div data-reveal className="litt-stepper mx-auto mt-12 max-w-5xl">
          <div role="tablist" aria-label="How a webpage gets made, step by step" className="flex flex-col gap-2">
            {STEPS.map((s, i) => (
              <button
                key={s.title}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`how-step-tab-${i}`}
                aria-selected={i === cur}
                aria-controls="how-step-panel"
                tabIndex={i === cur ? 0 : -1}
                onClick={() => pick(i)}
                onKeyDown={(e) => onTabKeyDown(e, i)}
                className="litt-step-btn"
              >
                <span className="num">0{i + 1}</span>
                <span>
                  <strong className="block text-sm font-black text-[#0E1510]">{s.title}</strong>
                  <small className="block text-xs font-semibold text-[#63745F]">{s.sub}</small>
                </span>
              </button>
            ))}
          </div>

          <div
            id="how-step-panel"
            role="tabpanel"
            aria-labelledby={`how-step-tab-${cur}`}
            aria-live="polite"
            className="litt-step-pane"
          >
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-[#177A36]">
              Step {cur + 1} of {STEPS.length}
            </p>
            <h3 className="mt-3 text-3xl font-black tracking-[-0.03em] text-[#0E1510]">{step.title}</h3>
            <p className="mt-3 max-w-xl text-base leading-7 text-[#37463A]">{step.body}</p>
            <div className="litt-step-art mt-6" aria-hidden="true">{step.art}</div>
            <div className="litt-step-nav mt-7 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => { stopAuto(); show(cur - 1); }}>
                <ChevronLeft size={14} /> Back
              </button>
              <button type="button" onClick={() => { stopAuto(); show(cur + 1); }}>
                Next <ChevronRight size={14} />
              </button>
              <button
                type="button"
                aria-pressed={auto}
                disabled={reducedMotion}
                title={reducedMotion ? "Auto-play is off when reduced motion is preferred" : undefined}
                onClick={() => (auto ? stopAuto() : setAuto(true))}
              >
                {auto ? (
                  <>
                    <Pause size={13} /> Pause
                  </>
                ) : (
                  <>
                    <Play size={13} /> Auto-play
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
