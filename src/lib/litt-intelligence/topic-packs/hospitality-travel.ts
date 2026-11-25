import type { TopicPack } from "./types";

/**
 * hospitality-travel — hotels, B&Bs, vacation rentals, tours,
 * attractions (§2 row 17). The bar: rooms/experiences with prices,
 * amenities, a real gallery, location, booking, reviews, and a
 * local-area guide.
 */
export const HOSPITALITY_TRAVEL_PACK: TopicPack = {
  id: "hospitality-travel",
  label: "Hospitality & Travel",
  version: 1,
  summary:
    "A complete hospitality site: rooms and experiences with prices, amenities, gallery, location, booking, reviews, and a local-area guide.",
  match: {
    keywords: [
      "hotel", "motel", "inn", "rentals", "rental", "tours", "tour",
      "travel", "lodging", "resort", "cabin", "bed and breakfast",
    ],
    phrases: [
      "vacation rental", "bed and breakfast", "boutique hotel",
      "guided tours", "places to stay", "holiday rental",
    ],
    negativeKeywords: ["car rental", "auto rental"],
  },
  themeDefaults: { theme: "light", accentHue: 190 },
  hero: {
    imageSubjects: [
      "cozy hotel room with view",
      "charming bed and breakfast exterior",
      "vacation rental cabin in woods",
      "guided tour group at landmark",
    ],
    cta: "Check availability",
    requiredElements: ["place in headline", "sleeps or group size line"],
  },
  requiredSections: [
    {
      kind: "cards", label: "Rooms & experiences", headingHints: ["Rooms & experiences", "Stay with us"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Each room/experience with sleeps, bed setup, and the nightly price in the text — a room without a price is a brochure, not a booking page.",
    },
    {
      kind: "features", label: "Amenities", headingHints: ["Amenities", "Included"],
      minItems: 4, requiredFields: ["title", "text"],
      notes: "Breakfast, parking, wifi, hot tub, check-in shape — the practical list guests filter on.",
    },
    {
      kind: "gallery", label: "Gallery", headingHints: ["Gallery", "See the place"],
      minItems: 6,
      notes: "Rooms, views, grounds, breakfast — the actual property, honestly lit.",
    },
    {
      kind: "about", label: "Your hosts", headingHints: ["Your hosts", "About"],
      notes: "The hosts/owners and the place's story, briefly and warmly.",
    },
    {
      kind: "features", label: "Local area guide", headingHints: ["Local area guide", "Explore nearby"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "What to do nearby with real distances — the reason to stay HERE.",
    },
    {
      kind: "testimonials", label: "Guest reviews", headingHints: ["Guest reviews", "What guests say"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named guests with where they came from and what they did.",
    },
    {
      kind: "booking", label: "Book your stay", headingHints: ["Book your stay", "Check availability"],
      minItems: 5,
      notes: "The booking request form from the booking block — one form on the page.",
    },
    {
      kind: "areas", label: "Find us", headingHints: ["Find us", "Location"],
      notes: "Address, arrival notes, and a directions link (the v1 map block).",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Call us"],
      notes: "Phone and email for booking questions.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Property name, address, check-in line." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Good to know"], minItems: 3, notes: "Check-in/out, pets, cancellation, minimum stay." },
    { kind: "pricing", label: "Seasonal rates", headingHints: ["Rates", "Seasonal rates"], notes: "Rate table when it differs by season." },
  ],
  requiredBlocks: [
    {
      block: "booking", formKind: "reservation",
      fields: ["name", "email", "check-in date", "check-out date", "guests"],
      notes: "Stay requests post to the platform form endpoint — a request, never fake live availability.",
    },
    { block: "map", notes: "Location block with directions." },
    { block: "gallery", notes: "Property photos, six-plus." },
    { block: "reviews", notes: "Named guest reviews." },
  ],
  images: {
    required: [
      "cozy hotel room with view",
      "charming bed and breakfast exterior",
      "vacation rental cabin in woods",
      "guided tour group at landmark",
    ],
    allowed: [
      "breakfast table with coffee and pastries",
      "lake view from porch chairs",
      "hotel pool at sunset",
      "hiking trail mountain overlook",
      "small town main street shops",
    ],
    banned: ["office meeting", "airport terminal crowd", "car repair", "gym equipment"],
  },
  copy: {
    tone: "Warm and exact — real prices, real distances, honest photos; no resort-brochure fog.",
    mustMention: ["book direct", "locally owned and operated"],
    bannedPhrases: ["hidden fees", "paradise getaway", "cheapest rates guaranteed", "luxury escape"],
  },
  seo: {
    titlePattern: "{Business} — Places to stay in {City}, {State}",
    descriptionPattern:
      "{Business} offers places to stay in {City} — rooms and experiences with prices, amenities, guest reviews, and booking requests.",
    localKeywords: ["places to stay", "vacation rental", "bed and breakfast", "hotel"],
    schemaType: "LodgingBusiness",
  },
  completeness: { minSections: 9, galleryMinImages: 6, testimonialsMin: 2 },
};
