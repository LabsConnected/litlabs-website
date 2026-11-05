/**
 * Deterministic Codegen Lane — reliable file production for lightweight
 * local models that cannot drive native tool calling (litt-coder:8k).
 *
 * Phase 2 of the lightweight coding lane (tasks/litt-coder-lane). The 1.5B
 * coder does not populate `tool_calls`; its usable output is text-format
 * JSON in `content`. Instead of depending on the tool channel, this lane:
 *
 *   1. Requests the whole site as ONE strict-JSON payload
 *      ({ "files": [{ "path", "content" }] }) via Ollama's `format`
 *      structured-output parameter.
 *   2. Parses deterministically — accepts the canonical files shape and the
 *      model's natural `write_file` text-call shape; REJECTS malformed JSON,
 *      parameter-schema echoes, phantom (non-file) tool calls, and
 *      escaped-newline corruption. Nothing is silently repaired: the only
 *      salvage paths are deterministic, flagged, and non-destructive.
 *   3. Validates every file (path safety, extension allowlist, size caps,
 *      then HTML5 / CSS / JS / JSON syntax per type).
 *   4. Writes through the verified WorkspaceTransport — the same
 *      authenticated, workspace-isolated file path the agent loop uses —
 *      then reads each file back and byte-compares before reporting success.
 *
 * The lane never executes generated commands: no command channel exists in
 * the schema, and file content is validated before it ever touches disk.
 * Success is claimed only after validation AND verified persistence.
 */

import "server-only";

import vm from "node:vm";
import { ensureOllamaModelResident, resolveOllamaEndpoint } from "@litt/models";
import { findModelRecord } from "./model-registry";
import { ollamaKeepAliveSetting, ollamaOutputTokenBudget, ollamaContextTokens } from "./ollama-shared";
import { ProgressEmitter } from "./progress-events";
import { emitUsageEvent, getMeteringContext } from "@/lib/metering";
import { calculateLlmCost } from "@/lib/llm-cost-engine";
import type { WorkspaceTransport, CheckpointInfo } from "./workspace-transport";
import { destructiveContentLoss } from "./patch-validation";
import { computeWorkspaceChange } from "./workspace-change-producer";
import type { WorkspaceChangeEvidence } from "@/lib/studio/completion-evidence";
import { ensureProjectPreviewReady, type LaunchFlowResult } from "./launch-flow";
import { buildPreviewProxyUrl } from "@/lib/terminal-internal-client";
import type { AgentLoopResult } from "./agent-loop-v2";

// ─── Lane eligibility ─────────────────────────────────────────────

/**
 * A model participates in the deterministic codegen lane only when its
 * registry record explicitly advertises the capability. Detection is
 * registry-driven (never a string allowlist): the pin "ollama/<tag>",
 * a bare tag, or a canonicalId all resolve through findModelRecord.
 */
export function isDeterministicCodegenModel(model: string | null | undefined): boolean {
  const raw = (model ?? "").trim();
  if (!raw) return false;
  const tag = raw.replace(/^ollama\//i, "");
  const rec =
    findModelRecord("ollama", raw) ??
    findModelRecord("ollama", tag) ??
    // Bare canonicalId form ("ollama-litt-coder-8k").
    findModelRecord("ollama", raw.replace(/^ollama-/, "litt-"));
  return rec?.capabilities.deterministicCodegen === true;
}

// ─── Output contract ──────────────────────────────────────────────

/**
 * The strict JSON schema requested from the model (Ollama `format`) AND
 * enforced again by the deterministic parser. Ollama constrains toward the
 * schema; the parser remains authoritative — a model that ignores the
 * schema is rejected, never coerced.
 */
export const CODEGEN_FILES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["files"],
  properties: {
    files: {
      type: "array",
      minItems: 1,
      maxItems: 12,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["path", "content"],
        properties: {
          path: { type: "string", description: "Relative workspace path, e.g. index.html" },
          content: { type: "string", description: "Complete file contents" },
        },
      },
    },
  },
} as const;

/** Extensions the lane will ever write. Everything else is rejected. */
export const ALLOWED_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".html", ".css", ".js", ".mjs", ".json", ".md", ".txt", ".svg",
]);

/** Per-file and per-build payload caps — the 8K lane cannot emit more anyway. */
export const MAX_FILE_BYTES = 128 * 1024;
export const MAX_TOTAL_BYTES = 384 * 1024;
const MAX_PATH_CHARS = 200;
const MAX_FILES = 12;

// ─── Prompt construction ──────────────────────────────────────────

export function buildCodegenSystemPrompt(): string {
  return [
    "You generate a complete small website as ONE JSON object — nothing else.",
    "Output ONLY this exact shape, no markdown, no prose, no code fences:",
    '{"files":[{"path":"index.html","content":"..."},{"path":"style.css","content":"..."},{"path":"app.js","content":"..."}]}',
    "Rules:",
    "- index.html MUST be a valid HTML5 document: <!doctype html>, <html>, <head>, <body>, </html>.",
    "- Link every generated .css file with <link rel=\"stylesheet\"> and every .js file with <script src=\"...\" defer></script>.",
    "- File content must contain REAL newlines, never literal \\n sequences.",
    "- No external URLs, no remote images, no frameworks — self-contained files only.",
    "- Do not output tool calls, schemas, or explanations. Only the JSON object.",
  ].join("\n");
}

export function buildCodegenUserPrompt(userRequest: string, projectName?: string): string {
  return [
    `Build this website now: ${userRequest.trim()}`,
    projectName ? `Project name: ${projectName}` : "",
    "Produce index.html, style.css, and app.js. Output the JSON files object only.",
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Edit mode (Phase 3) ──────────────────────────────────────────

/**
 * The blank-project starter ships an index.html carrying this marker —
 * same constant the launch flow uses (terminal-server welcome-screen.ts).
 * A workspace whose index.html still carries it has no real project yet,
 * so the next build runs in build mode, not edit mode.
 */
export const WELCOME_SCREEN_MARKER = "LITT-WELCOME-SCREEN";

/**
 * Existing files fed to the model in edit mode must fit the 8K context
 * together with the system prompt and the reserved completion budget.
 * Exceeding this fails honestly — never truncate a file the model must
 * preserve verbatim.
 */
export const MAX_EDIT_CONTEXT_BYTES = 10 * 1024;

export function buildEditSystemPrompt(): string {
  return [
    "You are EDITING an existing website. Output ONE JSON object — nothing else.",
    "Output ONLY this exact shape, no markdown, no prose, no code fences:",
    '{"files":[{"path":"index.html","content":"..."}]}',
    "Rules:",
    "- Output ONLY the files that must be ADDED or CHANGED to satisfy the request.",
    "- Emit the SMALLEST file set that satisfies the request — never restyle, reformat, or rewrite files the request does not affect.",
    "- Do NOT output files that stay the same — they are already on disk.",
    "- Each file's content must be the COMPLETE new file, not a diff or patch.",
    "- A CHANGED file keeps ALL of its existing content: every section, nav, image, and style rule already on disk stays unless the request names it for removal — apply the change ON TOP of the file shown, never regenerate the file from scratch.",
    "- APPLY THE REQUEST EXACTLY: every string, value, selector, or behavior the user names must appear verbatim in the emitted file. An emitted file that does not contain the requested change is a failure.",
    "- Change the RIGHT file: visual/style changes go in the .css file (add or edit the CSS rule itself — never invent a class without defining it), text/markup changes go in the .html file, behavior/logic changes go in the .js file.",
    "- Every .html file must be a full valid HTML5 document.",
    "- You may reference existing files (styles, scripts, other pages) — they remain on disk.",
    "- File content must contain REAL newlines, never literal \\n sequences.",
    "- No external URLs, no remote images — self-contained files only.",
  ].join("\n");
}

export function buildEditUserPrompt(userRequest: string, existingFiles: Map<string, string>): string {
  const blocks = [...existingFiles.entries()].map(
    ([path, content]) => `--- FILE: ${path} ---\n${content}\n--- END ${path} ---`,
  );
  return [
    "CURRENT FILES ON DISK:",
    ...blocks,
    "",
    `REQUESTED CHANGE: ${userRequest.trim()}`,
    "Output the {\"files\":[...]} JSON object with ONLY the files to add or change.",
  ].join("\n");
}

/**
 * Snapshot the existing website files for edit context. Shallow-walks the
 * workspace root and one level of directories; reads only generated-site
 * extensions; caps total bytes — oversized workspaces fail honestly.
 * Returns null when the workspace does not hold a real site (welcome
 * screen or missing index.html) → caller uses build mode.
 */
export interface WebsiteSnapshot {
  files: Map<string, string>;
  totalBytes: number;
}

export interface SnapshotResult {
  kind: "edit" | "build" | "too-large";
  snapshot?: WebsiteSnapshot;
  totalBytes?: number;
}

export async function snapshotWebsiteFiles(
  transport: WorkspaceTransport,
): Promise<SnapshotResult> {
  // Mode decision first: no real index.html → build mode regardless of
  // what else the scaffold holds (the welcome screen itself can exceed
  // the edit byte budget and must not block a first build).
  let index: string | undefined;
  try {
    index = (await transport.readFile("index.html")).content;
  } catch {
    index = undefined;
  }
  if (index === undefined || index.includes(WELCOME_SCREEN_MARKER)) {
    return { kind: "build" };
  }

  const files = new Map<string, string>([["index.html", index]]);
  const dirs: string[] = [""];
  const seen = new Set<string>(["index.html"]);
  let totalBytes = Buffer.byteLength(index, "utf8");
  if (totalBytes > MAX_EDIT_CONTEXT_BYTES) {
    return { kind: "too-large", totalBytes };
  }
  let walked = 0;

  while (dirs.length > 0 && walked < 8) {
    const dir = dirs.shift()!;
    walked++;
    let entries: Array<{ name: string; type: string }>;
    try {
      const res = await transport.listFiles(dir);
      entries = res.entries;
    } catch {
      continue;
    }
    for (const e of entries) {
      const rel = dir ? `${dir}/${e.name}` : e.name;
      if (seen.has(rel.toLowerCase())) continue;
      seen.add(rel.toLowerCase());
      if (e.type === "directory") {
        // One level deep — generated sites are flat or shallow.
        if (dir === "" && !e.name.startsWith(".") && e.name !== "node_modules") dirs.push(rel);
        continue;
      }
      const ext = fileExtensionOf(rel);
      if (!ALLOWED_FILE_EXTENSIONS.has(ext)) continue;
      if (!isSafeGeneratedPath(rel)) continue;
      try {
        const { content, size } = await transport.readFile(rel);
        totalBytes += size;
        if (totalBytes > MAX_EDIT_CONTEXT_BYTES) {
          return { kind: "too-large", totalBytes };
        }
        files.set(rel, content);
      } catch {
        // Unreadable file — skip; edits don't depend on it.
      }
    }
  }

  return { kind: "edit", snapshot: { files, totalBytes }, totalBytes };
}

function buildRepairFeedback(rejections: ParseRejection[], fileErrors: string[]): string {
  const lines = [
    "Your previous output was invalid and was NOT written to disk.",
    "Problems to fix:",
    ...rejections.slice(0, 8).map((r) => `- ${r.path ? `${r.path}: ` : ""}${r.detail}`),
    ...fileErrors.slice(0, 8).map((e) => `- ${e}`),
    "",
    "Try again: output ONLY the {\"files\":[...]} JSON object with valid file contents.",
  ];
  return lines.join("\n");
}

// ─── Deterministic parsing ────────────────────────────────────────

export type ParseRejectReason =
  | "malformed-json"
  | "shape-mismatch"
  | "schema-echo"
  | "phantom-tool-call"
  | "bad-path"
  | "bad-extension"
  | "duplicate-path"
  | "empty-content"
  | "oversize"
  | "escaped-corruption";

export interface ParseRejection {
  reason: ParseRejectReason;
  detail: string;
  path?: string;
}

export interface ParsedFileEntry {
  path: string;
  content: string;
  /** How this entry arrived — canonical files[] or a normalized text tool call. */
  via: "files-json" | "tool-call-text";
}

export interface DeterministicParseResult {
  ok: boolean;
  files: ParsedFileEntry[];
  rejected: ParseRejection[];
  /** Deterministic, flagged, non-destructive repairs applied while parsing. */
  repairs: string[];
}

const FILE_WRITE_CALL_NAMES = new Set(["write_file", "files.write", "files_write", "writeFile"]);

function stripCodeFences(raw: string): string {
  let t = raw.trim();
  // Remove a single leading fence (```json / ``` ) and trailing fence.
  t = t.replace(/^```[a-zA-Z0-9]*\s*\n?/, "").replace(/\n?```\s*$/, "");
  return t.trim();
}

/** Extract every top-level balanced {...} or [...] span from text. */
function extractJsonSpans(text: string): string[] {
  const spans: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{" || ch === "[") {
      if (depth === 0) start = i;
      depth++;
      continue;
    }
    if (ch === "}" || ch === "]") {
      if (depth > 0) depth--;
      if (depth === 0 && start >= 0) {
        spans.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return spans;
}

/** True when an object looks like a JSON-schema echo rather than file output. */
function isSchemaEcho(obj: unknown): boolean {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return false;
  const o = obj as Record<string, unknown>;
  const schemaKeys = ["properties", "required", "parameters", "additionalProperties", "$schema", "minItems", "maxItems"];
  const hits = schemaKeys.filter((k) => k in o);
  return hits.length >= 2 || ("type" in o && hits.length >= 1);
}

function looksLikeJsonSchemaString(s: string): boolean {
  const t = s.trim();
  if (!t.startsWith("{") || !t.endsWith("}")) return false;
  try {
    return isSchemaEcho(JSON.parse(t));
  } catch {
    return false;
  }
}

function normalizePath(raw: string): string {
  return raw.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}

/** Same safety contract as the files route: relative, in-workspace, no traversal. */
export function isSafeGeneratedPath(path: string): boolean {
  const p = normalizePath(path);
  if (!p || p === "." || p.length > MAX_PATH_CHARS) return false;
  if (p.startsWith("/") || /^[a-zA-Z]:/.test(p)) return false;
  if (p.split("/").some((seg) => seg === ".." || seg.includes(" "))) return false;
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(p)) return false;
  return true;
}

export function fileExtensionOf(path: string): string {
  const base = normalizePath(path).split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot).toLowerCase();
}

/** Count literal \n /\t escape sequences (two chars) vs real whitespace. */
function escapedSequenceCount(content: string): number {
  const matches = content.match(/\\n|\\t|\\r/g);
  return matches?.length ?? 0;
}

/**
 * Repair literal-escape corruption: the model emitted `\n`/`\"` as
 * characters inside the file body. Only attempted when the file contains
 * ZERO real newlines but several escape sequences — an unambiguous
 * corruption shape, decoded once and re-validated by the caller.
 */
function tryUnescapeCorruption(content: string): string | null {
  if (content.includes("\n") || escapedSequenceCount(content) < 3) return null;
  const repaired = content
    .replace(/\\r/g, "\r")
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
  return repaired.includes("\n") ? repaired : null;
}

interface RawEntry {
  path?: unknown;
  content?: unknown;
  via: ParsedFileEntry["via"];
}

function collectRawEntries(
  value: unknown,
  rejected: ParseRejection[],
  out: RawEntry[],
): void {
  if (value === null || value === undefined) return;
  if (Array.isArray(value)) {
    for (const item of value) collectRawEntries(item, rejected, out);
    return;
  }
  if (typeof value !== "object") return;
  const obj = value as Record<string, unknown>;

  // Canonical shape: { files: [...] }
  if (Array.isArray(obj.files)) {
    for (const f of obj.files) {
      if (f && typeof f === "object" && !Array.isArray(f)) {
        const fe = f as Record<string, unknown>;
        out.push({ path: fe.path, content: fe.content, via: "files-json" });
      } else {
        rejected.push({ reason: "shape-mismatch", detail: "files[] entry is not an object" });
      }
    }
    return;
  }

  // Text-format tool call: {name|function: "...", arguments: {...}|"json"}
  const callName = typeof obj.name === "string" ? obj.name : typeof obj.function === "string" ? obj.function : null;
  if (callName !== null && "arguments" in obj) {
    if (!FILE_WRITE_CALL_NAMES.has(callName)) {
      rejected.push({
        reason: "phantom-tool-call",
        detail: `Model emitted a tool call for "${callName}" — this lane writes files, it never executes tool calls`,
      });
      return;
    }
    let args = obj.arguments;
    if (typeof args === "string") {
      try {
        args = JSON.parse(args);
      } catch {
        rejected.push({ reason: "malformed-json", detail: "write_file arguments are not parseable JSON" });
        return;
      }
    }
    if (args && typeof args === "object" && !Array.isArray(args)) {
      const a = args as Record<string, unknown>;
      out.push({ path: a.path, content: a.content, via: "tool-call-text" });
      return;
    }
    rejected.push({ reason: "shape-mismatch", detail: "write_file arguments are not an object" });
    return;
  }

  // Bare {path, content} entry (models sometimes drop the wrapper).
  if (typeof obj.path === "string" && ("content" in obj || "contents" in obj)) {
    out.push({ path: obj.path, content: obj.content ?? obj.contents, via: "files-json" });
    return;
  }

  if (isSchemaEcho(obj)) {
    rejected.push({ reason: "schema-echo", detail: "Output echoes the parameter schema instead of file contents" });
    return;
  }

  rejected.push({ reason: "shape-mismatch", detail: "JSON object is neither a files[] payload nor a write_file call" });
}

/**
 * Parse model output into candidate file entries. Pure and deterministic:
 * every acceptance shape is explicit, every rejection is classified, and
 * the only repair path (literal-escape decode) is flagged in `repairs`.
 */
export function parseDeterministicFilesOutput(raw: string): DeterministicParseResult {
  const rejected: ParseRejection[] = [];
  const repairs: string[] = [];
  const rawEntries: RawEntry[] = [];

  const text = stripCodeFences(raw);
  let parsed = false;

  // Fast path: the whole payload is one JSON value.
  try {
    collectRawEntries(JSON.parse(text), rejected, rawEntries);
    parsed = true;
  } catch {
    // fall through to span extraction
  }

  if (!parsed) {
    // Slow path: pull balanced JSON spans out of surrounding prose, then
    // JSONL lines — the model sometimes emits several objects in sequence.
    const spans = extractJsonSpans(text);
    const candidates: string[] = [...spans];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
        candidates.push(t);
      }
    }
    let any = false;
    for (const c of candidates) {
      try {
        collectRawEntries(JSON.parse(c), rejected, rawEntries);
        any = true;
      } catch {
        // not parseable — keep scanning
      }
    }
    parsed = any;
    if (!any) {
      rejected.push({ reason: "malformed-json", detail: "Output is not parseable JSON" });
    }
  }

  // Normalize + validate each raw entry.
  const files: ParsedFileEntry[] = [];
  const seen = new Set<string>();
  let totalBytes = 0;
  for (const e of rawEntries) {
    const path = typeof e.path === "string" ? normalizePath(e.path) : "";
    if (!isSafeGeneratedPath(path)) {
      rejected.push({
        reason: "bad-path",
        path: typeof e.path === "string" ? e.path.slice(0, 120) : undefined,
        detail: `Unsafe or missing file path: ${typeof e.path === "string" ? e.path.slice(0, 80) : "(missing)"}`,
      });
      continue;
    }
    const ext = fileExtensionOf(path);
    if (!ALLOWED_FILE_EXTENSIONS.has(ext)) {
      rejected.push({ reason: "bad-extension", path, detail: `Extension "${ext || "(none)"}" is not in the generated-file allowlist` });
      continue;
    }
    if (seen.has(path.toLowerCase())) {
      rejected.push({ reason: "duplicate-path", path, detail: "Duplicate file path — keeping the first occurrence" });
      continue;
    }
    let content: string;
    if (typeof e.content === "string") {
      content = e.content;
    } else if (e.content && typeof e.content === "object") {
      rejected.push({ reason: "schema-echo", path, detail: "File content is a JSON object (schema echo), not source text" });
      continue;
    } else {
      rejected.push({ reason: "empty-content", path, detail: "File content is missing or not a string" });
      continue;
    }
    if (!content.trim()) {
      rejected.push({ reason: "empty-content", path, detail: "File content is empty" });
      continue;
    }
    if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
      rejected.push({ reason: "oversize", path, detail: `File exceeds ${MAX_FILE_BYTES} bytes` });
      continue;
    }
    if (totalBytes + Buffer.byteLength(content, "utf8") > MAX_TOTAL_BYTES) {
      rejected.push({ reason: "oversize", path, detail: `Build exceeds ${MAX_TOTAL_BYTES} total bytes` });
      continue;
    }

    // Schema echo emitted AS the file body (e.g. ```json {"type":"object",...}).
    if (ext !== ".json" && looksLikeJsonSchemaString(content)) {
      rejected.push({ reason: "schema-echo", path, detail: "File content is a JSON schema echo, not source code" });
      continue;
    }
    if (ext === ".json" && looksLikeJsonSchemaString(content)) {
      rejected.push({ reason: "schema-echo", path, detail: "JSON file contains a parameter-schema echo" });
      continue;
    }

    // Escaped-newline corruption: decode once, then let validation judge it.
    const unescaped = tryUnescapeCorruption(content);
    if (unescaped !== null) {
      content = unescaped;
      repairs.push(`unescaped-newlines:${path}`);
    }

    seen.add(path.toLowerCase());
    totalBytes += Buffer.byteLength(content, "utf8");
    files.push({ path, content, via: e.via });
  }

  if (files.length > MAX_FILES) {
    for (const extra of files.splice(MAX_FILES)) {
      rejected.push({ reason: "oversize", path: extra.path, detail: `Build exceeds ${MAX_FILES} files` });
    }
  }

  return { ok: files.length > 0, files, rejected, repairs };
}

// ─── Per-type validation ──────────────────────────────────────────

export interface FileValidation {
  ok: boolean;
  errors: string[];
}

export function validateGeneratedFile(path: string, content: string): FileValidation {
  const errors: string[] = [];
  const ext = fileExtensionOf(path);

  switch (ext) {
    case ".html": {
      const lc = content.toLowerCase();
      if (!/<!doctype html/i.test(content)) errors.push("missing <!doctype html>");
      if (!lc.includes("<html")) errors.push("missing <html> element");
      if (!lc.includes("<head")) errors.push("missing <head> element");
      if (!lc.includes("<body")) errors.push("missing <body> element");
      if (!lc.includes("</html>")) errors.push("missing </html> — document appears truncated");
      // A JSON payload smuggled into an html file.
      if (looksLikeJsonSchemaString(content)) errors.push("content is a JSON schema echo, not HTML");
      break;
    }
    case ".css": {
      let depth = 0;
      let unclosedComment = false;
      for (let i = 0; i < content.length; i++) {
        if (content[i] === "/" && content[i + 1] === "*") unclosedComment = true;
        if (content[i] === "*" && content[i + 1] === "/") unclosedComment = false;
        if (content[i] === "{") depth++;
        if (content[i] === "}") depth--;
        if (depth < 0) { errors.push("unbalanced braces (extra })"); break; }
      }
      if (depth > 0) errors.push(`unbalanced braces (${depth} unclosed {)`);
      if (unclosedComment) errors.push("unterminated /* comment");
      if (/<\/?(?:html|body|head|div|span|p|script|style|section|header|footer|nav|main)\b/i.test(content))
        errors.push("contains HTML markup — this is a stylesheet");
      if (looksLikeJsonSchemaString(content)) errors.push("content is a JSON schema echo, not CSS");
      break;
    }
    case ".js":
    case ".mjs": {
      try {
        // Compile-only syntax check — the body is NEVER executed.
        new vm.Script(content, { filename: path });
      } catch (err) {
        errors.push(`JavaScript syntax error: ${err instanceof Error ? err.message.split("\n")[0] : "invalid"}`);
      }
      if (looksLikeJsonSchemaString(content)) errors.push("content is a JSON schema echo, not JavaScript");
      break;
    }
    case ".json": {
      try {
        JSON.parse(content);
      } catch (err) {
        errors.push(`Invalid JSON: ${err instanceof Error ? err.message.slice(0, 120) : "parse failed"}`);
      }
      break;
    }
    case ".svg": {
      if (!/<svg[\s>]/i.test(content)) errors.push("missing <svg> root element");
      break;
    }
    default:
      // .md / .txt — non-empty (enforced by parser) is the whole contract.
      break;
  }

  return { ok: errors.length === 0, errors };
}

// ─── Deterministic HTML5 template ────────────────────────────────

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * The deterministic HTML5 shell. Boilerplate (doctype, meta, asset links)
 * is generated by the pipeline, never trusted to the model; the model's
 * contribution is the <body> content.
 */
export function assembleIndexHtml(opts: {
  title: string;
  bodyHtml: string;
  cssPath?: string;
  jsPath?: string;
}): string {
  const lines = [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escapeHtml(opts.title)}</title>`,
  ];
  if (opts.cssPath) lines.push(`  <link rel="stylesheet" href="${escapeHtml(opts.cssPath)}">`);
  lines.push("</head>", "<body>", opts.bodyHtml.trim(), "");
  if (opts.jsPath) lines.push(`  <script src="${escapeHtml(opts.jsPath)}" defer></script>`);
  lines.push("</body>", "</html>", "");
  return lines.join("\n");
}

/**
 * Extract a usable <body> fragment from a partial/invalid HTML document.
 * Returns null when the content has HTML-document markers but no
 * extractable body (nothing deterministic to salvage).
 */
export function extractHtmlBodyFragment(content: string): string | null {
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(content);
  if (bodyMatch) return bodyMatch[1].trim() || null;
  // No document markers at all → the whole string IS a fragment.
  if (!/<!doctype|<html[\s>]|<head[\s>]/i.test(content) && /<[a-z][^>]*>/i.test(content)) {
    return content.trim() || null;
  }
  return null;
}

/** CSS/JS assets referenced by an HTML document (deterministic link check). */
export function referencedAssets(html: string): { css: string[]; js: string[] } {
  const css = [...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/gi)].map((m) => m[1]);
  const js = [...html.matchAll(/<script[^>]+src=["']([^"']+\.m?js)["']/gi)].map((m) => m[1]);
  return { css, js };
}

// ─── Errors ───────────────────────────────────────────────────────

export type DeterministicCodegenFailure =
  | "model-unavailable"
  | "invalid-output"
  | "aborted";

export class DeterministicCodegenError extends Error {
  constructor(
    public readonly code: DeterministicCodegenFailure,
    message: string,
    public readonly diagnostics?: Partial<DeterministicGenerationDiagnostics>,
  ) {
    super(message);
    this.name = "DeterministicCodegenError";
  }
}

// ─── Generation orchestrator ─────────────────────────────────────

export interface ValidatedFile {
  path: string;
  content: string;
  bytes: number;
  /** How the file was produced — model verbatim, or a deterministic repair. */
  source: "model" | "template-wrapped" | "renamed-index";
}

export interface DeterministicGenerationDiagnostics {
  model: string;
  endpoint: string;
  attempts: number;
  latencyMs: number;
  perAttemptMs: number[];
  promptTokens: number;
  completionTokens: number;
  rejected: ParseRejection[];
  repairs: string[];
  /** Non-fatal issues worth surfacing (e.g. index.html links a missing asset). */
  notes: string[];
}

interface OllamaChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface DeterministicModelCall {
  (messages: OllamaChatMessage[], signal?: AbortSignal): Promise<{
    content: string;
    latencyMs: number;
    promptTokens?: number;
    completionTokens?: number;
  }>;
}

const OLLAMA_CHAT_TIMEOUT_MS = 300_000;

/**
 * Default model caller: Ollama /api/chat with the files schema as the
 * `format` constraint. Structured output is requested at the protocol
 * level; the parser still validates everything that comes back.
 */
async function ollamaStructuredChat(
  endpoint: string,
  model: string,
  numPredict: number,
): Promise<DeterministicModelCall> {
  const keepAlive = ollamaKeepAliveSetting();
  return async (messages, signal) => {
    const t0 = Date.now();
    const res = await fetch(`${endpoint}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false,
        keep_alive: keepAlive,
        format: CODEGEN_FILES_SCHEMA,
        messages,
        options: {
          temperature: 0.15,
          num_predict: numPredict,
        },
      }),
      signal: signal ?? AbortSignal.timeout(OLLAMA_CHAT_TIMEOUT_MS),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(`Ollama chat ${res.status}: ${txt.slice(0, 200)}`);
    }
    const data = (await res.json()) as {
      message?: { content?: string };
      prompt_eval_count?: number;
      eval_count?: number;
    };
    return {
      content: data.message?.content ?? "",
      latencyMs: Date.now() - t0,
      promptTokens: data.prompt_eval_count,
      completionTokens: data.eval_count,
    };
  };
}

export interface GenerateDeterministicWebsiteOptions {
  /** What the user asked for — passed to the model nearly verbatim. */
  userRequest: string;
  projectName?: string;
  /** Bare Ollama tag (e.g. "litt-coder:8k"). */
  model: string;
  endpoint?: string;
  /** Total generation attempts including the first (bounded retries). */
  maxAttempts?: number;
  signal?: AbortSignal;
  /** Injected for tests — when absent, real Ollama /api/chat is used. */
  callModel?: DeterministicModelCall;
}

/**
 * Shared real-lane setup: verify the pinned tag exists locally, warm it
 * through the serialized load gate (one model at a time), and build the
 * structured /api/chat caller with a context-bounded completion budget.
 */
async function prepareDeterministicCaller(
  opts: Pick<GenerateDeterministicWebsiteOptions, "model" | "endpoint" | "signal" | "callModel">,
  estimatedPromptChars: number,
): Promise<{ endpoint: string; callModel: DeterministicModelCall }> {
  const endpoint = opts.endpoint ?? resolveOllamaEndpoint((k) => process.env[k]);
  if (opts.callModel) return { endpoint, callModel: opts.callModel };
  const tags = await fetch(`${endpoint}/api/tags`, {
    signal: opts.signal ?? AbortSignal.timeout(15_000),
  }).then((r) => (r.ok ? r.json() : { models: [] })).catch(() => ({ models: [] }));
  const names = ((tags as { models?: Array<{ name?: string }> }).models ?? [])
    .map((m) => m.name)
    .filter((n): n is string => !!n);
  if (!names.includes(opts.model)) {
    throw new DeterministicCodegenError(
      "model-unavailable",
      `Local model ${opts.model} is not loaded in Ollama`,
    );
  }
  await ensureOllamaModelResident(endpoint, opts.model, {
    keepAlive: ollamaKeepAliveSetting(),
    signal: opts.signal,
  });
  const ctx = ollamaContextTokens(opts.model) ?? 8192;
  const estPrompt = Math.ceil(estimatedPromptChars / 4);
  const numPredict = Math.max(1024, Math.min(4096, ctx - estPrompt - 512));
  return { endpoint, callModel: await ollamaStructuredChat(endpoint, opts.model, numPredict) };
}

/**
 * Normalize the parsed file set into a website: ensure a valid index.html
 * exists (rename a lone .html sibling, or wrap a salvageable body fragment
 * in the deterministic template). Returns the normalized list, or null
 * when no salvage path exists — the caller retries or fails honestly.
 */
export function normalizeWebsiteFiles(
  files: ParsedFileEntry[],
  projectName: string,
  repairs: string[],
  notes: string[],
): ParsedFileEntry[] | null {
  const out = files.map((f) => ({ ...f }));
  let index = out.find((f) => f.path.toLowerCase() === "index.html");
  if (!index) {
    const htmlFiles = out.filter((f) => fileExtensionOf(f.path) === ".html");
    if (htmlFiles.length === 1) {
      const sole = htmlFiles[0];
      repairs.push(`renamed-index:${sole.path}->index.html`);
      sole.path = "index.html";
      index = sole;
    } else {
      return null; // no deterministic salvage for 0 or 2+ candidate entries
    }
  }

  const validation = validateGeneratedFile(index.path, index.content);
  if (!validation.ok) {
    const fragment = extractHtmlBodyFragment(index.content);
    if (fragment && fragment.length >= 40) {
      repairs.push(`index-template-wrap:${index.path}`);
      const css = out.find((f) => fileExtensionOf(f.path) === ".css")?.path;
      const js = out.find((f) => fileExtensionOf(f.path) === ".js" || fileExtensionOf(f.path) === ".mjs")?.path;
      index.content = assembleIndexHtml({ title: projectName, bodyHtml: fragment, cssPath: css, jsPath: js });
      index.via = "files-json";
    } else {
      return null;
    }
  }

  // Non-fatal: index references assets that were not generated. Surfaced
  // as a note, never silently created — the preview still renders the HTML.
  const { css, js } = referencedAssets(index.content);
  const have = new Set(out.map((f) => f.path.toLowerCase()));
  for (const href of [...css, ...js]) {
    const rel = normalizePath(href).toLowerCase();
    if (!have.has(rel)) {
      notes.push(`index.html references ${href} but it was not generated`);
    }
  }
  return out;
}

/**
 * Run the deterministic generation pipeline: prompt → structured output →
 * parse → validate → bounded repair reprompts. Throws
 * DeterministicCodegenError when every attempt fails validation.
 */
export async function generateDeterministicWebsite(
  opts: GenerateDeterministicWebsiteOptions,
): Promise<{ files: ValidatedFile[]; diagnostics: DeterministicGenerationDiagnostics }> {
  const endpoint = opts.endpoint ?? resolveOllamaEndpoint((k) => process.env[k]);
  const model = opts.model;
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 3);
  const t0 = Date.now();

  const diagnostics: DeterministicGenerationDiagnostics = {
    model,
    endpoint,
    attempts: 0,
    latencyMs: 0,
    perAttemptMs: [],
    promptTokens: 0,
    completionTokens: 0,
    rejected: [],
    repairs: [],
    notes: [],
  };

  const { callModel } = await prepareDeterministicCaller(
    opts,
    buildCodegenSystemPrompt().length + opts.userRequest.length,
  );

  const messages: OllamaChatMessage[] = [
    { role: "system", content: buildCodegenSystemPrompt() },
    { role: "user", content: buildCodegenUserPrompt(opts.userRequest, opts.projectName) },
  ];

  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new DeterministicCodegenError("aborted", "Generation cancelled", {
        ...diagnostics,
        latencyMs: Date.now() - t0,
      });
    }
    diagnostics.attempts = attempt;
    let raw: string;
    try {
      const res = await callModel(messages, opts.signal);
      raw = res.content;
      diagnostics.perAttemptMs.push(res.latencyMs);
      diagnostics.promptTokens += res.promptTokens ?? 0;
      diagnostics.completionTokens += res.completionTokens ?? 0;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "model call failed";
      if (opts.signal?.aborted || /aborted|abort/i.test(lastError)) {
        throw new DeterministicCodegenError("aborted", "Generation cancelled", {
          ...diagnostics,
          latencyMs: Date.now() - t0,
        });
      }
      messages.push({ role: "user", content: `The call failed: ${lastError.slice(0, 200)}. Output only the JSON files object.` });
      continue;
    }

    const parsed = parseDeterministicFilesOutput(raw);
    diagnostics.rejected.push(...parsed.rejected);
    diagnostics.repairs.push(...parsed.repairs);

    const fileErrors: string[] = [];
    let normalized: ParsedFileEntry[] | null = null;
    if (parsed.ok) {
      normalized = normalizeWebsiteFiles(parsed.files, opts.projectName ?? "Studio Site", parsed.repairs, diagnostics.notes);
      if (normalized) {
        for (const f of normalized) {
          const v = validateGeneratedFile(f.path, f.content);
          if (!v.ok) fileErrors.push(`${f.path}: ${v.errors.join("; ")}`);
        }
        // Linked-asset completeness: index.html must not reference local
        // css/js that was never generated — the preview manifest rejects
        // dead references, so this is a build failure, not a note.
        const index = normalized.find((f) => f.path.toLowerCase() === "index.html");
        if (index) {
          const { css, js } = referencedAssets(index.content);
          const have = new Set(normalized.map((f) => f.path.toLowerCase()));
          for (const href of [...css, ...js]) {
            if (/^(?:https?:)?\/\/|^data:|^#/i.test(href)) continue;
            const rel = normalizePath(href).toLowerCase();
            if (!have.has(rel)) {
              fileErrors.push(`index.html references "${href}" but that file was not generated`);
            }
          }
        }
      } else {
        fileErrors.push("No valid index.html could be produced from the output");
      }
    }

    if (parsed.ok && normalized && fileErrors.length === 0) {
      diagnostics.repairs = [...new Set(diagnostics.repairs)];
      diagnostics.notes = [...new Set(diagnostics.notes)];
      diagnostics.latencyMs = Date.now() - t0;
      return {
        files: normalized.map((f) => ({
          path: f.path,
          content: f.content,
          bytes: Buffer.byteLength(f.content, "utf8"),
          source: diagnostics.repairs.some((r) => r === `index-template-wrap:${f.path}`)
            ? "template-wrapped"
            : diagnostics.repairs.some((r) => r.startsWith(`renamed-index:`) && r.endsWith(`->${f.path}`))
              ? "renamed-index"
              : "model",
        })),
        diagnostics,
      };
    }

    // Bounded retry: feed the exact failures back, capped for the 8K window.
    lastError = `attempt ${attempt} produced no valid website (${parsed.rejected.length} parse rejections, ${fileErrors.length} validation errors)`;
    if (attempt < maxAttempts) {
      messages.push({ role: "assistant", content: raw.slice(0, 2000) });
      messages.push({ role: "user", content: buildRepairFeedback(parsed.rejected, fileErrors) });
    }
  }

  throw new DeterministicCodegenError(
    "invalid-output",
    `Deterministic codegen failed after ${maxAttempts} attempt(s): ${lastError}`,
    { ...diagnostics, latencyMs: Date.now() - t0 },
  );
}

// ─── Edit-mode generation ────────────────────────────────────────

export interface EditPlanFile {
  path: string;
  content: string;
  bytes: number;
  /**
   * added    — path did not exist on disk.
   * changed  — path exists and content differs.
   * unchanged— model echoed a byte-identical file (skipped on write).
   */
  kind: "added" | "changed" | "unchanged";
}

export interface GenerateDeterministicEditOptions extends GenerateDeterministicWebsiteOptions {
  /** Exact current workspace contents — used for prompts and diffing. */
  existingFiles: Map<string, string>;
}

/**
 * True when the request explicitly asks for a whole new page/site —
 * the only intent under which deleting most of an existing file's
 * content is legitimate. Deliberately narrow: a missed phrase costs a
 * bounded retry (the model re-emits a preserving file or the run fails
 * honestly), while a too-wide phrase silently authorizes destruction.
 */
const FULL_REBUILD_RE =
  /\b(?:rebuild|recreate|re-create|redesign|re-design|from scratch|start over|brand[\s-]?new|replace the (?:whole|entire) (?:site|page|website|file)|wipe (?:the|it|everything)|scrap (?:the|it|everything))\b/i;

export function fullRebuildRequested(userRequest: string): boolean {
  return FULL_REBUILD_RE.test(userRequest);
}

/**
 * Validate one candidate edit payload against the workspace: per-type
 * syntax, linked-asset completeness for every emitted .html file —
 * references may resolve to emitted files OR files already on disk —
 * and content preservation for files that exist on disk (an emitted
 * "complete file" that deletes most of the prior content is the
 * confirmed destructive-edit defect, not a valid edit). Returns
 * fileErrors (empty = valid).
 */
export function validateEditFiles(
  files: ParsedFileEntry[],
  existingFiles: Map<string, string>,
  opts: { userRequest?: string } = {},
): string[] {
  const errors: string[] = [];
  const emitted = new Set(files.map((f) => f.path.toLowerCase()));
  const disk = new Set([...existingFiles.keys()].map((k) => k.toLowerCase()));
  const prior = new Map([...existingFiles.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  const rebuild = fullRebuildRequested(opts.userRequest ?? "");
  for (const f of files) {
    const v = validateGeneratedFile(f.path, f.content);
    if (!v.ok) {
      errors.push(`${f.path}: ${v.errors.join("; ")}`);
      continue;
    }
    if (fileExtensionOf(f.path) === ".html") {
      const { css, js } = referencedAssets(f.content);
      for (const href of [...css, ...js]) {
        if (/^(?:https?:)?\/\/|^data:|^#/i.test(href)) continue;
        const rel = normalizePath(href).toLowerCase();
        if (!emitted.has(rel) && !disk.has(rel)) {
          errors.push(`${f.path} references "${href}" but it was not generated and does not exist on disk`);
        }
      }
    }
    if (!rebuild) {
      const prev = prior.get(f.path.toLowerCase());
      if (prev !== undefined) {
        const loss = destructiveContentLoss(prev, f.content);
        if (loss) {
          const lostPct = Math.round((1 - loss.retention) * 100);
          errors.push(
            `${f.path}: the emitted file deletes ~${lostPct}% of the existing content` +
              (loss.blocksLost ? " and removes every section/nav block" : "") +
              ` — the request asked for a targeted change. Re-emit the COMPLETE file keeping ALL existing ` +
              `sections, nav, images, copy, and styling; change only what the request asked.`,
          );
        }
      }
    }
  }
  return errors;
}

/**
 * Edit-mode generation: same strict pipeline, but the contract is
 * "output ONLY files to add or change" and unrelated on-disk files are
 * never part of the write set. A payload of only byte-identical files is
 * a retryable failure — it means the requested change was not applied.
 */
export async function generateDeterministicEdit(
  opts: GenerateDeterministicEditOptions,
): Promise<{ files: EditPlanFile[]; diagnostics: DeterministicGenerationDiagnostics }> {
  const model = opts.model;
  // Edits get a 4th attempt — the small model occasionally echoes the file
  // unchanged or emits a structurally-invalid doc; one more bounded try is
  // cheaper than failing a turn the next attempt would have landed.
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 4);
  const t0 = Date.now();

  const diagnostics: DeterministicGenerationDiagnostics = {
    model,
    endpoint: opts.endpoint ?? resolveOllamaEndpoint((k) => process.env[k]),
    attempts: 0,
    latencyMs: 0,
    perAttemptMs: [],
    promptTokens: 0,
    completionTokens: 0,
    rejected: [],
    repairs: [],
    notes: [],
  };

  const { callModel } = await prepareDeterministicCaller(
    opts,
    buildEditSystemPrompt().length + opts.userRequest.length + (await (async () => {
      let n = 0; for (const c of opts.existingFiles.values()) n += c.length; return n;
    })()),
  );

  const messages: OllamaChatMessage[] = [
    { role: "system", content: buildEditSystemPrompt() },
    { role: "user", content: buildEditUserPrompt(opts.userRequest, opts.existingFiles) },
  ];

  const existing = new Map([...opts.existingFiles.entries()].map(([k, v]) => [k.toLowerCase(), v]));
  // Double-quoted strings in the request are treated as contract literals —
  // the user is naming exact text. Path/extension-like literals are excluded
  // (they refer to files, not content).
  const quotedLiterals = [...opts.userRequest.matchAll(/"([^"\n]{2,80})"/g)]
    .map((m) => m[1])
    .filter((s) => !/[\\/]/.test(s) && !/\.[a-z0-9]{1,5}$/i.test(s));
  let lastError = "";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (opts.signal?.aborted) {
      throw new DeterministicCodegenError("aborted", "Edit cancelled", {
        ...diagnostics,
        latencyMs: Date.now() - t0,
      });
    }
    diagnostics.attempts = attempt;
    let raw: string;
    try {
      const res = await callModel(messages, opts.signal);
      raw = res.content;
      diagnostics.perAttemptMs.push(res.latencyMs);
      diagnostics.promptTokens += res.promptTokens ?? 0;
      diagnostics.completionTokens += res.completionTokens ?? 0;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "model call failed";
      if (opts.signal?.aborted || /aborted|abort/i.test(lastError)) {
        throw new DeterministicCodegenError("aborted", "Edit cancelled", {
          ...diagnostics,
          latencyMs: Date.now() - t0,
        });
      }
      messages.push({ role: "user", content: `The call failed: ${lastError.slice(0, 200)}. Output only the JSON files object.` });
      continue;
    }

    const parsed = parseDeterministicFilesOutput(raw);
    diagnostics.rejected.push(...parsed.rejected);
    diagnostics.repairs.push(...parsed.repairs);

    const fileErrors = parsed.ok
      ? validateEditFiles(parsed.files, opts.existingFiles, { userRequest: opts.userRequest })
      : [];

    let plan: EditPlanFile[] = [];
    let effective = 0;
    if (parsed.ok && fileErrors.length === 0) {
      plan = parsed.files.map((f) => {
        const prior = existing.get(f.path.toLowerCase());
        const kind = prior === undefined ? "added" : prior === f.content ? "unchanged" : "changed";
        if (kind !== "unchanged") effective++;
        return {
          path: f.path,
          content: f.content,
          bytes: Buffer.byteLength(f.content, "utf8"),
          kind: kind as EditPlanFile["kind"],
        };
      });
      if (effective === 0) {
        fileErrors.push("Every emitted file is byte-identical to disk — the requested change was not applied");
      } else if (quotedLiterals.length > 0) {
        // Effect check: double-quoted strings in the request are contract
        // literals (e.g. the exact text to insert). After the write the
        // workspace — emitted files ∪ unchanged on-disk files — must contain
        // each one; absence means the model skipped the requested change.
        const postState = new Map(existing);
        for (const f of plan) postState.set(f.path.toLowerCase(), f.content);
        const contents = [...postState.values()].map((c) => c.toLowerCase());
        for (const lit of quotedLiterals.filter((l) => !contents.some((c) => c.includes(l.toLowerCase()))).slice(0, 3)) {
          fileErrors.push(`No file contains the requested text "${lit}" — the change was not applied`);
        }
      }
    }

    if (parsed.ok && fileErrors.length === 0) {
      diagnostics.latencyMs = Date.now() - t0;
      diagnostics.repairs = [...new Set(diagnostics.repairs)];
      diagnostics.notes = [...new Set(diagnostics.notes)];
      return { files: plan, diagnostics };
    }

    lastError = `attempt ${attempt} produced no applicable edit (${parsed.rejected.length} parse rejections, ${fileErrors.length} validation errors)` +
      (fileErrors[0] ? ` — ${fileErrors[0].slice(0, 160)}` : parsed.rejected[0] ? ` — ${parsed.rejected[0].detail.slice(0, 160)}` : "");
    if (attempt < maxAttempts) {
      messages.push({ role: "assistant", content: raw.slice(0, 2000) });
      // All-echo rejection over-corrects small models into changing every
      // file to force a diff — bound the correction to the requested file(s).
      const allEcho = fileErrors.some((e) => e.includes("byte-identical"));
      messages.push({
        role: "user",
        content:
          buildRepairFeedback(parsed.rejected, fileErrors) +
          `\nThe requested change, verbatim: ${opts.userRequest}` +
          (allEcho
            ? "\nOnly emit the file(s) the change belongs in — do NOT modify unrelated files just to make the output differ."
            : ""),
      });
    }
  }

  throw new DeterministicCodegenError(
    "invalid-output",
    `Deterministic edit failed after ${maxAttempts} attempt(s): ${lastError}`,
    { ...diagnostics, latencyMs: Date.now() - t0 },
  );
}

// ─── Persistence (Studio writes, then verifies) ──────────────────

export interface PersistedWrite {
  path: string;
  ok: boolean;
  /** Byte-exact read-back verification — the only success signal. */
  verified: boolean;
  size?: number;
  error?: string;
}

export interface DeterministicPersistResult {
  checkpoint: CheckpointInfo | null;
  writes: PersistedWrite[];
  verifiedCount: number;
}

/**
 * Studio performs the writes via the verified workspace transport, then
 * reads every file back and byte-compares. A write that cannot be read
 * back identical is a failure — never reported as persisted.
 */
export async function persistDeterministicFiles(
  transport: WorkspaceTransport,
  files: ValidatedFile[],
  opts: { checkpointLabel?: string } = {},
): Promise<DeterministicPersistResult> {
  const checkpoint = await transport
    .createCheckpointBeforeMutation(opts.checkpointLabel ?? "deterministic-codegen")
    .catch(() => null);

  const writes: PersistedWrite[] = [];
  for (const file of files) {
    // One bounded retry per file — transient workspace-server blips must
    // not fail a build, but a second failure is reported honestly.
    let lastErr = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await transport.writeFile(file.path, file.content);
        const readBack = await transport.readFile(file.path);
        const verified = readBack.content === file.content;
        writes.push({
          path: file.path,
          ok: true,
          verified,
          size: readBack.size ?? file.bytes,
          ...(verified ? {} : { error: "Read-back content does not match what was written" }),
        });
        lastErr = "";
        break;
      } catch (err) {
        lastErr = err instanceof Error ? err.message.slice(0, 200) : "write failed";
        if (attempt === 0) await new Promise((r) => setTimeout(r, 400));
      }
    }
    if (lastErr) {
      writes.push({ path: file.path, ok: false, verified: false, error: lastErr });
    }
  }
  return { checkpoint, writes, verifiedCount: writes.filter((w) => w.verified).length };
}

// ─── Lane orchestrator (route-facing) ────────────────────────────

const DET_METERING_ID_PREFIX = "metering:llm:detcodegen";

function emitDeterministicMetering(input: {
  userId?: string;
  projectId?: string;
  runId: string;
  attempt: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  status: "success" | "failed";
  error?: string;
}): void {
  try {
    const ctx = getMeteringContext();
    const userId = ctx?.userId ?? input.userId ?? null;
    const clerkId = ctx?.clerkId ?? input.userId ?? null;
    if (!userId && !clerkId) return;
    const feature = ctx?.feature ?? "studio-chat";
    const { providerCostMicros } = calculateLlmCost({
      provider: "ollama",
      model: input.model,
      promptTokens: input.inputTokens,
      completionTokens: input.outputTokens,
      isByok: false,
    });
    const idempotencyKey = `${DET_METERING_ID_PREFIX}:${input.runId}:${input.attempt}`;
    void emitUsageEvent({
      userId: userId ?? undefined,
      clerkId: clerkId ?? undefined,
      runId: ctx?.runId ?? undefined,
      projectId: ctx?.projectId ?? input.projectId ?? undefined,
      feature,
      capability: "llm",
      provider: "ollama",
      model: input.model,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      providerCostMicros,
      status: input.status,
      billable: input.status === "success",
      error: input.error,
      idempotencyKey,
      originalRequestId: idempotencyKey,
    }).catch(() => {});
  } catch {
    // Metering must never break the run.
  }
}

export interface DeterministicLaneOptions {
  userMessage: string;
  projectId: string;
  userId: string;
  projectName?: string;
  transport: WorkspaceTransport;
  /** The pinned model string ("ollama/litt-coder:8k" or bare tag). */
  model: string;
  isStaticWorkspace?: boolean;
  maxAttempts?: number;
  signal?: AbortSignal;
  progress?: ProgressEmitter;
}

/**
 * The deterministic build lane as a LaunchFlowResult-compatible executor:
 * generation → validation → persistence → read-back verification →
 * preview artifact gate. Success is reported only when files verified on
 * disk AND the preview artifact gate passes.
 */
export async function runDeterministicBuildLane(
  opts: DeterministicLaneOptions,
): Promise<LaunchFlowResult> {
  const startTime = Date.now();
  const progress = opts.progress ?? new ProgressEmitter();
  const signal = opts.signal;
  const steps: string[] = [];
  const meteringRunId = `detcodegen-${Date.now().toString(36)}`;
  const toolCalls: AgentLoopResult["toolCalls"] = [];
  const emit = (summary: string) => {
    steps.push(summary);
    progress.emit({ type: "status", summary });
  };
  const modelTag = opts.model.replace(/^ollama\//i, "");

  const baseResult = (overrides: Partial<LaunchFlowResult>): LaunchFlowResult => ({
    success: false,
    status: "failed",
    finalText: "Build did not complete.",
    repairAttempts: 0,
    runtimeRepairAttempts: 0,
    steps,
    cancelled: false,
    agentLoopResult: {
      finalText: "",
      stepsUsed: 0,
      totalDurationMs: Date.now() - startTime,
      toolCalls,
      cancelled: false,
      events: [],
    },
    totalDurationMs: Date.now() - startTime,
    ...overrides,
  });

  try {
    if (signal?.aborted) throw new Error("cancelled");

    // 0. Mode detection: a workspace already holding a real site gets the
    // edit lane (changed/new files only); welcome-screen or missing
    // index.html gets the full build lane. Oversized workspaces fail
    // honestly — the 8K model cannot edit what it cannot read.
    const snapshot = await snapshotWebsiteFiles(opts.transport);
    const editMode = snapshot.kind === "edit";
    if (snapshot.kind === "too-large") {
      const msg = `Workspace has ~${snapshot.totalBytes} bytes of site files — beyond the ${MAX_EDIT_CONTEXT_BYTES}-byte edit context of ${modelTag}. Use a larger-context model for this project.`;
      progress.emit({ type: "model_failed", model: modelTag, category: "detcodegen", message: msg });
      return baseResult({
        success: false,
        status: "failed",
        finalText: `I can't edit this site with ${modelTag}: ${msg}`,
        error: msg,
      });
    }

    progress.emit({ type: "phase", phase: "call_llm", step: 1 });
    emit(editMode
      ? `Editing existing site with local model ${modelTag} (deterministic lane, ${snapshot.snapshot!.files.size} file(s) on disk)`
      : `Generating site files with local model ${modelTag} (deterministic lane)`);

    // 1. Generate + validate (bounded retries inside). Edit mode emits
    // only files to add/change — unrelated files are never in the write
    // set, so they cannot be overwritten.
    let files: ValidatedFile[];
    let editPlan: EditPlanFile[] = [];
    let diagnostics: DeterministicGenerationDiagnostics;
    try {
      if (editMode) {
        const edited = await generateDeterministicEdit({
          userRequest: opts.userMessage,
          projectName: opts.projectName,
          model: modelTag,
          existingFiles: snapshot.snapshot!.files,
          maxAttempts: opts.maxAttempts,
          signal,
        });
        diagnostics = edited.diagnostics;
        editPlan = edited.files;
        files = edited.files
          .filter((f) => f.kind !== "unchanged")
          .map((f) => ({ path: f.path, content: f.content, bytes: f.bytes, source: "model" as const }));
      } else {
        const built = await generateDeterministicWebsite({
          userRequest: opts.userMessage,
          projectName: opts.projectName,
          model: modelTag,
          maxAttempts: opts.maxAttempts,
          signal,
        });
        diagnostics = built.diagnostics;
        files = built.files;
      }
    } catch (err) {
      if (err instanceof DeterministicCodegenError) {
        emitDeterministicMetering({
          userId: opts.userId,
          projectId: opts.projectId,
          runId: meteringRunId,
          attempt: err.diagnostics?.attempts ?? 1,
          model: modelTag,
          inputTokens: Math.ceil((err.diagnostics?.promptTokens ?? 0)),
          outputTokens: Math.ceil((err.diagnostics?.completionTokens ?? 0)),
          status: "failed",
          error: err.message.slice(0, 200),
        });
        progress.emit({
          type: "model_failed",
          model: modelTag,
          category: "detcodegen",
          message: err.message.slice(0, 300),
        });
        const aborted = err.code === "aborted";
        return baseResult({
          success: false,
          status: aborted ? "cancelled" : "failed",
          cancelled: aborted,
          cancelReason: aborted ? err.message : undefined,
          finalText: aborted
            ? "The build was cancelled."
            : `I couldn't produce valid files with ${modelTag}: ${err.message.slice(0, 300)}`,
          error: err.message,
          agentLoopResult: {
            finalText: "",
            stepsUsed: err.diagnostics?.attempts ?? 1,
            totalDurationMs: Date.now() - startTime,
            toolCalls,
            cancelled: aborted,
            cancelReason: aborted ? err.message : undefined,
            modelFailed: aborted ? undefined : err.message.slice(0, 300),
            events: [],
          },
        });
      }
      throw err;
    }

    emitDeterministicMetering({
      userId: opts.userId,
      projectId: opts.projectId,
      runId: meteringRunId,
      attempt: diagnostics.attempts,
      model: modelTag,
      inputTokens: diagnostics.promptTokens,
      outputTokens: diagnostics.completionTokens,
      status: "success",
    });
    progress.emit({
      type: "model_routing",
      model: modelTag,
      provider: "ollama",
      category: "detcodegen",
      latencyMs: diagnostics.latencyMs,
    });
    const unchangedCount = editPlan.filter((f) => f.kind === "unchanged").length;
    emit(
      `${editMode ? "Edited" : "Generated"} ${files.length} file(s) in ${diagnostics.attempts} attempt(s)` +
        (unchangedCount ? ` (${unchangedCount} unchanged echo(es) skipped)` : "") +
        (diagnostics.repairs.length ? ` — repairs: ${diagnostics.repairs.join(", ")}` : "") +
        (diagnostics.notes.length ? ` — notes: ${diagnostics.notes.join("; ")}` : ""),
    );

    if (signal?.aborted) throw new Error("cancelled");

    // 2. Persist via the verified workspace transport + read-back proof.
    progress.emit({ type: "phase", phase: "execute", step: 2 });
    const persist = await persistDeterministicFiles(opts.transport, files, {
      checkpointLabel: `deterministic-codegen: ${opts.userMessage.slice(0, 60)}`,
    });
    if (persist.checkpoint) {
      progress.emit({
        type: "checkpoint",
        label: persist.checkpoint.label,
        gitSha: persist.checkpoint.gitSha,
        kind: "before",
      });
    }

    for (const w of persist.writes) {
      const t1 = Date.now();
      progress.emit({ type: "tool_start", toolId: "files.write", summary: `Write ${w.path}` });
      const ok = w.ok && w.verified;
      toolCalls.push({
        toolId: "files.write",
        success: ok,
        summary: ok
          ? `${w.path} written and verified (${w.size ?? 0} bytes)`
          : `${w.path}: ${w.error ?? "write failed"}`,
        mutating: true,
      });
      progress.emit({
        type: "tool_result",
        toolId: "files.write",
        success: ok,
        summary: ok ? `Verified ${w.path} on disk` : `Failed ${w.path}: ${w.error ?? "unverified"}`,
        durationMs: Date.now() - t1,
      });
    }

    if (persist.verifiedCount === 0) {
      const errMsg = "No generated file could be written and verified in the workspace.";
      return baseResult({
        success: false,
        status: "failed",
        finalText: `I generated the site files but none could be saved to the workspace. ${persist.writes[0]?.error ?? ""}`.trim(),
        error: errMsg,
      });
    }

    // Partial-persistence is a failure, not a degraded success: a site
    // missing a produced file (e.g. index.html) is broken, and an edit
    // that did not land must not be reported as applied. Files that DID
    // persist stay on disk — visible, checkpointed, never silently undone.
    const failedWrites = persist.writes.filter((w) => !w.verified);
    if (failedWrites.length > 0) {
      const errMsg = `${failedWrites.length} file(s) could not be written and verified: ${failedWrites.map((w) => `${w.path} (${w.error ?? "unverified"})`).join(", ")}`;
      progress.emit({
        type: "finished",
        totalSteps: diagnostics.attempts + persist.writes.length,
        totalDurationMs: Date.now() - startTime,
        success: false,
      });
      return baseResult({
        success: false,
        status: "failed",
        finalText: `The ${editMode ? "edit" : "build"} did not fully persist — ${errMsg}. Files that did save are still in the workspace.`,
        error: errMsg,
        agentLoopResult: {
          finalText: "",
          stepsUsed: diagnostics.attempts + persist.writes.length,
          totalDurationMs: Date.now() - startTime,
          toolCalls,
          cancelled: false,
          checkpoint: persist.checkpoint ?? undefined,
          events: [],
        },
      });
    }

    // 3. Workspace-change evidence — real diff when a checkpoint exists;
    // otherwise byte-verified writes are themselves the honest evidence.
    let workspaceChange: WorkspaceChangeEvidence | undefined;
    if (persist.checkpoint) {
      workspaceChange = await computeWorkspaceChange(opts.transport, persist.checkpoint);
    }
    if (!workspaceChange || workspaceChange.status === "unknown") {
      const verifiedPaths = persist.writes.filter((w) => w.verified).map((w) => w.path);
      workspaceChange = {
        status: verifiedPaths.length > 0 ? "changed" : "unknown",
        files: verifiedPaths,
        ...(persist.checkpoint?.gitSha ? { checkpointSha: persist.checkpoint.gitSha } : {}),
        ...(persist.checkpoint ? {} : { unknownReason: undefined }),
      };
    }
    progress.emit({
      type: "workspace_change",
      status: workspaceChange.status,
      files: workspaceChange.files,
      diff: workspaceChange.diff,
      additions: workspaceChange.additions,
      deletions: workspaceChange.deletions,
      checkpointSha: workspaceChange.checkpointSha,
      unknownReason: workspaceChange.unknownReason,
    });

    // 4. Preview artifact gate — the same on-disk proof the launch flow uses.
    progress.emit({ type: "phase", phase: "preview", step: 3 });
    progress.emit({ type: "preview_start" });
    const previewGate = await ensureProjectPreviewReady(
      opts.transport,
      {
        isStaticWorkspace: opts.isStaticWorkspace ?? true,
        workspaceChange,
        hadSuccessfulMutation: persist.verifiedCount > 0,
      },
      progress,
    );
    if (!previewGate.ok) {
      progress.emit({ type: "preview_result", success: false, error: previewGate.error });
      return baseResult({
        success: false,
        status: "failed",
        finalText: `Files were written and verified, but the preview gate failed: ${previewGate.error}`,
        error: previewGate.error,
        agentLoopResult: {
          finalText: "",
          stepsUsed: diagnostics.attempts + persist.writes.length,
          totalDurationMs: Date.now() - startTime,
          toolCalls,
          cancelled: false,
          workspaceChange,
          checkpoint: persist.checkpoint ?? undefined,
          events: [],
        },
      });
    }

    const previewUrl = opts.isStaticWorkspace ?? true
      ? `/api/preview/${encodeURIComponent(opts.projectId)}/`
      : buildPreviewProxyUrl(opts.transport.workspaceId);
    progress.emit({ type: "preview_status", status: "ready", healthy: true });
    progress.emit({ type: "preview_result", success: true, previewUrl });
    progress.emit({ type: "phase", phase: "finished", step: 4 });
    progress.emit({
      type: "finished",
      totalSteps: diagnostics.attempts + persist.writes.length,
      totalDurationMs: Date.now() - startTime,
      success: true,
    });

    const fileList = persist.writes.filter((w) => w.verified).map((w) => w.path).join(", ");
    const addedN = editPlan.filter((f) => f.kind === "added").length;
    const changedN = editPlan.filter((f) => f.kind === "changed").length;
    const kindNote = editMode ? ` (${addedN} added, ${changedN} changed${unchangedCount ? `, ${unchangedCount} unchanged skipped` : ""})` : "";
    const repairNote = diagnostics.repairs.length
      ? ` Note: ${diagnostics.repairs.join("; ")}.`
      : "";
    const notesNote = diagnostics.notes.length ? ` Heads-up: ${diagnostics.notes.join("; ")}.` : "";
    const finalText =
      `${editMode ? "Edited" : "Built"} ${persist.verifiedCount} file(s) with ${modelTag} (deterministic codegen lane)${kindNote}: ${fileList}. ` +
      `Every file was validated and verified on disk.${repairNote}${notesNote}`;

    return baseResult({
      success: true,
      status: "preview_ready",
      previewUrl,
      finalText,
      repairAttempts: Math.max(0, diagnostics.attempts - 1),
      agentLoopResult: {
        finalText,
        stepsUsed: diagnostics.attempts + persist.writes.length,
        totalDurationMs: Date.now() - startTime,
        toolCalls,
        cancelled: false,
        workspaceChange,
        checkpoint: persist.checkpoint ?? undefined,
        events: [],
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "deterministic lane failed";
    const aborted = signal?.aborted || msg === "cancelled";
    if (aborted) {
      progress.emit({ type: "cancelled", reason: msg });
    } else {
      progress.emit({ type: "finished", totalSteps: 0, totalDurationMs: Date.now() - startTime, success: false });
    }
    return baseResult({
      success: false,
      status: aborted ? "cancelled" : "failed",
      cancelled: aborted,
      cancelReason: aborted ? msg : undefined,
      finalText: aborted ? "The build was cancelled." : `The deterministic build failed: ${msg.slice(0, 300)}`,
      error: msg,
      agentLoopResult: {
        finalText: "",
        stepsUsed: 0,
        totalDurationMs: Date.now() - startTime,
        toolCalls,
        cancelled: aborted,
        cancelReason: aborted ? msg : undefined,
        events: [],
      },
    });
  }
}
