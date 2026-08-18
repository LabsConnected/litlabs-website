"use client";

import { useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
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
  /** "one-time" for Starter, "monthly" for paid plans */
  creditLabel: string;
  projectLimit: number;
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
    price: formatPrice(PLANS.starter.default_price),
    suffix: "forever",
    futurePrice: "No credit card required",
    description: PLANS.starter.description,
    credits: PLANS.starter.monthlyCredits.toLocaleString(),
    creditLabel: "AI credits (one-time)",
    projectLimit: PLANS.starter.activeProjectLimit,
    accent: "neutral",
    cta: "Start free",
    free: true,
  },
  {
    id: "creator_beta",
    name: PLANS.creator_beta.name,
    label: "Best for creators",
    price: formatPrice(PLANS.creator_beta.default_price),
    suffix: "/month",
    futurePrice: `Later ${formatPriceMonthly(PLANS.creator_beta.standardPriceCents)}`,
    description: PLANS.creator_beta.description,
    credits: PLANS.creator_beta.monthlyCredits.toLocaleString(),
    creditLabel: "AI credits monthly",
    projectLimit: PLANS.creator_beta.activeProjectLimit,
    featured: true,
    accent: "cyan",
    cta: "Choose Creator",
    free: false,
  },
  {
    id: "pro_builder_beta",
    name: PLANS.pro_builder_beta.name,
    label: "For serious builders",
    price: formatPrice(PLANS.pro_builder_beta.default_price),
    suffix: "/month",
    futurePrice: `Later ${formatPriceMonthly(PLANS.pro_builder_beta.standardPriceCents)}`,
    description: PLANS.pro_builder_beta.description,
    credits: PLANS.pro_builder_beta.monthlyCredits.toLocaleString(),
    creditLabel: "AI credits monthly",
    projectLimit: PLANS.pro_builder_beta.activeProjectLimit,
    accent: "purple",
    cta: "Choose Pro",
    free: false,
  },
];

const usageRules = [
  {
    title: "One visible balance",
    copy: "See all your AI credits in one place — no hidden balances or surprise charges.",
  },
  {
    title: "Credits per billing cycle",
    copy: "Paid plans grant AI credits after each successful billing cycle. Starter includes a one-time 500-credit grant that does not expire.",
  },
  {
    title: "Fair usage tracking",
    copy: "Expensive actions show an estimate before they run. You never get charged twice for the same thing.",
  },
];

const faq = [
  {
    question: "What are AI credits?",
    answer:
      "AI credits are platform credits used for billable AI actions such as chat, code generation, image creation, video generation, media processing, and terminal runtime.",
  },
  {
    question: "How does video generation work?",
    answer:
      "Video is metered usage. Create a 5-second clip starting at $0.79 in AI credits. Choose Draft, Quality, or Video with Audio. The exact cost is shown before you generate. Cinema and 4K are coming soon.",
  },
  {
    question: "Do I keep my existing Beta credits?",
    answer:
      "Yes. Existing balances remain visible. Monthly plan credits are used first, followed by promotional and purchased credits.",
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
    question: "What is the Founding Member offer?",
    answer:
      "A one-time $149 purchase that grants permanent Creator-level feature access and a Founder badge. No recurring subscription charge. Does not include monthly credit grants — purchase credits separately or subscribe to a paid plan for recurring credits. Checkout is currently unavailable pending an approved Stripe price. Limited to 100 supporters.",
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
          <span>{plan.creditLabel}</span>
        </div>
        <div className={styles.allowance}>
          <strong>{plan.projectLimit}</strong>
          <span>{plan.projectLimit === 1 ? "active project" : "active projects"}</span>
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

export default function PricingClient({ founderAvailable }: { founderAvailable: boolean }) {
  return (
    <Suspense fallback={<main className={styles.page} />}>
      <PricingClientInner founderAvailable={founderAvailable} />
    </Suspense>
  );
}

function PricingClientInner({ founderAvailable }: { founderAvailable: boolean }) {
  const { isSignedIn } = useClerkAuth();
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const canceled = useSearchParams().get("canceled") === "true";

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

        {canceled && (
          <div
            className={styles.errorBanner}
            role="status"
            aria-live="polite"
            style={{ marginBottom: 16, marginTop: 0 }}
          >
            Checkout was canceled — you were not charged. Your current plan and
            credits are unchanged. Pick a plan below when you’re ready, or{" "}
            <Link
              href="/settings?section=billing"
              style={{ textDecoration: "underline" }}
            >
              review your current plan
            </Link>
            .
          </div>
        )}

        <h1>
          Your AI creative studio.
          <span> Build apps, media, and projects with LiTT and Spark.</span>
        </h1>

        <p className={styles.heroCopy}>
          One workspace with LiTT and Spark. Start free, then unlock research,
          writing, and marketing skills with Creator Beta — or add coding and
          analytics skills with Pro Builder Beta.
        </p>

        <div className={styles.heroMeta}>
          <span>LiTT &amp; Spark</span>
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
            Founder pricing stays lower during beta. Cancel anytime — your work and credits are always yours.
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
              <p>Founding Member</p>
              {founderAvailable ? (
                <span>Limited to {PLANS.founder.founderLimit}</span>
              ) : (
                <span>Currently Unavailable</span>
              )}
            </div>
            <h2>
              $149 once. Permanent Creator-level feature access.
            </h2>
            <p>
              Founding Member grants permanent Creator-level feature access and a
              Founder badge — no recurring subscription charge. Does not include
              monthly credit grants; purchase credits separately or subscribe to
              a paid plan for recurring credits.
              Limited to {PLANS.founder.founderLimit} supporters.
              {!founderAvailable
                ? " Checkout is currently unavailable pending an approved Stripe price."
                : ""}
            </p>
          </div>

          <button
            type="button"
            className={styles.founderButton}
            disabled={!founderAvailable}
            onClick={() => founderAvailable && handleCheckout(PLANS.founder)}
          >
            {founderAvailable ? "Become a Founding Member" : "Currently Unavailable"}
          </button>
        </article>

        {error ? <div className={styles.errorBanner}>{error}</div> : null}
      </section>

      <section className={styles.trustSection} aria-label="Trust signals">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Trust & support</p>
            <h2>Built for real workflows, with real protections.</h2>
          </div>
          <p>If something breaks, you keep what you built. If you change your mind, you keep your access.</p>
        </div>
        <div className={styles.trustGrid}>
          {[
            { title: "Cancel anytime", copy: "Cancellation stops future renewals. Access continues through the paid period." },
            { title: "No surprise charges", copy: "Expensive actions show an estimate before they run. Credits are used predictably." },
            { title: "Your assets stay yours", copy: "Downgrades and cancellations never delete projects, media, or data." },
            { title: "Support channel", copy: "Need help? Reach out from Settings → Connections → Diagnostics." },
          ].map((item) => (
            <article key={item.title} className={styles.trustCard}>
              <h3>{item.title}</h3>
              <p>{item.copy}</p>
            </article>
          ))}
        </div>
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
