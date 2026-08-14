/**
 * @litt/agent-core — Platform-independent LiTT agent core.
 *
 * No React, Next.js, Clerk, Supabase, browser globals, or hardcoded paths.
 * Everything platform-specific is injected through adapters.
 */

// Types
export type {
  ShellResult,
  ShellExecuteOptions,
  ToolResult,
  ToolDefinition,
  ToolCallRequest,
  ToolCallResult,
  ToolHandler,
  ToolContext,
  ToolMetadata,
  ToolEntry,
  ShellExecutor,
  ProjectContext,
  RuntimePhase,
  RuntimeState,
  RuntimeEvent,
  RuntimeEventEmitter,
  HeartbeatStatus,
  ActiveCommand,
  LastResult,
  ModelProfile,
  ChatMessage,
  ModelProvider,
  ModelStreamEvent,
  ModelResult,
  MemoryAdapter,
  MemoryEntry,
  ApprovalLevel,
  ApprovalRequest,
  ApprovalResult,
  ApprovalProvider,
  AuthProvider,
} from "./types.js";

// Shell
export { NodeShellExecutor, createShellExecutor } from "./shell.js";

// Project tools
export {
  detectProjectRoot,
  resolveProjectContext,
  gitStatus,
  gitDiff,
  gitLog,
  gitBranch,
  listFiles,
  readFile,
  searchFiles,
  inspectPackageJson,
  isSafePath,
  runCommand,
  runScript,
  runTypecheck,
  runTest,
  runBuild,
} from "./project.js";

// Tool registry
export { ToolRegistry, createDefaultRegistry } from "./tools.js";

// Command router
export { CommandRouter } from "./router.js";
export type { CommandResult } from "./router.js";

// Runtime state
export { RuntimeStore, createInitialState } from "./state.js";

// Structured execution boundary
export {
  runCommand as runCommandSecure,
  runShellCommand,
  classifyCommand,
  inspectScriptBody,
  resolvePackageScript,
  redactSecrets,
  ExecutionError,
} from "./execution.js";
export type {
  MissionMode,
  RiskLevel,
  RiskAssessment,
  CapabilityTier,
  ExecutionOptions,
  ExecutionErrorCode,
  ApprovalProvider as ExecutionApprovalProvider,
} from "./execution.js";

// ─── Canonical Contracts ──────────────────────────────────────────
// The ONE source of truth for LiTT execution/security vocabulary.
// Other systems (litt-kernel, litt-intelligence, terminal-server) must
// import from here, not duplicate these types.
export * from "./contracts/index.js";

// ─── Compatibility adapters ───────────────────────────────────────
// Map existing types to canonical contracts without breaking callers.
// These aliases let old code continue compiling while new code uses
// the canonical types from ./contracts/.

// MissionMode (execution.ts) → canonical ExecutionMode
export type { ExecutionMode as MissionModeAlias } from "./contracts/identity.js";

// ApprovalLevel (types.ts) → canonical PolicyEffect
// Old: "allow" | "ask" | "deny"
// New: "allow" | "deny" | "require_approval"
// "ask" maps to "require_approval"
export type { PolicyEffect as ApprovalLevelAlias } from "./contracts/policy.js";

// ActionRisk (litt-kernel) → canonical ActionRisk
// Already aligned: "low" | "medium" | "high" | "critical"
export type { ActionRisk as ActionRiskAlias } from "./contracts/policy.js";

// Compatibility exports — preserves askLiTTCode/handleLiTTCodeCommand
// for existing callers (cli/src/litt-code-cli.tsx, cli/src/ui/App.tsx).
// New code should use ModelProvider from types.ts instead.
// Marked for removal once cli/ migrates to the canonical core.
export { askLiTTCode, handleLiTTCodeCommand } from "./compat.js";
