import type { TopicPack } from "./types";

/**
 * professional-services — law firms, accountants, consultants,
 * agencies, advisors (§2 row 5). Credibility-led: practice areas,
 * credentials, a clear engagement process, and an intake form.
 * Copy care: no outcome promises for legal/financial work.
 */
export const PROFESSIONAL_SERVICES_PACK: TopicPack = {
  id: "professional-services",
  label: "Professional Services",
  version: 1,
  summary:
    "A complete professional-services site: practice areas, credentials, engagement process, testimonials, FAQ, and an intake form.",
  match: {
    keywords: [
      "law", "lawyer", "attorney", "legal", "accounting", "accountant",
      "consulting", "consultant", "agency", "advisor", "firm",
    ],
    phrases: [
      "law firm", "accounting firm", "consulting firm", "legal services",
      "financial advisor", "marketing agency", "law office",
    ],
  },
  themeDefaults: { theme: "light", accentHue: 220 },
  hero: {
    imageSubjects: [
      "professional team meeting in office",
      "lawyer reviewing documents",
      "modern office conference room",
      "consultant presenting strategy",
    ],
    cta: "Book a consultation",
    requiredElements: ["practice areas in headline", "consultation line in subheading"],
  },
  requiredSections: [
    {
      kind: "services", label: "Practice areas", headingHints: ["Practice areas", "Services"],
      minItems: 4, requiredFields: ["title", "text"],
      notes: "The actual practice or service areas, each with who it is for and what it covers.",
    },
    {
      kind: "about", label: "About the firm", headingHints: ["About the firm", "About us"],
      notes: "The firm and its principals: background, credentials, how long in this community.",
    },
    {
      kind: "features", label: "Credentials", headingHints: ["Credentials", "Why us"],
      minItems: 3, requiredFields: ["title", "text"], altKinds: ["about"],
      notes: "Licenses, memberships, certifications, years — verifiable facts, not adjectives.",
    },
    {
      kind: "process", label: "How it works", headingHints: ["How it works", "Working with us"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Consultation → assessment → engagement: what the client does at each step and what happens next.",
    },
    {
      kind: "testimonials", label: "Client words", headingHints: ["Client words", "Testimonials"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named clients (or role + town where confidentiality applies) describing the work, never a promised outcome.",
    },
    {
      kind: "faq", label: "FAQ", headingHints: ["FAQ", "Common questions"],
      minItems: 4,
      notes: "Fees shape, timelines, what to bring to the first meeting, confidentiality.",
    },
    {
      kind: "form", label: "Intake form", headingHints: ["Request a consultation", "Get in touch"],
      minItems: 5,
      notes: "The intake form from the form block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Office"],
      notes: "Office address, phone, email, hours.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Firm name and the required professional disclaimer line." },
  ],
  optionalSections: [
    { kind: "stats", label: "Numbers", headingHints: ["By the numbers"], minItems: 3, notes: "Years, clients, matters — only when real." },
    { kind: "cta", label: "Consultation band", headingHints: ["Talk to us"], notes: "One consultation call band." },
  ],
  requiredBlocks: [
    {
      block: "form", formKind: "intake",
      fields: ["name", "email", "phone", "topic", "message"],
      notes: "Intake posts to the platform form endpoint; the form itself carries no confidential detail beyond the topic.",
    },
    { block: "reviews", notes: "Named client testimonials." },
  ],
  images: {
    required: ["professional team meeting in office"],
    allowed: [
      "lawyer reviewing documents",
      "modern office conference room",
      "consultant presenting strategy",
      "courthouse columns",
      "signing contract close up",
      "business handshake office",
    ],
    banned: ["money cash pile", "roofing work", "restaurant food", "gym equipment"],
  },
  copy: {
    tone: "Measured, expert, plain — credentials and specifics over adjectives; no outcome promises for legal or financial work.",
    mustMention: ["free initial consultation", "confidential"],
    bannedPhrases: ["guaranteed results", "we win every case", "best lawyers in town", "aggressive representation"],
  },
  seo: {
    titlePattern: "{Business} — Professional Services in {City}, {State}",
    descriptionPattern:
      "{Business} provides professional services in {City} — practice areas, credentials, and a free initial consultation.",
    localKeywords: ["law firm", "accountant", "consultant", "advisor"],
    schemaType: "ProfessionalService",
  },
  completeness: { minSections: 8, galleryMinImages: 0, testimonialsMin: 2 },
};
