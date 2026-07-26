"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { useTheme } from "@/context/ThemeContext";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { Check, Sparkles, ArrowRight, Loader2, Shield, Coins, RefreshCw, LockKeyhole } from "lucide-react";
import { PLAN_LIST, formatPrice, formatPriceMonthly, type PlanDefinition } from "@/config/plans";

const PLAN_ACCENTS: Record<string, string> = {
  starter: "#6b7280",
  creator_beta: "#00f0ff",
  pro_builder_beta: "#8b5cf6",
  founder: "#fbbf24",
};

export default function PricingPage() {
  const { resolvedColors: T } = useTheme();
  const { isSignedIn } = useClerkAuth();
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = useCallback(async (plan: PlanDefinition) => {
    if (plan.billingType === "free") return;
    if (!isSignedIn) {
      window.location.href = "/sign-in?redirect=/pricing";
      return;
    }
    setLoading(plan.id);
    setError(null);
    try {
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId: plan.id }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(data.error || "Failed to start checkout");
      }
    } catch {
      setError("Network error during checkout");
    } finally {
      setLoading(null);
    }
  }, [isSignedIn]);

  return (
    <div className="min-h-screen" style={{ backgroundColor: T.bgColor, color: T.textColor }}>
      {/* Header */}
      <div className="border-b border-white/10 px-4 py-12 sm:px-6 sm:py-16">
        <div className="mx-auto max-w-4xl text-center">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[10px] font-black uppercase tracking-wider text-amber-300">
            <Sparkles size={12} />
            Founder Beta Pricing
          </div>
          <h1 className="text-3xl font-black tracking-tight sm:text-5xl" style={{ color: T.headerColor }}>
            Lock in lower pricing while LiTTree is in beta
          </h1>
          <p className="mx-auto mt-4 max-w-2xl text-sm text-white/55 sm:text-base">
            Core tools remain free while testing. Paid beta plans unlock higher limits,
            private projects, GitHub workflows, terminal access, and deployment features.
          </p>
          <p className="mt-3 text-xs text-white/40">
            No plan claims unlimited external compute. LiTBits cover platform actions, not third-party infrastructure costs.
          </p>
        </div>
      </div>

      {/* Plan cards */}
      <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {PLAN_LIST.map((plan) => {
            const accent = PLAN_ACCENTS[plan.id] || T.accentColor;
            const isFree = plan.billingType === "free";
            const isFounder = plan.id === "founder";
            const isRecommended = plan.id === "creator_beta";
            const isLoading = loading === plan.id;

            return (
              <div
                key={plan.id}
                className="relative flex flex-col overflow-hidden rounded-2xl border-2 transition-all hover:-translate-y-1"
                style={{
                  borderColor: isFounder || isRecommended ? `${accent}70` : `${accent}30`,
                  backgroundColor: `${accent}08`,
                }}
              >
                {/* Founder badge */}
                {isFounder && (
                  <div className="absolute right-0 top-0 rounded-bl-xl px-3 py-1 text-[9px] font-black uppercase tracking-wider text-black" style={{ backgroundColor: accent }}>
                    Limited
                  </div>
                )}
                {isRecommended && (
                  <div className="absolute right-3 top-3 rounded-full px-2.5 py-1 text-[9px] font-black uppercase tracking-wider text-slate-950" style={{ backgroundColor: accent }}>
                    Best for creators
                  </div>
                )}

                <div className="flex flex-1 flex-col p-5">
                  {/* Plan name */}
                  <div className="text-xs font-black uppercase tracking-wider" style={{ color: accent }}>
                    {plan.name}
                  </div>

                  {/* Price */}
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-black" style={{ color: T.headerColor }}>
                      {plan.billingType === "one_time"
                        ? formatPrice(plan.monthlyPriceCents)
                        : formatPriceMonthly(plan.monthlyPriceCents)}
                    </span>
                    {plan.billingType === "one_time" && (
                      <span className="text-[10px] text-white/40">one-time</span>
                    )}
                  </div>

                  {/* Standard price comparison */}
                  {plan.standardPriceCents !== null && plan.standardPriceCents > 0 && (
                    <div className="mt-1 text-[10px] text-white/40">
                      Founder pricing · later{" "}
                      <span className="line-through">{formatPriceMonthly(plan.standardPriceCents)}</span>
                    </div>
                  )}

                  {isFree && (
                    <div className="mt-1 text-[10px] text-white/40">Free forever</div>
                  )}

                  {/* Description */}
                  <p className="mt-3 text-[11px] leading-relaxed text-white/50">
                    {plan.description}
                  </p>

                  {/* Credits */}
                  <div className="mt-4 rounded-lg border border-white/5 bg-black/20 px-3 py-2">
                    <div className="text-lg font-black" style={{ color: accent }}>
                      {plan.monthlyCredits.toLocaleString()}
                    </div>
                    <div className="text-[9px] uppercase tracking-wider text-white/40">
                      {isFounder ? "included founding LiTBits" : "monthly LiTBits"}
                    </div>
                  </div>

                  {/* Features */}
                  <div className="mt-4 flex-1 space-y-1.5">
                    {plan.features.map((feat) => (
                      <div key={feat} className="flex items-start gap-2 text-[11px] text-white/70">
                        <Check size={12} className="mt-0.5 shrink-0" style={{ color: accent }} />
                        {feat}
                      </div>
                    ))}
                  </div>

                  {/* CTA */}
                  <div className="mt-5">
                    {isFree ? (
                      <Link
                        href="/studio"
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl border py-2.5 text-xs font-bold transition hover:bg-white/5"
                        style={{ borderColor: `${accent}30`, color: accent }}
                      >
                        Get Started <ArrowRight size={12} />
                      </Link>
                    ) : (
                      <button
                        onClick={() => handleCheckout(plan)}
                        disabled={isLoading}
                        className="flex w-full items-center justify-center gap-1.5 rounded-xl py-2.5 text-xs font-black text-black transition hover:scale-[1.02] disabled:opacity-50"
                        style={{ backgroundColor: accent }}
                      >
                        {isLoading ? (
                          <Loader2 size={12} className="animate-spin" />
                        ) : (
                          <>
                            {isFounder ? "Become a Founder" : plan.id === "creator_beta" ? "Choose Creator" : "Choose Pro"}
                            <ArrowRight size={12} />
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <div className="mt-6 rounded-xl border border-red-400/30 bg-red-400/10 px-4 py-3 text-center text-xs font-bold text-red-300">
            {error}
          </div>
        )}

        <div className="mt-10 grid gap-3 md:grid-cols-3">
          {[
            {
              icon: Coins,
              title: "One visible balance",
              copy: "Monthly, promotional, and purchased LiTBits are shown separately and summed honestly.",
            },
            {
              icon: RefreshCw,
              title: "Monthly credits reset",
              copy: "Plan LiTBits refresh each paid billing period. Purchased LiTBits do not silently expire.",
            },
            {
              icon: LockKeyhole,
              title: "Atomic usage ledger",
              copy: "Every grant and charge has an idempotency key, preventing duplicate billing or double-spend.",
            },
          ].map((item) => (
            <div key={item.title} className="rounded-2xl border border-white/8 bg-white/[0.025] p-4">
              <item.icon size={17} style={{ color: T.accentColor }} />
              <h2 className="mt-3 text-sm font-black text-white/90">{item.title}</h2>
              <p className="mt-1 text-[11px] leading-5 text-white/50">{item.copy}</p>
            </div>
          ))}
        </div>

        {/* Trust section */}
        <div className="mt-10 rounded-2xl border border-white/10 bg-white/[.02] p-6">
          <div className="flex items-center gap-2">
            <Shield size={16} className="text-white/40" />
            <span className="text-xs font-black uppercase tracking-wider text-white/60">
              Beta Protection
            </span>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="flex items-start gap-2 text-[11px] text-white/50">
              <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
              Existing balances are migrated once and remain visible
            </div>
            <div className="flex items-start gap-2 text-[11px] text-white/50">
              <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
              Downgrades never delete your projects or assets
            </div>
            <div className="flex items-start gap-2 text-[11px] text-white/50">
              <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
              Cancellation preserves access through the paid period
            </div>
            <div className="flex items-start gap-2 text-[11px] text-white/50">
              <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
              Credits use an immutable ledger — no silent balance changes
            </div>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-8 space-y-3">
          <h3 className="text-sm font-black text-white/70">Beta Pricing FAQ</h3>
          {[
            {
              q: "What are LiTBits?",
              a: "LiTBits are platform credits used for AI actions like chat, code generation, image creation, and terminal minutes. Each plan includes a monthly allowance.",
            },
            {
              q: "Do I keep my existing Beta LiTBits?",
              a: "Yes. Your existing wallet balance is migrated once into the promotional bucket. Monthly plan credits are used first, then promotional credits, then purchased credits.",
            },
            {
              q: "Can I cancel anytime?",
              a: "Yes. Cancellation stops future renewals but preserves access through your paid period. Your projects and data are never deleted on cancellation.",
            },
            {
              q: "Is this unlimited AI?",
              a: "No. Billable AI and runtime actions have a LiTBit cost. Free navigation, project organization, and local editing do not. Estimated cost should be shown before expensive operations.",
            },
          ].map((faq) => (
            <div key={faq.q} className="rounded-xl border border-white/5 bg-black/20 px-4 py-3">
              <div className="text-xs font-bold text-white/80">{faq.q}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-white/50">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
