/**
 * LiTT Intelligence Layer — Public API
 *
 * This module is the entry point for the LiTT Intelligence system.
 * It re-exports the public types, scanner, and knowledge service.
 *
 * The intelligence layer extends (not replaces) the existing LiTT Kernel
 * by providing repository-aware project scanning, structured knowledge,
 * research, evaluation, and tool orchestration.
 */

export * from "./types";
export { scanProject, partialScan } from "./project-scanner";
export type { ScanInput } from "./project-scanner";
export { KnowledgeService } from "./knowledge-service";
export type { StoreKnowledgeInput } from "./knowledge-service";
export { ResearchEngine, createResearchEngine } from "./research-engine";
export type { ResearchProvider, ResearchResult } from "./research-engine";
export { planResearchQuery } from "./research-engine";
export {
  GitHubSearchProvider,
  WebSearchProvider,
  PackageRegistryProvider,
  OpenAPIDirectoryProvider,
} from "./research-providers";
export { BrowserbaseResearchProvider, getBrowserbaseProvider } from "./browserbase-provider";
export { CandidateEvaluator, EVALUATION_DIMENSIONS } from "./evaluator";
export type { CandidateInput, EvaluationDimension } from "./evaluator";
export { toolRegistry, registerInternalTools } from "./tool-registry";
export { MCPAdapter } from "./mcp-adapter";
export type { MCPServerConfig } from "./mcp-adapter";
export { OpenAPIAdapter } from "./openapi-adapter";
export { executeWebIntelligence, detectWebIntelligenceIntent } from "./web-intelligence";
export type { WebIntelligenceOperation, WebIntelligenceRequest, WebIntelligenceResult } from "./web-intelligence";
export { getSourceRegistry, SourceRegistry } from "./source-registry";
export type { WebSource, WebSourceType, ConfidenceLevel, WebSourceClaim } from "./source-registry";

export { ActionPlanner, ActionExecutor, verifyStepResult, verifyPlanCompletion } from "./action-loop";
export type { ExecutionEvent } from "./action-loop";
