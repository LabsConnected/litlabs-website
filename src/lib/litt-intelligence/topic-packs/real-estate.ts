import type { TopicPack } from "./types";

/**
 * real-estate — agents, brokerages, property management (§2 row 8).
 * The page must answer: what is for sale and at what price, who is
 * selling it, where do they work, and how do I start.
 */
export const REAL_ESTATE_PACK: TopicPack = {
  id: "real-estate",
  label: "Real Estate",
  version: 1,
  summary:
    "A complete real estate site: market stats, featured listings with prices, buy/sell process, agent about, areas served, reviews, and a lead form.",
  match: {
    keywords: [
      "realtor", "realty", "broker", "brokerage", "listings", "homes",
      "houses", "property", "properties", "estate",
    ],
    phrases: [
      "real estate", "real estate agent", "homes for sale",
      "property management", "real estate brokerage", "buy a home", "sell your home",
    ],
  },
  themeDefaults: { theme: "light", accentHue: 210 },
  hero: {
    imageSubjects: [
      "beautiful suburban home exterior",
      "realtor handing keys to buyers",
      "bright modern home interior",
      "aerial view of neighborhood homes",
    ],
    cta: "Book a free home valuation",
    requiredElements: ["city in headline", "areas served line"],
  },
  requiredSections: [
    {
      kind: "stats", label: "Market stats", headingHints: ["Market stats", "By the numbers"],
      minItems: 3,
      notes: "Homes sold, average days on market, list-to-sale ratio — real local numbers, clearly framed.",
    },
    {
      kind: "services", label: "Buying & selling services", headingHints: ["How we help", "Services"],
      minItems: 4, requiredFields: ["title", "text"],
      notes: "Buying, selling, relocation, property management — what the agent actually does.",
    },
    {
      kind: "cards", label: "Featured listings", headingHints: ["Featured listings", "Featured properties"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Title = the property name or street; text MUST carry the asking price plus beds/baths — a listing without a price is not a listing.",
    },
    {
      kind: "gallery", label: "Listing photos", headingHints: ["Gallery", "Recent listings"],
      minItems: 4,
      notes: "Homes and interiors — the properties and neighborhoods being sold.",
    },
    {
      kind: "process", label: "Buy / sell process", headingHints: ["How it works", "The process"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Consult → valuation/listing or search → offers → closing, in plain steps.",
    },
    {
      kind: "about", label: "Meet your agent", headingHints: ["Meet your agent", "About"],
      notes: "The agent or team: years local, license, neighborhoods they know street by street.",
    },
    {
      kind: "testimonials", label: "Client reviews", headingHints: ["Client reviews", "What clients say"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named buyers/sellers with the town they bought or sold in.",
    },
    {
      kind: "areas", label: "Areas served", headingHints: ["Areas served", "Communities"],
      notes: "The towns and neighborhoods covered, with a line on each where natural.",
    },
    {
      kind: "form", label: "Lead form", headingHints: ["Get in touch", "Start the conversation"],
      minItems: 5,
      notes: "The lead form from the form block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Call us"],
      notes: "Phone, email, office address.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Brokerage name, license and fair-housing line." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Common questions"], minItems: 3, notes: "First-time buyers, commissions, timelines." },
    { kind: "cta", label: "Valuation band", headingHints: ["What is your home worth?"], notes: "Free valuation call band." },
  ],
  requiredBlocks: [
    {
      block: "form", formKind: "contact",
      fields: ["name", "phone", "email", "buying or selling", "message"],
      notes: "Leads post to the platform form endpoint.",
    },
    { block: "map", notes: "Areas served with real town names." },
    { block: "gallery", notes: "Property and neighborhood photos." },
    { block: "reviews", notes: "Named client reviews." },
  ],
  images: {
    required: [
      "beautiful suburban home exterior",
      "realtor handing keys to buyers",
      "bright modern home interior",
      "aerial view of neighborhood homes",
    ],
    allowed: [
      "family moving into new home",
      "open house sign in yard",
      "modern kitchen interior",
      "downtown condo building",
      "handshake closing deal",
    ],
    banned: ["office cubicles", "restaurant food", "car engine", "gym equipment"],
  },
  copy: {
    tone: "Confident, local, concrete — real neighborhoods and real numbers, no pressure tactics.",
    mustMention: ["free home valuation", "local market expert", "no obligation"],
    bannedPhrases: ["dream home guaranteed", "#1 agent", "homes sell fast guaranteed", "luxury lifestyle"],
  },
  seo: {
    titlePattern: "{Business} — Real Estate in {City}, {State}",
    descriptionPattern:
      "{Business} helps buyers and sellers in {City} with local market expertise, featured listings, and free home valuations.",
    localKeywords: ["homes for sale", "real estate agent", "home valuation", "houses near me"],
    schemaType: "RealEstateAgent",
  },
  completeness: { minSections: 10, galleryMinImages: 4, testimonialsMin: 2 },
};
