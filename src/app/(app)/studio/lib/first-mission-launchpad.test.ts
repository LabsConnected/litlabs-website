import { describe, expect, it } from "vitest";
import {
  FIRST_INSPECTION_PROMPT,
  deriveFirstMissionLaunchpadState,
  isSuccessfulReadOnlyInspectionTool,
  type FirstMissionLaunchpadInput,
} from "./first-mission-launchpad";
import {
  INITIAL_RUNTIME_STATE,
  type ProjectRuntimeState,
} from "@/lib/projects/runtime-state";

function runtime(overrides: Partial<ProjectRuntimeState>): ProjectRuntimeState {
  return {
    ...INITIAL_RUNTIME_STATE,
    lastCheckedAt: "2026-08-31T00:00:00.000Z",
    ...overrides,
  };
}

const project = {
  projectId: "project-1",
  projectName: "First project",
  sourceType: "blank" as const,
};

const cases: Array<{
  name: string;
  input: FirstMissionLaunchpadInput;
  key: string;
  action: string | null;
  actionDisabled?: boolean;
  forbiddenReady?: boolean;
}> = [
  {
    name: "keeps unresolved checks in checking state",
    input: { runtime: runtime({ phase: "idle" }), runtimeLoading: true },
    key: "checking",
    action: null,
    forbiddenReady: true,
  },
  {
    name: "starts a blank project when no project exists",
    input: { runtime: runtime({ phase: "idle" }), runtimeLoading: false, providerHealth: "available" },
    key: "no_project",
    action: "start_blank_project",
    forbiddenReady: true,
  },
  {
    name: "prepares a missing workspace",
    input: {
      runtime: runtime({ ...project, phase: "workspace_not_provisioned" }),
      runtimeLoading: false,
      providerHealth: "available",
    },
    key: "workspace_missing",
    action: "prepare_workspace",
  },
  {
    name: "waits while a workspace is preparing",
    input: {
      runtime: runtime({
        ...project,
        phase: "workspace_not_ready",
        workspaceId: "workspace-1",
        workspaceStatus: "preparing",
      }),
      runtimeLoading: false,
      providerHealth: "available",
    },
    key: "workspace_preparing",
    action: null,
    actionDisabled: true,
  },
  {
    name: "retries a failed workspace",
    input: {
      runtime: runtime({
        ...project,
        phase: "workspace_not_ready",
        workspaceId: "workspace-1",
        workspaceStatus: "failed",
        error: { code: "WORKSPACE_NOT_READY", message: "Clone failed" },
      }),
      runtimeLoading: false,
      providerHealth: "available",
    },
    key: "workspace_failed",
    action: "retry_workspace",
  },
  {
    name: "configures an unavailable provider before terminal recovery",
    input: {
      runtime: runtime({
        ...project,
        phase: "terminal_disconnected",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        readAccess: true,
      }),
      runtimeLoading: false,
      providerHealth: "unavailable",
    },
    key: "provider_unavailable",
    action: "configure_provider",
  },
  {
    name: "connects a terminal after provider and workspace verification",
    input: {
      runtime: runtime({
        ...project,
        phase: "terminal_disconnected",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        readAccess: true,
      }),
      runtimeLoading: false,
      providerHealth: "available",
    },
    key: "terminal_disconnected",
    action: "connect_terminal",
  },
  {
    name: "prepares inspection only when runtime and provider are verified",
    input: {
      runtime: runtime({
        ...project,
        phase: "ready",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        terminalConnected: true,
        executionAvailable: true,
        readAccess: true,
      }),
      runtimeLoading: false,
      providerHealth: "available",
    },
    key: "verified",
    action: "prepare_inspection",
  },
  {
    name: "does not treat fully ready runtime as inspection proven while inspection runs",
    input: {
      runtime: runtime({
        ...project,
        phase: "ready",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        terminalConnected: true,
        executionAvailable: true,
        readAccess: true,
      }),
      runtimeLoading: false,
      providerHealth: "available",
      inspection: { status: "running" as const, toolResults: [{ toolId: "read_file", success: true }], persistedAssistantResponse: false },
    },
    key: "inspection_running",
    action: null,
  },
  {
    name: "keeps runtime ready blocked when inspection is incomplete",
    input: {
      runtime: runtime({
        ...project,
        phase: "ready",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        terminalConnected: true,
        executionAvailable: true,
        readAccess: true,
      }),
      runtimeLoading: false,
      providerHealth: "available",
      inspection: { status: "completed" as const, toolResults: [{ toolId: "read_file", success: true }], persistedAssistantResponse: false },
    },
    key: "inspection_incomplete",
    action: null,
  },
  {
    name: "keeps runtime ready blocked when no qualifying read evidence exists",
    input: {
      runtime: runtime({
        ...project,
        phase: "ready",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        terminalConnected: true,
        executionAvailable: true,
        readAccess: true,
      }),
      runtimeLoading: false,
      providerHealth: "available",
      inspection: { status: "completed" as const, toolResults: [{ toolId: "edit_file", success: true }], persistedAssistantResponse: true },
    },
    key: "inspection_incomplete",
    action: null,
  },
];

describe("deriveFirstMissionLaunchpadState", () => {
  for (const testCase of cases) {
    it(testCase.name, () => {
      const result = deriveFirstMissionLaunchpadState(testCase.input);

      expect(result.key).toBe(testCase.key);
      expect(result.primaryAction?.id ?? null).toBe(testCase.action);
      expect(result.primaryAction?.disabled ?? (testCase.action === null)).toBe(
        testCase.actionDisabled ?? (testCase.action === null),
      );
      if (testCase.forbiddenReady) {
        expect(`${result.eyebrow} ${result.title} ${result.description}`).not.toMatch(
          /workspace ready|workspace online/i,
        );
      }
    });
  }

  it("treats an unknown provider check as checking, never ready", () => {
    const result = deriveFirstMissionLaunchpadState({
      runtime: runtime({
        ...project,
        phase: "ready",
        workspaceId: "workspace-1",
        workspaceStatus: "ready",
        workspaceProvisioned: true,
        terminalConnected: true,
        executionAvailable: true,
      }),
      runtimeLoading: false,
      providerHealth: undefined,
    });

    expect(result.key).toBe("checking");
    expect(result.primaryAction).toBeNull();
  });

  it("does not derive readiness from project existence", () => {
    const result = deriveFirstMissionLaunchpadState({
      runtime: runtime({ ...project, phase: "workspace_not_provisioned" }),
      runtimeLoading: false,
      providerHealth: "available",
    });

    expect(result.key).toBe("workspace_missing");
    expect(result.facts.find((fact) => fact.label === "Terminal")?.status).not.toBe("verified");
    expect(result.facts.find((fact) => fact.label === "Deployment")?.status).not.toBe("verified");
  });

  it("defines a read-only mission that does not auto-authorize changes", () => {
    expect(FIRST_INSPECTION_PROMPT).toMatch(/read-only/i);
    expect(FIRST_INSPECTION_PROMPT).toMatch(/do not (edit|change)/i);
    expect(FIRST_INSPECTION_PROMPT).toMatch(/evidence/i);
  });

  it.each([
    { label: "list_files", toolId: "list_files", success: true, expected: true },
    { label: "read_file", toolId: "read_file", success: true, expected: true },
    { label: "search_code", toolId: "search_code", success: true, expected: true },
    { label: "edit_file", toolId: "edit_file", success: true, expected: false },
    { label: "run_project_checks", toolId: "run_project_checks", success: true, expected: false },
    { label: "request_deployment_approval", toolId: "request_deployment_approval", success: true, expected: false },
  ])("classifies %s as read-only evidence: %s", ({ toolId, success, expected }) => {
    expect(isSuccessfulReadOnlyInspectionTool({ toolId, success })).toBe(expected);
  });

  it("requires at least one successful read-only tool result for proof", () => {
    const result = deriveFirstMissionLaunchpadState({
      runtime: verifiedRuntime,
      runtimeLoading: false,
      providerHealth: "available",
      inspection: { status: "completed" as const, toolResults: [{ toolId: "edit_file", success: true }], persistedAssistantResponse: true },
    });

    expect(result.key).toBe("inspection_incomplete");
    expect(result.mutationActionsAllowed).toBe(false);
  });

  it("requires a persisted assistant response for proof", () => {
    const result = deriveFirstMissionLaunchpadState({
      runtime: verifiedRuntime,
      runtimeLoading: false,
      providerHealth: "available",
      inspection: { status: "completed" as const, toolResults: [{ toolId: "read_file", success: true }], persistedAssistantResponse: false },
    });

    expect(result.key).toBe("inspection_incomplete");
    expect(result.mutationActionsAllowed).toBe(false);
  });

  it("proves inspection only from completed read evidence and persistence", () => {
    const result = deriveFirstMissionLaunchpadState({
      runtime: verifiedRuntime,
      runtimeLoading: false,
      providerHealth: "available",
      inspection: { status: "completed" as const, toolResults: [{ toolId: "read_file", success: true, summary: "Read package.json" }], persistedAssistantResponse: true },
    });

    expect(result.key).toBe("inspection_proven");
    expect(result.mutationActionsAllowed).toBe(true);
    expect(result.primaryAction).toBeNull();
  });

  const verifiedRuntime = runtime({
    ...project,
    phase: "ready",
    workspaceId: "workspace-1",
    workspaceStatus: "ready",
    workspaceProvisioned: true,
    terminalConnected: true,
    executionAvailable: true,
    readAccess: true,
  });
});
