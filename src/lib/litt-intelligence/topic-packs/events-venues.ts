import type { TopicPack } from "./types";

/**
 * events-venues — wedding/event venues, conference and party
 * spaces, ticketing (§2 row 13). The bar: event types, capacity and
 * amenities in the open, packages with prices, and a booking
 * inquiry path.
 */
export const EVENTS_VENUES_PACK: TopicPack = {
  id: "events-venues",
  label: "Events & Venues",
  version: 1,
  summary:
    "A complete venue site: event types, capacity and amenities, gallery, priced packages, testimonials, FAQ, and a booking inquiry form.",
  match: {
    keywords: [
      "venue", "wedding", "events", "banquet", "reception",
      "conference", "party", "hall", "celebrations",
    ],
    phrases: [
      "event venue", "wedding venue", "banquet hall", "party venue",
      "conference center", "reception hall",
    ],
  },
  themeDefaults: { theme: "light", accentHue: 280 },
  hero: {
    imageSubjects: [
      "elegant wedding reception hall",
      "outdoor wedding ceremony garden",
      "banquet tables with floral centerpieces",
      "string lights over evening celebration",
    ],
    cta: "Check your date",
    requiredElements: ["event types in headline", "capacity line in subheading"],
  },
  requiredSections: [
    {
      kind: "features", label: "Event types", headingHints: ["Event types", "Celebrate here"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Weddings, corporate, parties — each with its capacity and shape.",
    },
    {
      kind: "stats", label: "Capacity & facts", headingHints: ["Capacity", "Good to know"],
      minItems: 3,
      notes: "Guest capacity, square footage, parking — the numbers planners filter on.",
    },
    {
      kind: "gallery", label: "The space", headingHints: ["The space", "Gallery"],
      minItems: 6,
      notes: "The rooms dressed for real events — ceremony, reception, details.",
    },
    {
      kind: "features", label: "Amenities", headingHints: ["Amenities", "Included"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Tables/chairs, kitchen, AV, getting-ready rooms — what is included vs rented.",
    },
    {
      kind: "pricing", label: "Packages", headingHints: ["Packages", "Pricing"],
      minItems: 3,
      notes: "Three packages with real prices and what each includes.",
    },
    {
      kind: "testimonials", label: "Kind words", headingHints: ["Kind words", "Reviews"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named couples/hosts with their event type and date.",
    },
    {
      kind: "faq", label: "FAQ", headingHints: ["FAQ", "Planning questions"],
      minItems: 4,
      notes: "Deposits, rain plan, vendors, noise/curfew, setup time.",
    },
    {
      kind: "booking", label: "Check your date", headingHints: ["Check your date", "Book a tour"],
      minItems: 5,
      notes: "The booking inquiry form from the booking block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Visit us"],
      notes: "Address, tour contact, phone.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Venue name, address, capacity line." },
  ],
  optionalSections: [
    { kind: "about", label: "About the venue", headingHints: ["About", "Our story"], notes: "The place and its history, briefly." },
    { kind: "areas", label: "Find us", headingHints: ["Find us", "Location"], notes: "Neighborhood and directions where helpful." },
  ],
  requiredBlocks: [
    {
      block: "booking", formKind: "reservation",
      fields: ["name", "email", "event date", "event type", "guest count"],
      notes: "Date inquiries post to the platform form endpoint — a request, never fake live availability.",
    },
    { block: "gallery", notes: "The dressed space, six-plus photos." },
    { block: "payments", notes: "Priced packages satisfy the payments block." },
    { block: "reviews", notes: "Named host reviews." },
  ],
  images: {
    required: [
      "elegant wedding reception hall",
      "outdoor wedding ceremony garden",
      "banquet tables with floral centerpieces",
      "string lights over evening celebration",
    ],
    allowed: [
      "wedding cake on dessert table",
      "conference room set for meeting",
      "dance floor with party lights",
      "garden patio evening gathering",
      "bride and groom first dance",
    ],
    banned: ["office cubicles", "car repair", "restaurant kitchen line", "construction site"],
  },
  copy: {
    tone: "Warm and concrete — capacities, inclusions, and prices in the open; no fairy-tale fog.",
    mustMention: ["tours available", "dates book fast"],
    bannedPhrases: ["fairy-tale wedding", "hidden fees", "cheapest venue in town", "magical experience"],
  },
  seo: {
    titlePattern: "{Business} — Event Venue in {City}, {State}",
    descriptionPattern:
      "{Business} is an event venue in {City} — event types, capacity, amenities, packages with prices, and date inquiries.",
    localKeywords: ["wedding venue", "banquet hall", "event space", "reception hall"],
    schemaType: "EventVenue",
  },
  completeness: { minSections: 9, galleryMinImages: 6, testimonialsMin: 2 },
};
