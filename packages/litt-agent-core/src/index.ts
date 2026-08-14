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
} from "./project.js";

// Tool registry
export { ToolRegistry, createDefaultRegistry } from "./tools.js";

// Command router
export { CommandRouter } from "./router.js";
export type { CommandResult } from "./router.js";

// Runtime state
export { RuntimeStore, createInitialState } from "./state.js";

// Compatibility exports — preserves askLiTTCode/handleLiTTCodeCommand
// for existing callers (cli/src/litt-code-cli.tsx, cli/src/ui/App.tsx).
// New code should use ModelProvider from types.ts instead.
// Marked for removal once cli/ migrates to the canonical core.
export { askLiTTCode, handleLiTTCodeCommand } from "./compat.js";
