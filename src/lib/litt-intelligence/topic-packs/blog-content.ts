import type { TopicPack } from "./types";

/**
 * blog-content — blogs, news, podcasts, newsletters, creators
 * (§2 row 11). The bar: recent highlights up front, clear topics,
 * a real subscribe path, and the person behind it.
 */
export const BLOG_CONTENT_PACK: TopicPack = {
  id: "blog-content",
  label: "Blog & Content",
  version: 1,
  summary:
    "A complete content site: latest posts or episodes, topic categories, about the author or host, a subscribe block, and contact.",
  match: {
    keywords: [
      "blog", "podcast", "newsletter", "articles", "writer",
      "author", "channel", "episodes", "magazine",
    ],
    phrases: [
      "blog website", "podcast show", "newsletter signup",
      "personal blog", "news site", "youtube channel",
    ],
  },
  themeDefaults: { theme: "light", accentHue: 200 },
  hero: {
    imageSubjects: [
      "writer typing at desk with notebook",
      "podcast microphone and headphones",
      "stack of magazines and coffee",
      "person reading newsletter on phone",
    ],
    cta: "Subscribe free",
    requiredElements: ["topic promise in headline", "publishing cadence line"],
  },
  requiredSections: [
    {
      kind: "cards", label: "Latest posts", headingHints: ["Latest posts", "Recent episodes"],
      minItems: 4, requiredFields: ["title", "text"],
      notes: "The newest posts or episodes — title plus a one-line hook each; these link to the real pieces.",
    },
    {
      kind: "features", label: "Topics", headingHints: ["Topics", "Categories"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "The topic categories a reader can browse, each with what it covers.",
    },
    {
      kind: "gallery", label: "From the show", headingHints: ["Gallery", "Behind the scenes"],
      minItems: 4,
      notes: "The desk, the mic, the places the work happens — the world of the publication.",
    },
    {
      kind: "about", label: "About the author", headingHints: ["About", "About the host"],
      notes: "Who writes/hosts this, their background, and why they cover this topic.",
    },
    {
      kind: "testimonials", label: "Reader words", headingHints: ["Reader words", "What readers say"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named readers/listeners on what they get from it.",
    },
    {
      kind: "form", label: "Subscribe", headingHints: ["Subscribe", "Get new posts by email"],
      minItems: 3,
      notes: "The subscribe form from the form block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Say hello"],
      notes: "Email for tips, pitches, and sponsorships.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Publication name, archive and socials line." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Questions"], minItems: 3, notes: "Cadence, guest pitches, sponsorships." },
    { kind: "cta", label: "Subscribe band", headingHints: ["Never miss a post"], notes: "One subscribe call band." },
  ],
  requiredBlocks: [
    {
      block: "form", formKind: "contact",
      fields: ["email", "first name", "interests"],
      notes: "Subscriptions post to the platform form endpoint as leads — the v1 subscribe path; no fake 'you are subscribed' state beyond the endpoint's real response.",
    },
    { block: "gallery", notes: "The publication's world in photos." },
    { block: "reviews", notes: "Named reader words." },
  ],
  images: {
    required: [
      "writer typing at desk with notebook",
      "podcast microphone and headphones",
      "stack of magazines and coffee",
      "person reading newsletter on phone",
    ],
    allowed: [
      "recording studio microphone close up",
      "library shelves warm light",
      "coffee and open journal",
      "interview conversation two people",
      "city street photography walk",
    ],
    banned: ["car repair", "roofing work", "restaurant kitchen", "gym equipment"],
  },
  copy: {
    tone: "Direct and personal — a clear promise about what the reader gets and how often.",
    mustMention: ["new posts", "free to subscribe"],
    bannedPhrases: ["thought leader", "content is king", "viral content", "must-read"],
  },
  seo: {
    titlePattern: "{Business} — Stories and ideas worth your time",
    descriptionPattern:
      "{Business} publishes new posts and episodes on a regular cadence — read the latest, browse the topics, and subscribe free.",
    localKeywords: ["blog", "podcast", "newsletter", "articles"],
    schemaType: "Blog",
  },
  completeness: { minSections: 7, galleryMinImages: 4, testimonialsMin: 2 },
};
