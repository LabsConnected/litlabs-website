/**
 * Deploy target vocabulary for user-project publishing.
 *
 * Two targets exist:
 * - "litt"    — LiTT Hosting's static tier (row target "litt-static").
 *               The original and default publish path; behavior unchanged.
 * - "netlify" — the USER'S OWN Netlify account (row target "netlify"),
 *               added 2026-11-11 at Larry's explicit reversal of his
 *               earlier decline. Publishing there uses the user's own
 *               connected Netlify credential, resolved server-side from
 *               the caller's identity — never from model input.
 *
 * The CHOICE ("litt" | "netlify") is what the UI and the project.deploy
 * tool input speak; the ROW TARGET is what deployment records store.
 * Keeping the mapping in exactly one module means the two vocabularies
 * can never drift apart.
 */

export type DeployTargetChoice = "litt" | "netlify";

/**
 * The LiTT row target — identical to HOSTING_TARGET in ./litt-hosting,
 * kept as a literal here so this module stays importable from client
 * components (litt-hosting pulls in server-side backends). A unit test
 * pins the two together.
 */
const LITT_ROW_TARGET = "litt-static";

/** Row target stored on deployment records for the Netlify adapter. */
export const NETLIFY_TARGET = "netlify" as const;

/**
 * Normalize an untrusted target value (tool input, event detail) to a
 * choice. Anything unrecognized — including a missing value — is the
 * default "litt": an unknown target must never silently publish somewhere
 * the user did not name.
 */
export function normalizeDeployTargetInput(value: unknown): DeployTargetChoice {
  return value === "netlify" ? "netlify" : "litt";
}

/** The deployment-row target for a choice. */
export function rowTargetForChoice(choice: DeployTargetChoice): string {
  return choice === "netlify" ? NETLIFY_TARGET : LITT_ROW_TARGET;
}

/** The user-facing label for a choice (approval cards, Deploy surface). */
export function deployTargetLabel(choice: DeployTargetChoice): string {
  return choice === "netlify" ? "Netlify" : "LiTT Hosting";
}

/**
 * The choice a deployment ROW belongs to, for display/grouping.
 * Unknown row targets (future adapters) return null rather than being
 * misattributed to either of today's targets.
 */
export function choiceForRowTarget(target: string): DeployTargetChoice | null {
  if (target === NETLIFY_TARGET) return "netlify";
  if (target === LITT_ROW_TARGET) return "litt";
  return null;
}
