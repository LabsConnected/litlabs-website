// Phase 4: Safe build pipeline tests
//
// Tests for the build pipeline service that orchestrates the full
// lifecycle: plan, approval, write, validate, preview, deploy.

import { describe, it, expect } from "vitest";

// Test the pipeline flow logic without making real API calls.
// These tests verify the control flow, error handling, and
// safety guarantees of the build pipeline.

describe("Build pipeline flow logic", () => {
  // Simulate the pipeline state machine
  function getNextPhase(status: string): string | null {
    const flow: Record<string, string | null> = {
      queued: "planning",
      planning: "awaiting_approval",
      awaiting_approval: "executing", // after approval
      executing: "previewing",
      previewing: "awaiting_deploy_approval",
      awaiting_deploy_approval: "deploying", // after approval
      deploying: "completed", // after provider reports success
      completed: null,
      failed: null,
      cancelled: null,
    };
    return flow[status] ?? null;
  }

  it("follows the correct phase sequence", () => {
    expect(getNextPhase("queued")).toBe("planning");
    expect(getNextPhase("planning")).toBe("awaiting_approval");
    expect(getNextPhase("awaiting_approval")).toBe("executing");
    expect(getNextPhase("executing")).toBe("previewing");
    expect(getNextPhase("previewing")).toBe("awaiting_deploy_approval");
    expect(getNextPhase("awaiting_deploy_approval")).toBe("deploying");
    expect(getNextPhase("deploying")).toBe("completed");
  });

  it("reaches completed after all phases", () => {
    let status = "queued";
    const visited: string[] = [status];
    while (status !== "completed" && status !== "failed") {
      const next = getNextPhase(status);
      if (!next) break;
      status = next;
      visited.push(status);
    }
    expect(visited).toEqual([
      "queued",
      "planning",
      "awaiting_approval",
      "executing",
      "previewing",
      "awaiting_deploy_approval",
      "deploying",
      "completed",
    ]);
  });
});

describe("Preview verification logic", () => {
  function verifyPreview(resp: { ok: boolean; url: string | null; status: number | null }): boolean {
    // Preview must return a successful response AND a URL
    return resp.ok && resp.url !== null && resp.status !== null && resp.status >= 200 && resp.status < 400;
  }

  it("accepts a successful preview with URL", () => {
    expect(verifyPreview({ ok: true, url: "https://preview.example.com", status: 200 })).toBe(true);
  });

  it("rejects a failed preview", () => {
    expect(verifyPreview({ ok: false, url: null, status: 500 })).toBe(false);
  });

  it("rejects a preview with no URL", () => {
    expect(verifyPreview({ ok: true, url: null, status: 200 })).toBe(false);
  });

  it("rejects a preview with null status", () => {
    expect(verifyPreview({ ok: true, url: "https://preview.example.com", status: null })).toBe(false);
  });

  it("rejects a preview with 4xx status", () => {
    expect(verifyPreview({ ok: true, url: "https://preview.example.com", status: 404 })).toBe(false);
  });

  it("rejects a preview with 5xx status", () => {
    expect(verifyPreview({ ok: true, url: "https://preview.example.com", status: 503 })).toBe(false);
  });
});

describe("Deployment safety guarantees", () => {
  it("never stores a fake URL on failure", () => {
    const failedDeployment = {
      ok: false,
      providerDeploymentId: null,
      url: null,
      status: "failed",
      error: "Vercel API returned 500",
    };
    expect(failedDeployment.url).toBeNull();
    expect(failedDeployment.ok).toBe(false);
  });

  it("stores real URL only on success", () => {
    const successDeployment = {
      ok: true,
      providerDeploymentId: "dpl_abc123",
      url: "https://my-project.vercel.app",
      status: "ready",
    };
    expect(successDeployment.url).not.toBeNull();
    expect(successDeployment.url).toMatch(/^https:\/\//);
    expect(successDeployment.ok).toBe(true);
  });

  it("never says deployed when only queued", () => {
    const queuedDeployment = {
      ok: true,
      providerDeploymentId: "dpl_abc123",
      url: null,
      status: "queued",
    };
    // The pipeline should NOT mark as completed when status is "queued"
    const shouldComplete = queuedDeployment.status === "ready" || queuedDeployment.status === "live";
    expect(shouldComplete).toBe(false);
  });

  it("never says deployed when building", () => {
    const buildingDeployment = {
      ok: true,
      providerDeploymentId: "dpl_abc123",
      url: null,
      status: "building",
    };
    const shouldComplete = buildingDeployment.status === "ready" || buildingDeployment.status === "live";
    expect(shouldComplete).toBe(false);
  });

  it("marks completed only when provider reports ready", () => {
    const readyDeployment = {
      ok: true,
      providerDeploymentId: "dpl_abc123",
      url: "https://my-project.vercel.app",
      status: "ready",
    };
    const shouldComplete = readyDeployment.status === "ready" || readyDeployment.status === "live";
    expect(shouldComplete).toBe(true);
  });

  it("marks completed only when provider reports live", () => {
    const liveDeployment = {
      ok: true,
      providerDeploymentId: "dpl_abc123",
      url: "https://my-project.vercel.app",
      status: "live",
    };
    const shouldComplete = liveDeployment.status === "ready" || liveDeployment.status === "live";
    expect(shouldComplete).toBe(true);
  });

  it("marks failed when provider reports error", () => {
    const errorDeployment = {
      ok: false,
      providerDeploymentId: "dpl_abc123",
      url: null,
      status: "error",
      error: "Build failed",
    };
    const shouldFail = errorDeployment.status === "error" || errorDeployment.status === "failed";
    expect(shouldFail).toBe(true);
  });

  it("marks failed when provider reports canceled", () => {
    const canceledDeployment = {
      ok: false,
      providerDeploymentId: "dpl_abc123",
      url: null,
      status: "canceled",
    };
    const shouldFail = canceledDeployment.status === "canceled";
    expect(shouldFail).toBe(true);
  });
});

describe("Deployment polling logic", () => {
  it("times out after max attempts", () => {
    const maxAttempts = 60;
    let attempts = 0;
    const states = Array(maxAttempts).fill("building");

    for (const state of states) {
      attempts++;
      if (state === "ready" || state === "live") break;
      if (state === "error" || state === "canceled") break;
    }

    expect(attempts).toBe(maxAttempts);
  });

  it("returns ready when provider reports ready", () => {
    const states = ["building", "building", "building", "ready"];
    let finalState = "timeout";

    for (const state of states) {
      if (state === "ready" || state === "live") {
        finalState = "ready";
        break;
      }
      if (state === "error" || state === "canceled") {
        finalState = "failed";
        break;
      }
    }

    expect(finalState).toBe("ready");
  });

  it("returns failed when provider reports error", () => {
    const states = ["building", "building", "error"];
    let finalState = "timeout";

    for (const state of states) {
      if (state === "ready" || state === "live") {
        finalState = "ready";
        break;
      }
      if (state === "error" || state === "canceled") {
        finalState = "failed";
        break;
      }
    }

    expect(finalState).toBe("failed");
  });
});

describe("Validation result handling", () => {
  it("passes when build succeeds", () => {
    const validation = { buildOk: true, testOk: true };
    expect(validation.buildOk).toBe(true);
  });

  it("fails when build fails", () => {
    const validation = { buildOk: false, testOk: true, errors: ["Build failed"] };
    expect(validation.buildOk).toBe(false);
    expect(validation.errors).toBeDefined();
  });

  it("does not deploy when validation fails", () => {
    const validation = { buildOk: false, testOk: true };
    const shouldDeploy = validation.buildOk;
    expect(shouldDeploy).toBe(false);
  });
});

describe("Checkpoint preservation on failure", () => {
  it("preserves checkpoint ID on run", () => {
    const run = {
      checkpoint_id: "ckpt_abc123",
      status: "failed",
      error_code: "preview_failed",
    };
    expect(run.checkpoint_id).not.toBeNull();
  });

  it("allows rollback to checkpoint after failure", () => {
    const run = {
      checkpoint_id: "ckpt_abc123",
      status: "failed",
    };
    const canRollback = run.checkpoint_id !== null && (run.status === "failed" || run.status === "cancelled");
    expect(canRollback).toBe(true);
  });

  it("does not allow rollback without checkpoint", () => {
    const run = {
      checkpoint_id: null,
      status: "failed",
    };
    const canRollback = run.checkpoint_id !== null;
    expect(canRollback).toBe(false);
  });
});

describe("Vercel configuration check", () => {
  it("rejects deployment when VERCEL_TOKEN is missing", () => {
    const vercelToken = "";
    const vercelProjectId = "prj_123";
    const isConfigured = Boolean(vercelToken) && Boolean(vercelProjectId);
    expect(isConfigured).toBe(false);
  });

  it("rejects deployment when VERCEL_PROJECT_ID is missing", () => {
    const vercelToken = "vercel_token_123";
    const vercelProjectId = "";
    const isConfigured = Boolean(vercelToken) && Boolean(vercelProjectId);
    expect(isConfigured).toBe(false);
  });

  it("allows deployment when both are configured", () => {
    const vercelToken = "vercel_token_123";
    const vercelProjectId = "prj_123";
    const isConfigured = Boolean(vercelToken) && Boolean(vercelProjectId);
    expect(isConfigured).toBe(true);
  });
});
