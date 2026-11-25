import type { TopicPack } from "./types";

/**
 * retail-ecommerce — shops, boutiques, makers, online stores
 * (§2 row 4). Products carry prices; shipping and returns are
 * stated up front; the payments block is the priced catalogue plus
 * the shop CTA (a checkout link only when the project has one).
 */
export const RETAIL_ECOMMERCE_PACK: TopicPack = {
  id: "retail-ecommerce",
  label: "Retail & Online Shop",
  version: 1,
  summary:
    "A complete shop site: categories, featured products with prices, the maker's story, shipping and returns, reviews, and a newsletter signup.",
  match: {
    keywords: [
      "shop", "store", "boutique", "products", "ecommerce", "retail",
      "gifts", "candles", "jewelry", "clothing", "handmade",
    ],
    phrases: [
      "online store", "gift shop", "clothing boutique", "shop website",
      "sell online", "handmade goods", "etsy shop",
    ],
  },
  themeDefaults: { theme: "light", accentHue: 35 },
  hero: {
    imageSubjects: [
      "boutique clothing rack in sunlight",
      "handmade candles on wooden table",
      "small shop interior shelves",
      "artisan jewelry flat lay",
    ],
    cta: "Shop the collection",
    requiredElements: ["new arrivals in headline", "shipping line in subheading"],
  },
  requiredSections: [
    {
      kind: "cards", label: "Shop by category", headingHints: ["Shop by category", "Categories"],
      minItems: 3, requiredFields: ["title", "text"],
      notes: "The real categories in the shop, each with what is in it.",
    },
    {
      kind: "menu", label: "Featured products", headingHints: ["Featured products", "Bestsellers"],
      minItems: 6, requiredFields: ["title", "text", "price"],
      notes: "Featured products with a real price each; use group for the category so products render grouped with price rows.",
    },
    {
      kind: "gallery", label: "In the shop", headingHints: ["Gallery", "In the shop"],
      minItems: 4,
      notes: "Products and the shop itself — no warehouse or stock-office shots.",
    },
    {
      kind: "about", label: "Our story", headingHints: ["Our story", "About the maker"],
      notes: "Who makes or curates this, where, and how — the reason to buy here instead of a marketplace giant.",
    },
    {
      kind: "features", label: "Shipping & returns", headingHints: ["Shipping & returns", "Good to know"],
      minItems: 2, requiredFields: ["title", "text"],
      notes: "Shipping times/costs and the returns window, stated plainly — the two questions every shopper asks.",
    },
    {
      kind: "testimonials", label: "Customer reviews", headingHints: ["Reviews", "What customers say"],
      minItems: 2, requiredFields: ["quote", "author"],
      notes: "Named customers naming the product they bought.",
    },
    {
      kind: "cta", label: "Shop band", headingHints: ["Shop the collection", "Start shopping"],
      notes: "The payments surface in v1: a clear shop/checkout call to action (a real checkout link when the project has one configured).",
    },
    {
      kind: "form", label: "Newsletter signup", headingHints: ["Stay in the loop", "Newsletter"],
      minItems: 3,
      notes: "The newsletter/contact form from the form block — one form on the page.",
    },
    {
      kind: "contact", label: "Contact", headingHints: ["Contact", "Visit us"],
      notes: "Shop address if public, email, hours.",
    },
    { kind: "footer", label: "Footer", headingHints: ["Footer"], notes: "Shop name, shipping line, copyright." },
  ],
  optionalSections: [
    { kind: "faq", label: "FAQ", headingHints: ["FAQ", "Questions"], minItems: 3, notes: "Sizing, gift wrap, local pickup." },
    { kind: "stats", label: "Numbers", headingHints: ["By the numbers"], minItems: 3, notes: "Happy customers, products, years — only when real." },
  ],
  requiredBlocks: [
    { block: "payments", notes: "Priced products plus the shop CTA; never a fake checkout button." },
    {
      block: "form", formKind: "contact",
      fields: ["first name", "email", "interests"],
      notes: "Newsletter signups post to the platform form endpoint as leads.",
    },
    { block: "gallery", notes: "Product and shop photos." },
    { block: "reviews", notes: "Named customer reviews." },
  ],
  images: {
    required: [
      "boutique clothing rack in sunlight",
      "handmade candles on wooden table",
      "small shop interior shelves",
      "artisan jewelry flat lay",
    ],
    allowed: [
      "customer unboxing package",
      "gift wrapping station",
      "market stall display",
      "sewing handmade bag",
      "stack of folded sweaters",
    ],
    banned: ["warehouse forklift", "office meeting", "car repair", "restaurant kitchen"],
  },
  copy: {
    tone: "Friendly, concrete, product-first — name materials, sizes, and shipping facts.",
    mustMention: ["secure checkout", "shipping and returns"],
    bannedPhrases: ["shop till you drop", "must-have", "limited time only", "best prices guaranteed"],
  },
  seo: {
    titlePattern: "{Business} — Shop Online in {City}, {State}",
    descriptionPattern:
      "{Business} is an online shop from {City} — featured products with prices, clear shipping and returns, and secure checkout.",
    localKeywords: ["gift shop", "boutique", "handmade", "shop online"],
    schemaType: "Store",
  },
  completeness: { minSections: 9, galleryMinImages: 4, testimonialsMin: 2 },
};
