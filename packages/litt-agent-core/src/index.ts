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
  StreamChunk,
  ToolStatus,
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
  MissionEventSubtype,
  RuntimeEventType,
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

// Hardened command executor (Phase 3B)
export { CommandExecutor, createCommandExecutor } from "./command-executor.js";
export type { CommandExecutorOptions, CommandExecutorResult } from "./command-executor.js";

// ExecutionGateway — the ONE canonical execution authority (P0 fix)
export { ExecutionGateway, createExecutionGateway } from "./execution-gateway.js";
export type {
  ExecutionGatewayOptions,
  ExecutionRequest,
  ExecutionIdentity,
  GatewayResult,
  GatewayExecutionCapsule,
} from "./execution-gateway.js";

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

// Agent loop — canonical agent execution through the shared runtime
export {
  runAgentLoop,
  parseToolCall,
  stripToolCallBlocks,
  buildDefaultSystemPrompt,
} from "./agent-loop.js";
export type {
  AgentLoopOptions,
  AgentLoopResult,
  AgentToolCallRecord,
  ParsedToolCall,
} from "./agent-loop.js";

// Semantic mission planner — generates a MissionStep[] plan BEFORE tool
// execution and persists it to the canonical RuntimeStore. Tools then
// attach to existing steps via toolHistory/actionHistory/evidence.
// One step may cover many tool calls; one tool may serve many steps.
export {
  planMission,
  parseSemanticPlan,
  fallbackPlan,
  resolveStepForTool,
  attachToolToStep,
} from "./mission-planner.js";
export type {
  SemanticStepSpec,
  SemanticPlan,
  PlanMissionOptions,
  PlanMissionResult,
} from "./mission-planner.js";

// VerificationGate — the runtime truth boundary (COMPLETE = runtime proved it)
export { VerificationGate, createVerificationGate, assertComplete } from "./verification-gate.js";
export type {
  VerificationCheckId,
  VerificationConfig,
  CheckResult,
  VerificationResult,
  BrowserVerifier,
  VerificationGateOptions,
} from "./verification-gate.js";

// ─── Missions Module (Autopilot V1) ─────────────────────────────────────
// Mission domain types, state machine, and persistence.
// Wraps and orchestrates existing ExecutionGateway/ToolRegistry/RuntimeStore.
export {
  MissionStore,
  createMissionStore,
  isValidMissionTransition,
  isValidStepTransition,
  validateMissionTransition,
  validateStepTransition,
  generateMissionId,
  generateStepId,
  generateEvidenceId,
  generateCheckpointId,
  createDefaultRetryBudget,
  deriveStepStatus,
  deriveMissionStatus,
} from "./missions/index.js";
export type {
  MissionStatus,
  MissionStepStatus,
  EvidenceType,
  Mission,
  MissionStep,
  RepositoryBaseline,
  MissionEvidence,
  Checkpoint,
  ActionRecord,
  VerificationResult as MissionVerificationResult,
  RetryBudget,
  ProviderFailure,
  ProviderState,
  TransitionResult,
} from "./missions/index.js";
export type { Mission as MissionModel } from "./missions/index.js";
