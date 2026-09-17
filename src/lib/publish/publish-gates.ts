/**
 * publish-gates — the single choke point for the publish pipeline.
 *
 * Every pre-publish check (fabrication honesty, later: mobile layout,
 * accessibility, SEO basics) registers here. The deploy path calls
 * `runPublishGates(...)` once; a failed gate fails the deploy with a
 * clear, non-technical, user-facing message naming the section to fix.
 *
 * Keep this choke point generic: to add a new check, call
 * `registerPublishGate({ name, run })` — no changes to the deploy path.
 */

import { validateNoFabricatedContent } from "./fabrication-guard";

/** What the publish pipeline hands to every gate. */
export interface PublishGateInput {
  /** Publishable files: path + text content. */
  files: { path: string; content: string }[];
  projectId: string;
  userId: string;
}

/** The verdict of one gate — and of the whole gate run. */
export interface PublishGateResult {
  ok: boolean;
  /** Names of the gates that failed. Empty when ok. */
  failedGates: string[];
  /** Non-technical, user-facing message naming what to fix. Empty when ok. */
  message: string;
}

/** A single pre-publish check. `run` may be sync or async. */
export interface PublishGate {
  name: string;
  run(input: PublishGateInput): PublishGateResult | Promise<PublishGateResult>;
}

const registry: PublishGate[] = [];

/**
 * Register (or replace, by name) a publish gate.
 * Other workers: this is how you add a gate — e.g. a mobile-layout check.
 */
export function registerPublishGate(gate: PublishGate): void {
  if (!gate || typeof gate.name !== "string" || gate.name.length === 0) {
    throw new Error("registerPublishGate requires a gate with a non-empty name.");
  }
  if (typeof gate.run !== "function") {
    throw new Error(`registerPublishGate: gate "${gate.name}" must provide a run function.`);
  }
  const existing = registry.findIndex((g) => g.name === gate.name);
  if (existing >= 0) registry[existing] = gate;
  else registry.push(gate);
}

/** Remove a gate by name. Mainly useful in tests. */
export function unregisterPublishGate(name: string): void {
  const idx = registry.findIndex((g) => g.name === name);
  if (idx >= 0) registry.splice(idx, 1);
}

/** Names of all currently registered gates, in run order. */
export function listPublishGates(): string[] {
  return registry.map((g) => g.name);
}

/**
 * Run every registered gate, in registration order. All gates run even if
 * an earlier one fails, so the user gets the full list of problems at once.
 *
 * A gate that throws is treated as failed with a generic message — a buggy
 * gate must never silently pass, and must never crash the deploy path.
 */
export async function runPublishGates(input: PublishGateInput): Promise<PublishGateResult> {
  const failedGates: string[] = [];
  const messages: string[] = [];

  for (const gate of registry) {
    let result: PublishGateResult;
    try {
      result = await gate.run(input);
    } catch (err) {
      result = {
        ok: false,
        failedGates: [gate.name],
        message: `The "${gate.name}" publish check ran into a problem (${err instanceof Error ? err.message : String(err)}). Please try again.`,
      };
    }
    if (!result.ok) {
      failedGates.push(gate.name);
      if (result.message) messages.push(result.message);
    }
  }

  if (failedGates.length === 0) {
    return { ok: true, failedGates: [], message: "" };
  }
  return { ok: false, failedGates, message: messages.join("\n\n") };
}

// ─── Default gates ─────────────────────────────────────────────────
// Registered at module load. Re-registering by name replaces, so importing
// this module more than once (e.g. HMR) never duplicates a gate.

registerPublishGate({
  name: "no-fabricated-content",
  run: (input) => {
    const check = validateNoFabricatedContent({ files: input.files });
    if (check.ok) {
      return { ok: true, failedGates: [], message: "" };
    }
    return {
      ok: false,
      failedGates: ["no-fabricated-content"],
      message: check.violations.map((v) => v.message).join("\n\n"),
    };
  },
});
