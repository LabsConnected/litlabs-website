import type { TopicPack } from "./types";

/**
 * saas-tech — SaaS products, apps, tech startups, dev tools
 * (§2 row 10). Not a local pack: no areas/hours; the bar is
 * features, how it works, pricing tiers, proof, FAQ, signup.
 */
export const SAAS_TECH_PACK: TopicPack = {
  id: "saas-tech",
  label: "SaaS & Tech Product",
  version: 1,
  summary:
    "A complete product site: features, how it works, pricing tiers, product shots, testimonials, FAQ, and a signup band.",
  match: {
    keywords: [
      "saas", "software", "app", "platform", "startup", "api",
      "dashboard", "tool", "automation", "cloud",
    ],
    phrases: [
      "saas product", "software tool", "mobile app", "web app",
      "tech startup", "developer tool", "ai tool",
    ],
  },
  themeDefaults: { theme: "dark", accentHue: 230 },
  hero: {
    imageSubjects: [
      "software dashboard on laptop screen",
      "team building software in modern office",
      "mobile app screens mockup",
      "developer coding on dual monitors",
    ],
    cta: "Start free",
    requiredElements: ["outcome in headline", "no-credit-card line in subheading"],
  },
  requiredSections: [
    {
      kind: "stats", label: "Proof bar", headingHints: ["Trusted by", "By the numbers"],
      minItems: 3,
      notes: "Users, uptime, time saved — only numbers the product can back up.",
    },
    {
      kind: "features", label: "Features", headingHints: ["Features", "What it does"],
      minItems: 5, requiredFields: ["title", "text"],
      notes: "The five capabilities a buyer compares, each tied to an outcome — not a settings list.",
    },
    {
      kind: "process", label: "How it works", headingHints: ["How it works", "Get started"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Sign up → connect/import → first result, in three steps with times where honest.",
    },
    {
      kind: "gallery", label: "Product shots", headingHints: ["See it in action", "Product"],
      minItems: 4,
      notes: "The product itself — dashboard, app screens, workflow — not generic office stock.",
    },
    {
      kind: "pricing", label: "Pricing tiers", headingHints: ["Pricing", "Plans"],
      minItems: 3,
      notes: "Three tiers with real prices and the differences that matter; the middle tier is the default pick.",
    },
    {
      kind: "testimonials", label: "Customer words", headingHints: ["Loved by teams", "Testimonials"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named customers with role/company and a measurable result where they gave one.",
    },
    {
      kind: "faq", label: "FAQ", headingHints: ["FAQ", "Questions"],
      minItems: 4,
      notes: "Trial, cancellation, data/security, migration — the questions that block signup.",
    },
    {
      kind: "cta", label: "Signup band", headingHints: ["Start today", "Try it free"],
      notes: "The payments/signup surface in v1: one clear start-free call to action.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Talk to us"],
      notes: "Support and sales contact; response-time line.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Product name, legal links line." },
  ],
  optionalSections: [
    { kind: "about", label: "About", headingHints: ["About", "Why we built this"], notes: "The problem and the team, briefly." },
    { kind: "cards", label: "Use cases", headingHints: ["Use cases", "Who it is for"], minItems: 3, notes: "Segments or jobs-to-be-done." },
  ],
  requiredBlocks: [
    { block: "payments", notes: "Priced tiers plus the signup CTA; checkout only when the project has a payment link configured." },
    { block: "gallery", notes: "Product screenshots and workflow shots." },
    { block: "reviews", notes: "Named customer testimonials." },
  ],
  images: {
    required: [
      "software dashboard on laptop screen",
      "team building software in modern office",
      "mobile app screens mockup",
      "developer coding on dual monitors",
    ],
    allowed: [
      "analytics charts on screen",
      "video call with remote team",
      "whiteboard product sketch",
      "server room blue lights",
      "customer support headset smiling",
    ],
    banned: ["restaurant food", "roofing work", "gym workout", "wedding party"],
  },
  copy: {
    tone: "Clear, confident, specific — outcomes and numbers over adjectives; no enterprise fog.",
    mustMention: ["free trial", "no credit card required", "cancel anytime"],
    bannedPhrases: ["revolutionary platform", "game-changer", "synergy", "world-class solution"],
  },
  seo: {
    titlePattern: "{Business} — Software that works the way you do",
    descriptionPattern:
      "{Business} is software that helps teams get the work done — features, pricing tiers, and a free trial with no credit card required.",
    localKeywords: ["saas", "software", "app", "automation tool"],
    schemaType: "SoftwareApplication",
  },
  completeness: { minSections: 9, galleryMinImages: 4, testimonialsMin: 2 },
};
