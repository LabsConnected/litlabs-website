"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import styles from "./pricing.module.css";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import {
  PLANS,
  formatPrice,
  formatPriceMonthly,
  type PlanDefinition,
  type PlanId,
} from "@/config/plans";

type Accent = "neutral" | "cyan" | "purple";

type CardPlan = {
  id: PlanId;
  name: string;
  label: string;
  price: string;
  suffix: string;
  futurePrice: string;
  description: string;
  credits: string;
  projects: string;
  featured?: boolean;
  accent: Accent;
  cta: string;
  free: boolean;
};

const CARD_PLANS: CardPlan[] = [
  {
    id: "starter",
    name: PLANS.starter.name,
    label: "Explore LiTTree",
    price: formatPrice(PLANS.starter.monthlyPriceCents),
    suffix: "forever",
    futurePrice: "No credit card required",
    description: PLANS.starter.description,
    credits: PLANS.starter.monthlyCredits.toLocaleString(),
    projects: `${PLANS.starter.activeProjectLimit} active project`,
    accent: "neutral",
    cta: "Start free",
    free: true,
  },
  {
    id: "creator_beta",
    name: PLANS.creator_beta.name,
    label: "Best for creators",
    price: formatPrice(PLANS.creator_beta.monthlyPriceCents),
    suffix: "/month",
    futurePrice: `Later ${formatPriceMonthly(PLANS.creator_beta.standardPriceCents)}`,
    description: PLANS.creator_beta.description,
    credits: PLANS.creator_beta.monthlyCredits.toLocaleString(),
    projects: `${PLANS.creator_beta.activeProjectLimit} active projects`,
    featured: true,
    accent: "cyan",
    cta: "Choose Creator",
    free: false,
  },
  {
    id: "pro_builder_beta",
    name: PLANS.pro_builder_beta.name,
    label: "For serious builders",
    price: formatPrice(PLANS.pro_builder_beta.monthlyPriceCents),
    suffix: "/month",
    futurePrice: `Later ${formatPriceMonthly(PLANS.pro_builder_beta.standardPriceCents)}`,
    description: PLANS.pro_builder_beta.description,
    credits: PLANS.pro_builder_beta.monthlyCredits.toLocaleString(),
    projects: `${PLANS.pro_builder_beta.activeProjectLimit} active projects`,
    accent: "purple",
    cta: "Choose Pro",
    free: false,
  },
];

const usageRules = [
  {
    title: "One visible balance",
    copy: "Monthly, promotional, and purchased LiTTBits stay separated behind one honest total.",
  },
  {
    title: "Monthly credits refresh",
    copy: "Plan LiTTBits refresh each billing period. Purchased LiTTBits do not silently expire.",
  },
  {
    title: "Atomic usage ledger",
    copy: "Every grant and charge uses an idempotency key to prevent duplicate billing or double-spend.",
  },
];

const faq = [
  {
    question: "What are LiTTBits?",
    answer:
      "LiTTBits are platform credits used for billable AI actions such as chat, code generation, image creation, video generation, media processing, and terminal runtime.",
  },
  {
    question: "How does video generation work?",
    answer:
      "Video is metered usage. Create a 5-second clip starting at $0.79 in LiTTBits. Choose Draft, Quality, or Video with Audio. The exact cost is shown before you generate. Cinema and 4K are coming soon.",
  },
  {
    question: "Do I keep my existing Beta LiTTBits?",
    answer:
      "Yes. Existing balances are migrated once into the promotional bucket. Monthly plan credits are used first, followed by promotional and purchased credits.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. Cancellation stops future renewals while access continues through the paid period. Downgrading or canceling does not delete projects or assets.",
  },
  {
    question: "Is this unlimited AI?",
    answer:
      "No. Billable AI and runtime actions have a LiTTBit cost. Free navigation, project organization, and local editing do not. Expensive actions show an estimate before they run.",
  },
  {
    question: "What is the Founding Supporter offer?",
    answer:
      "A one-time $49 purchase that grants 6 months of Creator-level access, 5,000 bonus LiTTBits, a Founder badge, 15% off future credit packs, and early feature access. Limited to 100 supporters.",
  },
];

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none">
      <path
        d="m4.5 10.5 3.1 3.1 7.9-8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ArrowIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none">
      <path
        d="M4 10h11M11 6l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PlanCard({
  plan,
  loading,
  onCheckout,
}: {
  plan: CardPlan;
  loading: boolean;
  onCheckout: (plan: PlanDefinition) => void;
}) {
  const accentClass = styles[`accent_${plan.accent}` as const] ?? "";
  const isLoading = loading;

  return (
    <article
      className={[styles.planCard, accentClass, plan.featured ? styles.featured : ""]
        .filter(Boolean)
        .join(" ")}
    >
      {plan.featured ? <div className={styles.topGlow} /> : null}

      <div className={styles.planHeader}>
        <div>
          <p className={styles.planLabel}>{plan.label}</p>
          <h2>{plan.name}</h2>
        </div>
        {plan.featured ? <span className={styles.popularBadge}>Most popular</span> : null}
      </div>

      <div className={styles.priceRow}>
        <span className={styles.price}>{plan.price}</span>
        <span className={styles.priceSuffix}>{plan.suffix}</span>
      </div>

      <p className={styles.futurePrice}>{plan.futurePrice}</p>
      <p className={styles.planDescription}>{plan.description}</p>

      <div className={styles.allowanceGrid}>
        <div className={styles.allowance}>
          <strong>{plan.credits}</strong>
          <span>LiTTBits monthly</span>
        </div>
        <div className={styles.allowance}>
          <strong>{plan.projects.replace(" active project", "").replace(" active projects", "")}</strong>
          <span>{plan.projects.includes("projects") ? "active projects" : "active project"}</span>
        </div>
      </div>

      <ul className={styles.featureList}>
        {PLANS[plan.id].features.map((feature) => (
          <li key={feature}>
            <span className={styles.check}>
              <CheckIcon />
            </span>
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      {plan.free ? (
        <Link className={styles.planButton} href="/studio">
          <span>{plan.cta}</span>
          <ArrowIcon />
        </Link>
      ) : (
        <button
          type="button"
          className={styles.planButton}
          disabled={isLoading}
          onClick={() => onCheckout(PLANS[plan.id])}
        >
          <span>{plan.cta}</span>
          {isLoading ? null : <ArrowIcon />}
        </button>
      )}
    </article>
  );
}

export default function PricingPage() {
  const { isSignedIn } = useClerkAuth();
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCheckout = useCallback(
    async (plan: PlanDefinition) => {
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
    },
    [isSignedIn],
  );

  const founder = PLANS.founder;
  const founderLoading = loading === founder.id;

  return (
    <main className={styles.page}>
      <div className={styles.wallpaper} aria-hidden="true">
        <div className={styles.grid} />
        <div className={styles.orbOne} />
        <div className={styles.orbTwo} />
        <div className={styles.orbThree} />
        <div className={styles.brandTree}>
          <span className={styles.treeCrown} />
          <span className={styles.treeTrunk} />
          <span className={styles.treeRootOne} />
          <span className={styles.treeRootTwo} />
          <span className={styles.treeRootThree} />
        </div>
      </div>

      <section className={styles.hero}>
        <div className={styles.heroBadge}>
          <span className={styles.liveDot} />
          Founder Beta Pricing
        </div>

        <h1>
          Your AI business team.
          <span> Research, write, code, market, and analyze.</span>
        </h1>

        <p className={styles.heroCopy}>
          One workspace, seven AI agents. Start free with LiTT and Spark, then
          unlock Researcher, Writer, and Marketer with Creator Beta — or add
          Coder and Analyst with Pro Builder Beta.
        </p>

        <div className={styles.heroMeta}>
          <span>7 specialist AI agents</span>
          <span>Clear LiTTBit allowances</span>
          <span>Projects stay yours</span>
        </div>
      </section>

      <section className={styles.pricingSection} aria-label="Pricing plans">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Choose your build level</p>
            <h2>Simple plans. Real limits. No billing tricks.</h2>
          </div>
          <p>
            Founder pricing stays lower during beta. All checkout flows use the
            existing Stripe price IDs and billing handler.
          </p>
        </div>

        <div className={styles.planGrid}>
          {CARD_PLANS.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              loading={loading === plan.id}
              onCheckout={handleCheckout}
            />
          ))}
        </div>

        <article className={styles.founderBanner}>
          <div className={styles.founderMark}>L</div>

          <div className={styles.founderCopy}>
            <div className={styles.founderTitleRow}>
              <p>Founding Supporter</p>
              <span>Limited · 100 spots</span>
            </div>
            <h2>
              6 months of Creator + bonus perks for{" "}
              <strong>{formatPrice(founder.monthlyPriceCents)} once</strong>
            </h2>
            <p>
              Includes 5,000 bonus LiTTBits, a Founder badge, 15% off future
              credit packs, early feature access, and priority feedback.
              One-time purchase — no recurring charge.
            </p>
          </div>

          <button
            type="button"
            className={styles.founderButton}
            disabled={founderLoading}
            onClick={() => handleCheckout(founder)}
          >
            Become a Founding Supporter
            {founderLoading ? null : <ArrowIcon />}
          </button>
        </article>

        {error ? <div className={styles.errorBanner}>{error}</div> : null}
      </section>

      <section className={styles.rulesSection}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Billing integrity</p>
            <h2>The pricing system should explain itself.</h2>
          </div>
          <p>Show users what they receive, what resets, and what never disappears.</p>
        </div>

        <div className={styles.rulesGrid}>
          {usageRules.map((item, index) => (
            <article key={item.title} className={styles.ruleCard}>
              <span className={styles.ruleNumber}>0{index + 1}</span>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
      </section>

      <section className={styles.protectionSection}>
        <div>
          <p className={styles.eyebrow}>Beta protection</p>
          <h2>Your work and credits do not vanish when a plan changes.</h2>
        </div>

        <ul>
          <li>
            <CheckIcon />
            Existing balances are migrated once and remain visible.
          </li>
          <li>
            <CheckIcon />
            Downgrades never delete projects or assets.
          </li>
          <li>
            <CheckIcon />
            Cancellation preserves access through the paid period.
          </li>
          <li>
            <CheckIcon />
            Credits use an immutable ledger with no silent balance changes.
          </li>
        </ul>
      </section>

      <section className={styles.faqSection}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Pricing FAQ</p>
            <h2>Answer the questions before users have to ask.</h2>
          </div>
        </div>

        <div className={styles.faqGrid}>
          {faq.map((item) => (
            <details key={item.question} className={styles.faqItem}>
              <summary>{item.question}</summary>
              <p>{item.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div>
          <p className={styles.eyebrow}>Ready when you are</p>
          <h2>Turn one idea into a real project inside Studio.</h2>
          <p>
            Start free. Upgrade only when you need more projects, private
            workflows, runtime, or deployment power.
          </p>
        </div>

        <div className={styles.ctaActions}>
          <Link className={styles.primaryCta} href="/studio">
            Launch Studio
            <ArrowIcon />
          </Link>
          <Link className={styles.secondaryCta} href="/marketplace">
            Explore Marketplace
          </Link>
        </div>
      </section>
    </main>
  );
}
