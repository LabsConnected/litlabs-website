/**
 * LiTT Runtime — Public API
 *
 * Import from here, not from individual modules:
 *   import { runLiTT, runLiTTStream } from "@/lib/litt-runtime";
 */

export { runLiTT, runLiTTStream, type RunLiTTOptions, type RunLiTTOutcome } from "./runtime";
export { resolveRequestContext, parseRuntimeContextHint, buildRunContextFromStudio, HISTORY_LIMIT } from "./request-context";
export { selectModelOptions, resolveGeminiVisionModel } from "./provider-router";
export { buildPrompt, sanitizeOutput } from "./prompt-builder";
export { buildToolPlan, type ToolPlan } from "./tool-planner";
export { executeRun, executeRunStream, type ExecutionResult } from "./execution-engine";
export { verifyResult, type VerifiedResult } from "./result-verifier";
export { auditRun, logLegacyAgentChat, type AuditRunEvent } from "./audit-service";
export { detectActions, createLiTTStream, buildSseHeaders } from "./response-stream";
export type {
  LiTTRunRequest,
  LiTTRunResult,
  LiTTMode,
  AttachmentInput,
  HistoryEntry,
  PageContextHint,
  ResolvedRunContext,
  BuiltPrompt,
} from "./types";
