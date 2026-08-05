/**
 * Braintrust evaluation integration for LiTTree Lab Studios.
 *
 * This module wires the unified LLM client (src/lib/llm.ts) into Braintrust
 * so every agent response is logged with full context (agent slug, mode,
 * provider, model, prompt, system prompt, latency, failover chain) and can
 * be scored against project-specific evals.
 *
 * Eval dimensions (aligned with TRUTH_RULES + ANTI-BOILERPLATE RULES):
 *   - truthfulness       — does the response avoid unsupported claims?
 *   - grounding           — does it cite basis / state data coverage?
 *   - anti-boilerplate    — no template code, placeholder text, or Lorem Ipsum?
 *   - tool-call-accuracy  — if a tool was invoked, was it correct?
 *   - helpfulness         — did it answer the actual question?
 *
 * Env:
 *   BT_API_KEY — Braintrust API key (get from `bt login` or app.braintrust.dev)
 *
 * If BT_API_KEY is not set, all functions are no-ops — production safety.
 * The module is server-only (uses the braintrust SDK which needs Node).
 */
import "server-only";

import { initLogger } from "braintrust";

/* ------------------------------------------------------------------ */
/*  Lazy singleton logger                                              */
/* ------------------------------------------------------------------ */
// We use ReturnType<typeof initLogger> to avoid generic parameter issues
// with the Logger class type.
type BTLogger = ReturnType<typeof initLogger>;

let _logger: BTLogger | null = null;
let _initAttempted = false;

function getLogger(): BTLogger | null {
  if (_initAttempted) return _logger;
  _initAttempted = true;

  const apiKey = process.env.BT_API_KEY;
  if (!apiKey) return null;

  try {
    _logger = initLogger({
      apiKey,
      projectName: "litlabs-website",
    });
  } catch {
    // Fail silently — evals must never break production LLM calls
    _logger = null;
  }
  return _logger;
}

/* ------------------------------------------------------------------ */
/*  Span metadata types                                                */
/* ------------------------------------------------------------------ */
export interface LLMCallMetadata {
  /** Agent slug (e.g. "litt", "spark", "nova") or "unknown". */
  agentSlug?: string;
  /** LiTT mode if applicable (standard, builder, research, spark). */
  agentMode?: string;
  /** Conversation ID for traceability. */
  conversationId?: string;
  /** User ID (Clerk). */
  userId?: string;
  /** Project ID if scoped to a project. */
  projectId?: string;
  /** Mission ID if part of a mission. */
  missionId?: string;
  /** Tool that was detected and executed, if any. */
  executedTool?: string;
  /** Whether the tool execution succeeded. */
  toolSuccess?: boolean;
}

export interface LLMCallRecord {
  prompt: string;
  systemPrompt?: string;
  output: string;
  provider: string;
  model: string;
  latencyMs: number;
  failover: string[];
  usage?: { prompt: number; completion: number; total: number };
  error?: string;
  metadata: LLMCallMetadata;
}

/* ------------------------------------------------------------------ */
/*  Log a completed LLM call                                           */
/* ------------------------------------------------------------------ */
export function logLLMCall(record: LLMCallRecord): void {
  const logger = getLogger();
  if (!logger) return;

  try {
    logger.log({
      input: {
        prompt: record.prompt,
        systemPrompt: record.systemPrompt,
      },
      output: record.output,
      metadata: {
        provider: record.provider,
        model: record.model,
        latencyMs: record.latencyMs,
        failover: record.failover,
        usage: record.usage,
        error: record.error,
        ...record.metadata,
      },
      // Tag with agent + mode for filtering in the Braintrust UI
      tags: [
        record.metadata.agentSlug ?? "unknown",
        record.metadata.agentMode ?? "default",
      ].filter(Boolean),
    });
  } catch {
    // Never let eval logging break the actual LLM call
  }
}

/* ------------------------------------------------------------------ */
/*  Log a streaming LLM call (chunks accumulated)                      */
/* ------------------------------------------------------------------ */
export function logStreamCall(
  record: Omit<LLMCallRecord, "output"> & { output: string },
): void {
  logLLMCall(record);
}

/* ------------------------------------------------------------------ */
/*  Check if Braintrust is configured                                  */
/* ------------------------------------------------------------------ */
export function isBraintrustConfigured(): boolean {
  return !!process.env.BT_API_KEY;
}

/* ------------------------------------------------------------------ */
/*  Eval definitions (for offline eval runs via `bt` CLI)              */
/* ------------------------------------------------------------------ */
/**
 * These eval definitions are used when running offline evaluation
 * datasets through the Braintruth CLI. They are not executed inline
 * with production calls — production calls are only logged.
 *
 * To run evals:
 *   1. Export a dataset of (prompt, expected) pairs
 *   2. Run: bt eval scripts/braintrust-evals.ts
 *
 * The scorers below use LLM-as-judge for subjective dimensions and
 * deterministic checks for structural ones.
 */
export const EVAL_DIMENSIONS = [
  {
    name: "truthfulness",
    description:
      "Does the response avoid unsupported factual claims? Does it cite basis or say 'I don't know' when uncertain?",
    type: "llm-judge",
  },
  {
    name: "grounding",
    description:
      "When asked about project status, does it report exact values (repo, branch, terminal state) rather than vague summaries?",
    type: "llm-judge",
  },
  {
    name: "anti-boilerplate",
    description:
      "No template code, placeholder text, 'Your App Name', 'Lorem Ipsum', or generic pricing?",
    type: "deterministic",
    check: (output: string) => {
      const boilerplatePatterns = [
        /your app name/i,
        /lorem ipsum/i,
        /placeholder text/i,
        /todo:\s*implement/i,
        /function\s+foo\s*\(/i,
        /console\.log\(["']hello/i,
      ];
      const violations = boilerplatePatterns.filter((p) => p.test(output));
      return violations.length === 0 ? 1 : 0;
    },
  },
  {
    name: "tool-call-accuracy",
    description:
      "If a tool was invoked, was it the correct tool for the intent? Did it succeed?",
    type: "metadata",
    extract: (metadata: LLMCallMetadata) => {
      if (!metadata.executedTool) return null; // no tool called — N/A
      return metadata.toolSuccess ? 1 : 0;
    },
  },
  {
    name: "helpfulness",
    description:
      "Did the response answer the actual question or just give generic advice?",
    type: "llm-judge",
  },
  {
    name: "latency",
    description: "Response latency in ms (lower is better, scored as bucketed).",
    type: "metadata",
    extract: (_metadata: LLMCallMetadata, latencyMs?: number) => {
      if (!latencyMs) return null;
      if (latencyMs < 2000) return 1;
      if (latencyMs < 5000) return 0.75;
      if (latencyMs < 10000) return 0.5;
      return 0.25;
    },
  },
] as const;
