/**
 * LandingPricing — LiTBits pricing (V1).
 *
 * V1 spec: keep it simple.
 *   - free entry
 *   - low-cost LiTBits
 *   - BYOK
 *   - clear usage
 */

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";

const TIERS = [
  {
    name: "Free",
    price: "$0",
    period: "during beta",
    tagline: "Start building, no card required.",
    features: [
      "Limited LiTBits per month",
      "Code, Terminal, Tests, VerificationGate",
      "1 active project",
      "Community support",
    ],
    cta: "Start Building Free",
    href: "/sign-up",
    highlight: false,
    color: "#34d399",
  },
  {
    name: "LiTBits",
    price: "Pay as you go",
    period: "low-cost credits",
    tagline: "Buy LiTBits. Spend them on real work.",
    features: [
      "Studio + Memory + Deploy",
      "Unlimited projects",
      "Bring your own OpenRouter key (BYOK)",
      "Pay only for agent work you use",
    ],
    cta: "Get LiTBits",
    href: "/pricing",
    highlight: true,
    color: "#a855f7",
  },
  {
    name: "BYOK",
    price: "Your keys",
    period: "your compute",
    tagline: "Bring your own model keys. Pay only for LiTT.",
    features: [
      "Use your OpenRouter / OpenAI / Anthropic keys",
      "Route to fast / smart / long profiles",
      "Full Studio + Memory + Deploy",
      "No per-token markup from LiTT",
    ],
    cta: "Bring your key",
    href: "/sign-up",
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
            Pricing · LiTBits
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
            LiTBits are credits you spend on real agent work — planning, coding, verifying,
            shipping. Bring your own keys to pay even less.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {TIERS.map((tier) => (
            <div
              key={tier.name}
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
          LiTBits are spent on agent work (planning, tool calls, verification). You always see
          usage before it happens. No hidden charges.
        </p>
      </div>
    </section>
  );
}
