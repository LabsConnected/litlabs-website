import Link from "next/link";
import { ArrowRight, GitBranch, Rocket, Sparkles, UserPlus } from "lucide-react";

const STEPS = [
  {
    icon: UserPlus,
    title: "Create your account",
    copy: "No credit card required. Start with the free Starter plan.",
    accent: "#a8ff2f",
  },
  {
    icon: GitBranch,
    title: "Start a project or connect GitHub",
    copy: "Use an existing repository or start fresh from a blank workspace.",
    accent: "#65f4ff",
  },
  {
    icon: Sparkles,
    title: "Give LiTT a mission",
    copy: "Explain what you want in normal language. LiTT understands the request.",
    accent: "#b58cff",
  },
  {
    icon: Rocket,
    title: "Watch LiTT work",
    copy: "LiTT plans, edits, creates, runs tools, and verifies progress.",
    accent: "#a8ff2f",
  },
  {
    icon: ArrowRight,
    title: "Review and ship",
    copy: "Inspect changes, approve sensitive actions, export, or deploy when ready.",
    accent: "#65f4ff",
  },
];

export function OnboardingSteps() {
  return (
    <section id="get-started" className="litt-section relative overflow-hidden border-t border-white/8">
      <div className="litt-grid-fade pointer-events-none absolute inset-0 opacity-25" />
      <div className="relative mx-auto max-w-[1500px] px-5 lg:px-8">
        <div data-reveal className="mx-auto max-w-3xl text-center">
          <div className="litt-eyebrow">
            <Rocket size={13} /> Start building in minutes
          </div>
          <h2 className="mt-5 text-[clamp(2.25rem,5vw,4.75rem)] font-black leading-[0.98] tracking-[-0.055em] text-white">
            From signup to first <span className="litt-gradient-text">mission in minutes.</span>
          </h2>
          <p className="mt-5 text-base leading-7 text-white/52 sm:text-lg sm:leading-8">
            No setup maze. No configuration wall. Create an account, give LiTT a mission, and watch the work happen.
          </p>
        </div>

        <div data-reveal className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {STEPS.map((step, index) => {
            const Icon = step.icon;
            return (
              <article
                key={step.title}
                className="litt-onboarding-card group"
                style={{ "--step-accent": step.accent, "--reveal-index": index } as React.CSSProperties}
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="litt-onboarding-icon">
                    <Icon size={18} />
                  </span>
                  <span className="font-mono text-[10px] font-black uppercase tracking-[0.16em] text-white/25">
                    0{index + 1}
                  </span>
                </div>
                <h3 className="mt-6 text-lg font-black tracking-[-0.025em] text-white">{step.title}</h3>
                <p className="mt-2.5 text-sm leading-6 text-white/50">{step.copy}</p>
              </article>
            );
          })}
        </div>

        <div data-reveal className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
          <Link href="/sign-up" className="litt-primary-button">
            Start building free <ArrowRight size={16} />
          </Link>
          <Link href="/pricing" className="litt-secondary-button">
            See pricing
          </Link>
        </div>
      </div>
    </section>
  );
}
