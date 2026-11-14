/**
 * Sandbox verification canary tests (SANDBOX-PLAN.md Phase 0).
 *
 * Properties proven here:
 *   1. A compliant provider passes every check and leaves no leaked
 *      sandboxes behind.
 *   2. Each failure class the canary exists to catch — shared
 *      filesystem across tenants, execution secretly happening on the
 *      host, open network egress, ignored resource limits, an
 *      unhealthy provider — fails exactly the checks it should and
 *      keeps the overall verdict red.
 *   3. The DisabledProvider (what production wires today) can never
 *      produce a green report.
 */

import { describe, it, expect } from "vitest";
import {
  runSandboxCanary,
  buildEgressProbeCommand,
  buildLimitsProbeCommand,
  buildMemoryHogCommand,
  CANARY_TOKENS,
  type CanaryCheckId,
} from "../sandbox/canary";
import { DisabledSandboxProvider } from "../sandbox/disabled-provider";
import { createSandboxExecStack } from "../sandbox/exec-router";
import {
  createCompliantFakeProvider,
  createSharedFilesystemFakeProvider,
  createHostExecFakeProvider,
  createOpenEgressFakeProvider,
  createProxyDeniedEgressFakeProvider,
  createNoLimitsFakeProvider,
  createUnhealthyFakeProvider,
} from "../sandbox/testing/fake-providers";

function checkStatus(report: { checks: { id: CanaryCheckId; status: string }[] }, id: CanaryCheckId): string {
  const found = report.checks.find((c) => c.id === id);
  if (!found) throw new Error(`check ${id} missing from report`);
  return found.status;
}

describe("runSandboxCanary — compliant provider", () => {
  it("passes every check and cleans up both sandboxes", async () => {
    const provider = createCompliantFakeProvider();
    const report = await runSandboxCanary(provider, { runId: "test-compliant" });

    expect(report.passed).toBe(true);
    expect(report.provider).toBe("fake");
    for (const check of report.checks) {
      expect(check.status, `${check.id}: ${check.detail}`).toBe("pass");
    }
    expect(report.checks.map((c) => c.id)).toEqual([
      "provider-health",
      "exec-round-trip",
      "host-isolation",
      "tenant-isolation",
      "filesystem-confinement",
      "network-egress",
      "resource-limits",
      "cleanup",
    ]);
    expect(provider.liveSandboxCount()).toBe(0);
    expect(provider.calls.destroy).toBe(2);
  });

  it("also passes with a terminal beacon URL configured (and blocked)", async () => {
    const provider = createCompliantFakeProvider();
    const report = await runSandboxCanary(provider, {
      runId: "test-compliant-beacon",
      terminalBeaconUrl: "http://terminal.internal:4001",
    });
    expect(report.passed).toBe(true);
    expect(checkStatus(report, "network-egress")).toBe("pass");
  });
});

describe("runSandboxCanary — disabled provider (production's Phase 0 truth)", () => {
  it("never passes: health fails, sandbox checks fail, cleanup has nothing to do", async () => {
    const report = await runSandboxCanary(new DisabledSandboxProvider(), {
      runId: "test-disabled",
    });

    expect(report.passed).toBe(false);
    expect(report.provider).toBe("disabled");
    expect(checkStatus(report, "provider-health")).toBe("fail");
    expect(checkStatus(report, "exec-round-trip")).toBe("fail");
    expect(checkStatus(report, "host-isolation")).toBe("fail");
    expect(checkStatus(report, "tenant-isolation")).toBe("fail");
    expect(checkStatus(report, "network-egress")).toBe("fail");
    expect(checkStatus(report, "resource-limits")).toBe("fail");
    expect(checkStatus(report, "cleanup")).toBe("pass");
  });
});

describe("runSandboxCanary — failure classes", () => {
  it("unhealthy provider: health fails and sandbox checks are not attempted", async () => {
    const report = await runSandboxCanary(createUnhealthyFakeProvider(), {
      runId: "test-unhealthy",
    });
    expect(report.passed).toBe(false);
    expect(checkStatus(report, "provider-health")).toBe("fail");
    expect(checkStatus(report, "exec-round-trip")).toBe("fail");
  });

  it("shared filesystem across tenants: tenant-isolation and filesystem-confinement fail", async () => {
    const report = await runSandboxCanary(createSharedFilesystemFakeProvider(), {
      runId: "test-shared-fs",
    });
    expect(report.passed).toBe(false);
    expect(checkStatus(report, "exec-round-trip")).toBe("pass");
    expect(checkStatus(report, "host-isolation")).toBe("pass");
    expect(checkStatus(report, "tenant-isolation")).toBe("fail");
    expect(checkStatus(report, "filesystem-confinement")).toBe("fail");
    expect(checkStatus(report, "network-egress")).toBe("pass");
    expect(checkStatus(report, "resource-limits")).toBe("pass");
  });

  it("execution on the host: round-trip 'works' but host-isolation, tenant-isolation and confinement fail", async () => {
    const provider = createHostExecFakeProvider();
    const report = await runSandboxCanary(provider, { runId: "test-host-exec" });
    expect(report.passed).toBe(false);
    // The trap this check exists for: exec appears to work fine…
    expect(checkStatus(report, "exec-round-trip")).toBe("pass");
    // …but it ran on the host, and the canary proves it.
    expect(checkStatus(report, "host-isolation")).toBe("fail");
    expect(checkStatus(report, "tenant-isolation")).toBe("fail");
    expect(checkStatus(report, "filesystem-confinement")).toBe("fail");
    expect(provider.liveSandboxCount()).toBe(0);
  });

  it("open egress: only network-egress fails", async () => {
    const report = await runSandboxCanary(createOpenEgressFakeProvider(), {
      runId: "test-open-egress",
    });
    expect(report.passed).toBe(false);
    expect(checkStatus(report, "network-egress")).toBe("fail");
    expect(checkStatus(report, "exec-round-trip")).toBe("pass");
    expect(checkStatus(report, "host-isolation")).toBe("pass");
    expect(checkStatus(report, "tenant-isolation")).toBe("pass");
    expect(checkStatus(report, "filesystem-confinement")).toBe("pass");
    expect(checkStatus(report, "resource-limits")).toBe("pass");
    // Observability: the detail records what answered — a 200 carrying
    // the Google metadata signature (the real metadata service).
    const egress = report.checks.find((c) => c.id === "network-egress");
    expect(egress?.detail).toContain("REACHABLE (status=200 flavor=present)");
  });

  it("proxy-denied egress: an intermediary's error response still fails, and the detail shows what answered", async () => {
    const report = await runSandboxCanary(createProxyDeniedEgressFakeProvider(), {
      runId: "test-proxy-denied-egress",
    });
    expect(report.passed).toBe(false);
    // The verdict logic is unchanged by the observability fields: any
    // HTTP response — even a proxy's own 403 with no metadata
    // signature — is REACHABLE and fails the check.
    expect(checkStatus(report, "network-egress")).toBe("fail");
    const egress = report.checks.find((c) => c.id === "network-egress");
    expect(egress?.detail).toContain("REACHABLE (status=403 flavor=absent)");
  });

  it("ignored resource limits: only resource-limits fails", async () => {
    const report = await runSandboxCanary(createNoLimitsFakeProvider(), {
      runId: "test-no-limits",
    });
    expect(report.passed).toBe(false);
    expect(checkStatus(report, "resource-limits")).toBe("fail");
    expect(checkStatus(report, "exec-round-trip")).toBe("pass");
    expect(checkStatus(report, "host-isolation")).toBe("pass");
    expect(checkStatus(report, "tenant-isolation")).toBe("pass");
    expect(checkStatus(report, "network-egress")).toBe("pass");
  });

  it("fails closed when provider.create throws mid-run", async () => {
    const provider = createCompliantFakeProvider();
    const original = provider.create.bind(provider);
    let calls = 0;
    provider.create = async (input) => {
      calls += 1;
      if (calls === 2) throw new Error("capacity exploded");
      return original(input);
    };
    const report = await runSandboxCanary(provider, { runId: "test-create-throws" });
    expect(report.passed).toBe(false);
    expect(checkStatus(report, "tenant-isolation")).toBe("fail");
    expect(provider.liveSandboxCount()).toBe(0);
  });
});

describe("probe command builders", () => {
  it("embed the documented probe tokens the fakes recognise", () => {
    expect(buildEgressProbeCommand("http://169.254.169.254/")).toContain(CANARY_TOKENS.egressProbe);
    expect(buildLimitsProbeCommand()).toContain(CANARY_TOKENS.limitsProbe);
    expect(buildMemoryHogCommand(1024)).toContain(CANARY_TOKENS.memoryHog);
  });

  it("egress probe embeds the target URL", () => {
    expect(buildEgressProbeCommand("http://example.invalid/")).toContain("http://example.invalid/");
  });

  it("egress probe captures the response status and the metadata signature", () => {
    const cmd = buildEgressProbeCommand("http://169.254.169.254/");
    expect(cmd).toContain("metadata-flavor");
    expect(cmd).toContain("flavor=");
    // The blocked paths are untouched: timeout and error still print
    // the bare EGRESS_BLOCKED token.
    expect(cmd).toContain('fin("EGRESS_BLOCKED")');
  });
});

describe("boot canary log line (createSandboxExecStack onReport)", () => {
  it("carries the network-egress detail; every other check stays bare id:status", async () => {
    const lines: string[] = [];
    const stack = createSandboxExecStack({}, { log: (m) => lines.push(m) });
    await stack.verification.runNow();
    const line = lines.find((l) => l.startsWith("[sandbox-canary]"));
    expect(line).toBeDefined();
    // Disabled provider: the egress probe never ran, so its detail is
    // the failRemaining note — and it is on the boot line now.
    expect(line).toContain("network-egress:fail[not attempted: provider health check failed]");
    expect(line).toContain("provider-health:fail");
    expect(line).not.toContain("provider-health:fail[");
    expect(line).toContain("cleanup:pass");
    expect(line).not.toContain("cleanup:pass[");
  });
});
