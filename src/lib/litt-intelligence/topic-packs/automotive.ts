import type { TopicPack } from "./types";

/**
 * automotive — dealers, repair shops, detailing, rentals, towing
 * (§2 row 15). The bar: services with price guidance, featured
 * vehicles where relevant, hours, service booking, reviews, map.
 */
export const AUTOMOTIVE_PACK: TopicPack = {
  id: "automotive",
  label: "Automotive",
  version: 1,
  summary:
    "A complete automotive site: services with price guidance, featured vehicles, hours, service booking, reviews, and location.",
  match: {
    keywords: [
      "auto", "car", "cars", "mechanic", "dealership", "dealer",
      "detailing", "towing", "tires", "brakes", "automotive", "vehicle",
    ],
    phrases: [
      "auto repair", "car dealership", "car detailing", "oil change",
      "tire shop", "auto shop", "used cars",
    ],
  },
  themeDefaults: { theme: "dark", accentHue: 210 },
  hero: {
    imageSubjects: [
      "mechanic repairing car engine",
      "shiny cars on dealership lot",
      "car detailing polishing paint",
      "tow truck helping stranded driver",
    ],
    cta: "Book service",
    requiredElements: ["services in headline", "warranty or guarantee line"],
  },
  requiredSections: [
    {
      kind: "services", label: "Services", headingHints: ["Services", "Auto services"],
      minItems: 5, requiredFields: ["title", "text"],
      notes: "The real services (brakes, oil, diagnostics, tires…) — put starting-price guidance in the text where the shop publishes it.",
    },
    {
      kind: "cards", label: "Featured vehicles", headingHints: ["Featured vehicles", "On the lot"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Dealers: featured vehicles with year/miles and the asking price in the text. Repair-only shops: use this for service specials instead.",
    },
    {
      kind: "gallery", label: "The shop", headingHints: ["The shop", "Gallery"],
      minItems: 4,
      notes: "Bays, lifts, the lot, finished work — the real place.",
    },
    {
      kind: "process", label: "How service works", headingHints: ["How it works", "What to expect"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Book → diagnosis with a written estimate → approval before work → pickup. The estimate-before-work promise matters.",
    },
    {
      kind: "testimonials", label: "Reviews", headingHints: ["Reviews", "What drivers say"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named customers naming their car and the job done.",
    },
    {
      kind: "hours", label: "Hours", headingHints: ["Hours", "Opening hours"],
      notes: "Real hours by day, Saturday hours called out.",
    },
    {
      kind: "booking", label: "Book service", headingHints: ["Book service", "Schedule service"],
      minItems: 5,
      notes: "The service booking form from the booking block — one form on the page.",
    },
    {
      kind: "areas", label: "Find us", headingHints: ["Find us", "Location"],
      notes: "Address and service/tow radius with a directions link (the v1 map block).",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Call us"],
      notes: "Phone first — drivers call from the road.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Shop name, address, hours line." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Good to know"], minItems: 3, notes: "Estimates, loaners, warranty on work." },
    { kind: "stats", label: "Numbers", headingHints: ["By the numbers"], minItems: 3, notes: "Years, certified techs, cars serviced — only when real." },
  ],
  requiredBlocks: [
    {
      block: "booking", formKind: "reservation",
      fields: ["name", "phone", "vehicle", "service needed", "date"],
      notes: "Service requests post to the platform form endpoint — request-a-time, never fake live bay availability.",
    },
    { block: "map", notes: "Location and tow/service radius." },
    { block: "gallery", notes: "Shop and work photos." },
    { block: "hours", notes: "Hours listed by day." },
    { block: "reviews", notes: "Named driver reviews." },
  ],
  images: {
    required: [
      "mechanic repairing car engine",
      "shiny cars on dealership lot",
      "car detailing polishing paint",
      "tow truck helping stranded driver",
    ],
    allowed: [
      "car dashboard interior detail",
      "tire change in workshop",
      "classic car at sunset",
      "electric vehicle charging",
      "mechanic diagnostic computer",
    ],
    banned: ["office meeting", "restaurant food", "roofing work", "gym equipment"],
  },
  copy: {
    tone: "Straight, mechanical, trustworthy — written estimates and no work without approval, stated plainly.",
    mustMention: ["free estimates", "warranty on work"],
    bannedPhrases: ["cheapest in town", "we fix everything same day guaranteed", "#1 auto shop", "dealer prices beaten guaranteed"],
  },
  seo: {
    titlePattern: "{Business} — Auto Services in {City}, {State}",
    descriptionPattern:
      "{Business} provides auto services in {City} — services with price guidance, hours, service booking, and reviews from local drivers.",
    localKeywords: ["auto repair near me", "mechanic", "oil change", "car detailing"],
    schemaType: "AutoRepair",
  },
  completeness: { minSections: 9, galleryMinImages: 4, testimonialsMin: 2 },
};
