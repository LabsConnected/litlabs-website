/**
 * Topic pack registry + deterministic selection (§4.1, §4.2).
 *
 * Selection is deterministic first: phrases score strong, keywords
 * weak, negative keywords veto. A clear winner is selected with no
 * model call — fast, predictable, testable. Ambiguity returns null
 * (the general fallback); the model can still name a pack explicitly
 * through the site.compose `pack` argument, and the user's own words
 * ("no pack") always win.
 */

import type { TopicPack } from "./types";
import { normText } from "./pack-validation";
import { ROOFING_PACK } from "./roofing";
import { TRADES_HOME_SERVICES_PACK } from "./trades-home-services";
import { RESTAURANT_FOOD_PACK } from "./restaurant-food";
import { REAL_ESTATE_PACK } from "./real-estate";
import { PORTFOLIO_CREATIVE_PACK } from "./portfolio-creative";
import { RETAIL_ECOMMERCE_PACK } from "./retail-ecommerce";
import { PROFESSIONAL_SERVICES_PACK } from "./professional-services";
import { HEALTH_WELLNESS_PACK } from "./health-wellness";
import { BEAUTY_PERSONAL_CARE_PACK } from "./beauty-personal-care";
import { SAAS_TECH_PACK } from "./saas-tech";
import { BLOG_CONTENT_PACK } from "./blog-content";
import { NONPROFIT_COMMUNITY_PACK } from "./nonprofit-community";
import { EVENTS_VENUES_PACK } from "./events-venues";
import { GAMING_ENTERTAINMENT_PACK } from "./gaming-entertainment";
import { AUTOMOTIVE_PACK } from "./automotive";
import { EDUCATION_COURSES_PACK } from "./education-courses";
import { HOSPITALITY_TRAVEL_PACK } from "./hospitality-travel";
import { FINANCE_INSURANCE_PACK } from "./finance-insurance";
import { PETS_ANIMALS_PACK } from "./pets-animals";
import { PERSONAL_ONE_PAGE_PACK } from "./personal-one-page";

export type { TopicPack, PackSectionReq, BlockReq } from "./types";
export { validatePlanAgainstPack, subjectMatches } from "./pack-validation";
export { buildPackBrief, buildSkeletonPlan, checkPackPresence } from "./pack-brief";
export type { PackPresenceResult } from "./pack-brief";

/** All registered packs, in build order (spec §6). */
export const ALL_PACKS: TopicPack[] = [
  ROOFING_PACK,
  TRADES_HOME_SERVICES_PACK,
  RESTAURANT_FOOD_PACK,
  REAL_ESTATE_PACK,
  PORTFOLIO_CREATIVE_PACK,
  RETAIL_ECOMMERCE_PACK,
  PROFESSIONAL_SERVICES_PACK,
  HEALTH_WELLNESS_PACK,
  BEAUTY_PERSONAL_CARE_PACK,
  SAAS_TECH_PACK,
  BLOG_CONTENT_PACK,
  NONPROFIT_COMMUNITY_PACK,
  EVENTS_VENUES_PACK,
  GAMING_ENTERTAINMENT_PACK,
  AUTOMOTIVE_PACK,
  EDUCATION_COURSES_PACK,
  HOSPITALITY_TRAVEL_PACK,
  FINANCE_INSURANCE_PACK,
  PETS_ANIMALS_PACK,
  PERSONAL_ONE_PAGE_PACK,
];

const PACKS_BY_ID = new Map(ALL_PACKS.map((p) => [p.id, p]));

export function getPack(id: string | undefined | null): TopicPack | undefined {
  if (!id) return undefined;
  return PACKS_BY_ID.get(String(id).trim().toLowerCase());
}

// ─── Selection ───────────────────────────────────────────────────────

export interface PackSelection {
  pack: TopicPack;
  score: number;
  runnerUpScore: number;
  via: "phrase" | "keywords" | "explicit";
}

const PHRASE_SCORE = 10;
const KEYWORD_SCORE = 3;
const NEGATIVE_SCORE = -25;
const MIN_SCORE = 6;
const MARGIN = 4;

function wordHit(text: string, word: string): boolean {
  const w = normText(word);
  if (!w) return false;
  if (w.includes(" ")) return text.includes(w);
  return new RegExp(`(^| )${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( |$)`).test(` ${text} `);
}

function scorePack(pack: TopicPack, text: string): number {
  let score = 0;
  for (const phrase of pack.match.phrases) {
    if (text.includes(normText(phrase))) score += PHRASE_SCORE;
  }
  for (const kw of pack.match.keywords) {
    if (wordHit(text, kw)) score += KEYWORD_SCORE;
  }
  for (const neg of pack.match.negativeKeywords ?? []) {
    if (wordHit(text, neg) || text.includes(normText(neg))) score += NEGATIVE_SCORE;
  }
  return score;
}

/** "no pack" / "keep it simple" — the user override always wins. */
export function hasPackOptOut(text: string): boolean {
  const t = normText(text);
  return /\b(no|without a|skip the) (topic )?pack\b/.test(t) || /\bkeep it simple\b/.test(t);
}

/** An explicit pack mention: "use the roofing pack", "a restaurant pack". */
function explicitMention(text: string): TopicPack | undefined {
  const t = normText(text);
  for (const pack of ALL_PACKS) {
    if (t.includes(`${pack.id.replace(/-/g, " ")} pack`) || t.includes(normText(pack.label))) {
      return pack;
    }
  }
  return undefined;
}

/**
 * Deterministically select the pack for a user prompt (+ project
 * name). Returns null when nothing clears the bar — the caller falls
 * back to the general baseline and says so.
 */
export function selectTopicPack(rawText: string): PackSelection | null {
  const text = normText(rawText);
  if (!text || hasPackOptOut(text)) return null;

  const explicit = explicitMention(text);
  if (explicit) return { pack: explicit, score: 100, runnerUpScore: 0, via: "explicit" };

  const scored = ALL_PACKS.map((pack) => ({ pack, score: scorePack(pack, text) }))
    .sort((a, b) => b.score - a.score);
  const top = scored[0];
  const runnerUp = scored[1];
  if (!top || top.score < MIN_SCORE) return null;
  const margin = top.score - (runnerUp?.score ?? 0);
  if (margin < MARGIN && top.score < PHRASE_SCORE) return null;
  return {
    pack: top.pack,
    score: top.score,
    runnerUpScore: runnerUp?.score ?? 0,
    via: top.score >= PHRASE_SCORE ? "phrase" : "keywords",
  };
}
