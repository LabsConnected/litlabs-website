/**
 * LiTT Intelligence Layer — Type Definitions
 *
 * These types define the canonical structures for project intelligence,
 * structured knowledge, research findings, candidate evaluation, tool
 * definitions, action plans, and approval policies.
 *
 * They extend (not replace) the existing LiTT Kernel types in
 * src/lib/litt-kernel/types.ts.
 */

// ─── Project Intelligence Snapshot ──────────────────────────────

export interface ProjectComponent {
  id: string;
  type: string;
  path: string;
  name: string;
  description?: string;
  confidence: number;
  sourcePaths: string[];
}

export interface VerifiedCapability {
  id: string;
  category: string;
  state: "ready" | "offline" | "connecting" | "limited" | "unavailable" | "unknown";
  verifiedAt: string;
  source: string;
  evidence: string;
  confidence: number;
}

export interface DependencyRecord {
  name: string;
  version: string;
  type: "production" | "development" | "peer" | "optional";
  source: string;
  license?: string;
  deprecated?: boolean;
}

export interface TestInventory {
  framework: string | null;
  testFiles: string[];
  testCount: number;
  configPath: string | null;
  coverage: boolean;
}

export interface ProjectRisk {
  id: string;
  severity: "low" | "medium" | "high" | "critical";
  description: string;
  sourcePath: string;
  detectedAt: string;
}

export interface OpenWorkItem {
  id: string;
  type: "pr" | "issue" | "branch" | "todo";
  title: string;
  state: string;
  url?: string;
  updatedAt?: string;
}

export interface ProjectIntelligenceSnapshot {
  projectId: string;
  repository?: {
    provider: "github";
    owner: string;
    name: string;
    defaultBranch: string;
    headSha: string;
  };
  stack: {
    languages: string[];
    frameworks: string[];
    runtimes: string[];
    packageManagers: string[];
    databases: string[];
    deploymentTargets: string[];
  };
  architecture: {
    entryPoints: ProjectComponent[];
    services: ProjectComponent[];
    APIs: ProjectComponent[];
    dataStores: ProjectComponent[];
    integrations: ProjectComponent[];
    tools: ProjectComponent[];
  };
  capabilities: VerifiedCapability[];
  dependencies: DependencyRecord[];
  tests: TestInventory;
  risks: ProjectRisk[];
  openWork: OpenWorkItem[];
  scannedAt: string;
  sourceRevision: string;
  stale: boolean;
}

// ─── Structured Knowledge ───────────────────────────────────────

export type KnowledgeCategory =
  | "architecture_fact"
  | "dependency_fact"
  | "integration_fact"
  | "capability_fact"
  | "decision"
  | "constraint"
  | "user_preference"
  | "known_issue"
  | "failed_attempt"
  | "successful_pattern"
  | "research_finding"
  | "security_risk"
  | "release_state"
  | "open_question";

export type VerificationStatus = "verified" | "unverified" | "superseded" | "stale";

export interface KnowledgeRecord {
  id: string;
  ownerId: string;
  projectId: string;
  category: KnowledgeCategory;
  content: string;
  sourceType: "repository" | "probe" | "research" | "conversation" | "manual";
  sourceReference: string;
  sourceRevision?: string;
  confidence: number;
  verificationStatus: VerificationStatus;
  expiresAt?: string;
  supersededBy?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

// ─── Research Types ─────────────────────────────────────────────

export interface ResearchQuery {
  id: string;
  text: string;
  subqueries: string[];
  intent: string;
  constraints: string[];
}

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  sourceType: string;
  snippet: string;
  relevanceScore: number;
  retrievedAt: string;
}

export interface ResearchSource {
  url: string;
  sourceType: string;
  title?: string;
}

export interface FetchedSource {
  url: string;
  title: string;
  content: string;
  contentType: string;
  fetchedAt: string;
  statusCode: number;
}

export interface VerificationResult {
  source: FetchedSource;
  verified: boolean;
  checks: VerificationCheck[];
  warnings: string[];
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  detail: string;
}

// ─── Candidate Evaluation ───────────────────────────────────────

export interface CandidateEvaluation {
  candidateId: string;
  name: string;
  type: "open_source" | "api" | "self_hosted" | "internal" | "postpone" | "reject";
  scores: EvaluationScore[];
  overallScore: number;
  evidence: string[];
}

export interface EvaluationScore {
  dimension: string;
  score: number;
  evidence: string;
}

export interface IntegrationPlan {
  approach: string;
  steps: string[];
  filesToCreate: string[];
  filesToModify: string[];
  dependencies: string[];
  estimatedEffort: string;
  rollbackPlan: string;
}

export interface IntegrationRecommendation {
  problem: string;
  projectConstraints: string[];
  candidates: CandidateEvaluation[];
  recommendation: {
    candidateId: string;
    reason: string;
    confidence: number;
  };
  rejectedCandidates: Array<{
    candidateId: string;
    reason: string;
  }>;
  proposedIntegration: IntegrationPlan;
  risks: string[];
  approvalRequired: boolean;
}

// ─── Tool Registry ──────────────────────────────────────────────

export type ToolSource = "internal" | "mcp" | "openapi" | "connector";
export type ToolRisk = "none" | "low" | "medium" | "high" | "critical";

/**
 * Tool permission levels — controls who can use a tool and whether
 * approval is required. Higher levels require explicit approval.
 *
 *   read             — search files, inspect repository (no approval)
 *   draft            — draft code, message, image (usually no approval)
 *   workspace-write  — edit project files (sometimes approval)
 *   external-write   — send email, create issue (always approval)
 *   production       — deploy, push, delete data (always approval)
 *   financial        — purchase or change billing (always approval)
 *   destructive      — irreversible destructive operations (always approval)
 */
export type ToolPermissionLevel =
  | "read"
  | "draft"
  | "workspace-write"
  | "external-write"
  | "production"
  | "financial"
  | "destructive";

/**
 * Permission levels that always require explicit approval.
 */
export const APPROVAL_REQUIRED_LEVELS: ReadonlySet<ToolPermissionLevel> = new Set([
  "external-write",
  "production",
  "financial",
  "destructive",
]);

/**
 * Returns true if a tool permission level requires explicit approval.
 */
export function requiresApproval(level: ToolPermissionLevel): boolean {
  return APPROVAL_REQUIRED_LEVELS.has(level);
}

export interface ApprovalPolicy {
  required: boolean;
  autoApproveReadOnly: boolean;
  requireExplicitForMutations: boolean;
  neverAllow: boolean;
}

export interface LiTTToolDefinition {
  id: string;
  name: string;
  description: string;
  source: ToolSource;
  version: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  requiredCapabilities: string[];
  requiredPermissions: string[];
  risk: ToolRisk;
  /** Permission level controls approval requirements. */
  permissionLevel: ToolPermissionLevel;
  approvalPolicy: ApprovalPolicy;
  timeoutMs: number;
  idempotent: boolean;
  readOnly: boolean;
  enabled: boolean;
}

// ─── Action Loop ────────────────────────────────────────────────

export type ActionPhase =
  | "understand"
  | "scan"
  | "research"
  | "plan"
  | "awaiting_approval"
  | "executing"
  | "observing"
  | "verifying"
  | "repairing"
  | "completed"
  | "failed"
  | "cancelled";

export interface Assumption {
  id: string;
  text: string;
  confidence: number;
  verificationRequired: boolean;
}

export interface LiTTActionStep {
  id: string;
  toolId: string;
  inputs: Record<string, unknown>;
  expectedOutput: string;
  requiredCapability: string;
  risk: ToolRisk;
  approvalStatus: "pending" | "approved" | "denied" | "not_required";
  rollbackAction: string;
  verificationAction: string;
  dependencies: string[];
  maxAttempts: number;
  actualOutput?: string;
  actualStatus?: "pending" | "success" | "failed" | "skipped";
  attempts?: number;
}

export interface LiTTActionPlan {
  id: string;
  userId: string;
  projectId: string;
  goal: string;
  assumptions: Assumption[];
  steps: LiTTActionStep[];
  risk: "low" | "medium" | "high" | "critical";
  approvalRequired: boolean;
  createdAt: string;
  phase: ActionPhase;
}

// ─── Scan Tier ──────────────────────────────────────────────────

export type ScanTier = 0 | 1 | 2 | 3 | 4;
