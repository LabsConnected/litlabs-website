import type { TopicPack } from "./types";

/**
 * personal-one-page — résumés, link-in-bio, personal brand,
 * wedding/announcement pages (§2 row 20). The one deliberately
 * light pack: the completeness bar is lower by design — about,
 * highlights/links, a few photos, contact. Nothing else is forced.
 */
export const PERSONAL_ONE_PAGE_PACK: TopicPack = {
  id: "personal-one-page",
  label: "Personal One-Pager",
  version: 1,
  summary:
    "A light one-page personal site: about, highlights and links, a few photos, and contact — complete at five sections by design.",
  match: {
    keywords: ["resume", "cv", "bio", "personal", "announcement", "wedding"],
    phrases: [
      "personal website", "link in bio", "resume website",
      "wedding website", "personal page", "about me page",
    ],
    negativeKeywords: ["wedding venue", "wedding photographer"],
  },
  themeDefaults: { theme: "light", accentHue: 250 },
  hero: {
    imageSubjects: [
      "portrait of person smiling outdoors",
      "person working at laptop cafe",
      "friends laughing at gathering",
      "couple holding hands at sunset",
    ],
    cta: "Say hello",
    requiredElements: ["name in headline"],
  },
  requiredSections: [
    {
      kind: "about", label: "About", headingHints: ["About", "About me"],
      notes: "Who this is, in their own voice — a short paragraph, not a corporate bio.",
    },
    {
      kind: "cards", label: "Highlights & links", headingHints: ["Highlights", "Links", "Find me"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "The links and highlights that matter (work, socials, the registry, the big news) — each with a line of context.",
    },
    {
      kind: "gallery", label: "Photos", headingHints: ["Photos", "Gallery"],
      minItems: 3,
      notes: "A few real photos of the person/couple — quality over quantity.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Say hello"],
      notes: "Email and socials — the ways in that the person actually checks.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Name and a one-line sign-off." },
  ],
  optionalSections: [
    { kind: "faq", label: "Details", headingHints: ["Details", "Good to know"], minItems: 2, notes: "Wedding/announcement logistics where relevant." },
    { kind: "form", label: "RSVP / message form", headingHints: ["RSVP", "Leave a message"], notes: "Only when the page needs replies (RSVP, guestbook)." },
  ],
  requiredBlocks: [
    { block: "gallery", notes: "A few real photos — the light pack's one media requirement." },
  ],
  images: {
    required: [
      "portrait of person smiling outdoors",
      "person working at laptop cafe",
      "friends laughing at gathering",
    ],
    allowed: [
      "couple holding hands at sunset",
      "person hiking mountain trail",
      "birthday celebration with friends",
      "graduation portrait smiling",
    ],
    banned: ["office meeting", "stock chart graph", "car repair", "restaurant kitchen"],
  },
  copy: {
    tone: "Personal and warm — first person, short lines, no corporate voice.",
    mustMention: ["get in touch"],
    bannedPhrases: ["synergy-driven professional", "guru", "ninja", "rockstar"],
  },
  seo: {
    titlePattern: "{Business} — Personal page",
    descriptionPattern:
      "{Business} — a personal one-page site: about, highlights and links, photos, and how to get in touch.",
    localKeywords: ["resume", "personal site", "link in bio"],
    schemaType: "Person",
  },
  completeness: { minSections: 4, galleryMinImages: 3, testimonialsMin: 0 },
};
