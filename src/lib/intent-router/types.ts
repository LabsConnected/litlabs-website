export type LiTTIntent =
  | "code"
  | "website"
  | "image"
  | "video"
  | "music"
  | "design"
  | "game"
  | "deploy"
  | "debug"
  | "research"
  | "agent_task"
  | "project_action"
  | "mixed";

export type ActionVerb =
  | "create"
  | "edit"
  | "fix"
  | "continue"
  | "analyze"
  | "generate"
  | "deploy"
  | "publish";

export type ApprovalPolicy =
  | "none"
  | "before_execution"
  | "before_external_write"
  | "before_destructive_action"
  | "before_publish";

export type StepType =
  | "create_project"
  | "inspect_project"
  | "generate_brand_direction"
  | "generate_image"
  | "generate_music"
  | "generate_video"
  | "edit_code"
  | "build_project"
  | "run_tests"
  | "attach_assets"
  | "create_preview"
  | "deploy_project"
  | "publish_project";

export type RunCondition =
  | { type: "all_dependencies_succeeded" }
  | { type: "always" }
  | { type: "expression"; expression: string };

export type InputBinding =
  | { source: "literal"; value: unknown }
  | { source: "step_output"; stepKey: string; output: string };

export interface ArtifactRef {
  id: string;
  kind: "file" | "image" | "audio" | "video" | "code" | "deployment" | "data";
  uri?: string;
}

export interface ExecutionPolicy {
  timeoutMs: number;
  maxAttempts: number;
  heartbeatMs?: number;
  leaseTimeoutMs?: number;
  idempotency: "required" | "best_effort";
}

export interface RouterStep {
  id: string;
  key: string;
  type: StepType;
  intent: LiTTIntent;
  dependsOn: string[];
  inputs: Record<string, InputBinding>;
  outputs: Record<string, ArtifactRef["kind"]>;
  approval: ApprovalPolicy;
  retryable: boolean;
  condition?: RunCondition;
  executionPolicy: ExecutionPolicy;
}

export interface ExecutionPlan {
  id: string;
  schemaVersion: "1.0";
  prompt: string;
  primaryIntent: LiTTIntent;
  steps: RouterStep[];
  createdAt: string;
}

export type RunStatus =
  | "queued"
  | "preparing"
  | "running"
  | "waiting_approval"
  | "complete"
  | "failed"
  | "stalled"
  | "cancelled"
  | "skipped";

export interface ExecutionError {
  code: string;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>;
}

export interface StepExecutionState {
  stepId: string;
  status: Exclude<RunStatus, "preparing" | "stalled">;
  attempt: number;
  startedAt?: string;
  completedAt?: string;
  heartbeatAt?: string;
  error?: ExecutionError;
  outputs?: ArtifactRef[];
}

export interface ExecutionState {
  planId: string;
  status: RunStatus;
  updatedAt: string;
  leaseExpiresAt?: string;
  error?: ExecutionError;
  steps: Record<string, StepExecutionState>;
}

export interface RouterContext {
  activeProjectId?: string;
  selectedAssetId?: string;
  openFiles?: string[];
  deploymentState?: "deployed" | "pending" | "failed" | "none";
  recentIntents?: LiTTIntent[];
}

export interface RouterInput {
  prompt: string;
  context: RouterContext;
}

export interface ClarificationRequest {
  question: string;
  options?: string[];
}

export interface IntentRouterResult {
  schemaVersion: "1.1";
  primaryIntent: LiTTIntent;
  secondaryIntents: LiTTIntent[];
  confidence: number;
  ambiguity: "none" | "low" | "material";
  consequence: "reversible" | "external_write" | "destructive";
  action: ActionVerb;
  goals: string[];
  target?: { projectId?: string; assetId?: string; filePath?: string; deploymentId?: string };
  requirements: {
    needsProject: boolean;
    needsFiles: boolean;
    needsApproval: boolean;
    needsExternalService: boolean;
  };
}

export type RouterOutput =
  | { type: "intent"; result: IntentRouterResult }
  | { type: "clarification"; request: ClarificationRequest };
