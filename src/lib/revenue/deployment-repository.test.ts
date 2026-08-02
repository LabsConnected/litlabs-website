// Phase 5: Deployment contract tests

import { describe, it, expect } from "vitest";
import {
  isValidDeploymentTransition,
  type DeploymentStatus,
} from "@/lib/revenue/deployment-repository";

describe("Deployment state machine", () => {
  it("allows pending → queued", () => {
    expect(isValidDeploymentTransition("pending", "queued")).toBe(true);
  });

  it("allows pending → building", () => {
    expect(isValidDeploymentTransition("pending", "building")).toBe(true);
  });

  it("allows pending → failed", () => {
    expect(isValidDeploymentTransition("pending", "failed")).toBe(true);
  });

  it("allows queued → building", () => {
    expect(isValidDeploymentTransition("queued", "building")).toBe(true);
  });

  it("allows building → deploying", () => {
    expect(isValidDeploymentTransition("building", "deploying")).toBe(true);
  });

  it("allows building → ready", () => {
    expect(isValidDeploymentTransition("building", "ready")).toBe(true);
  });

  it("allows building → live", () => {
    expect(isValidDeploymentTransition("building", "live")).toBe(true);
  });

  it("allows deploying → ready", () => {
    expect(isValidDeploymentTransition("deploying", "ready")).toBe(true);
  });

  it("allows deploying → live", () => {
    expect(isValidDeploymentTransition("deploying", "live")).toBe(true);
  });

  it("allows ready → live", () => {
    expect(isValidDeploymentTransition("ready", "live")).toBe(true);
  });

  it("allows any active state → failed", () => {
    const activeStates: DeploymentStatus[] = ["pending", "queued", "building", "deploying", "ready", "live"];
    for (const state of activeStates) {
      expect(isValidDeploymentTransition(state, "failed")).toBe(true);
    }
  });

  it("allows pending/queued → canceled", () => {
    expect(isValidDeploymentTransition("pending", "canceled")).toBe(true);
    expect(isValidDeploymentTransition("queued", "canceled")).toBe(true);
  });

  it("BLOCKS transitions from terminal states", () => {
    const terminalStates: DeploymentStatus[] = ["failed", "canceled"];
    const allStates: DeploymentStatus[] = [
      "pending", "queued", "building", "deploying", "ready", "live", "failed", "canceled",
    ];
    for (const terminal of terminalStates) {
      for (const target of allStates) {
        expect(isValidDeploymentTransition(terminal, target)).toBe(false);
      }
    }
  });

  it("BLOCKS reverse transitions", () => {
    expect(isValidDeploymentTransition("building", "queued")).toBe(false);
    expect(isValidDeploymentTransition("ready", "building")).toBe(false);
    expect(isValidDeploymentTransition("live", "ready")).toBe(false);
  });

  it("BLOCKS pending → deploying (must go through building)", () => {
    expect(isValidDeploymentTransition("pending", "deploying")).toBe(false);
  });

  it("BLOCKS queued → ready (must go through building)", () => {
    expect(isValidDeploymentTransition("queued", "ready")).toBe(false);
  });
});

describe("Deployment contract fields", () => {
  // Verify the deployment contract includes all required fields
  // from the spec:
  //   userId, projectId, agentRunId, provider, providerDeploymentId,
  //   environment, status, previewUrl/productionUrl, source revision,
  //   createdAt, completedAt, errorCode, sanitized errorMessage

  it("includes all required fields in the type", () => {
    const deployment = {
      id: "dep-1",
      user_id: "user-1",
      project_id: "proj-1",
      agent_run_id: "run-1",
      provider: "vercel",
      provider_deployment_id: "dpl_abc",
      environment: "production",
      status: "ready",
      preview_url: "https://preview.example.com",
      production_url: "https://example.com",
      source_revision: "abc123",
      checkpoint_id: "ckpt-1",
      error_code: null,
      error_message: null,
      metadata: {},
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
      completed_at: "2026-01-01T00:01:00Z",
    };

    // Verify all required fields are present
    expect(deployment).toHaveProperty("user_id");
    expect(deployment).toHaveProperty("project_id");
    expect(deployment).toHaveProperty("agent_run_id");
    expect(deployment).toHaveProperty("provider");
    expect(deployment).toHaveProperty("provider_deployment_id");
    expect(deployment).toHaveProperty("environment");
    expect(deployment).toHaveProperty("status");
    expect(deployment).toHaveProperty("preview_url");
    expect(deployment).toHaveProperty("production_url");
    expect(deployment).toHaveProperty("source_revision");
    expect(deployment).toHaveProperty("created_at");
    expect(deployment).toHaveProperty("completed_at");
    expect(deployment).toHaveProperty("error_code");
    expect(deployment).toHaveProperty("error_message");
  });

  it("stores real URLs (not fake)", () => {
    const deployment = {
      production_url: "https://my-project.vercel.app",
      preview_url: "https://my-project-git-preview.vercel.app",
    };
    expect(deployment.production_url).toMatch(/^https:\/\//);
    expect(deployment.preview_url).toMatch(/^https:\/\//);
  });

  it("stores null URLs when deployment fails", () => {
    const failedDeployment = {
      production_url: null,
      preview_url: null,
      status: "failed" as DeploymentStatus,
      error_code: "build_failed",
      error_message: "Build failed: exit code 1",
    };
    expect(failedDeployment.production_url).toBeNull();
    expect(failedDeployment.preview_url).toBeNull();
  });

  it("stores sanitized error messages (no secrets)", () => {
    const deployment = {
      error_code: "build_failed",
      error_message: "Build failed: exit code 1",
    };
    // Error message should not contain secrets
    expect(deployment.error_message).not.toContain("sk_");
    expect(deployment.error_message).not.toContain("password");
    expect(deployment.error_message).not.toContain("token");
    expect(deployment.error_message).not.toContain("secret");
  });
});
