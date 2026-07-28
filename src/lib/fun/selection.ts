/**
 * Fun Layer v1 — Challenge Selection Logic
 *
 * Deterministic daily challenge selection based on UTC date.
 * Surprise Me picks a random challenge that is NOT the current daily challenge.
 */

import { CHALLENGES, type CreativeChallenge } from "./challenges";

/**
 * Convert a UTC date to a day index (days since epoch).
 * Uses UTC midnight to ensure global consistency.
 */
function utcDayIndex(date: Date): number {
  const utcMidnight = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
  return Math.floor(utcMidnight / 86_400_000);
}

/**
 * Deterministic pseudo-random generator (mulberry32).
 * Same seed always produces the same sequence.
 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Get the daily challenge for a given date (UTC).
 * Deterministic — same date always returns the same challenge.
 */
export function getDailyChallenge(date: Date = new Date()): CreativeChallenge {
  const dayIndex = utcDayIndex(date);
  const seed = dayIndex * 2654435761; // Knuth multiplicative hash
  const rng = mulberry32(seed);
  const index = Math.floor(rng() * CHALLENGES.length);
  return CHALLENGES[index];
}

/**
 * Get the daily challenge for tomorrow (used to verify next-day change).
 */
export function getTomorrowChallenge(): CreativeChallenge {
  const tomorrow = new Date();
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  return getDailyChallenge(tomorrow);
}

/**
 * Surprise Me — pick a random challenge that is NOT the current daily challenge.
 * Uses Math.random for genuine unpredictability.
 * Guarantees a different challenge from today's daily pick.
 */
export function getSurpriseChallenge(date: Date = new Date()): CreativeChallenge {
  const daily = getDailyChallenge(date);
  const candidates = CHALLENGES.filter((c) => c.id !== daily.id);
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

/**
 * Build the Studio handoff URL for a challenge.
 * Only passes the challenge ID — the prompt is resolved from the catalog.
 */
export function getChallengeUrl(challenge: CreativeChallenge): string {
  return `/studio?tool=${challenge.suggestedTool}&challenge=${challenge.id}`;
}
