import type { TopicPack } from "./types";

/**
 * restaurant-food — restaurants, cafés, bakeries, food trucks, bars,
 * breweries (§2 row 3). The page must answer: what's on the menu and
 * what does it cost, when are you open, where are you, and how do I
 * get a table.
 */
export const RESTAURANT_FOOD_PACK: TopicPack = {
  id: "restaurant-food",
  label: "Restaurant & Food",
  version: 1,
  summary:
    "A complete restaurant site: story, a priced menu, food and room photos, hours, location, and reservations.",
  match: {
    keywords: [
      "restaurant", "cafe", "bakery", "bistro", "diner", "brewery",
      "pizza", "catering", "kitchen", "coffee", "brunch", "dining",
    ],
    phrases: [
      "restaurant website", "food truck", "coffee shop", "bakery shop",
      "pizza place", "brew pub", "fine dining", "farm to table",
    ],
    negativeKeywords: ["roofing"],
  },
  themeDefaults: { theme: "warm", accentHue: 25 },
  hero: {
    imageSubjects: [
      "chef plating gourmet dish",
      "cozy restaurant interior tables",
      "fresh baked bread and pastries",
      "barista pouring latte art",
    ],
    cta: "Book a table",
    requiredElements: ["cuisine in headline", "neighborhood or city in subheading"],
  },
  requiredSections: [
    {
      kind: "about", label: "Our story", headingHints: ["Our story", "About"],
      notes: "Who cooks, since when, what the place stands for — two or three real sentences.",
    },
    {
      kind: "menu", label: "Menu", headingHints: ["Menu", "Eat & drink"],
      minItems: 6, requiredFields: ["title", "text", "price"],
      notes: "Real dishes with a short description AND a price each; group starters, mains, desserts when natural.",
    },
    {
      kind: "gallery", label: "Food & space", headingHints: ["Gallery", "From the kitchen"],
      minItems: 4,
      notes: "Dishes and the room — the food people will actually order.",
    },
    {
      kind: "features", label: "Private events & catering", headingHints: ["Private events", "Catering"],
      minItems: 2, requiredFields: ["title", "text"],
      notes: "Private events, catering, or group bookings where offered; otherwise seasonal specials and sourcing.",
    },
    {
      kind: "testimonials", label: "Reviews", headingHints: ["Reviews", "What guests say"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Guest reviews naming a dish or an occasion.",
    },
    {
      kind: "hours", label: "Hours", headingHints: ["Hours", "Opening hours"],
      notes: "Real opening hours by day, kitchen-close note if different.",
    },
    {
      kind: "booking", label: "Reservations", headingHints: ["Reservations", "Book a table"],
      minItems: 5,
      notes: "The reservation request form from the booking block — one form on the page.",
    },
    {
      kind: "areas", label: "Find us", headingHints: ["Find us", "Location", "Visit us"],
      notes: "Neighborhood and address block with a directions link (the v1 map block).",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Call us"],
      notes: "Phone for reservations and takeout, email, address.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Name, address, hours line." },
  ],
  optionalSections: [
    { kind: "cta", label: "Call to action", headingHints: ["Hungry?"], notes: "Order or reserve band." },
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Good to know"], minItems: 3, notes: "Parking, dietary options, large parties." },
  ],
  requiredBlocks: [
    {
      block: "booking", formKind: "reservation",
      fields: ["name", "phone", "date", "time", "party size"],
      notes: "Reservation requests post to the platform form endpoint — request-a-time, no fake live availability.",
    },
    { block: "map", notes: "Location block with address and directions link." },
    { block: "gallery", notes: "Food and interior photos only." },
    { block: "hours", notes: "Opening hours listed by day." },
    { block: "reviews", notes: "Named guest reviews." },
  ],
  images: {
    required: [
      "chef plating gourmet dish",
      "cozy restaurant interior tables",
      "fresh baked bread and pastries",
      "barista pouring latte art",
    ],
    allowed: [
      "wood fired pizza oven",
      "craft cocktail on bar",
      "farmers market vegetables",
      "outdoor patio dining",
      "dessert cake slice",
    ],
    banned: ["office building", "car repair", "roofing work", "gym workout"],
  },
  copy: {
    tone: "Warm, appetizing, specific — name dishes, ingredients, and the room; no generic foodie hype.",
    mustMention: ["made fresh daily", "reservations welcome", "locally sourced ingredients"],
    bannedPhrases: ["foodie paradise", "taste sensation", "best food in town", "culinary journey"],
  },
  seo: {
    titlePattern: "{Business} — Restaurant in {City}, {State}",
    descriptionPattern:
      "{Business} is a restaurant in {City} serving fresh, locally sourced dishes — see the menu, hours, and reservations.",
    localKeywords: ["restaurants near me", "dinner", "brunch", "catering", "reservations"],
    schemaType: "Restaurant",
  },
  completeness: { minSections: 9, galleryMinImages: 4, testimonialsMin: 2 },
};
