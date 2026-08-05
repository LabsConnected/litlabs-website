/**
 * Prometheus metrics for litlabs.net application.
 *
 * Exposes counters and histograms for:
 *   - LLM calls (by provider, model, task, status)
 *   - LLM latency (histogram by provider)
 *   - Token usage (by provider, model)
 *   - Agent runs (by agent slug, mode, status)
 *   - Eval scores (by dimension, agent)
 *   - HTTP request duration (by route, method, status)
 *   - Build/deploy status gauges
 *
 * Scraped by Alloy at http://localhost:3000/metrics and forwarded
 * to Grafana Cloud alongside Windows host metrics.
 */
import "server-only";
import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

// ─── Registry ──────────────────────────────────────────────────────
export const registry = new Registry();

// Collect Node.js default metrics (GC, event loop, memory, etc.)
collectDefaultMetrics({ register: registry });

// ─── LLM Metrics ───────────────────────────────────────────────────
export const llmCallsTotal = new Counter({
  name: "litlabs_llm_calls_total",
  help: "Total LLM calls by provider, model, task, and status",
  labelNames: ["provider", "model", "task", "status"] as const,
  registers: [registry],
});

export const llmLatencySeconds = new Histogram({
  name: "litlabs_llm_latency_seconds",
  help: "LLM call latency in seconds by provider",
  labelNames: ["provider", "model", "task"] as const,
  buckets: [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

export const llmTokensTotal = new Counter({
  name: "litlabs_llm_tokens_total",
  help: "Total tokens consumed by provider, model, and type (prompt/completion)",
  labelNames: ["provider", "model", "type"] as const,
  registers: [registry],
});

export const llmFailoverTotal = new Counter({
  name: "litlabs_llm_failover_total",
  help: "Total LLM provider failovers by from_provider",
  labelNames: ["from_provider"] as const,
  registers: [registry],
});

// ─── Agent Metrics ─────────────────────────────────────────────────
export const agentRunsTotal = new Counter({
  name: "litlabs_agent_runs_total",
  help: "Total agent runs by slug, mode, and status",
  labelNames: ["agent", "mode", "status"] as const,
  registers: [registry],
});

export const agentRunDurationSeconds = new Histogram({
  name: "litlabs_agent_run_duration_seconds",
  help: "Agent run duration in seconds by slug",
  labelNames: ["agent", "mode"] as const,
  buckets: [0.5, 1, 5, 10, 30, 60, 120, 300, 600],
  registers: [registry],
});

// ─── Eval Metrics ──────────────────────────────────────────────────
export const evalScores = new Gauge({
  name: "litlabs_eval_score",
  help: "Latest eval score by dimension and agent (0-1)",
  labelNames: ["dimension", "agent"] as const,
  registers: [registry],
});

export const evalRunsTotal = new Counter({
  name: "litlabs_eval_runs_total",
  help: "Total eval runs by dimension and agent",
  labelNames: ["dimension", "agent"] as const,
  registers: [registry],
});

// ─── HTTP / API Metrics ────────────────────────────────────────────
export const httpRequestTotal = new Counter({
  name: "litlabs_http_requests_total",
  help: "Total HTTP requests by method, route, and status",
  labelNames: ["method", "route", "status"] as const,
  registers: [registry],
});

export const httpRequestDurationSeconds = new Histogram({
  name: "litlabs_http_request_duration_seconds",
  help: "HTTP request duration in seconds by route",
  labelNames: ["method", "route", "status"] as const,
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// ─── Build / Deploy Metrics ────────────────────────────────────────
export const buildStatus = new Gauge({
  name: "litlabs_build_status",
  help: "Build status: 1=success, 0=failed, -1=in_progress",
  labelNames: ["branch", "commit"] as const,
  registers: [registry],
});

export const buildDurationSeconds = new Gauge({
  name: "litlabs_build_duration_seconds",
  help: "Last build duration in seconds by branch",
  labelNames: ["branch"] as const,
  registers: [registry],
});

export const deployStatus = new Gauge({
  name: "litlabs_deploy_status",
  help: "Deploy status: 1=success, 0=failed, -1=in_progress",
  labelNames: ["environment"] as const,
  registers: [registry],
});

// ─── Visual Build Metrics ──────────────────────────────────────────
export const visualBuildsTotal = new Counter({
  name: "litlabs_visual_builds_total",
  help: "Total visual builds by stage and status",
  labelNames: ["stage", "status"] as const,
  registers: [registry],
});

export const visualBuildDurationSeconds = new Histogram({
  name: "litlabs_visual_build_duration_seconds",
  help: "Visual build duration in seconds by stage",
  labelNames: ["stage"] as const,
  buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1200],
  registers: [registry],
});

// ─── API Resilience Metrics ────────────────────────────────────────
export const apiRetriesTotal = new Counter({
  name: "litlabs_api_retries_total",
  help: "Total API retries by status code and outcome (recovered/exhausted)",
  labelNames: ["status_code", "outcome"] as const,
  registers: [registry],
});

export const apiErrorsTotal = new Counter({
  name: "litlabs_api_errors_total",
  help: "Total API errors by type (timeout/network/http/html)",
  labelNames: ["type", "status_code"] as const,
  registers: [registry],
});

export const apiRetryLatencySeconds = new Histogram({
  name: "litlabs_api_retry_latency_seconds",
  help: "Total time spent in apiFetch including retries",
  labelNames: ["endpoint"] as const,
  buckets: [0.1, 0.5, 1, 2.5, 5, 10, 30, 60],
  registers: [registry],
});

// ─── Helpers ───────────────────────────────────────────────────────

/**
 * Record an LLM call — call this after every generateText/streamText
 * completes (success or failure).
 */
export function recordLLMCall(params: {
  provider: string;
  model: string;
  task: string;
  status: "success" | "error";
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
  failoverFrom?: string[];
}): void {
  const { provider, model, task, status, latencyMs, promptTokens, completionTokens, failoverFrom } = params;

  llmCallsTotal.labels({ provider, model, task, status }).inc();
  llmLatencySeconds.labels({ provider, model, task }).observe(latencyMs / 1000);

  if (promptTokens) {
    llmTokensTotal.labels({ provider, model, type: "prompt" }).inc(promptTokens);
  }
  if (completionTokens) {
    llmTokensTotal.labels({ provider, model, type: "completion" }).inc(completionTokens);
  }
  if (failoverFrom) {
    for (const fp of failoverFrom) {
      llmFailoverTotal.labels({ from_provider: fp }).inc();
    }
  }
}

/**
 * Record an agent run.
 */
export function recordAgentRun(params: {
  agent: string;
  mode: string;
  status: "success" | "error" | "timeout";
  durationMs: number;
}): void {
  const { agent, mode, status, durationMs } = params;
  agentRunsTotal.labels({ agent, mode, status }).inc();
  agentRunDurationSeconds.labels({ agent, mode }).observe(durationMs / 1000);
}

/**
 * Record an eval score.
 */
export function recordEvalScore(params: {
  dimension: string;
  agent: string;
  score: number;
}): void {
  const { dimension, agent, score } = params;
  evalScores.labels({ dimension, agent }).set(score);
  evalRunsTotal.labels({ dimension, agent }).inc();
}

/**
 * Record an API retry event (from apiFetch).
 */
export function recordApiRetry(params: {
  statusCode: number;
  recovered: boolean;
}): void {
  const { statusCode, recovered } = params;
  apiRetriesTotal
    .labels({ status_code: String(statusCode), outcome: recovered ? "recovered" : "exhausted" })
    .inc();
}

/**
 * Record an API error (from apiFetch).
 */
export function recordApiError(params: {
  type: "timeout" | "network" | "http" | "html";
  statusCode?: number;
}): void {
  const { type, statusCode } = params;
  apiErrorsTotal
    .labels({ type, status_code: String(statusCode ?? 0) })
    .inc();
}

/**
 * Get the metrics registry content for the /metrics endpoint.
 */
export async function getMetrics(): Promise<string> {
  return registry.metrics();
}
