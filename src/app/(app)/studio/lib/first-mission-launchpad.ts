import type { ProjectRuntimeState } from "@/lib/projects/runtime-state";
import type { ProviderHealth } from "../stores/useStudioModelStore";

export const FIRST_INSPECTION_PROMPT = [
  "Perform a read-only inspection of this project.",
  "Do not edit or change files, install dependencies, deploy, or run commands with side effects.",
  "Identify the project structure, detected stack, available scripts, and current workspace or git state using read-only tools only.",
  "Summarize what you verified and cite the file or tool evidence for each finding.",
].join(" ");

export type FirstMissionLaunchpadKey =
  | "checking"
  | "blocked"
  | "no_project"
  | "workspace_missing"
  | "workspace_preparing"
  | "workspace_failed"
  | "provider_unavailable"
  | "terminal_disconnected"
  | "verified"
  | "inspection_running"
  | "inspection_failed"
  | "inspection_cancelled"
  | "inspection_incomplete"
  | "inspection_proven";

export type FirstMissionActionId =
  | "start_blank_project"
  | "prepare_workspace"
  | "retry_workspace"
  | "configure_provider"
  | "connect_terminal"
  | "prepare_inspection";

export interface FirstMissionPrimaryAction {
  id: FirstMissionActionId;
  label: string;
  disabled: boolean;
  disabledReason?: string;
}

export interface FirstMissionFact {
  label: "Project" | "Workspace" | "AI provider" | "Terminal" | "Deployment";
  status: "verified" | "pending" | "unavailable" | "not_started";
  detail: string;
}

export interface FirstMissionLaunchpadState {
  key: FirstMissionLaunchpadKey;
  eyebrow: string;
  title: string;
  description: string;
  facts: FirstMissionFact[];
  primaryAction: FirstMissionPrimaryAction | null;
  mutationActionsAllowed: boolean;
  inspectionEvidence: FirstMissionToolResult[];
}

export interface FirstMissionToolResult {
  toolId: string;
  success?: boolean;
  summary?: string;
}

export interface FirstMissionInspectionState {
  status: "running" | "completed" | "failed" | "cancelled";
  toolResults: FirstMissionToolResult[];
  persistedAssistantResponse: boolean;
}

export interface FirstMissionLaunchpadInput {
  runtime: ProjectRuntimeState;
  runtimeLoading: boolean;
  runtimeError?: string | null;
  providerHealth?: ProviderHealth;
  inspection?: FirstMissionInspectionState;
}

const READ_ONLY_INSPECTION_TOOLS = new Set([
  "get_active_project",
  "git_status",
  "inspect_project_files",
  "list_files",
  "read_file",
  "search_code",
]);

export function isSuccessfulReadOnlyInspectionTool(result: FirstMissionToolResult): boolean {
  return result.success === true && READ_ONLY_INSPECTION_TOOLS.has(result.toolId);
}

function fact(
  label: FirstMissionFact["label"],
  status: FirstMissionFact["status"],
  detail: string,
): FirstMissionFact {
  return { label, status, detail };
}

function factsFor(runtime: ProjectRuntimeState, providerHealth?: ProviderHealth): FirstMissionFact[] {
  const hasProject = Boolean(runtime.projectId);
  const workspaceReady = runtime.workspaceProvisioned && runtime.workspaceStatus === "ready";
  const providerAvailable = providerHealth === "available" || providerHealth === "degraded";

  return [
    fact(
      "Project",
      hasProject ? "verified" : "not_started",
      hasProject ? runtime.projectName ?? "Project selected" : "No project selected",
    ),
    fact(
      "Workspace",
      workspaceReady
        ? "verified"
        : runtime.workspaceStatus && runtime.workspaceStatus !== "failed" && runtime.workspaceStatus !== "error"
          ? "pending"
          : "unavailable",
      workspaceReady
        ? "Verified ready"
        : runtime.workspaceStatus
          ? `Status: ${runtime.workspaceStatus}`
          : "Not prepared",
    ),
    fact(
      "AI provider",
      providerHealth === undefined
        ? "pending"
        : providerAvailable
          ? "verified"
          : "unavailable",
      providerHealth === undefined
        ? "Checking provider"
        : providerAvailable
          ? providerHealth === "degraded" ? "Available with limitations" : "Available"
          : "Configuration required",
    ),
    fact(
      "Terminal",
      runtime.terminalConnected && runtime.executionAvailable ? "verified" : "unavailable",
      runtime.terminalConnected && runtime.executionAvailable
        ? "Verified connection"
        : "No verified execution session",
    ),
    fact("Deployment", "not_started", "Not checked by the first mission"),
  ];
}

function action(id: FirstMissionActionId, label: string): FirstMissionPrimaryAction {
  return { id, label, disabled: false };
}

function isWorkspaceFailure(runtime: ProjectRuntimeState): boolean {
  const status = runtime.workspaceStatus?.toLowerCase();
  return runtime.phase === "error"
    || status === "failed"
    || status === "error";
}

export function deriveFirstMissionLaunchpadState(
  input: FirstMissionLaunchpadInput,
): FirstMissionLaunchpadState {
  const { runtime, runtimeLoading, runtimeError, providerHealth } = input;
  const facts = factsFor(runtime, providerHealth);
  const blocked = { mutationActionsAllowed: false, inspectionEvidence: [] };

  if (runtimeLoading || runtime.phase === "resolving" || providerHealth === undefined) {
    return {
      key: "checking",
      eyebrow: "Checking prerequisites",
      title: "Verifying your first mission path",
      description: "LiTT is checking project, workspace, provider, and terminal evidence before enabling an action.",
      facts,
      primaryAction: null,
      ...blocked,
    };
  }

  if (runtime.phase === "unauthenticated") {
    return {
      key: "blocked",
      eyebrow: "Sign-in required",
      title: "Studio cannot verify this session",
      description: "Sign in again before starting a project or mission.",
      facts,
      primaryAction: null,
      ...blocked,
    };
  }

  if (runtimeError) {
    return {
      key: "blocked",
      eyebrow: "Verification unavailable",
      title: "Runtime status could not be verified",
      description: runtimeError,
      facts,
      primaryAction: null,
      ...blocked,
    };
  }

  if (!runtime.projectId || runtime.phase === "idle") {
    return {
      key: "no_project",
      eyebrow: "No project selected",
      title: "Start with a blank project",
      description: "A project is required before LiTT can verify a workspace, terminal, preview, or deployment path.",
      facts,
      primaryAction: action("start_blank_project", "Start blank project"),
      ...blocked,
    };
  }

  if (runtime.phase === "workspace_not_provisioned" || !runtime.workspaceId) {
    return {
      key: "workspace_missing",
      eyebrow: "Workspace not prepared",
      title: "Prepare the project workspace",
      description: "The project exists, but no verified workspace is available for inspection or execution.",
      facts,
      primaryAction: action("prepare_workspace", "Prepare workspace"),
      ...blocked,
    };
  }

  if (runtime.phase === "workspace_not_ready") {
    if (isWorkspaceFailure(runtime)) {
      return {
        key: "workspace_failed",
        eyebrow: "Workspace preparation failed",
        title: "Retry workspace preparation",
        description: runtime.error?.message ?? "The workspace did not become ready. Retry the existing preparation flow.",
        facts,
        primaryAction: action("retry_workspace", "Retry workspace"),
        ...blocked,
      };
    }

    return {
      key: "workspace_preparing",
      eyebrow: "Workspace preparation in progress",
      title: "Waiting for verified workspace state",
      description: "Inspection and terminal actions remain unavailable until the workspace reports ready.",
      facts,
      primaryAction: null,
      ...blocked,
    };
  }

  if (providerHealth === "unavailable" || providerHealth === "locked") {
    return {
      key: "provider_unavailable",
      eyebrow: "AI provider unavailable",
      title: "Configure an AI provider",
      description: "The workspace may be available, but LiTT cannot prepare a mission without a verified provider.",
      facts,
      primaryAction: action("configure_provider", "Configure provider"),
      ...blocked,
    };
  }

  if (
    runtime.phase === "terminal_disconnected"
    || runtime.phase === "terminal_reconnecting"
    || !runtime.terminalConnected
    || !runtime.executionAvailable
  ) {
    return {
      key: "terminal_disconnected",
      eyebrow: "Terminal not connected",
      title: "Connect the project terminal",
      description: runtime.readAccess
        ? "Read access is available, but command execution has not been verified. Connect the terminal before preparing the mission."
        : "No verified terminal execution session is available.",
      facts,
      primaryAction: action("connect_terminal", "Connect terminal"),
      ...blocked,
    };
  }

  if (input.inspection) {
    const inspectionEvidence = input.inspection.toolResults.filter(
      isSuccessfulReadOnlyInspectionTool,
    );

    if (input.inspection.status === "running") {
      return {
        key: "inspection_running",
        eyebrow: "Inspection in progress",
        title: "Collecting read-only project evidence",
        description: "LiTT is inspecting the project with read-only tools. Mutation and deployment actions remain unavailable.",
        facts,
        primaryAction: null,
        mutationActionsAllowed: false,
        inspectionEvidence,
      };
    }

    if (input.inspection.status === "failed") {
      return {
        key: "inspection_failed",
        eyebrow: "Inspection failed",
        title: "The first inspection did not complete",
        description: "Mutation and deployment actions remain unavailable because the inspection run failed.",
        facts,
        primaryAction: null,
        mutationActionsAllowed: false,
        inspectionEvidence,
      };
    }

    if (input.inspection.status === "cancelled") {
      return {
        key: "inspection_cancelled",
        eyebrow: "Inspection cancelled",
        title: "The first inspection was not completed",
        description: "Mutation and deployment actions remain unavailable because the inspection run was cancelled.",
        facts,
        primaryAction: null,
        mutationActionsAllowed: false,
        inspectionEvidence,
      };
    }

    if (inspectionEvidence.length === 0 || !input.inspection.persistedAssistantResponse) {
      return {
        key: "inspection_incomplete",
        eyebrow: "Inspection evidence incomplete",
        title: "Completion could not be verified",
        description: "A persisted response and at least one successful read-only tool result are required before mutation or deployment actions become available.",
        facts,
        primaryAction: null,
        mutationActionsAllowed: false,
        inspectionEvidence,
      };
    }

    return {
      key: "inspection_proven",
      eyebrow: "Inspection verified",
      title: "Read-only inspection completed",
      description: "The persisted response includes successful read-only tool evidence. Normal capability and approval gates now control further work.",
      facts,
      primaryAction: null,
      mutationActionsAllowed: true,
      inspectionEvidence,
    };
  }

  return {
    key: "verified",
    eyebrow: "Prerequisites verified",
    title: "Prepare your first inspection",
    description: "LiTT can prepare a read-only project inspection. The mission will be placed in the composer for your review and will not start automatically.",
    facts,
    primaryAction: action("prepare_inspection", "Prepare read-only inspection"),
    ...blocked,
  };
}
