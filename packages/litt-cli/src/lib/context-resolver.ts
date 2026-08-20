/**
 * ContextResolver — resolves @mentions into context blocks.
 *
 * The `@` picker inserts tokens like `@controller.ts` or `@git:changes`
 * into the composer. On submit, this module resolves each token to real
 * context text and builds the final prompt:
 *
 *   <file path="src/controller.ts">
 *   ...content...
 *   </file>
 *
 *   TASK: fix the bug
 *
 * Supported tokens:
 *   @<file-path>       — relative or absolute file (content attached)
 *   @git:changes       — porcelain status
 *   @git:branch        — branch + last commit
 *   @terminal:last     — last captured terminal line
 *   @error:last        — last captured error text
 *   @workspace         — the project root path
 *
 * Unknown tokens are left untouched in the prompt (never resolved).
 * Pure + testable — no React, no Ink.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

export type ContextKind = "file" | "git" | "terminal" | "error" | "workspace";

export interface ResolvedContext {
  /** The @mention token as typed (e.g. "@controller.ts"). */
  token: string;
  /** Short human label (e.g. "git changes"). */
  label: string;
  /** Context body attached to the prompt. */
  content: string;
  kind: ContextKind;
}

export interface MentionToken {
  raw: string;
  label: string;
}

/** Extract @mentions from a composer value (also catches emails — the
 *  resolver filters out anything it can't resolve). */
export function extractMentions(input: string): MentionToken[] {
  const tokens: MentionToken[] = [];
  const re = /@([\w./\\:@-]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) {
    tokens.push({ raw: m[0], label: m[1] });
  }
  return tokens;
}

function runGit(args: string[], cwd: string): string | null {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Resolve a single mention label (without the @) to context, or null
 * when it is not a known token (emails, unknown words → untouched).
 */
export function resolveMention(
  label: string,
  cwd: string,
  options?: { terminalLog?: string[]; errorLog?: string[] },
): ResolvedContext | null {
  if (label === "git:changes") {
    const porcelain = runGit(["status", "--porcelain=v1"], cwd);
    return {
      token: "@git:changes",
      label: "git changes",
      kind: "git",
      content: porcelain && porcelain.length > 0 ? porcelain : "Working tree clean.",
    };
  }
  if (label === "git:branch") {
    const branch = runGit(["branch", "--show-current"], cwd) ?? "unknown";
    const last = runGit(["log", "-1", "--format=%h %s"], cwd);
    return {
      token: "@git:branch",
      label: "git branch",
      kind: "git",
      content: `branch: ${branch}${last ? `\nlast commit: ${last}` : ""}`,
    };
  }
  if (label === "terminal:last") {
    const last = options?.terminalLog?.length
      ? options.terminalLog[options.terminalLog.length - 1]
      : null;
    return last
      ? { token: "@terminal:last", label: "terminal · last", kind: "terminal", content: last }
      : null;
  }
  if (label === "error:last") {
    const last = options?.errorLog?.length
      ? options.errorLog[options.errorLog.length - 1]
      : null;
    return last
      ? { token: "@error:last", label: "error · last", kind: "error", content: last }
      : null;
  }
  if (label === "workspace") {
    return { token: "@workspace", label: "workspace", kind: "workspace", content: cwd };
  }

  // File path mention — only resolve when it actually exists.
  if (label.includes(".") || label.includes("/") || label.includes("\\")) {
    const abs = isAbsolute(label) ? label : resolve(cwd, label);
    try {
      if (existsSync(abs) && statSync(abs).isFile()) {
        const content = readFileSync(abs, "utf8");
        return {
          token: `@${label}`,
          label,
          kind: "file",
          content: content.slice(0, 12_000),
        };
      }
    } catch {
      return null;
    }
  }
  return null;
}

export interface ResolvedPrompt {
  /** The final prompt sent to the runtime (context + task). */
  prompt: string;
  /** Context blocks that were attached (for display). */
  resolved: ResolvedContext[];
  /** The original input with resolved mentions stripped. */
  cleaned: string;
}

/**
 * Build the final prompt for a composer value containing @mentions.
 * Returns the original input unchanged when nothing resolves.
 */
export function buildPromptWithContext(
  input: string,
  cwd: string,
  options?: { terminalLog?: string[]; errorLog?: string[] },
): ResolvedPrompt {
  const mentions = extractMentions(input);
  const resolved: ResolvedContext[] = [];
  const blocks: string[] = [];
  let cleaned = input;

  for (const mention of mentions) {
    const ctx = resolveMention(mention.label, cwd, options);
    if (ctx) {
      resolved.push(ctx);
      blocks.push(`<file path="${ctx.label}">\n${ctx.content}\n</file>`);
      // Replace with a space so "explain @a.ts to me" → "explain to me",
      // never "explain  to me" or "explainto me".
      cleaned = cleaned.replace(mention.raw, " ");
    }
  }

  // Collapse whitespace left behind by removed mentions.
  const task = cleaned.replace(/\s{2,}/g, " ").trim();
  if (blocks.length === 0 || !task) {
    return { prompt: input, resolved, cleaned };
  }
  return {
    prompt: `${blocks.join("\n\n")}\n\nTASK: ${task}`,
    resolved,
    cleaned: task,
  };
}
