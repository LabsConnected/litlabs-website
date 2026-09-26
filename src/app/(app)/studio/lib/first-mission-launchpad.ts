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
  /**
   * Active project id (null when there is no project yet). Lets the empty
   * state persist the business profile straight to the project; without one
   * the describe box stashes a pending intake instead.
   */
  projectId: string | null;
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

type LaunchpadStateWithoutProject = Omit<FirstMissionLaunchpadState, "projectId">;

function deriveLaunchpad(input: FirstMissionLaunchpadInput): LaunchpadStateWithoutProject {
  const { runtime, runtimeLoading, runtimeError, providerHealth } = input;
  const facts = factsFor(runtime, providerHealth);
  const blocked = { mutationActionsAllowed: false, inspectionEvidence: [] };

  if (runtimeLoading || runtime.phase === "resolving" || providerHealth === undefined) {
    return {
      key: "checking",
      eyebrow: "Getting things ready",
      title: "What do you want LiTT to do?",
      description: "LiTT is getting set up — just a few seconds.",
      facts,
      primaryAction: null,
      ...blocked,
    };
  }

  if (runtime.phase === "unauthenticated") {
    return {
      key: "blocked",
      eyebrow: "Sign-in needed",
      title: "Please sign in again",
      description: "Your session expired. Sign in again to keep going.",
      facts,
      primaryAction: null,
      ...blocked,
    };
  }

  if (runtimeError) {
    return {
      key: "blocked",
      eyebrow: "Couldn't check status",
      title: "Something needs attention",
      description: runtimeError,
      facts,
      primaryAction: null,
      ...blocked,
    };
  }

  if (!runtime.projectId || runtime.phase === "idle") {
    return {
      key: "no_project",
      eyebrow: "Let's get started",
      title: "What do you want LiTT to do?",
      description: "Tell LiTT what you want in your own words — a website, a fix, a fresh look. Nothing runs until you say so.",
      facts,
      primaryAction: action("start_blank_project", "Get started"),
      ...blocked,
    };
  }

  if (runtime.phase === "workspace_not_provisioned" || !runtime.workspaceId) {
    return {
      key: "workspace_missing",
      eyebrow: "Almost ready",
      title: "What do you want LiTT to do?",
      description: "One quick setup step, then tell LiTT what to build.",
      facts,
      primaryAction: action("prepare_workspace", "Set up"),
      ...blocked,
    };
  }

  if (runtime.phase === "workspace_not_ready") {
    if (isWorkspaceFailure(runtime)) {
      return {
        key: "workspace_failed",
        eyebrow: "Needs attention",
        title: "Setup didn't finish",
        description: runtime.error?.message ?? "The setup didn't complete. You can try again.",
        facts,
        primaryAction: action("retry_workspace", "Try again"),
        ...blocked,
      };
    }

    return {
      key: "workspace_preparing",
      eyebrow: "Getting things ready",
      title: "Setting things up",
      description: "LiTT is preparing your space. This usually takes about a minute.",
      facts,
      primaryAction: null,
      ...blocked,
    };
  }

  if (providerHealth === "unavailable" || providerHealth === "locked") {
    return {
      key: "provider_unavailable",
      eyebrow: "One more step",
      title: "Connect your AI",
      description: "LiTT needs an AI connection to do the work — it takes about a minute.",
      facts,
      primaryAction: action("configure_provider", "Connect AI"),
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
      eyebrow: "One more step",
      title: "Almost there",
      description: "LiTT needs a live connection to run things. One tap to connect.",
      facts,
      primaryAction: action("connect_terminal", "Connect"),
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
        eyebrow: "Working on it",
        title: "Looking over your project",
        description: "LiTT is reading through the project to understand it. Nothing is being changed.",
        facts,
        primaryAction: null,
        mutationActionsAllowed: false,
        inspectionEvidence,
      };
    }

    if (input.inspection.status === "failed") {
      return {
        key: "inspection_failed",
        eyebrow: "Needs attention",
        title: "That didn't finish",
        description: "LiTT couldn't finish looking over the project. You can still tell it what you want.",
        facts,
        primaryAction: null,
        mutationActionsAllowed: false,
        inspectionEvidence,
      };
    }

    if (input.inspection.status === "cancelled") {
      return {
        key: "inspection_cancelled",
        eyebrow: "Stopped",
        title: "That was stopped",
        description: "The look-over was stopped before it finished. Nothing was changed.",
        facts,
        primaryAction: null,
        mutationActionsAllowed: false,
        inspectionEvidence,
      };
    }

    if (inspectionEvidence.length === 0 || !input.inspection.persistedAssistantResponse) {
      return {
        key: "inspection_incomplete",
        eyebrow: "Almost",
        title: "Couldn't verify everything",
        description: "LiTT didn't get a complete picture. You can still describe what you want.",
        facts,
        primaryAction: null,
        mutationActionsAllowed: false,
        inspectionEvidence,
      };
    }

    return {
      key: "inspection_proven",
      eyebrow: "Ready",
      title: "What do you want LiTT to do?",
      description: "LiTT has looked over the project. Tell it what you want in your own words.",
      facts,
      primaryAction: null,
      mutationActionsAllowed: true,
      inspectionEvidence,
    };
  }

  return {
    key: "verified",
    eyebrow: "Ready",
    title: "What do you want LiTT to do?",
    description: "Tell LiTT what you want in your own words — a website, a fix, a fresh look.",
    facts,
    primaryAction: action("prepare_inspection", "Look over my project first"),
    ...blocked,
  };
}

export function deriveFirstMissionLaunchpadState(
  input: FirstMissionLaunchpadInput,
): FirstMissionLaunchpadState {
  return {
    ...deriveLaunchpad(input),
    projectId: input.runtime.projectId ?? null,
  };
}
