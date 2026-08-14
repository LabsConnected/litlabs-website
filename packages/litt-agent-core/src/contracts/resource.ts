/**
 * Canonical resource budget contracts.
 *
 * Every execution capsule must have a resource budget that enforces:
 *   - wall-clock timeout
 *   - CPU/process constraints (where supported)
 *   - memory limits
 *   - output limits
 *   - token/model budget (when applicable)
 *   - child-process limits
 *
 * This is the ONE canonical source. The existing Docker manager limits
 * (1 CPU, 1GB memory, 100 PIDs) are an implementation of this contract.
 */

// ─── Resource budget ──────────────────────────────────────────────

/**
 * Limits on an execution capsule.
 */
export interface ResourceBudget {
  /** Maximum wall-clock runtime in seconds */
  maxRuntimeSeconds: number;
  /** Maximum number of child processes */
  maxProcesses: number;

  /** Maximum CPU percentage (0-100), if enforceable */
  maxCpuPercent: number | null;
  /** Maximum memory in MB, if enforceable */
  maxMemoryMb: number | null;
  /** Maximum disk usage in MB, if enforceable */
  maxDiskMb: number | null;

  /** Maximum output (stdout + stderr) in bytes */
  maxOutputBytes: number;

  /** Maximum tool calls within this run */
  maxToolCalls: number;
  /** Maximum files changed within this run */
  maxFilesChanged: number;

  /** Maximum cost in USD */
  maxCostUsd: number | null;
  /** Maximum token usage */
  maxTokens: number | null;
}

// ─── Default budgets ──────────────────────────────────────────────

/**
 * Default budget for local workspace operations.
 * Generous enough for development, bounded enough to prevent runaway.
 */
export const LOCAL_WORKSPACE_BUDGET: ResourceBudget = {
  maxRuntimeSeconds: 120,
  maxProcesses: 10,
  maxCpuPercent: null,  // Not enforced on local
  maxMemoryMb: null,    // Not enforced on local
  maxDiskMb: null,      // Not enforced on local
  maxOutputBytes: 2 * 1024 * 1024,  // 2MB
  maxToolCalls: 50,
  maxFilesChanged: 100,
  maxCostUsd: 1.0,
  maxTokens: 100_000,
};

/**
 * Budget for isolated/sandboxed execution.
 * Stricter limits for untrusted or autonomous execution.
 */
export const SANDBOX_BUDGET: ResourceBudget = {
  maxRuntimeSeconds: 60,
  maxProcesses: 5,
  maxCpuPercent: 100,
  maxMemoryMb: 1024,
  maxDiskMb: 512,
  maxOutputBytes: 1024 * 1024,  // 1MB
  maxToolCalls: 20,
  maxFilesChanged: 20,
  maxCostUsd: 0.50,
  maxTokens: 50_000,
};

/**
 * Budget for chat-only runs (no execution).
 * Minimal limits since no tools are called.
 */
export const CHAT_ONLY_BUDGET: ResourceBudget = {
  maxRuntimeSeconds: 30,
  maxProcesses: 0,
  maxCpuPercent: null,
  maxMemoryMb: null,
  maxDiskMb: null,
  maxOutputBytes: 0,
  maxToolCalls: 0,
  maxFilesChanged: 0,
  maxCostUsd: 0.10,
  maxTokens: 10_000,
};

/**
 * Budget for headless/automation runs.
 * Bounded to prevent runaway automations.
 */
export const AUTOMATION_BUDGET: ResourceBudget = {
  maxRuntimeSeconds: 300,
  maxProcesses: 10,
  maxCpuPercent: 100,
  maxMemoryMb: 2048,
  maxDiskMb: 1024,
  maxOutputBytes: 2 * 1024 * 1024,
  maxToolCalls: 100,
  maxFilesChanged: 50,
  maxCostUsd: 5.0,
  maxTokens: 500_000,
};
