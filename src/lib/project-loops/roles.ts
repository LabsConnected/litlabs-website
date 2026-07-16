/**
 * Project Loops — agent roles
 *
 * Each role is a thin wrapper around the shared LLM client that knows
 * how to prompt for one specific phase of a Project Loop. They're
 * intentionally small: the prompts live here so they're easy to tweak
 * without touching the runner.
 */

import { generateText } from "@/lib/llm";
import type { ProjectLoop } from "@/types/project-loops";

export type RepoSnapshot = {
  available: boolean;
  /** Lightweight file listing for the model. */
  files: { path: string; size: number }[];
  /** Detected languages in the repo. */
  languages: string[];
  /** SHA of HEAD on the base branch. */
  headSha?: string;
};

function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function approxCents(text: string): number {
  return Math.max(1, Math.round(text.length / 1000));
}

/* ── Director ───────────────────────────────────────────────────── */

export async function runDirectorPlan(
  loop: ProjectLoop,
  snapshot: RepoSnapshot,
  signal?: AbortSignal,
): Promise<{ text: string; tokensUsed: number; costCents: number }> {
  const fileContext = snapshot.files
    .slice(0, 40)
    .map((f) => `- ${f.path} (${f.size}b)`)
    .join("\n");

  const prompt = `You are the **Director** of a LiTT Project Loop.

GOAL: ${loop.goal}

ACCEPTANCE CRITERIA:
${loop.acceptanceCriteria.map((c) => `- ${c}`).join("\n") || "(none provided)"}

REPO SNAPSHOT:
${snapshot.available ? `Files (sample of ${snapshot.files.length}):\n${fileContext}\nLanguages: ${snapshot.languages.join(", ")}\nHEAD: ${snapshot.headSha ?? "?"}` : "(snapshot unavailable — using goal only)"}

ITERATION: ${loop.iteration + 1} of ${loop.maxIterations}

Produce a concise plan (max ~250 words) that the Engineer will execute. Cover:
1. Which files to touch (max 5).
2. The concrete change for each.
3. How to verify it passes the acceptance criteria.
4. Risks / trade-offs.

Do NOT write the code. Just the plan.`;

  try {
    const result = await generateText(prompt, {
      task: "precise",
      maxTokens: 1024,
      temperature: 0.3,
    });
    return {
      text: result.text,
      tokensUsed: approxTokens(prompt) + approxTokens(result.text),
      costCents: approxCents(result.text),
    };
  } catch (err) {
    return {
      text:
        "Plan unavailable (LLM call failed). Engineer will proceed with best-effort edits based on the goal.",
      tokensUsed: 0,
      costCents: 0,
    };
  }
}
