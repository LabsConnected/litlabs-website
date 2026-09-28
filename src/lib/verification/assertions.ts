/**
 * LiTT Verification Foundation — assertion helpers.
 * Pure: no I/O.
 */
import type { AssertionResult } from "./types";

/** Build an assertion result from an observed vs expected comparison. */
export function assertion(
  name: string,
  expected: string,
  observed: string,
): AssertionResult {
  return { name, expected, observed, pass: expected === observed };
}

/** True when every assertion in the set passed. */
export function allAssertionsPass(assertions: AssertionResult[]): boolean {
  return assertions.length > 0 && assertions.every((a) => a.pass);
}

/** Names of the assertions that failed. */
export function failedAssertionNames(assertions: AssertionResult[]): string[] {
  return assertions.filter((a) => !a.pass).map((a) => a.name);
}

/**
 * Merge assertion sets from multiple evidence items, keyed by name.
 * Later items do not overwrite earlier ones — conflicts are detected
 * separately by detect-conflicts.ts; this is only an index.
 */
export function indexAssertionsByName(
  assertions: AssertionResult[],
): Map<string, AssertionResult[]> {
  const map = new Map<string, AssertionResult[]>();
  for (const a of assertions) {
    const list = map.get(a.name) ?? [];
    list.push(a);
    map.set(a.name, list);
  }
  return map;
}
