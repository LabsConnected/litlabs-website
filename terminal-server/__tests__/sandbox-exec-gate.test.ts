/**
 * Sandbox exec gate + router tests (SANDBOX-PLAN.md Phase 1).
 *
 * The gate is the whole safety story of Phase 1, so every closure is
 * proven independently:
 *   1. provider not configured (disabled default) -> never routes
 *   2. not a staging process                      -> never routes
 *   3. requester not the owner                    -> never routes
 *   4. canary red / never-run / STALE             -> never routes
 *   5. all four green                             -> routes, reuses
 *      the per-(user, project, workspace) sandbox, and keeps
 *      different projects in different sandboxes (invariant 3).
 *
 * Config resolution is proven separately: the E2B provider exists
 * only when SANDBOX_PROVIDER=e2b AND E2B_API_KEY are both set.
 */

import { describe, it, expect } from "vitest";
import {
  SandboxExecGate,
  SandboxExecRouter,
} from "../sandbox/exec-router";
import {
  createSandboxProvider,
  resolveSandboxRuntimeConfig,
} from "../sandbox/config";
import { SandboxVerificationService } from "../sandbox/verification";
import {
  createCompliantFakeProvider,
  FakeSandboxProvider,
} from "../sandbox/testing/fake-providers";
import { DisabledSandboxProvider } from "../sandbox/disabled-provider";
import { E2bSandboxProvider } from "../sandbox/e2b-provider";

const OWNER = "user_owner";
const OTHER = "user_someone_else";

function gateWith(overrides: Partial<ConstructorParameters<typeof SandboxExecGate>[0]> = {}) {
  return new SandboxExecGate({
    providerEnabled: true,
    staging: true,
    isOwner: (u) => u === OWNER,
    isVerified: () => true,
    ...overrides,
  });
}

describe("SandboxExecGate — each condition closes independently", () => {
  it("opens only when provider + staging + owner + canary all pass", () => {
    expect(gateWith().decide(OWNER)).toEqual({ allowed: true, reason: "ok" });
  });

  it("closes when the provider is not configured", () => {
    expect(gateWith({ providerEnabled: false }).decide(OWNER)).toEqual({
      allowed: false,
      reason: "provider-disabled",
    });
  });

  it("closes outside staging", () => {
    expect(gateWith({ staging: false }).decide(OWNER)).toEqual({
      allowed: false,
      reason: "not-staging",
    });
  });

  it("closes for non-owners", () => {
    expect(gateWith().decide(OTHER)).toEqual({ allowed: false, reason: "not-owner" });
  });

  it("closes when the canary is not verified", () => {
    expect(gateWith({ isVerified: () => false }).decide(OWNER)).toEqual({
      allowed: false,
      reason: "canary-not-verified",
    });
  });
});

describe("SandboxExecRouter", () => {
  const req = {
    userId: OWNER,
    projectId: "proj-1",
    workspaceId: "ws-1",
    command: "printf '%s' 'hi' > /tmp/marker.txt",
  };

  it("returns null and never touches the provider when the gate is closed", async () => {
    const provider = new FakeSandboxProvider();
    const router = new SandboxExecRouter(provider, gateWith({ staging: false }), {
      log: () => {},
    });
    expect(await router.tryExecute(req)).toBeNull();
    expect(provider.calls.create).toBe(0);
    expect(provider.calls.execute).toBe(0);
  });

  it("routes when open, reuses the binding, and isolates per project", async () => {
    const provider = new FakeSandboxProvider();
    const router = new SandboxExecRouter(provider, gateWith(), { log: () => {} });

    const first = await router.tryExecute(req);
    expect(first).not.toBeNull();
    expect(first!.result.exitCode).toBe(0);

    const read = await router.tryExecute({ ...req, command: "cat /tmp/marker.txt" });
    expect(read!.result.stdout).toBe("hi");
    expect(read!.sandboxId).toBe(first!.sandboxId);
    expect(provider.calls.create).toBe(1);

    // A different project gets its OWN sandbox and cannot see the file.
    const other = await router.tryExecute({
      ...req,
      projectId: "proj-2",
      workspaceId: "ws-2",
      command: "cat /tmp/marker.txt",
    });
    expect(other!.sandboxId).not.toBe(first!.sandboxId);
    expect(other!.result.exitCode).toBe(1);
    expect(provider.calls.create).toBe(2);
  });

  it("closes again when the canary goes stale (real verification service)", async () => {
    let nowMs = 1_000_000;
    const service = new SandboxVerificationService(createCompliantFakeProvider(), {
      maxAgeMs: 60_000,
      now: () => nowMs,
      canary: { runId: "gate-stale-test" },
    });
    const report = await service.runNow();
    expect(report.passed).toBe(true);
    expect(service.isVerified()).toBe(true);

    const provider = new FakeSandboxProvider();
    const router = new SandboxExecRouter(
      provider,
      gateWith({ isVerified: () => service.isVerified() }),
      { log: () => {} },
    );

    expect(await router.tryExecute(req)).not.toBeNull();

    // Freshness window lapses: the same green report no longer counts.
    nowMs += 61_000;
    expect(service.isVerified()).toBe(false);
    expect(await router.tryExecute(req)).toBeNull();
  });

  it("never routes for the disabled provider stack (Phase 0 default)", async () => {
    const service = new SandboxVerificationService(new DisabledSandboxProvider());
    await service.runNow();
    const router = new SandboxExecRouter(
      new DisabledSandboxProvider(),
      gateWith({
        providerEnabled: false,
        isVerified: () => service.isVerified(),
      }),
      { log: () => {} },
    );
    expect(await router.tryExecute(req)).toBeNull();
  });
});

describe("sandbox config resolution", () => {
  it("defaults to disabled with nothing set", () => {
    const cfg = resolveSandboxRuntimeConfig({});
    expect(cfg.providerName).toBe("disabled");
    expect(cfg.staging).toBe(false);
  });

  it("requires BOTH SANDBOX_PROVIDER=e2b and E2B_API_KEY", () => {
    expect(resolveSandboxRuntimeConfig({ SANDBOX_PROVIDER: "e2b" }).providerName).toBe(
      "disabled",
    );
    expect(resolveSandboxRuntimeConfig({ E2B_API_KEY: "k" }).providerName).toBe("disabled");
    expect(
      resolveSandboxRuntimeConfig({ SANDBOX_PROVIDER: "e2b", E2B_API_KEY: "k" })
        .providerName,
    ).toBe("e2b");
    expect(
      resolveSandboxRuntimeConfig({ SANDBOX_PROVIDER: "docker", E2B_API_KEY: "k" })
        .providerName,
    ).toBe("disabled");
  });

  it("detects staging via the Railway environment name or the explicit flag", () => {
    expect(resolveSandboxRuntimeConfig({ RAILWAY_ENVIRONMENT_NAME: "staging" }).staging).toBe(
      true,
    );
    expect(resolveSandboxRuntimeConfig({ SANDBOX_STAGING: "true" }).staging).toBe(true);
    expect(
      resolveSandboxRuntimeConfig({ RAILWAY_ENVIRONMENT_NAME: "production" }).staging,
    ).toBe(false);
  });

  it("template defaults and overrides via E2B_TEMPLATE_ID", () => {
    expect(resolveSandboxRuntimeConfig({}).templateId).toBe("litt-sandbox-v1");
    expect(resolveSandboxRuntimeConfig({ E2B_TEMPLATE_ID: "custom-tpl" }).templateId).toBe(
      "custom-tpl",
    );
  });

  it("factory builds Disabled by default and E2B only when fully configured", () => {
    expect(createSandboxProvider({})).toBeInstanceOf(DisabledSandboxProvider);
    expect(
      createSandboxProvider({ SANDBOX_PROVIDER: "e2b", E2B_API_KEY: "k" }),
    ).toBeInstanceOf(E2bSandboxProvider);
  });
});
