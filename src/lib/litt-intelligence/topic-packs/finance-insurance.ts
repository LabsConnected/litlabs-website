import type { TopicPack } from "./types";

/**
 * finance-insurance — insurance agents, mortgage, tax prep,
 * bookkeeping (§2 row 18). Regulated-copy care is the point: no
 * guaranteed-return or outcome claims anywhere; a disclaimer line
 * is part of the bar.
 */
export const FINANCE_INSURANCE_PACK: TopicPack = {
  id: "finance-insurance",
  label: "Finance & Insurance",
  version: 1,
  summary:
    "A complete finance/insurance site: services, process, credentials, FAQ, a quote/intake form, testimonials, and the disclaimer line.",
  match: {
    keywords: [
      "insurance", "mortgage", "tax", "bookkeeping", "financial",
      "accounting", "loans", "retirement", "advisor",
    ],
    phrases: [
      "insurance agent", "insurance agency", "tax preparation",
      "mortgage broker", "bookkeeping services", "financial planning",
    ],
    negativeKeywords: ["law firm"],
  },
  themeDefaults: { theme: "light", accentHue: 215 },
  hero: {
    imageSubjects: [
      "financial advisor meeting with couple",
      "insurance agent reviewing policy documents",
      "calculator and tax forms on desk",
      "family in front of their home",
    ],
    cta: "Get a free quote review",
    requiredElements: ["services in headline", "local and licensed line"],
  },
  requiredSections: [
    {
      kind: "services", label: "Services", headingHints: ["Services", "Coverage & services"],
      minItems: 5, requiredFields: ["title", "text"],
      notes: "Auto/home/life/health/business lines or tax/bookkeeping services — each with who it fits, never a promised price or return.",
    },
    {
      kind: "process", label: "How it works", headingHints: ["How it works", "The process"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Review → options compared in plain language → choice → annual check-in. No pressure steps.",
    },
    {
      kind: "features", label: "Credentials", headingHints: ["Credentials", "Why us"],
      minItems: 3, requiredFields: ["title", "text"], altKinds: ["about"],
      notes: "Licenses, carriers represented, years — verifiable facts only.",
    },
    {
      kind: "gallery", label: "Our office", headingHints: ["Our office", "Gallery"],
      minItems: 4,
      notes: "The office and team — approachable and local.",
    },
    {
      kind: "testimonials", label: "Client words", headingHints: ["Client words", "Reviews"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named clients describing service and clarity — never returns or savings amounts presented as typical.",
    },
    {
      kind: "faq", label: "FAQ", headingHints: ["FAQ", "Common questions"],
      minItems: 4,
      notes: "What a review covers, what to bring, how agents are paid, how switching works.",
    },
    {
      kind: "form", label: "Quote / intake form", headingHints: ["Get a quote review", "Request a review"],
      minItems: 5,
      notes: "The intake form from the form block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Office"],
      notes: "Office address, phone, email, hours.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Business name plus the disclaimer line: products and availability vary; nothing here is financial advice." },
  ],
  optionalSections: [
    { kind: "stats", label: "Numbers", headingHints: ["By the numbers"], minItems: 3, notes: "Years, households served, carriers — only when real." },
    { kind: "cta", label: "Review band", headingHints: ["Time for a review?"], notes: "One annual-review call band." },
  ],
  requiredBlocks: [
    {
      block: "form", formKind: "intake",
      fields: ["name", "email", "phone", "topic", "message"],
      notes: "Intake posts to the platform form endpoint; no account numbers or SSNs are ever collected by this form.",
    },
    { block: "gallery", notes: "Office and team photos." },
    { block: "reviews", notes: "Named client words." },
  ],
  images: {
    required: [
      "financial advisor meeting with couple",
      "insurance agent reviewing policy documents",
      "calculator and tax forms on desk",
      "family in front of their home",
    ],
    allowed: [
      "handshake in bright office",
      "home keys and contract signing",
      "small business owner at counter",
      "senior couple reviewing paperwork smiling",
      "downtown office building exterior",
    ],
    banned: ["money cash pile", "stock chart rocket", "luxury sports car", "casino gambling"],
  },
  copy: {
    tone: "Plain, careful, local — explain trade-offs honestly; never promise returns, savings, or approvals.",
    mustMention: ["free quote review", "licensed"],
    bannedPhrases: ["guaranteed returns", "guaranteed savings", "beat the market", "risk-free profits"],
  },
  seo: {
    titlePattern: "{Business} — Insurance & Finance in {City}, {State}",
    descriptionPattern:
      "{Business} provides insurance and finance services in {City} — services, process, credentials, and a free quote review.",
    localKeywords: ["insurance agent near me", "tax preparation", "mortgage broker", "bookkeeping"],
    schemaType: "InsuranceAgency",
  },
  completeness: { minSections: 8, galleryMinImages: 4, testimonialsMin: 2 },
};
