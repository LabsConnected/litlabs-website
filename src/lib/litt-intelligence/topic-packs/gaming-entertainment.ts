import type { TopicPack } from "./types";

/**
 * gaming-entertainment — game studios, indie games, streamers,
 * esports, arcades, entertainment acts (§2 row 14). The bar: the
 * game or show itself front and center, where to get it, and the
 * community around it.
 */
export const GAMING_ENTERTAINMENT_PACK: TopicPack = {
  id: "gaming-entertainment",
  label: "Gaming & Entertainment",
  version: 1,
  summary:
    "A complete game/entertainment site: the game or show, features, media gallery, platforms, community, news, and press contact.",
  match: {
    keywords: [
      "game", "games", "gaming", "esports", "streamer", "arcade",
      "indie", "gameplay", "xbox", "playstation", "nintendo",
    ],
    phrases: [
      "video game", "indie game", "game studio", "esports team",
      "streaming channel", "game development",
    ],
  },
  themeDefaults: { theme: "dark", accentHue: 265 },
  hero: {
    imageSubjects: [
      "epic video game landscape artwork",
      "gamer wearing headset at rgb setup",
      "arcade machines neon lights",
      "esports arena crowd screens",
    ],
    cta: "Play the demo",
    requiredElements: ["game or show name in headline", "platforms line in subheading"],
  },
  requiredSections: [
    {
      kind: "about", label: "About the game", headingHints: ["About the game", "The show"],
      notes: "What it is, the fantasy it delivers, who made it — two or three punchy sentences.",
    },
    {
      kind: "features", label: "Game features", headingHints: ["Features", "Game features"],
      minItems: 4, requiredFields: ["title", "text"],
      notes: "Modes, world, mechanics, multiplayer — the reasons to play, concretely.",
    },
    {
      kind: "gallery", label: "Screenshots & media", headingHints: ["Screenshots", "Media"],
      minItems: 6,
      notes: "Screenshots and key art of the game/show itself — the trailer slot lives here in v1.",
    },
    {
      kind: "cards", label: "Platforms & editions", headingHints: ["Platforms", "Get the game"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "Where to get it (Steam, consoles, itch) and what each edition includes, with prices in the text.",
    },
    {
      kind: "features", label: "Community", headingHints: ["Community", "Join the community"],
      minItems: 2, requiredFields: ["title", "text"],
      notes: "Discord, streams, tournaments, fan content — where the community actually gathers.",
    },
    {
      kind: "testimonials", label: "Player words", headingHints: ["Player words", "Press & players"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Player/press quotes with the source named.",
    },
    {
      kind: "form", label: "Press & contact form", headingHints: ["Press kit & contact", "Contact the studio"],
      minItems: 4,
      notes: "The press/contact form from the form block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Studio"],
      notes: "Studio email, socials, press contact.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Studio name, game title, copyright and rating line." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Questions"], minItems: 3, notes: "Release date, platforms, early access, system needs." },
    { kind: "stats", label: "Numbers", headingHints: ["By the numbers"], minItems: 3, notes: "Players, wishlists, hours of content — only when real." },
  ],
  requiredBlocks: [
    {
      block: "form", formKind: "contact",
      fields: ["name", "email", "topic", "message"],
      notes: "Press and business inquiries post to the platform form endpoint.",
    },
    { block: "gallery", notes: "Screenshots and key art, six-plus." },
    { block: "reviews", notes: "Named player/press words." },
  ],
  images: {
    required: [
      "epic video game landscape artwork",
      "gamer wearing headset at rgb setup",
      "arcade machines neon lights",
      "esports arena crowd screens",
    ],
    allowed: [
      "retro game controller close up",
      "game character concept art",
      "streaming setup microphone camera",
      "pixel art game scene",
      "friends playing couch co-op",
    ],
    banned: ["office meeting", "restaurant food", "car repair", "roofing work"],
  },
  copy: {
    tone: "Energetic but concrete — name modes, worlds, and platforms; let the media do the shouting.",
    mustMention: ["available now", "wishlist"],
    bannedPhrases: ["revolutionary gaming experience", "next-gen masterpiece", "addictive gameplay", "best game ever"],
  },
  seo: {
    titlePattern: "{Business} — The game everyone will be playing",
    descriptionPattern:
      "{Business} is a game worth your time — features, screenshots, platforms and editions, community, and the latest news.",
    localKeywords: ["indie game", "video game", "esports", "game studio"],
    schemaType: "VideoGame",
  },
  completeness: { minSections: 8, galleryMinImages: 6, testimonialsMin: 2 },
};
