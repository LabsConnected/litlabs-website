/**
 * Local-Tool Mission — deterministic tool-only missions for signed-out LOCAL.
 *
 * A local-tool mission is a request that can be satisfied entirely with
 * local tool execution + a deterministic evidence-grounded summary, with
 * NO model inference required. This allows signed-out LOCAL users to run
 * compound inspection/verification requests (git status + typecheck +
 * project inspection) without cloud/model access.
 *
 * Detection is deliberately conservative: only prompts that clearly ask
 * for tool execution + reporting (not reasoning/fixing/creating) match.
 * Anything ambiguous falls through to the normal mission path (which the
 * capability gate blocks for signed-out LOCAL).
 *
 * What this module does NOT do:
 *   - no model inference (no planning, no synthesis, no reasoning)
 *   - no remote execution
 *   - no file mutations (read-only commands only)
 *   - no fix/refactor/implement (those need model reasoning)
 *
 * Truthfulness:
 *   - The summary is derived ONLY from actual tool results — never
 *     invented. If typecheck passes, the summary says so. If it fails,
 *     the summary reports the actual errors.
 *   - LOCAL/REMOTE truth is preserved: the mission reports LOCAL locus.
 */

/** A single tool call in a local-tool mission. */
export interface LocalToolCall {
  toolId: string;
  args: Record<string, unknown>;
  label: string;
  /** Mission step title for the observability MissionProgressBlock. */
  stepTitle: string;
}

/** A matched local-tool mission. */
export interface LocalToolMissionMatch {
  calls: LocalToolCall[];
  /** Human-readable summary of what the mission does. */
  summary: string;
  /** The mission goal text (for the canonical mission). */
  goal: string;
}

/**
 * Action verbs that indicate the user wants model REASONING, not just tool
 * execution. If any of these appear, the mission is NOT local-tool-only.
 */
const MODEL_REASONING_VERBS = /\b(fix|implement|refactor|create|write|edit|delete|deploy|ship|optimize|migrate|scaffold|generate|design|architect|plan|debug|repair)\b/i;

/**
 * Detect whether a prompt is a local-tool-only mission — one that can be
 * satisfied with local tool execution + a deterministic summary, with no
 * model inference.
 *
 * Returns a match with tool calls, or null if the prompt needs model
 * reasoning or cannot be deterministically decomposed into local tools.
 */
export function matchLocalToolMission(input: string): LocalToolMissionMatch | null {
  const lower = input.toLowerCase().trim();

  // ─── Guard: model-reasoning verbs disqualify ──────────────────────
  // "fix the typecheck errors" needs model reasoning — NOT local-tool.
  if (MODEL_REASONING_VERBS.test(lower)) return null;

  const calls: LocalToolCall[] = [];

  // ─── Git status / dirty state ─────────────────────────────────────
  const wantsGitStatus = /\b(dirty|clean|git status|what.*changed|what.*change|working tree|changes|uncommitted|untracked)\b/i.test(lower);
  if (wantsGitStatus) {
    calls.push({
      toolId: "project.status",
      args: {},
      label: "Git status",
      stepTitle: "Git status",
    });
  }

  // ─── Project inspection ───────────────────────────────────────────
  const wantsProjectInfo = /\b(project|repo|repository|inspect|package|structure|stack|framework)\b/i.test(lower);
  if (wantsProjectInfo) {
    calls.push({
      toolId: "project.inspect_package",
      args: {},
      label: "Project metadata",
      stepTitle: "Project inspection",
    });
  }

  // ─── Branch ───────────────────────────────────────────────────────
  const wantsBranch = /\bbranch\b/i.test(lower);
  if (wantsBranch) {
    calls.push({
      toolId: "project.branch",
      args: {},
      label: "Current branch",
      stepTitle: "Branch check",
    });
  }

  // ─── Typecheck ────────────────────────────────────────────────────
  const wantsTypecheck = /\b(typecheck|type check|type-check|tsc)\b/i.test(lower);
  if (wantsTypecheck) {
    calls.push({
      toolId: "project.run",
      args: { command: "pnpm", args: ["exec", "tsc", "--noEmit"] },
      label: "Typecheck",
      stepTitle: "Typecheck",
    });
  }

  // ─── Lint ─────────────────────────────────────────────────────────
  const wantsLint = /\b(lint|eslint|linting)\b/i.test(lower);
  if (wantsLint) {
    calls.push({
      toolId: "project.run",
      args: { command: "pnpm", args: ["exec", "eslint", "src", "--ext", ".ts"] },
      label: "Lint",
      stepTitle: "Lint",
    });
  }

  // ─── Build ────────────────────────────────────────────────────────
  const wantsBuild = /\b(build|compile)\b/i.test(lower);
  if (wantsBuild) {
    calls.push({
      toolId: "project.run",
      args: { command: "pnpm", args: ["build"] },
      label: "Build",
      stepTitle: "Build",
    });
  }

  // ─── Tests ────────────────────────────────────────────────────────
  const wantsTests = /\b(test|tests|testing|vitest|jest)\b/i.test(lower);
  if (wantsTests) {
    calls.push({
      toolId: "project.run",
      args: { command: "pnpm", args: ["exec", "vitest", "run", "--reporter=dot"] },
      label: "Tests",
      stepTitle: "Tests",
    });
  }

  // Need at least one tool call to be a local-tool mission.
  if (calls.length === 0) return null;

  // ─── Guard: must not ask for model-only tasks ─────────────────────
  // "explain why the code is broken" needs model reasoning even though
  // it contains "explain". Only allow if the prompt is clearly about
  // tool execution + reporting.
  const hasToolRequest = wantsGitStatus || wantsProjectInfo || wantsBranch
    || wantsTypecheck || wantsLint || wantsBuild || wantsTests;
  if (!hasToolRequest) return null;

  // "explain what you checked" is fine — it's asking for a summary of
  // what was done, not model reasoning. But "explain why..." or
  // "explain how..." needs model reasoning.
  const wantsModelExplanation = /\bexplain\s+(why|how|what is|what are|the reason|the cause)\b/i.test(lower);
  if (wantsModelExplanation) return null;

  const summary = `${calls.length} local tool${calls.length > 1 ? "s" : ""}: ${calls.map((c) => c.label).join(", ")}`;

  return {
    calls,
    summary,
    goal: input,
  };
}

// ─── Filesystem search dispatch ─────────────────────────────────────

/**
 * Deterministic routing for "find/search <name> in <place>" requests.
 *
 * A Windows-local agent that advertises PC tools cannot hand a filename
 * search to a tool-less model — observed live: "nice can you search my
 * c drive" classified CHAT, the model refused with a fabricated
 * "can't access the filesystem" claim. This matcher runs BEFORE the
 * model path and decides one of three honest outcomes:
 *
 *   execute — a real filesystem.search tool call. scope "." (the
 *             project sandbox) or an explicit absolute path the user
 *             typed (naming the path IS the authorization).
 *   clarify — the request is too broad or lacks a target. Returns the
 *             exact question to ask; never silently guesses a scope.
 *   refuse  — a denied location (system/credential dirs). Truthful.
 *
 * It returns null for non-filesystem requests (content/code search
 * stays on the existing mission path).
 */
export type FilesystemSearchMatch =
  | { action: "execute"; call: LocalToolCall }
  | { action: "clarify"; question: string }
  | { action: "refuse"; reason: string };

/** Content-search phrasing belongs to project.search, not the by-name walker. */
const CONTENT_SEARCH_SIGNAL = /\b(?:content|contents|text|string|code|containing|grep|occurrences?|mentions? of)\b/i;

const WORKSPACE_SCOPE_WORDS = /\b(?:this|the|my|current|that)\s+(?:project|repo|repository|workspace|worktree|codebase|directory|folder|dir|cwd)\b/i;

const FILE_SEARCH_VERB = /\b(?:find|search|locate|look\s+for)\b/i;

/** Roots that must never be searched — mirrors the tool's blocklist so the refusal is decided before dispatch. */
const SENSITIVE_SCOPE = /^[a-z]:[/\\](?:windows|program files|programdata|\$recycle\.bin|system volume information|recovery)\b|^[/\\](?:etc|root|proc|sys)\b|(?:\.ssh|\.aws|\.gnupg)\b/i;

function extractSearchName(input: string): string | null {
  // "named X" / "called X" / `for "X"` / `for 'X'`
  const named = input.match(/\b(?:named|called)\s+"?([\w.*~\-]+)"?/i)
    ?? input.match(/\bfor\s+"([^"\n]+)"|\bfor\s+'([^'\n]+)'/i);
  if (named) return (named[1] ?? named[2]) ?? null;
  // Filename token with extension or glob — package.json, AGENTS.md, *.ts, README.*
  const fileTok = input.match(/\b([\w~.-]*\*[\w.?*-]*|[\w~-]+\.[\w]{1,10})\b/);
  if (fileTok) return fileTok[1];
  // "find <word>" as a last resort — "find package.json", "find my keys.txt"
  const findVerb = input.match(/\b(?:find|locate|search\s+for|look\s+for)\s+(?:a\s+|an\s+|the\s+|any\s+|all\s+)*(?:files?|folders?|directories|directory|file|folder)\s*(?:named|called)?\s*"?([\w.*~\-]+)"?/i)
    ?? input.match(/\b(?:find|locate|search\s+for|look\s+for)\s+(?:a\s+|an\s+|the\s+|any\s+|all\s+)"?([\w.*~\-]+)"?/i);
  if (findVerb) return findVerb[1];
  return null;
}

interface ExtractedScope {
  /** "workspace" | "explicit" | "broad" | null (no location named) */
  kind: "workspace" | "explicit" | "broad" | "sensitive" | null;
  /** Normalized root for explicit scopes; "." for workspace. */
  root?: string;
  /** The user's own phrasing, for messages. */
  label?: string;
}

/** Words that end a path capture — "for X", "named X", next clause. */
const PATH_BOUNDARY = /^(?:for|named|called|in|inside|on|under|within|with|and|to|from|of|through|where|all|the|a|an)$/i;

/** Extract a Windows/Unix absolute path starting at `startIndex`, extending
 * across spaces ("C:\Program Files") until a sentence boundary word. */
function extractPathAt(input: string, startIndex: number): string {
  const tail = input.slice(startIndex);
  const tokens = tail.split(/\s+/);
  const parts: string[] = [];
  for (const tok of tokens) {
    if (parts.length > 0 && PATH_BOUNDARY.test(tok)) break;
    if (parts.length > 0 && /^[a-z]:[\\/]/i.test(tok)) break;
    parts.push(tok.replace(/[,.?!]+$/, ""));
    if (/["']/.test(parts[parts.length - 1])) break;
  }
  return parts.join(" ").replace(/^["']|["']$/g, "");
}

function extractSearchScope(input: string): ExtractedScope {
  // Quoted absolute location: "in 'C:\LiTT'", 'under "/home/x"'
  const quoted = input.match(/\b(?:in|inside|under|within|on|from|of|through)\s+"([^"\n]+)"|\b(?:in|inside|under|within|on|from|of|through)\s+'([^'\n]+)'/i);
  const abs = quoted?.[1] ?? quoted?.[2];
  if (abs) {
    const normalized = abs.replace(/\//g, "\\");
    if (SENSITIVE_SCOPE.test(normalized)) return { kind: "sensitive", root: normalized, label: abs };
    return { kind: "explicit", root: abs, label: abs };
  }
  // A drive-letter or root-slash token anywhere — extend across spaces so
  // "C:\Program Files" is captured whole (previously truncated at the
  // first space, which let a denied root slip through as "C:\Program").
  const pathTok = input.match(/[a-z]:[\\/]|(?<!\w)\//i);
  if (pathTok && pathTok.index !== undefined) {
    const full = extractPathAt(input, pathTok.index);
    const normalized = full.replace(/\//g, "\\");
    if (SENSITIVE_SCOPE.test(normalized)) return { kind: "sensitive", root: full, label: full };
    return { kind: "explicit", root: full, label: full };
  }
  // Whole-drive / broad phrasing — "my c drive", "the c drive", "c:\", "the whole drive", "my computer"
  if (/\b(?:my|the|your|whole|entire|full)\s+(?:[a-z]\s*[- ]?drive|drive|disk|computer|pc|machine|filesystem|file system)\b/i.test(input)
    || /\b[a-z]\s*[- ]?drive\b/i.test(input)
    || /\bmy\s+computer\b/i.test(input)) {
    const driveLetter = input.match(/\b([a-z])\s*[- ]?drive\b/i)?.[1];
    return { kind: "broad", root: driveLetter ? `${driveLetter.toUpperCase()}:\\` : undefined, label: driveLetter ? `${driveLetter.toUpperCase()} drive` : "the filesystem" };
  }
  if (WORKSPACE_SCOPE_WORDS.test(input)) return { kind: "workspace", root: ".", label: "the project" };
  return { kind: null };
}

export function matchFilesystemSearch(input: string): FilesystemSearchMatch | null {
  const lower = input.toLowerCase().trim();
  if (!FILE_SEARCH_VERB.test(lower)) return null;
  // "search my code for TODO" is a content search — mission lane owns it.
  if (CONTENT_SEARCH_SIGNAL.test(lower) && !/\b(?:files?|folders?|named)\b/i.test(lower)) return null;
  // "find out why" / "find the bug" are not filename searches — require a
  // filesystem noun or an explicit location to engage.
  if (!/\b(?:files?|folders?|directories|directory|drive|disk|named|called)\b/i.test(lower)
      && !/[a-z]:[\\/]/i.test(lower)
      && !/\bin\s+(?:my\s+|the\s+|this\s+)?(?:project|repo|workspace|worktree|directory|folder|c\b|[a-z]:)\b/i.test(lower)) {
    return null;
  }

  const scope = extractSearchScope(input);
  if (scope.kind === "sensitive") {
    return {
      action: "refuse",
      reason: `I can't search ${scope.label ?? "that location"} — it's a system or sensitive directory and needs separate authorization. Name a different folder and I'll search it.`,
    };
  }

  const name = extractSearchName(input);

  // Broad scope or missing target — clarify before executing anything.
  if (scope.kind === "broad") {
    const where = scope.root ?? "the filesystem";
    return {
      action: "clarify",
      question: name
        ? `I can search for "${name}". ${scope.label ? `I can't run an unrestricted scan of ${scope.label}, but ` : ""}name a folder to authorize it — for example "search C:\\LiTT for ${name}".`
        : `I can search ${where} for a file or folder — what am I looking for? I can start within C:\\LiTT, or you can name a narrower location to authorize it.`,
    };
  }
  if (!name) {
    return {
      action: "clarify",
      question: `I can search ${scope.kind === "explicit" ? scope.label : "the filesystem"} for a file or folder — what filename, folder name, or pattern should I look for?`,
    };
  }

  const root = scope.kind === "explicit" ? scope.root! : ".";
  const scopeLabel = root === "." ? "the current project" : root;
  return {
    action: "execute",
    call: {
      toolId: "filesystem.search",
      args: { path: root, name },
      label: `Search ${scopeLabel} for ${name}`,
      stepTitle: "Filesystem search",
    },
  };
}

// ─── Deterministic summary ──────────────────────────────────────────

/** A tool result from the gateway. */
export interface LocalToolResult {
  toolId: string;
  label: string;
  stepTitle: string;
  success: boolean;
  message: string;
  data?: Record<string, unknown> | unknown;
  durationMs?: number;
}

/**
 * Parse git porcelain lines into categorized counts.
 *
 * Porcelain v1 format: each line starts with a 2-char status code:
 *   XY filename
 * X = staged status, Y = unstaged status.
 *   " " = unmodified
 *   M  = modified
 *   A  = added
 *   D  = deleted
 *   R  = renamed
 *   C  = copied
 *   U  = unmerged (conflict)
 *   ?  = untracked (only in Y, X is " ")
 *   !  = ignored (only in Y, X is " ")
 *
 * We categorize into: modified, added, deleted, renamed, untracked, unmerged.
 * "modified" includes copied (rare) to keep the summary concise.
 */
export function parseGitPorcelain(
  porcelain: string,
): {
  total: number;
  modified: number;
  added: number;
  deleted: number;
  renamed: number;
  untracked: number;
  unmerged: number;
} {
  const lines = porcelain.trim().split("\n").filter((l) => l.trim());
  const counts = { total: 0, modified: 0, added: 0, deleted: 0, renamed: 0, untracked: 0, unmerged: 0 };

  for (const line of lines) {
    if (line.length < 2) continue;
    counts.total++;
    const x = line[0];
    const y = line[1];

    if (x === "?" || y === "?") {
      counts.untracked++;
      continue;
    }
    if (x === "U" || y === "U" || (x === "D" && y === "D") || (x === "A" && y === "A")) {
      counts.unmerged++;
      continue;
    }
    // Check both staged (X) and unstaged (Y) status
    const codes = x + y;
    if (codes.includes("R") || codes.includes("C")) {
      counts.renamed++;
    } else if (codes.includes("A")) {
      counts.added++;
    } else if (codes.includes("D")) {
      counts.deleted++;
    } else if (codes.includes("M")) {
      counts.modified++;
    }
  }

  return counts;
}

/**
 * Format git status into the canonical summary string.
 *
 *   clean repo → "Git: clean"
 *   dirty repo → "Git: N changes — X modified, Y untracked, ..."
 *
 * Only non-zero categories are listed. Categories are ordered:
 * modified, added, deleted, renamed, unmerged, untracked.
 */
export function formatGitSummary(
  porcelain: string,
  changeCount: number,
): string {
  if (changeCount === 0) return "Git: clean";

  const c = parseGitPorcelain(porcelain);
  const parts: string[] = [];
  if (c.modified > 0) parts.push(`${c.modified} modified`);
  if (c.added > 0) parts.push(`${c.added} added`);
  if (c.deleted > 0) parts.push(`${c.deleted} deleted`);
  if (c.renamed > 0) parts.push(`${c.renamed} renamed`);
  if (c.unmerged > 0) parts.push(`${c.unmerged} unmerged`);
  if (c.untracked > 0) parts.push(`${c.untracked} untracked`);

  if (parts.length === 0) {
    // Fallback: changeCount > 0 but no categories matched — use the raw count.
    return `Git: ${changeCount} change(s)`;
  }

  return `Git: ${c.total} change${c.total > 1 ? "s" : ""} — ${parts.join(", ")}`;
}

/**
 * Format a deterministic, evidence-grounded summary from actual tool
 * results. NEVER invents status — every line derives from a real tool
 * result.
 *
 * This is the "plain-English conclusion" that the SummaryBlock renders.
 * It reports what was checked and what passed/failed, with no model
 * inference.
 */
export function formatLocalToolSummary(
  input: string,
  results: LocalToolResult[],
): string {
  const lines: string[] = [];

  // Header: what was inspected
  lines.push("Inspection complete.");

  // Per-tool evidence
  for (const r of results) {
    if (r.toolId === "project.status") {
      const data = r.data as { porcelain?: string; changeCount?: number; files?: string[] } | undefined;
      if (data?.porcelain !== undefined && data?.changeCount !== undefined) {
        lines.push(formatGitSummary(data.porcelain, data.changeCount));
      } else if (data?.changeCount === 0 || r.message === "Working tree clean") {
        lines.push("Git: clean");
      } else {
        lines.push(`Git: ${r.message}`);
      }
    } else if (r.toolId === "project.branch") {
      const data = r.data as { branch?: string } | undefined;
      lines.push(`Branch: ${data?.branch ?? r.message}`);
    } else if (r.toolId === "project.inspect_package") {
      const data = r.data as { name?: string; version?: string } | undefined;
      if (data?.name) {
        lines.push(`Project: ${data.name}${data.version ? `@${data.version}` : ""}`);
      } else {
        lines.push(`Project: ${r.message}`);
      }
    } else if (r.toolId === "filesystem.search") {
      if (!r.success) {
        // Denied scope / missing directory — surface the real reason.
        lines.push(`Search: ${r.message}`);
      } else {
        const data = r.data as
          { root?: string; query?: string; matches?: string[]; count?: number; truncated?: boolean }
          | undefined;
        const matches = Array.isArray(data?.matches) ? data!.matches : [];
        if (matches.length === 0) {
          lines.push(`Search: ${r.message}`);
        } else {
          const shown = matches.slice(0, 10);
          const remaining = matches.length - shown.length;
          lines.push(`Search: ${matches.length} match${matches.length === 1 ? "" : "es"} for "${data?.query ?? ""}"`);
          for (const m of shown) lines.push(`  ${m}`);
          if (remaining > 0) lines.push(`  … +${remaining} more`);
          if (data?.truncated) lines.push("  (search truncated — narrow the path or pattern for full coverage)");
        }
      }
    } else if (r.toolId === "project.list_files") {
      if (!r.success) {
        // Sandbox block / missing directory — surface the real reason.
        lines.push(`Files: ${r.message}`);
      } else {
        const data = r.data as { files?: Array<{ name?: string; type?: string }> } | undefined;
        const files = Array.isArray(data?.files)
          ? data!.files.filter((f): f is { name: string; type: string } => typeof f?.name === "string")
          : [];
        const limitMatch = input.match(/\b(\d+)\s*files?\b/i);
        const limit = limitMatch ? Math.max(1, Number(limitMatch[1])) : 10;
        const names = files.slice(0, limit).map((f) => (f.type === "dir" ? `${f.name}/` : f.name));
        const remaining = files.length - names.length;
        lines.push(
          files.length === 0
            ? "Files: workspace root is empty."
            : `Files: ${names.join(", ")}${remaining > 0 ? ` +${remaining} more` : ""}`,
        );
      }
    } else if (r.toolId === "project.run") {
      const label = r.label;
      if (r.success) {
        lines.push(`${label}: passed.`);
      } else {
        // Include a truncated portion of the actual error output
        const errMsg = r.message.slice(0, 200);
        lines.push(`${label}: failed — ${errMsg}`);
      }
    }
  }

  // Footer: what was checked (derived from the actual tool set)
  const checked = results.map((r) => r.stepTitle.toLowerCase());
  if (checked.length > 0) {
    lines.push(`Checked: ${checked.join(", ")}.`);
  }

  // Read-only note if the prompt mentioned "without changing"
  if (/\b(without changing|don.t change|read.only|no changes)\b/i.test(input)) {
    lines.push("No files were changed.");
  }

  return lines.join("\n");
}
