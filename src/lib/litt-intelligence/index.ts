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
export { ResearchEngine } from "./research-engine";
export type { ResearchProvider, ResearchResult } from "./research-engine";
export { planResearchQuery } from "./research-engine";
export {
  GitHubSearchProvider,
  WebSearchProvider,
  PackageRegistryProvider,
  OpenAPIDirectoryProvider,
} from "./research-providers";
