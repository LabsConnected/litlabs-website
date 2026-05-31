"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

interface PricingTier {
  id: string;
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  highlighted?: boolean;
  badge?: string;
  priceId?: string;
}

const TIERS: PricingTier[] = [
  {
    id: "free",
    name: "Explorer",
    price: "$0",
    period: "forever",
    description: "Get started with the basics",
    features: [
      "100 messages/month",
      "3 AI agents",
      "Community access",
      "Basic templates",
      "1 arena entry/week",
    ],
  },
  {
    id: "pro",
    name: "Architect",
    price: "$19",
    period: "per month",
    description: "For serious builders and teams",
    priceId: "price_1TYs4AJ53kgx4fp5RgAChEmk",
    highlighted: true,
    badge: "★ MOST POPULAR ★",
    features: [
      "Unlimited messages",
      "Unlimited AI agents",
      "Priority support",
      "API access",
      "All integrations",
      "Unlimited arena entries",
      "Custom agent branding",
      "Advanced analytics",
    ],
  },
  {
    id: "enterprise",
    name: "Commander",
    price: "Custom",
    period: "contact us",
    description: "For organizations needing scale",
    features: [
      "Everything in Pro",
      "Dedicated infrastructure",
      "Custom SLAs",
      "Team management (unlimited)",
      "SSO & advanced security",
      "Dedicated success manager",
      "Custom training & onboarding",
    ],
  },
];

function CheckIcon() {
  return (
    <svg className="w-4 h-4 text-neon-cyan shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

export default function BillingPage() {
  const router = useRouter();
  const [loading, setLoading] = useState<string | null>(null);
  const [billingPeriod, setBillingPeriod] = useState<"monthly" | "yearly">("monthly");

  async function handleUpgrade(tier: PricingTier) {
    if (tier.id === "free") return;
      if (tier.id === "enterprise") {
        router.push("mailto:enterprise@litlabs.net");
        return;
      }

    setLoading(tier.id);
    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          priceId: tier.priceId,
          mode: "subscription",
        }),
      });

      const data = await res.json();

      if (data.setup_required) {
        alert(
          "Stripe payments are being set up. To enable payments:\n\n" +
          "1. Create a Stripe account at stripe.com\n" +
          "2. Create a Pro product with a $19/month recurring price\n" +
          "3. Add STRIPE_SECRET_KEY and STRIPE_PRO_PRICE_ID to Vercel environment variables\n" +
          "4. Deploy to Vercel"
        );
        setLoading(null);
        return;
      }

      if (data.error) {
        alert("Error: " + data.error);
        setLoading(null);
        return;
      }

      if (data.url) {
        router.push(data.url);
      }
    } catch (err) {
      console.error("Checkout error:", err);
      alert("Something went wrong. Please try again.");
      setLoading(null);
    }
  }

  return (
    <div className="max-w-6xl mx-auto pb-20">
      {/* Header */}
      <div className="text-center mb-12 pt-4">
        <div className="text-[10px] font-bold text-neon-cyan tracking-[0.3em] uppercase mb-2">
          Choose Your Tier
        </div>
        <h1 className="font-heading text-3xl sm:text-4xl font-bold mb-3">
          Upgrade Your <span className="gradient-text">Access</span>
        </h1>
        <p className="text-text-secondary max-w-lg mx-auto text-sm sm:text-base">
          Unlock the full power of the LitLabs ecosystem. Upgrade anytime, cancel anytime.
        </p>
      </div>

      {/* Period Toggle */}
      <div className="flex justify-center mb-12">
        <div className="flex bg-white/5 border border-white/10 rounded-xl p-1">
          <button
            onClick={() => setBillingPeriod("monthly")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              billingPeriod === "monthly"
                ? "bg-neon-cyan text-cyber-bg"
                : "text-text-secondary hover:text-white"
            }`}
          >
            Monthly
          </button>
          <button
            onClick={() => setBillingPeriod("yearly")}
            className={`px-5 py-2 rounded-lg text-sm font-medium transition-all ${
              billingPeriod === "yearly"
                ? "bg-neon-cyan text-cyber-bg"
                : "text-text-secondary hover:text-white"
            }`}
          >
            Yearly{" "}
            <span className="text-[10px] text-neon-gold font-bold hidden sm:inline">
              SAVE 20%
            </span>
          </button>
        </div>
      </div>

      {/* Pricing Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 lg:gap-8">
        {TIERS.map((tier) => (
          <div
            key={tier.id}
            className={`relative rounded-2xl p-[1px] ${
              tier.highlighted
                ? "bg-gradient-to-b from-neon-cyan via-neon-purple to-neon-cyan shadow-[0_0_40px_rgba(0,242,254,0.15)]"
                : "bg-white/[0.08]"
            }`}
          >
            {/* Badge */}
            {tier.badge && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
                <span className="bg-gradient-to-r from-neon-cyan to-neon-purple text-cyber-bg text-[10px] font-bold uppercase tracking-wider px-4 py-1 rounded-full">
                  {tier.badge}
                </span>
              </div>
            )}

            <div
              className={`rounded-2xl p-6 sm:p-8 h-full flex flex-col ${
                tier.highlighted
                  ? "bg-gradient-to-b from-cyber-surface to-cyber-bg"
                  : "bg-cyber-surface"
              }`}
            >
              {/* Tier Name */}
              <div className="mb-6">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-heading text-lg font-bold uppercase tracking-tight">
                    {tier.name}
                  </h3>
                  {tier.id === "free" && (
                    <span className="badge badge-green text-[10px]">CURRENT</span>
                  )}
                </div>
                <p className="text-text-muted text-sm">{tier.description}</p>
              </div>

              {/* Price */}
              <div className="mb-6">
                <div className="flex items-baseline gap-1">
                  <span
                    className={`font-heading text-4xl font-bold ${
                      tier.highlighted ? "gradient-text" : "text-text-primary"
                    }`}
                  >
                    {tier.id === "pro" && billingPeriod === "yearly"
                      ? "$15"
                      : tier.price}
                  </span>
                  {tier.period !== "forever" && tier.price !== "Custom" && (
                    <span className="text-text-muted text-sm">/{tier.period}</span>
                  )}
                </div>
                {tier.id === "pro" && billingPeriod === "yearly" && (
                  <p className="text-neon-gold text-xs font-medium mt-1">
                    $188/year (save $40)
                  </p>
                )}
              </div>

              {/* CTA Button */}
              <button
                onClick={() => handleUpgrade(tier)}
                disabled={loading === tier.id || tier.id === "free"}
                className={`w-full py-4 rounded-xl font-bold text-sm uppercase tracking-wider transition-all mb-8 min-h-[52px] ${
                  tier.highlighted
                    ? "btn-primary text-base"
                    : tier.id === "free"
                    ? "btn-secondary opacity-50 cursor-not-allowed"
                    : "btn-secondary"
                }`}
              >
                {loading === tier.id
                  ? "Redirecting..."
                  : tier.id === "free"
                  ? "Current Plan"
                  : tier.id === "enterprise"
                  ? "Contact Sales"
                  : `Upgrade to ${tier.name}`}
              </button>

              {/* Features */}
              <div className="space-y-3 flex-1">
                {tier.features.map((feature, i) => (
                  <div key={i} className="flex items-start gap-2.5">
                    <CheckIcon />
                    <span className="text-sm text-text-secondary">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Trust signals */}
      <div className="mt-16 text-center">
        <div className="flex flex-wrap justify-center gap-6 sm:gap-10 text-text-muted text-xs font-medium">
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
            </svg>
            Secure payments via Stripe
          </span>
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
            Cancel anytime
          </span>
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Instant activation
          </span>
          <span className="flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            24/7 support for Pro
          </span>
        </div>
      </div>

      {/* FAQ */}
      <div className="mt-20 max-w-2xl mx-auto">
        <h2 className="font-heading text-xl font-bold text-center mb-8">
          Frequently Asked <span className="gradient-text">Questions</span>
        </h2>
        <div className="space-y-4">
          {[
            {
              q: "Can I cancel anytime?",
              a: "Yes. Cancel from your settings page anytime. You'll keep Pro access until your billing period ends.",
            },
            {
              q: "What payment methods do you accept?",
              a: "We accept all major credit and debit cards via Stripe. Enterprise customers can pay via invoice.",
            },
            {
              q: "Can I switch between plans?",
              a: "Absolutely. Upgrade or downgrade at any time. Changes take effect immediately with prorated billing.",
            },
            {
              q: "Is there a free trial?",
              a: "The Explorer tier is free forever. When you upgrade to Pro, you get instant access to all features.",
            },
          ].map((faq, i) => (
            <div key={i} className="card">
              <h3 className="font-semibold text-sm mb-2">{faq.q}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{faq.a}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
