"use client";

import { useState, useCallback } from "react";
import Image from "next/image";
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
  icon: string;
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
    icon: "spark",
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
    icon: "litt",
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
    icon: "studio",
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
      "LiTTBits are platform credits used for billable AI actions such as chat, code generation, image creation, media processing, and terminal runtime.",
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
      "No. Billable AI and runtime actions have a LiTTBit cost. Free navigation, project organization, and local editing do not. Expensive actions should show an estimate before they run.",
  },
];

const showcaseItems = [
  {
    image: "/brand/litt-agent-hero-v2.png",
    alt: "LiTT in the neon LiTTree creative command center",
    eyebrow: "Your creative copilot",
    title: "LiTT",
    copy: "Always-there creative copilot. LiTT understands the goal, assembles the right tools, remembers the project, and helps turn the next idea into finished work.",
    accent: "cyan" as const,
  },
  {
    image: "/brand/spark-agent-hero-v2.png",
    alt: "Spark, LiTT's neon robotic fox companion",
    eyebrow: "Companion · Explorer",
    title: "Spark",
    copy: "The playful side of the lab. Spark keeps discovery fun, helps you explore new directions, and brings personality, energy, and curiosity to every mission.",
    accent: "purple" as const,
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

function PlanIcon({ icon }: { icon: string }) {
  if (icon === "litt") {
    return (
      <div className={styles.planIconWrap}>
        <Image
          src="/brand/litt-mascot-avatar.png"
          alt=""
          fill
          sizes="48px"
          className={styles.planIconImg}
        />
      </div>
    );
  }
  if (icon === "spark") {
    return (
      <div className={styles.planIconWrap}>
        <Image
          src="/brand/spark-agent-portrait.png"
          alt=""
          fill
          sizes="48px"
          className={styles.planIconImg}
        />
      </div>
    );
  }
  // studio
  return (
    <div className={styles.planIconWrap}>
      <Image
        src="/studio/creative-engine-hero.png"
        alt=""
        fill
        sizes="48px"
        className={styles.planIconImg}
      />
    </div>
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
        <div className={styles.planHeaderLeft}>
          <PlanIcon icon={plan.icon} />
          <div>
            <p className={styles.planLabel}>{plan.label}</p>
            <h2>{plan.name}</h2>
          </div>
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
      </div>

      <section className={styles.hero}>
        <div className={styles.heroContent}>
          <div className={styles.heroBadge}>
            <span className={styles.liveDot} />
            Founder Beta Pricing
          </div>

          <h1>
            Build more.
            <span> Pay for what actually runs.</span>
          </h1>

          <p className={styles.heroCopy}>
            Start free, then unlock private projects, GitHub workflows, voice,
            terminal runtime, advanced models, and deployment when your work needs
            it.
          </p>

          <div className={styles.heroMeta}>
            <span>No fake unlimited claims</span>
            <span>Clear LiTTBit allowances</span>
            <span>Projects stay yours</span>
          </div>

          <div className={styles.heroCtaRow}>
            <a className={styles.heroPrimaryCta} href="#plans">
              See plans
              <ArrowIcon />
            </a>
            <Link className={styles.heroSecondaryCta} href="/studio">
              Launch Studio
            </Link>
          </div>
        </div>

        <div className={styles.heroVisual}>
          <div className={styles.heroImageFrame}>
            <Image
              src="/brand/litt-mascot-hero.png"
              alt="LiTT — the LiTTree Lab Studios mascot"
              fill
              priority
              sizes="(max-width: 980px) 100vw, 480px"
              className={styles.heroImage}
            />
            <div className={styles.heroImageGlow} />
          </div>
        </div>
      </section>

      <section id="plans" className={styles.pricingSection} aria-label="Pricing plans">
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
          <div className={styles.founderVisual}>
            <Image
              src="/brand/litt-mascot-avatar.png"
              alt=""
              fill
              sizes="80px"
              className={styles.founderAvatar}
            />
          </div>

          <div className={styles.founderCopy}>
            <div className={styles.founderTitleRow}>
              <p>Founding Member</p>
              <span>Limited</span>
            </div>
            <h2>
              Permanent Creator-level access for{" "}
              <strong>{formatPrice(founder.monthlyPriceCents)} once</strong>
            </h2>
            <p>
              Includes {founder.monthlyCredits.toLocaleString()} founding LiTTBits, a Founder
              badge, early feature access, 20% off future usage packs, higher beta
              limits, priority feedback, and price protection. One-time purchase
              that does not renew.
            </p>
          </div>

          <button
            type="button"
            className={styles.founderButton}
            disabled={founderLoading}
            onClick={() => handleCheckout(founder)}
          >
            Become a Founder
            {founderLoading ? null : <ArrowIcon />}
          </button>
        </article>

        {error ? <div className={styles.errorBanner}>{error}</div> : null}
      </section>

      <section className={styles.showcaseSection}>
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Who you build with</p>
            <h2>Two AI characters. One creative engine.</h2>
          </div>
          <p>
            Every plan includes LiTT and Spark. Upgrade to unlock private projects,
            voice, terminal, and deployment.
          </p>
        </div>

        <div className={styles.showcaseGrid}>
          {showcaseItems.map((item) => (
            <article
              key={item.title}
              className={
                item.accent === "cyan" ? styles.showcaseCardCyan : styles.showcaseCardPurple
              }
            >
              <div className={styles.showcaseImage}>
                <Image
                  src={item.image}
                  alt={item.alt}
                  fill
                  sizes="(max-width: 980px) 100vw, 560px"
                  className={styles.showcaseImg}
                />
                <div className={styles.showcaseOverlay} />
              </div>
              <div className={styles.showcaseBody}>
                <p
                  className={
                    item.accent === "cyan" ? styles.showcaseEyebrowCyan : styles.showcaseEyebrowPurple
                  }
                >
                  {item.eyebrow}
                </p>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
              </div>
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
        <div className={styles.protectionContent}>
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
        </div>

        <div className={styles.protectionVisual}>
          <div className={styles.protectionImageFrame}>
            <Image
              src="/studio/creative-engine-hero.png"
              alt="LiTTree Studio creative engine"
              fill
              sizes="(max-width: 980px) 100vw, 420px"
              className={styles.protectionImage}
            />
            <div className={styles.protectionImageGlow} />
          </div>
        </div>
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
        <div className={styles.finalCtaContent}>
          <p className={styles.eyebrow}>Ready when you are</p>
          <h2>Turn one idea into a real project inside Studio.</h2>
          <p>
            Start free. Upgrade only when you need more projects, private
            workflows, runtime, or deployment power.
          </p>

          <div className={styles.ctaActions}>
            <Link className={styles.primaryCta} href="/studio">
              Launch Studio
              <ArrowIcon />
            </Link>
            <Link className={styles.secondaryCta} href="/marketplace">
              Explore Marketplace
            </Link>
          </div>
        </div>

        <div className={styles.finalCtaVisual}>
          <Image
            src="/brand/litt-base-station.png"
            alt="LiTTree Lab Studios base station"
            fill
            sizes="(max-width: 980px) 0px, 360px"
            className={styles.finalCtaImage}
          />
          <div className={styles.finalCtaImageGlow} />
        </div>
      </section>
    </main>
  );
}
