import type { TopicPack } from "./types";

/**
 * trades-home-services — plumbers, HVAC, electricians, landscapers,
 * cleaners, painters, movers, pest control, handymen (§2 row 2).
 * Roofing has its own pack; everything else with a truck and a
 * toolbox lands here. Per-trade vocabulary lives in the match lists
 * and section notes rather than in separate packs (§2 note).
 */
export const TRADES_HOME_SERVICES_PACK: TopicPack = {
  id: "trades-home-services",
  label: "Home Services & Trades",
  version: 1,
  summary:
    "A complete local trades site: services, service area, availability, process, pricing guidance, reviews, and a quote form.",
  match: {
    keywords: [
      "plumber", "plumbing", "hvac", "electrician", "electrical", "handyman",
      "landscaping", "landscaper", "painter", "painting", "pest", "cleaning",
      "furnace", "remodeling", "contractor",
    ],
    phrases: [
      "home services", "plumbing company", "hvac company", "electrician company",
      "handyman service", "lawn care", "pest control", "house cleaning",
      "air conditioning repair", "plumbing services", "cleaning service",
    ],
    negativeKeywords: ["roofing company", "rooftop"],
  },
  themeDefaults: { theme: "light", accentHue: 205 },
  hero: {
    imageSubjects: [
      "plumber fixing sink faucet",
      "hvac technician servicing furnace",
      "electrician installing light fixture",
      "landscaping crew trimming hedge",
    ],
    cta: "Get a free quote",
    requiredElements: [
      "trust line: licensed and insured",
      "city in headline",
      "emergency or same-day availability line",
    ],
  },
  requiredSections: [
    {
      kind: "stats", label: "Trust bar", headingHints: ["Years in business", "Jobs completed"],
      minItems: 3,
      notes: "Years in business, jobs completed, licensed & insured — the fast credibility strip.",
    },
    {
      kind: "services", label: "Services", headingHints: ["Our services", "What we do"],
      minItems: 5, requiredFields: ["title", "text"],
      notes: "At least five real services for THIS trade (a plumber lists drains, water heaters, repipes — not generic 'repairs').",
    },
    {
      kind: "process", label: "How it works", headingHints: ["How it works", "What to expect"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Call → visit/assessment → quote → work → guarantee. Name the emergency path if offered.",
    },
    {
      kind: "features", label: "Pricing guidance", headingHints: ["Pricing guidance", "Honest pricing", "Why choose us"],
      minItems: 2, requiredFields: ["title", "text"],
      notes: "How pricing works (flat-rate vs hourly, free estimates, no-surprise quotes) — guidance, not invented prices.",
    },
    {
      kind: "gallery", label: "Recent work", headingHints: ["Recent work", "Our work"],
      minItems: 4,
      notes: "Photos of the actual trade at work — crews, tools, finished jobs.",
    },
    {
      kind: "testimonials", label: "Reviews", headingHints: ["Reviews", "What neighbors say"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named local customers; the specific job in each quote.",
    },
    {
      kind: "areas", label: "Service area", headingHints: ["Service area", "Areas we serve"],
      notes: "The towns actually served, plus the response-time or emergency note.",
    },
    {
      kind: "form", label: "Quote form", headingHints: ["Get a free quote", "Request service"],
      minItems: 6,
      notes: "The quote form from the form block — same fields, one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Call us"],
      notes: "Phone first — trades customers call. Hours and emergency line included.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Business name, service area, license line." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Common questions"], minItems: 3, notes: "Pricing, arrival windows, guarantees." },
    { kind: "cta", label: "Call to action", headingHints: ["Need help today?"], notes: "One strong call band." },
  ],
  requiredBlocks: [
    {
      block: "form", formKind: "quote",
      fields: ["name", "phone", "email", "property address", "service needed", "message"],
      notes: "Quote requests land in the owner's lead inbox via the platform form endpoint.",
    },
    { block: "map", notes: "Service-area towns with a directions/address line." },
    { block: "gallery", notes: "Real work photos, on-topic subjects only." },
    { block: "reviews", notes: "Named customer reviews." },
  ],
  images: {
    required: [
      "plumber fixing sink faucet",
      "hvac technician servicing furnace",
      "electrician installing light fixture",
      "landscaping crew trimming hedge",
    ],
    allowed: [
      "cleaning professional wiping counter",
      "painter painting interior wall",
      "air conditioner unit outside house",
      "toolbox and tools on workbench",
      "moving crew carrying boxes",
    ],
    banned: ["office meeting", "skyscraper", "restaurant kitchen", "wedding party"],
  },
  copy: {
    tone: "Straightforward, dependable, local — plain words, real specifics, no hype.",
    mustMention: ["licensed and insured", "free quote", "service area"],
    bannedPhrases: ["cheapest in town", "#1 rated", "guaranteed lowest price", "world-class"],
  },
  seo: {
    titlePattern: "{Business} — Home Services in {City}, {State}",
    descriptionPattern:
      "{Business} provides plumbing, HVAC, electrical and home services in {City} — licensed and insured, free quotes, fast local response.",
    localKeywords: ["plumber near me", "hvac repair", "electrician", "handyman", "pest control"],
    schemaType: "LocalBusiness",
  },
  completeness: { minSections: 9, galleryMinImages: 4, testimonialsMin: 2 },
};
