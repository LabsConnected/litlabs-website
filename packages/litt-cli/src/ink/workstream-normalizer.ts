/**
 * WorkstreamNormalizer — maps raw agent/tool events to semantic activities.
 *
 * The presentation layer must NEVER become a pile of tool-specific hacks.
 * This module is the single boundary where raw tool names are translated
 * into the semantic WorkstreamKind vocabulary + human-readable labels.
 *
 * Pipeline:
 *   agent/tool event
 *         ↓
 *   normalizeToolEvent(event)
 *         ↓
 *   semantic activity { kind, label, subject }
 *         ↓
 *   WorkstreamStore.begin/add
 *         ↓
 *   WorkstreamDock
 *
 * If a tool is unknown, it falls back to a generic "tool" kind with the
 * raw tool name as the label — never crashes, never shows "unknown".
 */

import type { WorkstreamKind, WorkstreamPhase } from "./workstream-store.js";

// ─── Tool name → semantic kind mapping ─────────────────────────────

/** Maps raw tool names to semantic activity kinds. */
const TOOL_KIND_MAP: Record<string, WorkstreamKind> = {
  // File inspection tools
  read_file: "inspect",
  read_files: "inspect",
  readFile: "inspect",
  readFiles: "inspect",
  list_files: "inspect",
  listFiles: "inspect",
  glob: "inspect",
  grep: "inspect",
  search: "inspect",
  find_file: "inspect",
  findFile: "inspect",

  // File editing tools
  write_file: "edit",
  writeFile: "edit",
  edit_file: "edit",
  editFile: "edit",
  replace: "edit",
  apply_patch: "edit",
  applyPatch: "edit",
  create_file: "edit",
  createFile: "edit",

  // Command execution
  run_command: "command",
  runCommand: "command",
  execute: "command",
  exec: "command",
  shell: "command",

  // Testing
  run_tests: "test",
  runTests: "test",
  test: "test",
  vitest: "test",
  jest: "test",

  // Verification
  typecheck: "verify",
  type_check: "verify",
  typeCheck: "verify",
  lint: "verify",
  build: "verify",
  verify: "verify",

  // Deployment / sync
  deploy: "deploy" as WorkstreamKind,
  push: "deploy" as WorkstreamKind,
  sync: "sync" as WorkstreamKind,
};

// ─── Human-readable label generation ───────────────────────────────

/** Maps a tool name + arguments to a human-readable label. */
export function humanizeToolLabel(toolName: string, args?: Record<string, unknown>): string {
  const kind = TOOL_KIND_MAP[toolName];

  // For inspection tools, try to extract the file path
  if (kind === "inspect") {
    const file = extractFilePath(args);
    if (file) return shortenPath(file);
    return "Inspecting";
  }

  // For editing tools
  if (kind === "edit") {
    const file = extractFilePath(args);
    if (file) return shortenPath(file);
    return "Updating";
  }

  // For commands
  if (kind === "command") {
    const cmd = args?.command as string ?? args?.cmd as string;
    if (cmd) return shortenCommand(cmd);
    return "Running command";
  }

  // For tests
  if (kind === "test") {
    const file = extractFilePath(args);
    if (file) return shortenPath(file);
    return "Running tests";
  }

  // For verification
  if (kind === "verify") {
    const cmd = args?.command as string;
    if (cmd) return shortenCommand(cmd);
    return "Verifying";
  }

  // Fallback: use the tool name itself, cleaned up
  return prettifyToolName(toolName);
}

/** Maps a tool name to its semantic activity kind. */
export function toolKind(toolName: string): WorkstreamKind {
  return TOOL_KIND_MAP[toolName] ?? "tool";
}

/** Maps a tool name to its standardized workstream phase. */
export function toolPhase(toolName: string): WorkstreamPhase {
  const kind = toolKind(toolName);
  switch (kind) {
    case "inspect": return "inspecting";
    case "edit": return "editing";
    case "command": return "running";
    case "test": return "testing";
    case "verify": return "verifying";
    default: return "running";
  }
}

// ─── Helpers ───────────────────────────────────────────────────────

/** Extract a file path from common tool argument shapes. */
function extractFilePath(args?: Record<string, unknown>): string | null {
  if (!args) return null;
  const candidates = ["file", "path", "filePath", "filename", "file_path"];
  for (const key of candidates) {
    const val = args[key];
    if (typeof val === "string" && val.length > 0) return val;
  }
  // Some tools pass an array of files
  const files = args.files;
  if (Array.isArray(files) && files.length > 0 && typeof files[0] === "string") {
    return files[0];
  }
  return null;
}

/** Shorten a file path for display (keep last 2-3 segments). */
export function shortenPath(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/");
  if (parts.length <= 3) return path;
  return ".../" + parts.slice(-2).join("/");
}

/** Shorten a command for display (keep the first meaningful token). */
export function shortenCommand(cmd: string): string {
  const trimmed = cmd.trim().replace(/\s+/g, " ");
  // Strip common prefixes
  const stripped = trimmed.replace(/^(npx|pnpm|npm|yarn|node)\s+(exec\s+)?/, "");
  // Keep first 2-3 words
  const words = stripped.split(" ");
  if (words.length <= 3) return stripped;
  return words.slice(0, 3).join(" ") + " ...";
}

/** Convert a raw tool name to a prettier display name. */
function prettifyToolName(name: string): string {
  return name
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Grouping: collapse repetitive operations ──────────────────────

/** Group consecutive activities of the same kind into a single summary.
 *  Returns groups with count + representative label. */
export interface ActivityGroup {
  kind: WorkstreamKind;
  label: string;
  count: number;
  subjects: string[];
  status: "running" | "complete" | "failed";
  /** The underlying activity ids in this group. */
  ids: string[];
}

/** Group consecutive same-kind activities (e.g. 4 read_file → "Inspecting 4 files").
 *  Only groups inspect/edit/test kinds; others stay individual. */
export function groupConsecutive(
  activities: Array<{ id: string; kind: WorkstreamKind; label: string; subject?: string; status: "running" | "complete" | "failed" }>,
): ActivityGroup[] {
  const GROUPABLE: WorkstreamKind[] = ["inspect", "edit", "test"];
  const groups: ActivityGroup[] = [];
  let i = 0;
  while (i < activities.length) {
    const act = activities[i];
    if (!GROUPABLE.includes(act.kind)) {
      groups.push({
        kind: act.kind,
        label: act.label,
        count: 1,
        subjects: act.subject ? [act.subject] : [],
        status: act.status,
        ids: [act.id],
      });
      i++;
      continue;
    }
    // Collect consecutive same-kind activities
    const batch = [act];
    let j = i + 1;
    while (j < activities.length && activities[j].kind === act.kind) {
      batch.push(activities[j]);
      j++;
    }
    if (batch.length <= 2) {
      // Not enough to group — emit individually
      for (const b of batch) {
        groups.push({
          kind: b.kind,
          label: b.label,
          count: 1,
          subjects: b.subject ? [b.subject] : [],
          status: b.status,
          ids: [b.id],
        });
      }
    } else {
      // Group them
      const subjects = batch
        .map((b) => b.subject)
        .filter((s): s is string => typeof s === "string" && s.length > 0);
      const kindLabel = act.kind === "inspect" ? "Inspecting"
        : act.kind === "edit" ? "Updating"
        : act.kind === "test" ? "Testing"
        : act.label;
      const anyRunning = batch.some((b) => b.status === "running");
      const anyFailed = batch.some((b) => b.status === "failed");
      groups.push({
        kind: act.kind,
        label: `${kindLabel} ${batch.length} ${act.kind === "inspect" ? "files" : act.kind === "edit" ? "files" : "tests"}`,
        count: batch.length,
        subjects,
        status: anyFailed ? "failed" : anyRunning ? "running" : "complete",
        ids: batch.map((b) => b.id),
      });
    }
    i = j;
  }
  return groups;
}
