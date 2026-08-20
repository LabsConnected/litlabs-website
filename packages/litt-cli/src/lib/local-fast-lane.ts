/**
 * Local Fast Lane — deterministic local queries answered without a model.
 *
 * A NARROW, EXPLICIT fast-path that runs BEFORE model routing. It matches a
 * small fixed set of canonical phrasings (after light normalization) and
 * answers them from local runtime state in milliseconds. It is deliberately
 * NOT fuzzy NLP — anything not in the exact phrase set falls through to the
 * normal chat/mission path.
 *
 * What it does NOT do:
 *   - no model request
 *   - no provider adapter resolution
 *   - no semantic mission creation
 *   - no ToolRegistry / ExecutionGateway / VerificationGate involvement
 *   - no mission persistence
 *
 * Truthfulness:
 *   - branch / git-clean read fresh git state via the canonical getGitState
 *     helper (the same one `litt doctor`/`litt status` use), so the answer
 *     can never disagree with the cockpit header.
 *   - project uses the canonical detected project name.
 *   - mode uses the canonical local session mode.
 *
 * The controller calls `matchLocalFastPath(input, ctx)`. A null return means
 * "no local match — proceed to classifyIntent / model routing". A non-null
 * return is rendered into the transcript by the controller (this module is
 * pure and side-effect free apart from the git read, which is a read-only
 * canonical state refresh).
 */

import { getGitState } from "./git-state.js";

export type LocalFastPathKind =
  | "branch"
  | "project"
  | "git-clean"
  | "mode"
  | "exit";

export interface LocalFastPathContext {
  /** cwd the tools/git use — passed to getGitState for fresh reads. */
  cwd: string;
  /** Canonical detected project name (from detectProject). */
  projectName?: string;
  /** Canonical local session mode. */
  mode: "plan" | "act";
}

export interface LocalFastPathResult {
  kind: LocalFastPathKind;
  /** The answer text rendered into the transcript. */
  text: string;
}

/**
 * Exact phrase sets. Matched after normalization only — no fuzzy/substring
 * matching. Adding a phrase here is an explicit decision to answer it
 * locally; ambiguous wording stays on the model path.
 */
const BRANCH_PHRASES = [
  "what branch am i on",
  "what branch is this",
  "current branch",
];

const PROJECT_PHRASES = [
  "what project is this",
  "what repo is this",
  "what repository is this",
];

const GIT_CLEAN_PHRASES = [
  "is the repo clean",
  "is git clean",
  "do i have changes",
  "is the repo dirty",
];

const MODE_PHRASES = [
  "what mode am i in",
  "am i in plan mode",
  "am i in act mode",
];

/**
 * Normalize input for exact-phrase matching:
 *   - lowercase
 *   - trim outer whitespace
 *   - strip a single trailing run of sentence punctuation (. ! ?)
 *   - collapse internal whitespace
 *   - strip a trailing question mark already handled above
 *
 * This is intentionally minimal — it does NOT stem, synonym-expand, or do
 * any fuzzy matching. "what branch am i on?" matches; "what's my branch"
 * does NOT (it falls through to the model path).
 */
export function normalizeLocalInput(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[?!.,;:]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Try to match `input` against the deterministic local phrase set.
 * Returns the answer result, or null when no local match exists (the
 * controller then proceeds to normal intent classification + model routing).
 */
export function matchLocalFastPath(
  input: string,
  ctx: LocalFastPathContext,
): LocalFastPathResult | null {
  const n = normalizeLocalInput(input);

  // ─── EXIT — bare "exit" / "quit" (slash /exit /quit stay slash commands) ──
  if (n === "exit" || n === "quit") {
    return { kind: "exit", text: "Exiting LiTT." };
  }

  // ─── BRANCH — fresh canonical git read ───────────────────────────────────
  if (BRANCH_PHRASES.includes(n)) {
    const gs = getGitState(ctx.cwd);
    const branch =
      gs.isGitRepo && gs.branch ? gs.branch : "(detached HEAD or not a git repo)";
    return { kind: "branch", text: `Current branch: ${branch}` };
  }

  // ─── PROJECT — canonical detected project name ───────────────────────────
  if (PROJECT_PHRASES.includes(n)) {
    const name = ctx.projectName && ctx.projectName.length > 0
      ? ctx.projectName
      : "(unknown — no project detected)";
    return { kind: "project", text: `Project: ${name}` };
  }

  // ─── GIT CLEAN — fresh canonical git read ────────────────────────────────
  if (GIT_CLEAN_PHRASES.includes(n)) {
    const gs = getGitState(ctx.cwd);
    if (!gs.isGitRepo) {
      return { kind: "git-clean", text: "Not a git repository." };
    }
    if (gs.clean) {
      return { kind: "git-clean", text: "The repo is clean — no changes." };
    }
    return {
      kind: "git-clean",
      text: `The repo is dirty — ${gs.changed} changed, ${gs.untracked} untracked.`,
    };
  }

  // ─── MODE — canonical local session mode ─────────────────────────────────
  if (MODE_PHRASES.includes(n)) {
    const m = ctx.mode;
    const suffix = m === "plan" ? " — read-only, mutations blocked" : " — full execution";
    return { kind: "mode", text: `Mode: ${m.toUpperCase()}${suffix}` };
  }

  return null;
}
