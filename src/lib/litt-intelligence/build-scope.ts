/**
 * Build-scope authorization (ACC-07, Larry's ruling 2026-11-25).
 *
 * One approval covers the entire scoped build. Acceptance Run 1 on
 * c15099b4 paused THREE times for one small bakery build (files.write,
 * image.stock, files.write) because the permission gate asked per
 * tool call. Larry's ruling: approving the build authorizes the
 * build's own content work — writing/editing project files and
 * generating/fetching the images and media the build needs — without
 * repetitive prompts. Publishing/deploying, destructive operations,
 * sensitive changes, and anything beyond the approved scope still
 * require their own separate approval.
 *
 * This module is the single source of truth for that line. It does
 * NOT widen the permission engine: the engine still decides what
 * needs approval; the loop consults this module only to learn
 * whether an already-granted build scope covers a gated call, and
 * the first gated build-scope call of a run is what ASKS for the
 * scope (with the scope text on the card, so what the approval
 * authorizes is displayed before the user decides).
 *
 * Safety properties preserved:
 *  - Scope covers only the closed content-creation set below. A tool
 *    outside the set is never covered, scope or not.
 *  - The always-separate set mirrors the permission engine's
 *    SENSITIVE_ACTIONS and wins over scope in every check.
 *  - terminal.execute is never in scope: shell commands keep their
 *    per-command classification.
 *  - Scope never crosses runs: it is granted by one approval, carried
 *    on that run's paused-run record across its own resumes, and
 *    dies with the run.
 */

import { getDelegateToolId } from "./tool-delegates";

/** The content-creation tools a build approval authorizes: writing
 *  and editing the project's own files, composing its pages, and
 *  generating/fetching the media the build needs. */
export const BUILD_SCOPE_TOOL_IDS: ReadonlySet<string> = new Set([
  "files.write",
  "files.create",
  "files.mkdir",
  "files.rename",
  "files.move",
  "files.patch",
  "apply_patch",
  "site.compose",
  "site.patch",
  "site.html",
  "site.webmanifest",
  "image.stock",
  "image.generate",
  "image.upscale",
  "video.generate",
  "audio.generate",
  "audio.sfx",
  "audio.tts",
]);

/** Tools that ALWAYS require their own separate approval, even with
 *  a granted build scope — mirrors the permission engine's
 *  SENSITIVE_ACTIONS (publishing, destructive, irreversible). */
export const ALWAYS_SEPARATE_APPROVAL_TOOL_IDS: ReadonlySet<string> = new Set([
  "project.deploy",
  "deploy.execute",
  "files.delete",
  "git.push",
  "git.force_push",
  "git.reset_hard",
  "git.rebase",
]);

export function canonicalBuildToolId(toolId: string): string {
  return getDelegateToolId(toolId) ?? toolId;
}

/** True when the tool must prompt on its own regardless of scope. */
export function isAlwaysSeparateApprovalTool(toolId: string): boolean {
  return (
    ALWAYS_SEPARATE_APPROVAL_TOOL_IDS.has(toolId) ||
    ALWAYS_SEPARATE_APPROVAL_TOOL_IDS.has(canonicalBuildToolId(toolId))
  );
}

/** True when the tool is inside the build scope (and not carved out
 *  by the always-separate set). */
export function isBuildScopeTool(toolId: string): boolean {
  if (isAlwaysSeparateApprovalTool(toolId)) return false;
  return BUILD_SCOPE_TOOL_IDS.has(canonicalBuildToolId(toolId));
}

/** The gate decision: a granted build scope covers this call. */
export function buildScopeCoversTool(scopeAuthorized: boolean, toolId: string): boolean {
  return scopeAuthorized && isBuildScopeTool(toolId);
}

/**
 * The text shown on the FIRST approval card of a build — it must
 * clearly display what the approval authorizes (Larry's ruling).
 * The specific gated action is named first; the scope it grants and
 * its exclusions follow, so the user approves the scope knowingly,
 * not just the single step.
 */
export function buildScopeApprovalReason(toolId: string): string {
  return (
    `Approve this build step (${toolId}) and the build it belongs to. ` +
    `This one approval covers the whole build: writing and editing this project's files, ` +
    `composing its pages, and fetching or generating the images and media the build needs — ` +
    `you will not be asked again for those steps. ` +
    `It does NOT cover publishing or deploying the site, deleting files, pushing code, ` +
    `or anything outside this build — those will still ask for their own approval.`
  );
}
