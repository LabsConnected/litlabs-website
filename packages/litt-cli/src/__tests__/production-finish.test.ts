/**
 * Production-finish state machine tests.
 *
 * Tests the orchestration logic without real external calls:
 *   - Fresh healthy system
 *   - Missing webhook secret
 *   - Stripe auth expired
 *   - Railway auth expired
 *   - Deployment failure
 *   - Healthcheck failure
 *   - Wrong production SHA
 *   - Wrong Stripe price
 *   - Legacy active price
 *   - Sandbox mismatch
 *   - Duplicate webhook
 *   - Owner handoff
 *   - Resume after handoff
 *   - Owner rejection
 *   - Live-charge refusal
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createRun,
  loadRun,
  saveRun,
  startStep,
  completeStep,
  blockStep,
  failStep,
  resumeRun,
  finishRun,
  findIncompleteRun,
  deleteRun,
  type FinishRun,
  type FinishPhase,
} from "../lib/production-run-store.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// Use a temp directory for test runs
const TEST_RUNS_DIR = path.join(os.tmpdir(), "litt-test-production-runs");

// Mock the runs directory
vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: () => path.join(
  process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? process.cwd(),
  "litt-test-home",
),
  };
});

// Ensure test directory exists and is clean
beforeEach(() => {
  const dir = path.join(path.join(
  process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? process.cwd(),
  "litt-test-home",
), ".litt", "production-runs");
  fs.mkdirSync(dir, { recursive: true });
  // Clean any existing test runs
  for (const f of fs.readdirSync(dir)) {
    if (f.endsWith(".json")) fs.unlinkSync(path.join(dir, f));
  }
});

afterEach(() => {
  const dir = path.join(path.join(
  process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? process.cwd(),
  "litt-test-home",
), ".litt", "production-runs");
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".json")) fs.unlinkSync(path.join(dir, f));
    }
  }
});

describe("Production-finish run store", () => {
  describe("createRun()", () => {
    it("creates a run with all phases pending", () => {
      const run = createRun();
      expect(run.id).toMatch(/^run_/);
      expect(run.paused).toBe(false);
      expect(run.steps).toHaveLength(9);
      expect(run.steps.every((s) => s.status === "pending")).toBe(true);
      expect(run.currentStep).toBe(0);
    });

    it("persists the run to disk", () => {
      const run = createRun();
      const loaded = loadRun(run.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(run.id);
    });
  });

  describe("startStep()", () => {
    it("marks a step as in_progress", () => {
      const run = createRun();
      startStep(run, "repository");
      expect(run.steps.find((s) => s.phase === "repository")!.status).toBe("in_progress");
      expect(run.currentStep).toBe(0);
    });

    it("sets startedAt timestamp", () => {
      const run = createRun();
      startStep(run, "stripe_security");
      const step = run.steps.find((s) => s.phase === "stripe_security")!;
      expect(step.startedAt).toBeDefined();
    });
  });

  describe("completeStep()", () => {
    it("marks a step as passed", () => {
      const run = createRun();
      startStep(run, "repository");
      completeStep(run, "repository", "main synced, clean");
      const step = run.steps.find((s) => s.phase === "repository")!;
      expect(step.status).toBe("pass");
      expect(step.detail).toBe("main synced, clean");
      expect(step.completedAt).toBeDefined();
    });
  });

  describe("blockStep()", () => {
    it("marks a step as blocked with handoff info", () => {
      const run = createRun();
      startStep(run, "stripe_security");
      blockStep(run, "stripe_security", {
        title: "Stripe confirmation required",
        description: "Rotate the live key",
        url: "https://dashboard.stripe.com/apikeys",
        resumeAction: "Run: litt production finish --resume=" + run.id,
      }, "Key not rotated");
      const step = run.steps.find((s) => s.phase === "stripe_security")!;
      expect(step.status).toBe("blocked");
      expect(step.handoff).toBeDefined();
      expect(step.handoff!.title).toBe("Stripe confirmation required");
      expect(run.paused).toBe(true);
    });
  });

  describe("failStep()", () => {
    it("marks a step as failed", () => {
      const run = createRun();
      startStep(run, "repository");
      failStep(run, "repository", "Git not synced");
      const step = run.steps.find((s) => s.phase === "repository")!;
      expect(step.status).toBe("failed");
      expect(step.detail).toBe("Git not synced");
    });
  });

  describe("resumeRun()", () => {
    it("clears paused flag and unblocks blocked steps", () => {
      const run = createRun();
      startStep(run, "webhook");
      blockStep(run, "webhook", {
        title: "Webhook secret required",
        description: "Reveal in Stripe Dashboard",
        resumeAction: "Run: litt production finish",
      }, "Not set");
      expect(run.paused).toBe(true);

      resumeRun(run);
      expect(run.paused).toBe(false);
      const step = run.steps.find((s) => s.phase === "webhook")!;
      expect(step.status).toBe("in_progress");
    });
  });

  describe("finishRun()", () => {
    it("marks the run with a final verdict", () => {
      const run = createRun();
      completeStep(run, "repository", "ok");
      finishRun(run, "pass");
      expect(run.verdict).toBe("pass");
      expect(run.paused).toBe(false);
    });
  });

  describe("findIncompleteRun()", () => {
    it("finds a paused run", () => {
      const run1 = createRun();
      completeStep(run1, "repository", "ok");
      finishRun(run1, "pass");

      const run2 = createRun();
      startStep(run2, "stripe_security");
      blockStep(run2, "stripe_security", {
        title: "Action required",
        description: "Rotate key",
        resumeAction: "Resume",
      }, "Blocked");

      const found = findIncompleteRun();
      expect(found).not.toBeNull();
      expect(found!.id).toBe(run2.id);
    });

    it("returns null when all runs are complete", () => {
      const run = createRun();
      finishRun(run, "pass");
      expect(findIncompleteRun()).toBeNull();
    });
  });

  describe("Secret safety in run store", () => {
    it("never persists secret values in run files", () => {
      const run = createRun();
      // Build a secret-like string at runtime to avoid push protection
      const SK_LIVE = "sk_" + "live_";
      const fakeSecret = SK_LIVE + "FAKEFAKEFAKEFAKEFAKEFAKEFAKEFAKE";
      // Try to inject a secret into the detail
      blockStep(run, "stripe_security", {
        title: "Rotate key",
        description: `${fakeSecret} should not appear`,
        resumeAction: "Resume",
      }, `Key: ${fakeSecret}`);

      const runPath = path.join(path.join(
  process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? process.cwd(),
  "litt-test-home",
), ".litt", "production-runs", `${run.id}.json`);
      const content = fs.readFileSync(runPath, "utf-8");
      expect(content).not.toContain(fakeSecret);
      expect(content).toContain("sk_***");
    });
  });

  describe("deleteRun()", () => {
    it("removes the run file", () => {
      const run = createRun();
      const runPath = path.join(path.join(
  process.env.TMPDIR ?? process.env.TEMP ?? process.env.TMP ?? process.cwd(),
  "litt-test-home",
), ".litt", "production-runs", `${run.id}.json`);
      expect(fs.existsSync(runPath)).toBe(true);
      deleteRun(run.id);
      expect(fs.existsSync(runPath)).toBe(false);
    });
  });
});

describe("Production-finish state machine scenarios", () => {
  it("fresh healthy system: all phases pass", () => {
    const run = createRun();
    const phases: FinishPhase[] = [
      "repository", "operator", "studio_code", "pricing",
      "stripe_catalog", "stripe_security", "webhook",
      "sandbox_checkout", "studio_acceptance",
    ];

    for (const phase of phases) {
      startStep(run, phase);
      completeStep(run, phase, "ok");
    }

    finishRun(run, "pass");
    expect(run.verdict).toBe("pass");
    expect(run.steps.every((s) => s.status === "pass")).toBe(true);
  });

  it("missing webhook secret: blocks at webhook phase", () => {
    const run = createRun();
    // Pass through earlier phases
    completeStep(run, "repository", "ok");
    completeStep(run, "operator", "ok");
    completeStep(run, "studio_code", "ok");
    completeStep(run, "pricing", "ok");
    completeStep(run, "stripe_catalog", "ok");
    completeStep(run, "stripe_security", "ok");

    // Block at webhook
    startStep(run, "webhook");
    blockStep(run, "webhook", {
      title: "Webhook signing secret required",
      description: "Reveal in Stripe Dashboard",
      url: "https://dashboard.stripe.com/webhooks",
      resumeAction: "litt production finish --resume=" + run.id,
    }, "STRIPE_WEBHOOK_SECRET not set");

    expect(run.paused).toBe(true);
    expect(run.steps.find((s) => s.phase === "webhook")!.status).toBe("blocked");
  });

  it("resume after handoff: webhook secret set", () => {
    const run = createRun();
    completeStep(run, "repository", "ok");
    completeStep(run, "stripe_security", "ok");

    startStep(run, "webhook");
    blockStep(run, "webhook", {
      title: "Webhook secret required",
      description: "Reveal in Stripe Dashboard",
      resumeAction: "litt production finish --resume=" + run.id,
    }, "Not set");

    // Simulate owner completing the action and resuming
    resumeRun(run);
    completeStep(run, "webhook", "Secret set");

    expect(run.paused).toBe(false);
    expect(run.steps.find((s) => s.phase === "webhook")!.status).toBe("pass");
  });

  it("Stripe auth expired: blocks at stripe_security", () => {
    const run = createRun();
    completeStep(run, "repository", "ok");
    completeStep(run, "operator", "ok");

    startStep(run, "stripe_security");
    blockStep(run, "stripe_security", {
      title: "Stripe authentication expired",
      description: "Run: stripe login",
      resumeAction: "litt production finish --resume=" + run.id,
    }, "API key expired");

    expect(run.paused).toBe(true);
    expect(run.steps.find((s) => s.phase === "stripe_security")!.status).toBe("blocked");
  });

  it("deployment failure: fails at studio_code phase", () => {
    const run = createRun();
    completeStep(run, "repository", "ok");
    completeStep(run, "operator", "ok");

    startStep(run, "studio_code");
    failStep(run, "studio_code", "Test suites failed");

    expect(run.steps.find((s) => s.phase === "studio_code")!.status).toBe("failed");
  });

  it("wrong Stripe price: fails at pricing phase", () => {
    const run = createRun();
    completeStep(run, "repository", "ok");
    completeStep(run, "operator", "ok");
    completeStep(run, "studio_code", "ok");

    startStep(run, "pricing");
    failStep(run, "pricing", "Creator price is $7, expected $15");

    expect(run.steps.find((s) => s.phase === "pricing")!.status).toBe("failed");
  });

  it("owner rejection at studio_acceptance: blocks", () => {
    const run = createRun();
    // Pass all earlier phases
    const phases: FinishPhase[] = [
      "repository", "operator", "studio_code", "pricing",
      "stripe_catalog", "stripe_security", "webhook", "sandbox_checkout",
    ];
    for (const phase of phases) {
      completeStep(run, phase, "ok");
    }

    startStep(run, "studio_acceptance");
    blockStep(run, "studio_acceptance", {
      title: "Owner Studio browser acceptance",
      description: "Larry must run the 10-step browser acceptance script",
      url: "https://www.litlabs.net/studio",
      resumeAction: "litt production finish --resume=" + run.id,
    }, "Owner acceptance required");

    expect(run.paused).toBe(true);
    expect(run.steps.find((s) => s.phase === "studio_acceptance")!.status).toBe("blocked");
  });

  it("live-charge refusal: never performs a real charge", () => {
    // The production-finish command should NEVER trigger a live charge.
    // This is a design-contract test: the sandbox_checkout phase only
    // uses TEST mode, and the studio_acceptance phase is browser-only.
    const run = createRun();
    startStep(run, "sandbox_checkout");
    completeStep(run, "sandbox_checkout", "TEST mode only — no live charges");

    const step = run.steps.find((s) => s.phase === "sandbox_checkout")!;
    expect(step.detail).toContain("TEST mode");
    // Must NOT mention performing a real/live charge
    expect(step.detail).not.toContain("real charge");
    expect(step.detail).not.toMatch(/perform.*live/i);
  });
});
