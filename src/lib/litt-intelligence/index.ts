/**
 * LiTT Intelligence Layer — Public API
 *
 * This module is the entry point for the LiTT Intelligence system.
 * It re-exports the public types and scanner functions.
 *
 * The intelligence layer extends (not replaces) the existing LiTT Kernel
 * by providing repository-aware project scanning, structured knowledge,
 * research, evaluation, and tool orchestration.
 */

export * from "./types";
export { scanProject, partialScan } from "./project-scanner";
export type { ScanInput } from "./project-scanner";
