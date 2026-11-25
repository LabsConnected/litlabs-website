/**
 * Topic Packs — typed product knowledge for site generation.
 *
 * A pack is DATA, not a code path: one object per site category that
 * knows what a complete, professional site for that topic contains —
 * required sections, working blocks (form / booking / map / payments /
 * hours / reviews), on-topic image subjects, copy rules, and SEO shape.
 * The planner brief, the plan validator, and the acceptance tests all
 * consume the same object, so a topic's bar can never drift between
 * "what we told the model" and "what we checked".
 *
 * Spec: TOPIC-PACKS-SPEC-2026-11-19.md (§1). Packs ship with the app
 * and change by PR; they are never user data.
 */

export type PackBlockKind =
  | "form"
  | "booking"
  | "map"
  | "gallery"
  | "payments"
  | "hours"
  | "reviews";

export type PackFormKind = "quote" | "contact" | "reservation" | "intake";

export interface PackSectionReq {
  /** A compose section kind (must exist in site-compose's KNOWN_KINDS). */
  kind: string;
  /**
   * Alternative kinds that also satisfy this requirement — §3 phrases
   * several roofing rows as "features or about"; the primary `kind` is
   * the preferred home, any of `altKinds` also counts.
   */
  altKinds?: string[];
  /** Human label — "Services" — used in briefs and error messages. */
  label: string;
  /** Acceptable heading shapes for the presence checker. */
  headingHints: string[];
  /** Minimum item count for the matched section, when item-bearing. */
  minItems?: number;
  /** Per-item fields that must be present and non-empty. */
  requiredFields?: string[];
  /** What "good" looks like — goes into the planner brief. */
  notes: string;
}

export interface BlockReq {
  block: PackBlockKind;
  /** For form/booking blocks: which form flavour the block needs. */
  formKind?: PackFormKind;
  /** Required form field names (form/booking blocks). */
  fields?: string[];
  notes: string;
}

export interface TopicPack {
  /** Stable id — "roofing" — used in project records and tests. */
  id: string;
  /** "Roofing Company". */
  label: string;
  /** Bump when requirements change. */
  version: number;
  /** One line: what a complete site for this topic is. */
  summary: string;

  /** How the planner recognizes this topic in a user prompt (§4.2). */
  match: {
    /** Weak signals — weighted terms: "roof", "shingles", "gutter". */
    keywords: string[];
    /** Strong signals: "roofing company", "roof repair". */
    phrases: string[];
    /** Disambiguators: "roof" in "rooftop bar" → not roofing. */
    negativeKeywords?: string[];
  };

  /** Overridable by the user/model. theme is a site-compose theme name. */
  themeDefaults: { theme: string; accentHue: number };

  hero: {
    /** Enrichment keywords, e.g. "roofers installing shingles". */
    imageSubjects: string[];
    /** The topic's natural primary action: "Get a free inspection". */
    cta: string;
    /**
     * e.g. ["trust line: licensed & insured", "city in headline"].
     * Entries shaped "trust line: X" are machine-checked (X must
     * appear in the plan copy); the rest are brief guidance.
     */
    requiredElements: string[];
  };

  /** Plan FAILS validation without these (§4.3). */
  requiredSections: PackSectionReq[];
  /** Offered in the brief, never forced. */
  optionalSections: PackSectionReq[];

  /** Working blocks (§1.1) — plan FAILS without these. */
  requiredBlocks: BlockReq[];

  images: {
    /** Subjects that must appear (hero + gallery minimums). */
    required: string[];
    /** On-topic subjects the model may also use. */
    allowed: string[];
    /** Off-topic subjects that fail validation if used. */
    banned: string[];
  };

  copy: {
    tone: string;
    /** Facts a pro site for this topic always states. */
    mustMention: string[];
    /** Banned phrases — hype, lorem, placeholders. */
    bannedPhrases: string[];
  };

  seo: {
    /** "{Business} — Roofing Contractor in {City}, {State}". */
    titlePattern: string;
    descriptionPattern: string;
    localKeywords: string[];
    /** schema.org type for future JSON-LD: "RoofingContractor". */
    schemaType: string;
  };

  completeness: {
    /** Total section floor for this pack. */
    minSections: number;
    galleryMinImages: number;
    /** 0 for packs where reviews are optional. */
    testimonialsMin: number;
  };
}
