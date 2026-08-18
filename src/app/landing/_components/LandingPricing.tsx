/**
 * LandingPricing — pricing teaser aligned with canonical plans.
 *
 * Reads from @/config/plans (the pricing authority) and displays the
 * three customer-facing plans: Starter, Creator Beta, Pro Builder Beta.
 * Does NOT duplicate pricing logic — only renders canonical values.
 *
 * V1 spec: keep it simple.
 *   - free entry
 *   - paid beta plans with clear allowances
 *   - BYOK
 *   - link to full /pricing page for details
 */

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { PLANS, formatPrice, type PlanId } from "@/config/plans";

type Tier = {
  id: PlanId;
  name: string;
  price: string;
  period: string;
  tagline: string;
  features: string[];
  cta: string;
  href: string;
  highlight: boolean;
  color: string;
};

const TIERS: Tier[] = [
  {
    id: "starter",
    name: PLANS.starter.name,
    price: formatPrice(PLANS.starter.default_price),
    period: "forever",
    tagline: "Start building, no card required.",
    features: [
      `${PLANS.starter.monthlyCredits.toLocaleString()} AI credits (one-time)`,
      `${PLANS.starter.activeProjectLimit} active project`,
      "Code generation & image generation",
      "Community support",
    ],
    cta: "Start Free",
    href: "/sign-up",
    highlight: false,
    color: "#34d399",
  },
  {
    id: "creator_beta",
    name: PLANS.creator_beta.name,
    price: formatPrice(PLANS.creator_beta.default_price),
    period: "/month · beta",
    tagline: "Research, write, and market with AI agents.",
    features: [
      `${PLANS.creator_beta.monthlyCredits.toLocaleString()} AI credits per billing cycle`,
      `${PLANS.creator_beta.activeProjectLimit} active projects`,
      "Private projects & GitHub connection",
      "Voice mode & preview deployments",
    ],
    cta: "Choose Creator",
    href: "/pricing",
    highlight: true,
    color: "#a855f7",
  },
  {
    id: "pro_builder_beta",
    name: PLANS.pro_builder_beta.name,
    price: formatPrice(PLANS.pro_builder_beta.default_price),
    period: "/month · beta",
    tagline: "Build, debug, and deploy with full AI tooling.",
    features: [
      `${PLANS.pro_builder_beta.monthlyCredits.toLocaleString()} AI credits per billing cycle`,
      `${PLANS.pro_builder_beta.activeProjectLimit} active projects`,
      "Terminal runtime & advanced coding models",
      "Vercel deployment & Supabase integration",
    ],
    cta: "Choose Pro",
    href: "/pricing",
    highlight: false,
    color: "#30e7ff",
  },
];

export function LandingPricing() {
  return (
    <section id="pricing" className="relative z-10 border-t border-white/5 px-4 py-24 md:py-32" style={{ background: "rgba(255,255,255,0.01)" }}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-14 text-center">
          <div className="mb-3 inline-flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-violet-300">
            <span className="h-px w-8 bg-violet-400/40" />
            Pricing · Beta
            <span className="h-px w-8 bg-violet-400/40" />
          </div>
          <h2 className="mb-4 text-3xl font-black tracking-tight text-white md:text-5xl">
            Free to start.
            <br />
            <span className="bg-gradient-to-r from-violet-300 via-emerald-300 to-cyan-300 bg-clip-text text-transparent">
              Pay for what you use.
            </span>
          </h2>
          <p className="mx-auto max-w-xl text-base text-neutral-400">
            Start free with 500 AI credits. Upgrade to a paid beta plan for more projects,
            credits, and capabilities. Bring your own model keys to pay even less.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.id}
              className={`relative overflow-hidden rounded-2xl border p-7 transition-all duration-300 ${
                tier.highlight ? "border-violet-500/30 lg:scale-[1.03]" : "border-white/8 hover:border-white/15"
              }`}
              style={{
                background: tier.highlight
                  ? "linear-gradient(145deg, rgba(168,85,247,0.08), rgba(10,10,20,0.95))"
                  : "linear-gradient(145deg, rgba(255,255,255,0.02), transparent)",
              }}
            >
              {tier.highlight && (
                <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-violet-500/20 blur-[80px]" />
              )}
              <div className="relative">
                <div className="mb-1 flex items-center gap-2">
                  <h3 className="text-lg font-black text-white">{tier.name}</h3>
                  {tier.highlight && (
                    <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[9px] font-black uppercase tracking-widest text-violet-300">
                      Popular
                    </span>
                  )}
                </div>
                <div className="mb-1 flex items-baseline gap-2">
                  <span className="text-3xl font-black text-white">{tier.price}</span>
                  <span className="text-xs text-neutral-500">{tier.period}</span>
                </div>
                <p className="mb-5 text-sm text-neutral-400">{tier.tagline}</p>

                <ul className="mb-6 space-y-2">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2 text-xs text-neutral-300">
                      <Check size={14} style={{ color: tier.color }} className="mt-0.5 shrink-0" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>

                <Link
                  href={tier.href}
                  className={`group inline-flex w-full items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold transition ${
                    tier.highlight
                      ? "bg-white text-black hover:bg-violet-50"
                      : "border border-white/12 bg-white/5 text-white hover:border-white/20"
                  }`}
                >
                  {tier.cta}
                  <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </div>
          ))}
        </div>

        <p className="mt-8 text-center text-xs text-neutral-600">
          AI credits are spent on agent work (planning, tool calls, verification). You always see
          usage before it happens. No hidden charges.{" "}
          <Link href="/terms#credits-and-payments" className="text-neutral-500 underline-offset-2 hover:text-neutral-400 hover:underline">
            Refund &amp; cancellation policy
          </Link>
          {" · "}
          <Link href="/pricing" className="text-neutral-500 underline-offset-2 hover:text-neutral-400 hover:underline">
            Full pricing details
          </Link>
          {" · "}
          <a href="mailto:support@litlabs.net" className="text-neutral-500 underline-offset-2 hover:text-neutral-400 hover:underline">
            support@litlabs.net
          </a>
        </p>
      </div>
    </section>
  );
}
