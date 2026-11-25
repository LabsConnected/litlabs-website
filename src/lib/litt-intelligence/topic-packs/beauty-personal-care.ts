import type { TopicPack } from "./types";

/**
 * beauty-personal-care — salons, barbers, spas, nails, aesthetics
 * (§2 row 7). The page must answer: what services, at what price,
 * with whom, and how do I book.
 */
export const BEAUTY_PERSONAL_CARE_PACK: TopicPack = {
  id: "beauty-personal-care",
  label: "Beauty & Personal Care",
  version: 1,
  summary:
    "A complete salon/spa site: a priced service menu, stylists, gallery, products and aftercare, hours, and booking.",
  match: {
    keywords: [
      "salon", "barber", "barbershop", "spa", "nails", "hair",
      "hairstylist", "aesthetics", "beauty", "lashes", "manicure",
    ],
    phrases: [
      "hair salon", "barber shop", "nail salon", "day spa", "beauty salon",
    ],
  },
  themeDefaults: { theme: "warm", accentHue: 45 },
  hero: {
    imageSubjects: [
      "hair stylist finishing blowout",
      "barber giving precision haircut",
      "spa treatment room candles",
      "nail technician painting nails",
    ],
    cta: "Book an appointment",
    requiredElements: ["services in headline", "booking line in subheading"],
  },
  requiredSections: [
    {
      kind: "menu", label: "Service menu", headingHints: ["Service menu", "Services & prices"],
      minItems: 6, requiredFields: ["title", "text", "price"],
      notes: "Every core service with a real price; group cuts, color, nails, spa where natural.",
    },
    {
      kind: "features", label: "Meet the stylists", headingHints: ["Meet the stylists", "Our team"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Stylists/barbers by name with their specialty — clients book a person.",
    },
    {
      kind: "gallery", label: "Recent work", headingHints: ["Recent work", "Gallery"],
      minItems: 4,
      notes: "Real finished work — hair, nails, skin — on-topic only.",
    },
    {
      kind: "features", label: "Products & aftercare", headingHints: ["Products & aftercare", "Take it home"],
      minItems: 2, requiredFields: ["title", "text"],
      notes: "The product lines carried and how to keep the result at home.",
    },
    {
      kind: "testimonials", label: "Client words", headingHints: ["Client words", "Reviews"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named clients naming their stylist and service.",
    },
    {
      kind: "hours", label: "Hours", headingHints: ["Hours", "Opening hours"],
      notes: "Real hours by day, walk-in note where true.",
    },
    {
      kind: "booking", label: "Book now", headingHints: ["Book now", "Book an appointment"],
      minItems: 5,
      notes: "The booking request form from the booking block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Visit us"],
      notes: "Address, phone, parking note where natural.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Salon name, address, hours line." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Good to know"], minItems: 3, notes: "Cancellation policy, consultations, patch tests." },
    { kind: "cta", label: "Booking band", headingHints: ["Ready when you are"], notes: "One booking call band." },
  ],
  requiredBlocks: [
    {
      block: "booking", formKind: "reservation",
      fields: ["name", "phone", "service", "date", "time"],
      notes: "Booking requests post to the platform form endpoint — request-a-time, never fake live availability.",
    },
    { block: "gallery", notes: "Finished-work photos." },
    { block: "hours", notes: "Hours listed by day." },
    { block: "reviews", notes: "Named client reviews." },
  ],
  images: {
    required: [
      "hair stylist finishing blowout",
      "barber giving precision haircut",
      "spa treatment room candles",
      "nail technician painting nails",
    ],
    allowed: [
      "makeup application close up",
      "salon interior mirrors chairs",
      "manicure pastel nails",
      "beard trim barbershop",
      "facial treatment relaxing",
    ],
    banned: ["car repair", "office meeting", "restaurant kitchen", "construction site"],
  },
  copy: {
    tone: "Polished and friendly — real services, real prices, stylists by name.",
    mustMention: ["appointments available", "gift cards available"],
    bannedPhrases: ["best salon in town", "celebrity stylist", "miracle hair treatment", "cheap cuts"],
  },
  seo: {
    titlePattern: "{Business} — Salon & Spa in {City}, {State}",
    descriptionPattern:
      "{Business} is a salon and spa in {City} — a service menu with prices, stylists, hours, and easy booking.",
    localKeywords: ["hair salon near me", "barber", "nail salon", "spa day"],
    schemaType: "BeautySalon",
  },
  completeness: { minSections: 8, galleryMinImages: 4, testimonialsMin: 2 },
};
