import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * project.deploy target routing — the user's chosen target must reach
 * the matching deploy service: "netlify" → the Netlify service with the
 * caller's server-side credential lookup; anything else (absent,
 * "litt", or unrecognized) → the original LiTT Hosting service,
 * unchanged. Both services are mocked; no live calls.
 */

const deployUserProject = vi.fn(async () => ({
  ok: false as const,
  deploymentId: null,
  status: "failed" as const,
  publicUrl: null,
  errorClass: "hosting",
  message: "litt path taken",
  retryable: false,
}));

const deployProjectToNetlify = vi.fn(async () => ({
  ok: false as const,
  deploymentId: null,
  status: "failed" as const,
  publicUrl: null,
  errorClass: "needs_connection",
  message: "netlify path taken",
  retryable: false,
}));

vi.mock("@/lib/deployments/deploy-service", () => ({ deployUserProject }));
vi.mock("@/lib/deployments/netlify-deploy-service", () => ({
  deployProjectToNetlify,
}));
vi.mock("@/lib/deployments/deployment-store", () => ({
  supabaseDeploymentStore: { __fake: true },
}));
vi.mock("@/lib/netlify-connection", () => ({
  getNetlifyToken: vi.fn(async () => null),
}));
vi.mock("@/lib/projects/project-repository", () => ({
  getProject: vi.fn(async () => ({ name: "Ember Roast" })),
}));

import { handleProjectDeploy } from "./tool-handlers-v2";

const transport = {
  userId: "user_owner",
  projectId: "proj_ember",
  workspaceId: "ws_ember",
} as never;

beforeEach(() => {
  deployUserProject.mockClear();
  deployProjectToNetlify.mockClear();
});

describe("handleProjectDeploy target routing", () => {
  it("routes target \"netlify\" to the Netlify service with the project name", async () => {
    const result = await handleProjectDeploy({ target: "netlify" }, transport);
    expect(deployProjectToNetlify).toHaveBeenCalledTimes(1);
    expect(deployUserProject).not.toHaveBeenCalled();
    const [requestArg, depsArg] = deployProjectToNetlify.mock.calls[0] as unknown as [
      { projectName?: string | null },
      { getToken?: unknown },
    ];
    expect(requestArg.projectName).toBe("Ember Roast");
    expect(typeof depsArg.getToken).toBe("function");
    expect(result.success).toBe(false);
    expect((result as { errorClass?: string }).errorClass).toBe("needs_connection");
  });

  it("routes a missing target to the LiTT service (default unchanged)", async () => {
    await handleProjectDeploy({}, transport);
    expect(deployUserProject).toHaveBeenCalledTimes(1);
    expect(deployProjectToNetlify).not.toHaveBeenCalled();
  });

  it("routes target \"litt\" to the LiTT service", async () => {
    await handleProjectDeploy({ target: "litt" }, transport);
    expect(deployUserProject).toHaveBeenCalledTimes(1);
    expect(deployProjectToNetlify).not.toHaveBeenCalled();
  });

  it("routes an unrecognized target to the LiTT service — never somewhere unnamed", async () => {
    await handleProjectDeploy({ target: "vercel" }, transport);
    expect(deployUserProject).toHaveBeenCalledTimes(1);
    expect(deployProjectToNetlify).not.toHaveBeenCalled();
  });
});
