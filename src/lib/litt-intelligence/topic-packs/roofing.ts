import type { TopicPack } from "./types";

/**
 * Roofing — the worked example (spec §3) and first customer vertical.
 * A homeowner with a leak or an old roof must be able to answer,
 * without leaving the page: What do you do? What will it cost and how
 * does it work? Are you legit? Do you serve my town? How do I get a
 * quote?
 */
export const ROOFING_PACK: TopicPack = {
  id: "roofing",
  label: "Roofing Company",
  version: 1,
  summary:
    "A complete roofing contractor site: services, materials, process, proof, financing and warranties, service area, FAQ, and a free-inspection quote form.",
  match: {
    keywords: ["roof", "roofing", "roofer", "shingle", "shingles", "gutter", "gutters"],
    phrases: [
      "roofing company",
      "roofing contractor",
      "roof repair",
      "roof replacement",
      "roof inspection",
      "new roof",
    ],
    negativeKeywords: ["rooftop", "roof deck", "rooftop bar", "rooftop restaurant"],
  },
  themeDefaults: { theme: "light", accentHue: 215 },
  hero: {
    imageSubjects: [
      "roofers installing shingles",
      "roofers installing asphalt shingles",
      "completed house with new roof",
      "aerial view of finished roof",
    ],
    cta: "Get a free roof inspection",
    requiredElements: ["trust line: licensed & insured", "city in headline"],
  },
  requiredSections: [
    {
      kind: "stats",
      label: "Trust bar",
      headingHints: ["by the numbers", "trusted", "proven"],
      minItems: 3,
      notes:
        "Years in business, roofs completed, review rating, warranty years — round, plausible figures only when the owner gave none; they are replace-me numbers.",
    },
    {
      kind: "services",
      label: "Services",
      headingHints: ["our services", "roofing services", "what we do"],
      minItems: 5,
      requiredFields: ["title", "text"],
      notes:
        "Roof replacement, roof repair, storm damage & insurance-claim repair, roof inspections, gutter installation & repair, emergency tarping/leak response. Each: title + 1–2 line plain description.",
    },
    {
      kind: "features",
      label: "Materials",
      headingHints: ["materials", "roofing materials", "choose your roof"],
      minItems: 3,
      requiredFields: ["title", "text"],
      notes:
        "Architectural asphalt shingles, metal roofing, flat/TPO where offered, cedar or tile by region. Each card: who it's for + expected lifespan/durability.",
    },
    {
      kind: "process",
      label: "Our process",
      headingHints: ["our process", "how it works", "what to expect"],
      minItems: 4,
      requiredFields: ["title", "text"],
      notes:
        "Free inspection & photos → written estimate (no pressure) → material & color selection → install (typical 1–2 days, property protected, full cleanup) → final walkthrough + warranty registration.",
    },
    {
      kind: "about",
      altKinds: ["features"],
      label: "Why choose us",
      headingHints: ["why choose us", "why homeowners choose", "the difference"],
      notes:
        "Licensed & insured stated plainly, manufacturer certifications if any (e.g. GAF / Owens Corning installer), local & family-owned where true, cleanup promise.",
    },
    {
      kind: "gallery",
      label: "Recent work",
      headingHints: ["recent work", "our work", "before and after"],
      minItems: 4,
      notes:
        "Completed roofs only — subjects from the pack image list. Captions may name the neighborhood or town.",
    },
    {
      kind: "testimonials",
      label: "Reviews",
      headingHints: ["reviews", "what homeowners say", "testimonials"],
      minItems: 2,
      requiredFields: ["quote", "author"],
      notes: "Homeowner voice: leak fixed, crew showed up on time, yard left clean. Name + town on each.",
    },
    {
      kind: "features",
      altKinds: ["about"],
      label: "Financing, insurance & warranties",
      headingHints: ["financing", "insurance", "warranties", "financing and warranties"],
      minItems: 2,
      requiredFields: ["title", "text"],
      notes:
        "Financing available / payment plans; 'we document storm damage and work with your insurer' — stated as help, never a promise of claim outcome. Workmanship warranty (years), manufacturer material warranty, what happens if something leaks after install.",
    },
    {
      kind: "areas",
      label: "Service area",
      headingHints: ["service area", "areas we serve", "where we work"],
      notes: "Named list of towns served + base address or a 'serving the area' line + directions link.",
    },
    {
      kind: "faq",
      label: "FAQ",
      headingHints: ["faq", "questions", "frequently asked"],
      minItems: 4,
      notes:
        "How long does a replacement take? How much does a new roof cost (factors, not a fake fixed price)? Do you help with insurance claims? What warranty do I get? Do you offer free inspections?",
    },
    {
      kind: "form",
      label: "Free inspection form",
      headingHints: ["get a free inspection", "request your free inspection", "get a free estimate"],
      minItems: 6,
      notes: "The quote form (block below). Phone number shown beside it in the contact section for people who won't use forms.",
    },
    {
      kind: "contact",
      label: "Contact",
      headingHints: ["contact", "get in touch", "call us"],
      notes: "Phone, email, hours (incl. emergency line if offered), service-area line.",
    },
    {
      kind: "footer",
      label: "Footer",
      headingHints: ["footer"],
      notes: "Business name, service-area line, license number slot.",
    },
  ],
  optionalSections: [
    {
      kind: "cta",
      label: "Mid-page call to action",
      headingHints: ["ready to start", "get started"],
      notes: "A mid-page repeat of the free-inspection offer for long pages.",
    },
    {
      kind: "pricing",
      label: "Maintenance plans",
      headingHints: ["maintenance plans", "care plans"],
      notes: "Only if the company sells inspection/maintenance plans — priced offers, never invented roof prices.",
    },
  ],
  requiredBlocks: [
    {
      block: "form",
      formKind: "quote",
      fields: ["name", "phone", "email", "property address", "service needed", "message"],
      notes: "Free-inspection quote form — the page's conversion point.",
    },
    { block: "map", notes: "Service-area towns + address/directions (areas section)." },
    { block: "gallery", notes: "Photos of actual roofing work, pack subjects only." },
    { block: "reviews", notes: "Named homeowner reviews (testimonials section)." },
  ],
  images: {
    required: [
      "roofers installing asphalt shingles",
      "completed house with new roof",
      "roofing crew working on residential roof",
      "shingle texture close-up",
    ],
    allowed: [
      "aerial view suburban rooftops",
      "gutter installation",
      "storm damaged roof",
      "homeowner and roofer inspecting roof",
      "metal roof house exterior",
    ],
    banned: [
      "office building interior",
      "skyscraper construction",
      "plumbing",
      "kitchen renovation",
      "business meeting",
      "landscaping garden",
    ],
  },
  copy: {
    tone:
      "Plain-spoken and trustworthy — talk like a contractor who shows up, not a marketing agency. Short sentences, real specifics, no hype.",
    mustMention: ["licensed and insured", "free inspection", "warranty"],
    bannedPhrases: ["cheapest", "#1 rated", "roof in a day guaranteed", "world-class"],
  },
  seo: {
    titlePattern: "{Business} — Roofing Contractor in {City}, {State}",
    descriptionPattern:
      "{Business} provides roof replacement, roof repair, and free inspections in {City} and the surrounding area. Licensed and insured — call for a free estimate.",
    localKeywords: ["roof replacement", "roof repair", "storm damage", "shingle", "metal roofing"],
    schemaType: "RoofingContractor",
  },
  completeness: { minSections: 9, galleryMinImages: 4, testimonialsMin: 2 },
};
