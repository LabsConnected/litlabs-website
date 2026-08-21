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

import { getGitState, readBranchFromGitDir, readHeadStateFromGitDir, type GitHeadState } from "./git-state.js";

export type LocalFastPathKind =
  | "branch"
  | "project"
  | "git-clean"
  | "mode"
  | "compound"
  | "exit";

export interface LocalFastPathContext {
  /** cwd the tools/git use — passed to getGitState for fresh reads. */
  cwd: string;
  /** Package name from package.json (e.g. "@litlabs/litt-cli"). May be a scoped name. */
  projectName?: string;
  /**
   * Canonical repository name — the directory name of the git/project root
   * (e.g. "litt-final-integration"). This is the identity users mean when
   * they ask "what repo is this?" — NOT the package.json name, which can
   * be a scoped monorepo package name like "@litlabs/litt-cli".
   * Derived from basename(projectRoot) in the controller.
   */
  repoName?: string;
  /** Canonical local session mode. */
  mode: "plan" | "act";
  /**
   * Optional callback to sync the cockpit header with the freshly resolved
   * HEAD state. Called for ALL resolved states — branch, detached HEAD,
   * and not-git — so the header can never remain stale after an external
   * branch switch or detached checkout.
   *
   * The SAME resolved state used for the response feeds this callback,
   * ensuring response and header agree during the SAME interaction.
   */
  onHeadResolved?: (state: GitHeadState) => void;
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
  "what is my git state",
  "what is the git state",
  "whats my git state",
  "what is my git status",
  "what is the git status",
  "whats my git status",
  "git status",
  "working tree state",
  "working tree status",
  "are there changes",
];

const MODE_PHRASES = [
  "what mode am i in",
  "am i in plan mode",
  "am i in act mode",
];

/**
 * Trailing policy/instruction text that users append to local queries.
 * These are stripped before matching so the core query can be recognized.
 * Examples: "Read only. Do not modify anything." / "don't change anything"
 */
const TRAILING_POLICY_PATTERNS: RegExp[] = [
  /\bread only\b/i,
  /\bdo not modify( anything)?\b/i,
  /\bdon'?t modify( anything)?\b/i,
  /\bdon'?t change( anything)?\b/i,
  /\bno changes\b/i,
  /\bread-only\b/i,
  /\bjust (tell|show|read)\b/i,
];

/**
 * Return the canonical repository name for display.
 * Prefers `repoName` (directory name of the project root) over
 * `projectName` (package.json name, which may be a scoped monorepo
 * package like "@litlabs/litt-cli"). Falls back to projectName if
 * repoName is not provided, then to "(unknown)".
 */
function getRepoDisplayName(ctx: LocalFastPathContext): string {
  if (ctx.repoName && ctx.repoName.length > 0) return ctx.repoName;
  if (ctx.projectName && ctx.projectName.length > 0) return ctx.projectName;
  return "(unknown — no project detected)";
}

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
 * Strip trailing read-only policy instructions from a query so the core
 * local-state question can be recognized. Returns the cleaned query.
 *
 * SAFETY: Only strips policy text that appears AFTER a sentence boundary
 * (., !, ?) or as a clearly trailing clause at the very end. Never strips
 * policy words that are integral to the question's meaning.
 *
 * Strips:
 *   "what repo am i in? read only."
 *   "what branch am i on? do not modify anything."
 *   "what branch am i on read only"  (trailing, no punctuation)
 *
 * Does NOT strip:
 *   "is this repo read-only?"        (read-only is the question subject)
 *   "why does this file say do not modify?"  (do not modify is quoted content)
 *   "find where 'read only' appears" (read only is a search term)
 *   "what files are marked read-only?" (read-only modifies "files")
 *   "fix the read-only repo configuration." (read-only modifies "repo")
 */
export function stripTrailingPolicy(input: string): string {
  let result = input;

  // ─── Pass 1: Strip after sentence boundaries ────────────────────────
  // If policy text appears after a ?, ., or !, it's clearly a trailing
  // instruction appended to a complete question. Repeat until no more
  // sentence-boundary matches (handles "read only. do not modify anything").
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of TRAILING_POLICY_PATTERNS) {
      const afterBoundary = new RegExp(
        `[?!.]\\s*` + pattern.source + `.*$`,
        "i",
      );
      const match = result.match(afterBoundary);
      if (match && match.index !== undefined) {
        const before = result.slice(0, match.index + 1); // keep the boundary char
        if (before.trim().length > 0) {
          result = before.trim();
          changed = true;
          break; // restart the loop on the shortened string
        }
      }
    }
  }

  // ─── Pass 2: Strip trailing clause without sentence boundary ────────
  // "what branch am i on read only" — no punctuation, but "read only" is
  // clearly a trailing instruction. Only strip if:
  //   a) The text before the policy pattern contains a question word
  //   b) The word immediately before the policy text is NOT a content word
  //      that would make the policy text part of the question
  const CONTENT_WORDS_BEFORE_POLICY = new Set([
    "repo", "repository", "file", "readme", "files", "marked",
    "say", "says", "configuration", "config",
  ]);

  for (const pattern of TRAILING_POLICY_PATTERNS) {
    const trailing = new RegExp(
      `\\s+` + pattern.source + `.*$`,
      "i",
    );
    const match = result.match(trailing);
    if (match && match.index !== undefined) {
      const before = result.slice(0, match.index);
      // Must contain a question word to be a recognizable local query
      if (/\b(what|which|am i|is this|current|tell me)\b/i.test(before)) {
        // Check the word immediately before the policy text
        const wordsBefore = before.trim().split(/\s+/);
        const lastWord = (wordsBefore.pop() ?? "").toLowerCase();
        // Don't strip if the last word is a content word that binds the
        // policy text into the question's meaning
        if (!CONTENT_WORDS_BEFORE_POLICY.has(lastWord)) {
          return before.trim();
        }
      }
    }
  }

  return result;
}

/**
 * Keyword sets for compound local-state detection.
 * These are checked as whole-word matches within the normalized query.
 */
const REPO_KEYWORDS = ["repo", "repository", "project"];
const BRANCH_KEYWORDS = ["branch"];
const MODE_KEYWORDS = ["mode"];
// CLEAN_KEYWORDS are whole-word matches for compound detection.
// Multi-word phrases use a regex check in hasAnyPhrase.
const CLEAN_KEYWORDS = ["clean", "dirty", "changes"];
const CLEAN_PHRASES = ["git state", "git status", "working tree state", "working tree status"];

function hasAnyWord(text: string, words: string[]): boolean {
  return words.some((w) => {
    // Whole-word match using word boundaries
    return new RegExp(`\\b${w}\\b`, "i").test(text);
  });
}

function hasAnyPhrase(text: string, phrases: string[]): boolean {
  return phrases.some((p) => text.includes(p));
}

/**
 * Detect whether a query is a compound local-state question that can be
 * answered deterministically. Returns the set of requested aspects, or
 * null if the query is not a recognizable local-state question.
 *
 * This handles natural compound phrasings like:
 *   "what repo and branch am i currently in"
 *   "what project and branch is this"
 *   "what repo branch and mode am i in"
 *
 * It does NOT handle queries that request actions, file contents, or
 * anything beyond local runtime state — those fall through to READ/MISSION.
 */
function detectCompoundLocalQuery(
  normalized: string,
): { repo: boolean; branch: boolean; mode: boolean; clean: boolean } | null {
  // Must contain at least one local-state keyword to be a compound candidate
  const wantsRepo = hasAnyWord(normalized, REPO_KEYWORDS);
  const wantsBranch = hasAnyWord(normalized, BRANCH_KEYWORDS);
  const wantsMode = hasAnyWord(normalized, MODE_KEYWORDS);
  const wantsClean = hasAnyWord(normalized, CLEAN_KEYWORDS) || hasAnyPhrase(normalized, CLEAN_PHRASES);

  // Need at least 2 aspects for "compound" (single-aspect queries use exact phrases)
  const aspectCount = [wantsRepo, wantsBranch, wantsMode, wantsClean].filter(Boolean).length;
  if (aspectCount < 2) return null;

  // Reject if the query contains MUTATION verbs that suggest a mission
  // intent. Read verbs like "show" and "check" are allowed — "show project
  // and branch" is a read-only compound query, not a mutation.
  const mutationVerbs = /\b(fix|edit|create|delete|run|build|test|deploy|commit|push|install|add|remove|scan|inspect|verify|list|find|search|open|read file|cat|reset|discard|switch|checkout|stash|rebase|merge|pull|fetch|amend|revert)\b/i;
  // Question form includes "what/which/am i/is this/current/tell me" AND
  // "show" — "show project, branch, and working tree status" is a valid
  // read-only compound query.
  const isQuestionForm = /\b(what|which|am i|is this|current|tell me|show)\b/i.test(normalized);

  if (!isQuestionForm) return null;

  // Reject if mutation verbs present (except "tell me" which is question-form)
  if (mutationVerbs.test(normalized) && !/\btell me\b/i.test(normalized)) return null;

  return { repo: wantsRepo, branch: wantsBranch, mode: wantsMode, clean: wantsClean };
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
  // ─── Strip trailing policy text first, then normalize ────────────────
  const stripped = stripTrailingPolicy(input);
  const n = normalizeLocalInput(stripped);

  // ─── EXIT — bare "exit" / "quit" (slash /exit /quit stay slash commands) ──
  if (n === "exit" || n === "quit") {
    return { kind: "exit", text: "Exiting LiTT." };
  }

  // ─── BRANCH — fresh .git/HEAD filesystem read (no subprocess) ──────────
  // Reads .git/HEAD directly — always current, ~1ms vs ~100-200ms for
  // a git subprocess. The structured GitHeadState feeds BOTH the response
  // AND the header via onHeadResolved, so they can never disagree.
  //
  // For detached HEAD, the short SHA is extracted from .git/HEAD without
  // spawning `git rev-parse --short HEAD`. For not-a-repo, the header is
  // updated to reflect that state (not left stale).
  //
  // NEVER falls back to a stale knownBranch — a detached HEAD means
  // there is NO current branch, and showing a stale name would be a lie.
  if (BRANCH_PHRASES.includes(n)) {
    const headState = readHeadStateFromGitDir(ctx.cwd);
    if (headState.kind === "branch") {
      ctx.onHeadResolved?.(headState);
      return { kind: "branch", text: `Current branch: ${headState.branch}` };
    }
    if (headState.kind === "detached") {
      ctx.onHeadResolved?.(headState);
      return { kind: "branch", text: `Current branch: (detached HEAD @ ${headState.commit})` };
    }
    // headState.kind === "not-git" — fall back to getGitState to confirm
    // (could be a subdirectory of a repo that .git/HEAD walk didn't find)
    const gs = getGitState(ctx.cwd);
    if (gs.isGitRepo && gs.branch) {
      ctx.onHeadResolved?.({ kind: "branch", branch: gs.branch });
      return { kind: "branch", text: `Current branch: ${gs.branch}` };
    }
    if (gs.isGitRepo && !gs.branch) {
      ctx.onHeadResolved?.({ kind: "detached", commit: "unknown" });
      return { kind: "branch", text: "Current branch: (detached HEAD)" };
    }
    ctx.onHeadResolved?.({ kind: "not-git" });
    return { kind: "branch", text: "Current branch: (not a git repo)" };
  }

  // ─── PROJECT — canonical repository name (NOT package.json name) ────────
  if (PROJECT_PHRASES.includes(n)) {
    return { kind: "project", text: `Project: ${getRepoDisplayName(ctx)}` };
  }

  // ─── GIT CLEAN — fresh canonical git read (no cached trust) ────────────
  // Dirty state can change from external processes (editor saves, git
  // operations). Cached gitModified/gitUntracked are NOT trustworthy
  // without explicit freshness semantics. Always read fresh.
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

  // ─── COMPOUND — multiple local-state aspects in one query ────────────────
  // Handles: "what repo and branch am i currently in", etc.
  //
  // Freshness model:
  //   - branch ONLY: read from .git/HEAD (filesystem, ~1ms, always current)
  //   - dirty state ONLY: read from getGitState (subprocess, always current)
  //   - branch + dirty state: ONE getGitState call (returns both branch
  //     and dirty state from the same git invocation — no redundant reads)
  //   - project name: from session context (stable, no freshness issue)
  //   - mode: from session context (stable, no freshness issue)
  //
  // When both branch and dirty state are needed, getGitState provides
  // both from one `git branch --show-current` + `git status --porcelain`
  // invocation. The branch-only path stays on the cheap .git/HEAD read
  // so "what branch am i on" never pays the git-status subprocess cost.
  const compound = detectCompoundLocalQuery(n);
  if (compound) {
    const parts: string[] = [];

    if (compound.branch || compound.clean) {
      let branch: string;
      let isRepo: boolean;
      let changed: number;
      let untracked: number;
      let gs: ReturnType<typeof getGitState> | null = null;

      if (compound.clean) {
        // Dirty state needed → one getGitState call provides branch + dirty.
        // This avoids a separate .git/HEAD read when we're already spawning
        // git for status. getGitState's branch is equally fresh.
        gs = getGitState(ctx.cwd);
        isRepo = gs.isGitRepo;
        changed = gs.changed;
        untracked = gs.untracked;
        if (gs.isGitRepo && gs.branch) {
          branch = gs.branch;
          ctx.onHeadResolved?.({ kind: "branch", branch: gs.branch });
        } else if (gs.isGitRepo && !gs.branch) {
          branch = "(detached HEAD)";
          ctx.onHeadResolved?.({ kind: "detached", commit: "unknown" });
        } else {
          branch = "(not a git repo)";
          ctx.onHeadResolved?.({ kind: "not-git" });
        }
      } else {
        // Branch only — use the cheap .git/HEAD filesystem read (~1ms).
        // The structured GitHeadState feeds both response and header.
        const headState = readHeadStateFromGitDir(ctx.cwd);
        if (headState.kind === "branch") {
          branch = headState.branch;
          isRepo = true;
          changed = 0;
          untracked = 0;
          ctx.onHeadResolved?.(headState);
        } else if (headState.kind === "detached") {
          branch = `(detached HEAD @ ${headState.commit})`;
          isRepo = true;
          changed = 0;
          untracked = 0;
          ctx.onHeadResolved?.(headState);
        } else {
          // not-git — fall back to getGitState to confirm
          gs = getGitState(ctx.cwd);
          isRepo = gs.isGitRepo;
          changed = gs.changed;
          untracked = gs.untracked;
          if (gs.isGitRepo && gs.branch) {
            branch = gs.branch;
            ctx.onHeadResolved?.({ kind: "branch", branch: gs.branch });
          } else if (gs.isGitRepo && !gs.branch) {
            branch = "(detached HEAD)";
            ctx.onHeadResolved?.({ kind: "detached", commit: "unknown" });
          } else {
            branch = "(not a git repo)";
            ctx.onHeadResolved?.({ kind: "not-git" });
          }
        }
      }

      if (compound.repo) {
        parts.push(`Project: ${getRepoDisplayName(ctx)}`);
      }

      if (compound.branch) {
        parts.push(`Branch: ${branch}`);
      }

      if (compound.clean) {
        if (!isRepo) {
          parts.push("Git: not a repository");
        } else if (changed === 0 && untracked === 0) {
          parts.push("Git: clean");
        } else {
          parts.push(`Git: dirty (${changed} changed, ${untracked} untracked)`);
        }
      }
    } else if (compound.repo) {
      // Repo without git aspects — no need for getGitState
      parts.push(`Project: ${getRepoDisplayName(ctx)}`);
    }

    if (compound.mode) {
      const m = ctx.mode;
      const suffix = m === "plan" ? " (read-only)" : " (full execution)";
      parts.push(`Mode: ${m.toUpperCase()}${suffix}`);
    }

    if (parts.length > 0) {
      return { kind: "compound", text: parts.join("\n") };
    }
  }

  return null;
}
