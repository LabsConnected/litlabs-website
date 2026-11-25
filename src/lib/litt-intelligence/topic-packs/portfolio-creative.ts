import type { TopicPack } from "./types";

/**
 * portfolio-creative — photographers, designers, artists,
 * videographers, freelancers (§2 row 9). Gallery-led: the work is
 * the argument; packages and a booking path close it.
 */
export const PORTFOLIO_CREATIVE_PACK: TopicPack = {
  id: "portfolio-creative",
  label: "Portfolio & Creative",
  version: 1,
  summary:
    "A complete creative portfolio: gallery-led work samples, services, priced packages, about, reviews, and an inquiry form.",
  match: {
    keywords: [
      "photographer", "photography", "designer", "artist", "videographer",
      "illustrator", "freelancer", "portfolio", "creative",
    ],
    phrases: [
      "photography portfolio", "graphic designer", "wedding photographer",
      "freelance designer", "video production", "portrait photographer",
    ],
  },
  themeDefaults: { theme: "mono", accentHue: 265 },
  hero: {
    imageSubjects: [
      "photographer shooting portrait session",
      "designer workspace with sketches",
      "gallery wall of framed artwork",
      "videographer filming with camera",
    ],
    cta: "Book a session",
    requiredElements: ["craft in headline", "availability line"],
  },
  requiredSections: [
    {
      kind: "gallery", label: "Selected work", headingHints: ["Selected work", "Portfolio", "Work"],
      minItems: 6,
      notes: "The work leads — six or more real pieces, on-topic subjects only.",
    },
    {
      kind: "services", label: "Services", headingHints: ["Services", "What I offer"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "The kinds of work offered (sessions, commissions, brand work) with what each includes.",
    },
    {
      kind: "pricing", label: "Packages", headingHints: ["Packages", "Pricing"],
      minItems: 3,
      notes: "Three packages with real prices and what each includes — no 'contact for pricing' on every tier.",
    },
    {
      kind: "about", label: "About", headingHints: ["About", "About the artist"],
      notes: "First person where natural: background, style, who the work is for.",
    },
    {
      kind: "testimonials", label: "Kind words", headingHints: ["Kind words", "Reviews"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named clients with the kind of project they booked.",
    },
    {
      kind: "form", label: "Inquiry form", headingHints: ["Book a session", "Start a project"],
      minItems: 6,
      notes: "The inquiry form from the form block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Get in touch"],
      notes: "Email and socials; studio location if public.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Name, craft, copyright line." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Good to know"], minItems: 3, notes: "Turnaround, deposits, travel, print rights." },
    { kind: "stats", label: "Numbers", headingHints: ["By the numbers"], minItems: 3, notes: "Shoots done, years, awards — only when real." },
  ],
  requiredBlocks: [
    {
      block: "form", formKind: "intake",
      fields: ["name", "email", "phone", "project type", "date", "message"],
      notes: "Inquiries post to the platform form endpoint.",
    },
    { block: "gallery", notes: "The work itself, six-plus pieces." },
    { block: "reviews", notes: "Named client words." },
    { block: "payments", notes: "Priced packages satisfy the payments block; checkout links only when the project has one configured." },
  ],
  images: {
    required: [
      "photographer shooting portrait session",
      "designer workspace with sketches",
      "gallery wall of framed artwork",
      "videographer filming with camera",
    ],
    allowed: [
      "wedding couple portrait outdoors",
      "brand identity mockup on desk",
      "artist painting canvas in studio",
      "concert stage lights crowd",
      "product photography setup",
    ],
    banned: ["office meeting", "plumbing repair", "fast food burger", "car dealership"],
  },
  copy: {
    tone: "Personal and visual — show the work, name the craft, skip the buzzwords.",
    mustMention: ["available for new projects", "booking inquiries welcome"],
    bannedPhrases: ["visionary artist", "world-renowned", "cutting-edge creative solutions", "passionate creative"],
  },
  seo: {
    titlePattern: "{Business} — Creative Portfolio in {City}, {State}",
    descriptionPattern:
      "{Business} is a creative portfolio from {City} — selected work, packages with prices, and booking inquiries for new projects.",
    localKeywords: ["photographer near me", "wedding photographer", "graphic designer", "videographer"],
    schemaType: "ProfessionalService",
  },
  completeness: { minSections: 7, galleryMinImages: 6, testimonialsMin: 2 },
};
