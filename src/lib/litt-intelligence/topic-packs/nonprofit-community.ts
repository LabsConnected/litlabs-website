import type { TopicPack } from "./types";

/**
 * nonprofit-community — charities, churches, clubs, PTA, community
 * organizations (§2 row 12). The bar: mission up front, programs,
 * events, a real get-involved path, and a donate block that follows
 * the payments rule (real link when configured, else contact CTA).
 */
export const NONPROFIT_COMMUNITY_PACK: TopicPack = {
  id: "nonprofit-community",
  label: "Nonprofit & Community",
  version: 1,
  summary:
    "A complete nonprofit site: mission, programs, events, stories, volunteer and donate paths, and contact.",
  match: {
    keywords: [
      "nonprofit", "charity", "church", "club", "community",
      "volunteer", "donations", "foundation", "ministry", "pta",
    ],
    phrases: [
      "nonprofit organization", "community organization", "church website",
      "charity organization", "volunteer group", "food bank",
    ],
  },
  themeDefaults: { theme: "light", accentHue: 150 },
  hero: {
    imageSubjects: [
      "volunteers packing food boxes",
      "community gathering in hall",
      "volunteers planting community garden",
      "church congregation smiling together",
    ],
    cta: "Get involved",
    requiredElements: ["mission in headline", "community served line"],
  },
  requiredSections: [
    {
      kind: "about", label: "Our mission", headingHints: ["Our mission", "Why we exist"],
      notes: "The mission in plain words: who is served, what changes, since when.",
    },
    {
      kind: "stats", label: "Impact numbers", headingHints: ["Our impact", "By the numbers"],
      minItems: 3,
      notes: "People served, meals, hours — real, dated numbers only.",
    },
    {
      kind: "services", label: "Programs", headingHints: ["Programs", "What we do"],
      minItems: 4, requiredFields: ["title", "text"],
      notes: "Each program: who it is for, when it runs, how to join.",
    },
    {
      kind: "gallery", label: "In the community", headingHints: ["Gallery", "In the community"],
      minItems: 4,
      notes: "Real people and real events — the community itself.",
    },
    {
      kind: "features", label: "Events", headingHints: ["Events", "Coming up"],
      minItems: 2, requiredFields: ["title", "text"],
      notes: "Recurring and upcoming events with day/time in the text.",
    },
    {
      kind: "features", label: "Get involved", headingHints: ["Get involved", "Volunteer"],
      minItems: 2, requiredFields: ["title", "text"],
      notes: "Volunteer, donate goods, partner — the concrete ways in, each with the next step.",
    },
    {
      kind: "testimonials", label: "Stories", headingHints: ["Stories", "Voices"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named people the work touched — with permission, in their words.",
    },
    {
      kind: "cta", label: "Donate band", headingHints: ["Donate", "Give today"],
      notes: "The payments surface in v1: the donate call to action (a real giving link when the project has one configured, else the contact path).",
    },
    {
      kind: "form", label: "Volunteer form", headingHints: ["Volunteer", "Join us"],
      minItems: 5,
      notes: "The volunteer/contact form from the form block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Visit us"],
      notes: "Address, meeting times, phone, email.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Organization name, mission line, tax-status line where applicable." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Questions"], minItems: 3, notes: "Donations, volunteering age limits, meeting times." },
    { kind: "hours", label: "Meeting times", headingHints: ["Meeting times", "When we meet"], notes: "Weekly rhythm where it helps." },
  ],
  requiredBlocks: [
    { block: "payments", notes: "Donate CTA (real giving link when configured; never a fake donation checkout)." },
    {
      block: "form", formKind: "contact",
      fields: ["name", "email", "phone", "how I want to help", "message"],
      notes: "Volunteer signups post to the platform form endpoint.",
    },
    { block: "gallery", notes: "Community photos." },
    { block: "reviews", notes: "Community stories count as this pack's reviews." },
  ],
  images: {
    required: [
      "volunteers packing food boxes",
      "community gathering in hall",
      "volunteers planting community garden",
      "church congregation smiling together",
    ],
    allowed: [
      "donation drive boxes of food",
      "kids art class community center",
      "volunteers serving meals",
      "neighborhood cleanup crew",
      "choir singing in church",
    ],
    banned: ["office meeting", "shopping mall", "car dealership", "gym equipment"],
  },
  copy: {
    tone: "Warm, plain, invitational — real people and real numbers, no guilt tactics.",
    mustMention: ["volunteers welcome", "everyone is welcome"],
    bannedPhrases: ["save the world", "desperate need", "act now or else", "world-changing"],
  },
  seo: {
    titlePattern: "{Business} — Community organization in {City}, {State}",
    descriptionPattern:
      "{Business} is a community organization in {City} — its mission, programs, events, and how to volunteer or donate.",
    localKeywords: ["nonprofit", "volunteer", "church", "community events"],
    schemaType: "NGO",
  },
  completeness: { minSections: 10, galleryMinImages: 4, testimonialsMin: 2 },
};
