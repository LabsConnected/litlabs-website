/**
 * Business Profile — the "describe once" intake model.
 *
 * The launch-program thesis: "Describe your business once. LiTT builds it,
 * configures what it needs, and walks you live." This module is the front
 * door: it turns a free-text business description into a persisted,
 * transparently-inferred Business Profile that every later stage can read
 * from instead of re-asking the user.
 *
 * Design rules:
 * - Inference is a transparent keyword map, not a black box. Every result
 *   carries the matched keywords so the UI can show its working.
 * - The downstream contract (`BusinessProfileDownstream`) is the shape the
 *   publish/SEO/analytics worker consumes. Keep it stable.
 * - This file is PURE (no DB, no fetch, no localStorage) so it can be
 *   imported by server routes, client components, and the prompt composer.
 */

/** Business types LiTT can infer. `other` is the honest fallback. */
export type BusinessTypeId =
  | "local-service"
  | "restaurant-food"
  | "retail-store"
  | "online-store"
  | "portfolio-creator"
  | "saas-software"
  | "agency-professional"
  | "health-wellness"
  | "real-estate"
  | "education"
  | "nonprofit"
  | "event"
  | "music-artist"
  | "game"
  | "other";

export interface BusinessTypeInfo {
  id: BusinessTypeId;
  /** Human label, e.g. "Local service business". */
  label: string;
  /** Greeter category id this type maps to (see EmptyCanvasGreeter / STARTER_BUILDS). */
  category: string;
  /** starter-builds.ts template id recommended for this type. */
  templateId: string;
  /** Where "Start building" should land in Studio. */
  studioHref: string;
}

export const BUSINESS_TYPES: Record<BusinessTypeId, BusinessTypeInfo> = {
  "local-service": {
    id: "local-service",
    label: "Local service business",
    category: "Website",
    templateId: "business-site",
    studioHref: "/studio?tool=chat&mode=website",
  },
  "restaurant-food": {
    id: "restaurant-food",
    label: "Restaurant / food business",
    category: "Website",
    templateId: "business-site",
    studioHref: "/studio?tool=chat&mode=website",
  },
  "retail-store": {
    id: "retail-store",
    label: "Retail store",
    category: "Store",
    templateId: "store",
    studioHref: "/studio?tool=chat&mode=website",
  },
  "online-store": {
    id: "online-store",
    label: "Online store",
    category: "Store",
    templateId: "store",
    studioHref: "/studio?tool=chat&mode=website",
  },
  "portfolio-creator": {
    id: "portfolio-creator",
    label: "Portfolio / creator",
    category: "Creator",
    templateId: "portfolio",
    studioHref: "/studio?tool=chat&mode=website",
  },
  "saas-software": {
    id: "saas-software",
    label: "Software / SaaS product",
    category: "SaaS",
    templateId: "saas-dashboard",
    studioHref: "/studio?tool=build",
  },
  "agency-professional": {
    id: "agency-professional",
    label: "Agency / professional services",
    category: "Website",
    templateId: "business-site",
    studioHref: "/studio?tool=chat&mode=website",
  },
  "health-wellness": {
    id: "health-wellness",
    label: "Health & wellness",
    category: "Website",
    templateId: "business-site",
    studioHref: "/studio?tool=chat&mode=website",
  },
  "real-estate": {
    id: "real-estate",
    label: "Real estate",
    category: "Website",
    templateId: "business-site",
    studioHref: "/studio?tool=chat&mode=website",
  },
  education: {
    id: "education",
    label: "Education / courses",
    category: "Website",
    templateId: "landing-page",
    studioHref: "/studio?tool=chat&mode=website",
  },
  nonprofit: {
    id: "nonprofit",
    label: "Nonprofit / community",
    category: "Website",
    templateId: "landing-page",
    studioHref: "/studio?tool=chat&mode=website",
  },
  event: {
    id: "event",
    label: "Event / venue",
    category: "Website",
    templateId: "landing-page",
    studioHref: "/studio?tool=chat&mode=website",
  },
  "music-artist": {
    id: "music-artist",
    label: "Music artist",
    category: "Creator",
    templateId: "portfolio",
    studioHref: "/studio?tool=chat&mode=website",
  },
  game: {
    id: "game",
    label: "Game",
    category: "Website",
    templateId: "landing-page",
    studioHref: "/studio?tool=game",
  },
  other: {
    id: "other",
    label: "Something else",
    category: "Website",
    templateId: "landing-page",
    studioHref: "/studio?tool=chat&mode=website",
  },
};

/**
 * Transparent keyword map: business type -> indicative phrases.
 * Matching is case-insensitive substring matching on the normalized
 * description. Longer phrases are listed first so multi-word matches win
 * ties; ties otherwise resolve by list order below (more specific types
 * first).
 */
const KEYWORD_MAP: Array<{ type: BusinessTypeId; keywords: string[] }> = [
  {
    type: "restaurant-food",
    keywords: [
      "food truck", "coffee shop", "ice cream", "fine dining",
      "restaurant", "cafe", "café", "bakery", "pizzeria", "pizza",
      "burger", "taco", "sushi", "diner", "catering", "caterer",
      "brewery", "bar & grill", "bistro", "brunch", "breakfast joint",
      "sandwich shop", "donut", "doughnut", "juice bar", "smoothie",
      "steakhouse", "bbq", "barbecue", "ramen", "thai food",
      "mexican restaurant", "italian restaurant", "menu", "chef",
    ],
  },
  {
    type: "local-service",
    keywords: [
      "dog grooming", "pet grooming", "dog walking", "pet sitting",
      "auto repair", "oil change", "car detailing", "house cleaning",
      "cleaning service", "lawn care", "landscaping", "landscaper",
      "snow removal", "pest control", "locksmith", "handyman",
      "home repair", "roofing", "roofer", "plumbing", "plumber",
      "electrician", "electrical", "hvac", "painting", "painter",
      "remodeling", "contractor", "drywall", "flooring", "carpet cleaning",
      "pressure washing", "moving company", "movers", "junk removal",
      "barber", "barbershop", "hair salon", "nail salon", "tattoo",
      "massage", "day spa", "detailing", "mechanic", "towing",
      "septic", "well drilling", "garage door", "appliance repair",
      "salon", "grooming", "cleaners", "dry cleaner",
    ],
  },
  {
    type: "health-wellness",
    keywords: [
      "dental", "dentist", "orthodont", "chiropract", "physical therapy",
      "mental health", "counseling", "therapist", "therapy practice",
      "wellness", "yoga", "pilates", "acupuncture", "massage therapy",
      "medical", "clinic", "doctor", "pediatric", "veterinar", "vet clinic",
      "optometrist", "dermatolog",
    ],
  },
  {
    type: "online-store",
    keywords: [
      "sell online", "selling online", "ecommerce", "e-commerce",
      "shopify", "etsy shop", "online shop", "online store",
      "dropship", "merch line", "merchandise", "products to sell",
    ],
  },
  {
    type: "retail-store",
    keywords: [
      "gift shop", "flower shop", "pet store", "bookstore",
      "clothing store", "boutique", "furniture store", "thrift store",
      "jewelry", "florist", "flowers", "retail", "storefront",
      "consignment", "antique shop", "hardware store", "garden center",
      "liquor store", "convenience store",
    ],
  },
  {
    type: "real-estate",
    keywords: [
      "real estate", "realtor", "brokerage", "property management",
      "homes for sale", "buying and selling homes", "listings",
      "real-estate",
    ],
  },
  {
    type: "saas-software",
    keywords: [
      "saas", "software startup", "software product", "mobile app",
      "web app", "platform for", "dashboard", "analytics tool",
      "crm", "project management tool", "scheduling software",
      "startup idea", "tech startup", "b2b software",
    ],
  },
  {
    type: "agency-professional",
    keywords: [
      "marketing agency", "digital agency", "creative agency",
      "consulting", "consultant", "law firm", "lawyer", "attorney",
      "accounting", "accountant", "cpa firm", "bookkeeping",
      "financial advisor", "insurance agency", "staffing agency",
      "coaching business", "life coach", "business coach",
      "freelance", "freelancer",
    ],
  },
  {
    type: "music-artist",
    keywords: [
      "music artist", "recording artist", "hip hop artist", "rapper",
      "singer", "vocalist", "band", "music producer", "beat maker",
      "album", "mixtape", "tour dates", "spotify", "soundcloud",
      "discography",
    ],
  },
  {
    type: "portfolio-creator",
    keywords: [
      "portfolio", "photographer", "photography", "videographer",
      "graphic designer", "interior designer", "artist", "illustrator",
      "content creator", "influencer", "youtuber", "tiktoker",
      "stream", "podcast", "author", "writer", "freelance designer",
      "model portfolio", "link in bio", "media kit", "gallery",
    ],
  },
  {
    type: "education",
    keywords: [
      "tutoring", "tutor", "online course", "course creator",
      "training program", "workshop", "bootcamp", "music lessons",
      "dance studio", "martial arts", "karate", "academy",
      "preschool", "daycare", "childcare", "driving school",
    ],
  },
  {
    type: "nonprofit",
    keywords: [
      "nonprofit", "non-profit", "charity", "church", "ministry",
      "foundation", "fundraiser", "volunteer", "community center",
      "animal rescue", "food bank", "501c3",
    ],
  },
  {
    type: "event",
    keywords: [
      "wedding planner", "wedding venue", "event planning",
      "event venue", "party rental", "dj service", "event coordinator",
      "banquet hall",
    ],
  },
  {
    type: "game",
    keywords: [
      "video game", "2d game", "3d game", "game studio",
      "indie game", "mobile game", "gaming", "game dev",
    ],
  },
];

export type InferenceConfidence = "high" | "medium" | "low";

export interface BusinessTypeInference {
  businessType: BusinessTypeId;
  info: BusinessTypeInfo;
  confidence: InferenceConfidence;
  /** The exact phrases that fired, for UI transparency. */
  matchedKeywords: string[];
}

/**
 * Infer the business type from a free-text description using the
 * transparent keyword map above. Never throws; returns `other` with low
 * confidence when nothing matches.
 */
export function inferBusinessType(description: string): BusinessTypeInference {
  // Normalize dashes so "dog-grooming" matches the "dog grooming" keyword.
  const text = (description ?? "").toLowerCase().replace(/[-‐‑‒–—−]/g, " ");
  if (!text.trim()) {
    return { businessType: "other", info: BUSINESS_TYPES.other, confidence: "low", matchedKeywords: [] };
  }

  let best: { type: BusinessTypeId; keywords: string[] } | null = null;
  let bestScore = 0;

  for (const entry of KEYWORD_MAP) {
    const matched = entry.keywords.filter((kw) => text.includes(kw));
    // Score = number of distinct keyword hits, with a small bonus for
    // multi-word (more specific) phrases so "dog grooming" beats "salon".
    const score = matched.reduce((sum, kw) => sum + (kw.includes(" ") ? 2 : 1), 0);
    if (score > bestScore) {
      bestScore = score;
      best = { type: entry.type, keywords: matched };
    }
  }

  if (!best || bestScore === 0) {
    return { businessType: "other", info: BUSINESS_TYPES.other, confidence: "low", matchedKeywords: [] };
  }

  const confidence: InferenceConfidence =
    bestScore >= 4 ? "high" : bestScore >= 2 ? "medium" : "low";

  return {
    businessType: best.type,
    info: BUSINESS_TYPES[best.type],
    confidence,
    matchedKeywords: best.keywords,
  };
}

// ─── Downstream contract ──────────────────────────────────────────

/**
 * DOWNSTREAM CONTRACT — the shape the publish/SEO/analytics worker expects.
 *
 * All fields optional. A worker MUST treat every field as possibly absent
 * and MUST NOT fabricate values for missing fields (per the product's
 * anti-boilerplate rules: never invent business facts).
 *
 * - businessName: the business's own name, as the user wrote it
 * - description: the user's verbatim description (source of truth)
 * - businessType: one of the BusinessTypeId values above, or user-corrected text
 * - location: free-text locality, e.g. "Muskegon, MI"
 * - phone / email: as extracted or user-provided
 * - services: list of services/products the business offers
 */
export interface BusinessProfileDownstream {
  businessName?: string;
  description?: string;
  businessType?: string;
  location?: string;
  phone?: string;
  email?: string;
  services?: string[];
}

/**
 * The stored Business Profile. Extends the downstream contract with
 * intake metadata (when/how it was captured and confirmed).
 */
export interface BusinessProfile extends BusinessProfileDownstream {
  /** ISO timestamp of when the profile was first captured. */
  capturedAt?: string;
  /** ISO timestamp of the last update. */
  updatedAt?: string;
  /** Whether the user confirmed the inferred type ("looks right"). */
  typeConfirmed?: boolean;
  /** Keywords that fired during inference, for UI transparency. */
  matchedKeywords?: string[];
  /** Recommended starter-build template id at capture time. */
  recommendedTemplateId?: string;
}

const MAX = {
  businessName: 120,
  description: 4000,
  businessType: 60,
  location: 160,
  phone: 40,
  email: 160,
  serviceItem: 100,
  services: 20,
} as const;

function cleanString(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return undefined;
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[+()\-.\s\d]{7,40}$/;

export interface ProfileValidation {
  profile: BusinessProfile;
  errors: string[];
}

/**
 * Validate + sanitize a profile payload (used by the PUT route and by
 * client code before saving). Unknown fields are dropped; overlong
 * strings are truncated; malformed email/phone are reported and dropped.
 */
export function validateBusinessProfile(input: unknown): ProfileValidation {
  const errors: string[] = [];
  const profile: BusinessProfile = {};
  if (!input || typeof input !== "object") {
    return { profile, errors: ["Profile must be an object"] };
  }
  const src = input as Record<string, unknown>;

  const businessName = cleanString(src.businessName, MAX.businessName);
  if (businessName) profile.businessName = businessName;

  const description = cleanString(src.description, MAX.description);
  if (description) profile.description = description;

  const businessType = cleanString(src.businessType, MAX.businessType);
  if (businessType) profile.businessType = businessType;

  const location = cleanString(src.location, MAX.location);
  if (location) profile.location = location;

  const phone = cleanString(src.phone, MAX.phone);
  if (phone) {
    if (PHONE_RE.test(phone)) profile.phone = phone;
    else errors.push("phone looks invalid and was dropped");
  }

  const email = cleanString(src.email, MAX.email);
  if (email) {
    if (EMAIL_RE.test(email)) profile.email = email;
    else errors.push("email looks invalid and was dropped");
  }

  if (Array.isArray(src.services)) {
    const services = src.services
      .map((s) => cleanString(s, MAX.serviceItem))
      .filter((s): s is string => !!s)
      .slice(0, MAX.services);
    if (services.length > 0) profile.services = services;
  }

  const capturedAt = cleanString(src.capturedAt, 40);
  if (capturedAt) profile.capturedAt = capturedAt;
  const updatedAt = cleanString(src.updatedAt, 40);
  if (updatedAt) profile.updatedAt = updatedAt;
  if (typeof src.typeConfirmed === "boolean") profile.typeConfirmed = src.typeConfirmed;
  if (Array.isArray(src.matchedKeywords)) {
    const kws = src.matchedKeywords
      .map((k) => cleanString(k, 60))
      .filter((k): k is string => !!k)
      .slice(0, 20);
    if (kws.length > 0) profile.matchedKeywords = kws;
  }
  const recommendedTemplateId = cleanString(src.recommendedTemplateId, 60);
  if (recommendedTemplateId) profile.recommendedTemplateId = recommendedTemplateId;

  return { profile, errors };
}

/**
 * True when a stored value looks like a BusinessProfile (used when reading
 * the settings JSONB blob so corrupt/legacy values degrade to null).
 */
export function isBusinessProfile(value: unknown): value is BusinessProfile {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (v.businessName === undefined || typeof v.businessName === "string") &&
    (v.description === undefined || typeof v.description === "string") &&
    (v.businessType === undefined || typeof v.businessType === "string") &&
    (v.location === undefined || typeof v.location === "string") &&
    (v.phone === undefined || typeof v.phone === "string") &&
    (v.email === undefined || typeof v.email === "string") &&
    (v.services === undefined || Array.isArray(v.services))
  );
}

// ─── Heuristic extraction ─────────────────────────────────────────

/** Capture a quoted business name: "Paws & Claws" ... */
const QUOTED_NAME_RE = /["“”]([^"“”]{2,60})["“”]/;
/** ... called X / ... named X (up to 4 capitalized words). */
const CALLED_NAME_RE = /\b(?:called|named)\s+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/;
/** I run X / I own X / I operate X — the most natural self-introduction. */
const RUN_NAME_RE = /\b[Ii]\s+(?:run|own|operate)\s+([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})/;
/** A capitalized phrase right before "in <Place>". */
const LEADING_NAME_RE =
  /^([A-Z][\w&'’.-]*(?:\s+[A-Z][\w&'’.-]*){0,3})\s+(?:in|near|at|around|serving)\s+[A-Z]/;

/** in Muskegon / near Grand Rapids / at the corner of ... */
const LOCATION_RE =
  /\b(?:in|near|at|around|from|serving)\s+(?:the\s+)?([A-Z][a-zA-Z.'-]*(?:\s+[A-Z][a-zA-Z.'-]*){0,2})(?:\s+area\b)?/;

/** Abbreviations that legitimately contain a period inside a place name. */
const LOCATION_ABBREVS = new Set(["st", "mt", "ft"]);

/**
 * Clean a raw location capture: a sentence boundary (". We do…") must not
 * leak into the place name, but abbreviations ("St. Louis") survive.
 */
function cleanLocation(raw: string): string {
  const noTrailingDots = raw.trim().replace(/[.]+$/, "").replace(/\s+area$/, "");
  const sentenceSplit = noTrailingDots.split(/\.\s+/);
  if (sentenceSplit.length === 1) return noTrailingDots;
  const first = sentenceSplit[0] ?? "";
  // "St. Louis" → the fragment before the period is an abbreviation.
  const lastWord = first.split(/\s+/).pop()?.toLowerCase() ?? "";
  if (LOCATION_ABBREVS.has(lastWord) && sentenceSplit.length >= 2) {
    return `${first}. ${sentenceSplit[1]}`.replace(/[.]+$/, "");
  }
  return first;
}

const PHONE_EXTRACT_RE = /(\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})/;
const EMAIL_EXTRACT_RE = /[\w.+-]+@[\w-]+\.[\w.]+/;
const SERVICES_LEAD_RE =
  /\b(?:offer(?:ing|s)?|services?\s+(?:include|including)|we\s+do|specializ(?:e|ing)\s+in|products?\s+include)\b[:\s]+([^.\n]{4,200})/i;

const STOP_PHRASES = new Set(["and more", "etc", "and so on", "and others"]);

/**
 * Heuristically extract profile fields from a free-text description.
 * Transparent and conservative: fields that can't be extracted with
 * reasonable confidence are left undefined rather than guessed.
 */
export function extractBusinessProfile(description: string): BusinessProfileDownstream {
  const profile: BusinessProfileDownstream = {};
  const text = (description ?? "").trim();
  if (!text) return profile;

  profile.description = text.length > MAX.description ? text.slice(0, MAX.description) : text;

  // Name: quoted > called/named > "I run X" > leading capitalized phrase.
  const quoted = text.match(QUOTED_NAME_RE)?.[1]?.trim();
  const called = text.match(CALLED_NAME_RE)?.[1]?.trim();
  const run = text.match(RUN_NAME_RE)?.[1]?.trim();
  const leading = text.match(LEADING_NAME_RE)?.[1]?.trim();
  const businessName = quoted || called || run || leading;
  if (businessName && businessName.length >= 2 && businessName.length <= MAX.businessName) {
    // Guard against capturing a sentence fragment as a "name"
    // ("I run ...", "The best ..."). Quoted names are trusted as-is.
    const firstWord = (businessName.split(" ")[0] ?? "").toLowerCase();
    const startsWithStopword = ["i", "we", "my", "our", "the", "a", "an"].includes(firstWord);
    if (quoted || !startsWithStopword) {
      profile.businessName = businessName;
    }
  }

  const location = cleanLocation(text.match(LOCATION_RE)?.[1] ?? "");
  if (location && location.length >= 2 && location.length <= MAX.location) {
    // Guard against common false positives ("in minutes", "in stock").
    const lower = location.toLowerCase();
    const falsePositives = ["minutes", "stock", "general", "person", "total", "addition", "progress", "house"];
    if (!falsePositives.includes(lower)) {
      profile.location = location;
    }
  }

  const phone = text.match(PHONE_EXTRACT_RE)?.[1]?.trim();
  if (phone && PHONE_RE.test(phone)) profile.phone = phone;

  const email = text
    .match(EMAIL_EXTRACT_RE)?.[0]
    ?.trim()
    .replace(/[.]+$/, "");
  if (email && EMAIL_RE.test(email)) profile.email = email;

  const servicesRaw = text.match(SERVICES_LEAD_RE)?.[1];
  if (servicesRaw) {
    const services = servicesRaw
      .split(/[,;]|\s+and\s+|\s*&\s+/)
      .map((s) => s.trim().replace(/[.]+$/, ""))
      .filter((s) => s.length >= 2 && s.length <= MAX.serviceItem)
      .filter((s) => !STOP_PHRASES.has(s.toLowerCase()))
      .slice(0, MAX.services);
    if (services.length > 0) profile.services = services;
  }

  return profile;
}

/**
 * Full intake: extract fields + run type inference, returning a profile
 * ready to show in the "LiTT thinks…" confirmation UI.
 */
export function buildIntakeProfile(description: string): {
  profile: BusinessProfile;
  inference: BusinessTypeInference;
} {
  const inference = inferBusinessType(description);
  const extracted = extractBusinessProfile(description);
  const now = new Date().toISOString();
  const profile: BusinessProfile = {
    ...extracted,
    businessType: inference.businessType,
    capturedAt: now,
    updatedAt: now,
    typeConfirmed: false,
    matchedKeywords: inference.matchedKeywords,
    recommendedTemplateId: inference.info.templateId,
  };
  return { profile, inference };
}

/**
 * Render an optional Business Profile as a prompt-composer context block.
 * Returns null when there's nothing meaningful to say (so callers can
 * append it only when it adds signal). Never fabricates: only fields
 * present in the profile are mentioned.
 */
export function buildBusinessProfilePromptBlock(
  profile: BusinessProfileDownstream | null | undefined,
): string | null {
  if (!profile) return null;
  const lines: string[] = [];
  if (profile.businessName) lines.push(`- Business name: ${profile.businessName}`);
  if (profile.businessType) {
    const info = BUSINESS_TYPES[profile.businessType as BusinessTypeId];
    lines.push(`- Business type: ${info ? info.label : profile.businessType}`);
  }
  if (profile.location) lines.push(`- Location: ${profile.location}`);
  if (profile.services?.length) lines.push(`- Offers: ${profile.services.join(", ")}`);
  if (profile.phone) lines.push(`- Phone: ${profile.phone}`);
  if (profile.email) lines.push(`- Email: ${profile.email}`);
  if (profile.description) {
    const desc = profile.description.length > 500 ? profile.description.slice(0, 500) + "…" : profile.description;
    lines.push(`- Owner's description: "${desc}"`);
  }
  if (lines.length === 0) return null;
  return [`Business profile (described once by the owner — use it, don't re-ask):`, ...lines].join("\n");
}
