import type { TopicPack } from "./types";

/**
 * health-wellness — clinics, dental, chiropractic, therapy, gyms,
 * yoga, wellness (§2 row 6). The page must answer: what do you
 * treat, who treats me, what does the first visit look like, do you
 * take my insurance, and how do I book.
 */
export const HEALTH_WELLNESS_PACK: TopicPack = {
  id: "health-wellness",
  label: "Health & Wellness",
  version: 1,
  summary:
    "A complete health and wellness site: services, providers, insurance and first-visit basics, hours, booking, reviews, and FAQ.",
  match: {
    keywords: [
      "clinic", "dental", "dentist", "chiropractic", "chiropractor", "therapy",
      "therapist", "gym", "yoga", "wellness", "health", "medical", "fitness",
    ],
    phrases: [
      "dental clinic", "physical therapy", "yoga studio", "fitness center",
      "chiropractic care", "wellness center", "mental health",
    ],
  },
  themeDefaults: { theme: "light", accentHue: 170 },
  hero: {
    imageSubjects: [
      "bright modern clinic reception",
      "dentist examining patient smile",
      "yoga class in sunlit studio",
      "physical therapist guiding exercise",
    ],
    cta: "Book an appointment",
    requiredElements: ["insurance line", "new patients line"],
  },
  requiredSections: [
    {
      kind: "services", label: "Services & treatments", headingHints: ["Services", "Treatments"],
      minItems: 5, requiredFields: ["title", "text"],
      notes: "The real services/treatments offered, each with what it is and who it helps.",
    },
    {
      kind: "features", label: "Meet the team", headingHints: ["Meet the team", "Our providers"],
      minItems: 3, requiredFields: ["title", "text"], altKinds: ["about"],
      notes: "Providers by name and role — people book people, not logos.",
    },
    {
      kind: "features", label: "Insurance & first visit", headingHints: ["Insurance & first visit", "New patients"],
      minItems: 2, requiredFields: ["title", "text"],
      notes: "Insurance basics and exactly what happens at the first visit — the two biggest unknowns for a new patient.",
    },
    {
      kind: "gallery", label: "Our space", headingHints: ["Our space", "Gallery"],
      minItems: 4,
      notes: "The actual rooms and people — calm, clean, real.",
    },
    {
      kind: "testimonials", label: "Patient words", headingHints: ["Patient words", "Reviews"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named patients describing their experience (never promised outcomes).",
    },
    {
      kind: "faq", label: "FAQ", headingHints: ["FAQ", "Common questions"],
      minItems: 4,
      notes: "Insurance, first visit, cancellation policy, what to wear/bring.",
    },
    {
      kind: "hours", label: "Hours", headingHints: ["Hours", "Opening hours"],
      notes: "Real hours by day.",
    },
    {
      kind: "booking", label: "Book a visit", headingHints: ["Book a visit", "Book an appointment"],
      minItems: 5,
      notes: "The appointment request form from the booking block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Visit us"],
      notes: "Address, phone, parking note where natural.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Practice name, address, hours line." },
  ],
  optionalSections: [
    { kind: "stats", label: "Numbers", headingHints: ["By the numbers"], minItems: 3, notes: "Years, patients, providers — only when real." },
    { kind: "cta", label: "New patient band", headingHints: ["New patients welcome"], notes: "One booking call band." },
  ],
  requiredBlocks: [
    {
      block: "booking", formKind: "reservation",
      fields: ["name", "phone", "date", "time", "reason for visit"],
      notes: "Appointment requests post to the platform form endpoint — request-a-time, never fake live availability.",
    },
    { block: "hours", notes: "Hours listed by day." },
    { block: "gallery", notes: "Space and team photos." },
    { block: "reviews", notes: "Named patient reviews." },
  ],
  images: {
    required: [
      "bright modern clinic reception",
      "dentist examining patient smile",
      "yoga class in sunlit studio",
      "physical therapist guiding exercise",
    ],
    allowed: [
      "gym members training with weights",
      "massage therapy room",
      "healthy food bowl and smoothie",
      "waiting room comfortable chairs",
      "stretching class outdoors",
    ],
    banned: ["surgery graphic", "hospital emergency room", "fast food", "office meeting"],
  },
  copy: {
    tone: "Calm, clear, reassuring — what happens at the first visit and what it costs; no miracle claims.",
    mustMention: ["new patients welcome", "most insurance accepted"],
    bannedPhrases: ["miracle cure", "guaranteed results", "instant pain relief", "best doctor in town"],
  },
  seo: {
    titlePattern: "{Business} — Health & Wellness in {City}, {State}",
    descriptionPattern:
      "{Business} offers health and wellness care in {City} — services, providers, insurance basics, and easy appointment booking.",
    localKeywords: ["dentist near me", "physical therapy", "yoga classes", "chiropractor"],
    schemaType: "MedicalClinic",
  },
  completeness: { minSections: 9, galleryMinImages: 4, testimonialsMin: 2 },
};
