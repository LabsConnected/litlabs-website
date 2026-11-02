/**
 * Deploy-tool exposure gate (2026-11-02, golden run 41505296694).
 *
 * Two customer-facing defects are pinned here:
 * - `deploy.production` was advertised to the Studio agent loop via the
 *   station bridge; the model picked it instead of the canonical
 *   `project.deploy`. It is now removed from the customer-facing registries.
 * - `deploy.execute` redeploys LiTT's OWN Railway/Vercel service (infra,
 *   not the user's site). It must stay unreachable for customer runs even
 *   if invoked directly — the tool is disabled unless
 *   LITT_ENABLE_INFRA_DEPLOY=1 + provider creds are present, which are
 *   unset in the test env.
 */
import { describe, expect, it } from "vitest";

import "@/lib/station-control/stations/deploy";
import { getStationAction } from "@/lib/station-control/registry";
import { registerInternalTools, toolRegistry } from "../tool-registry";

registerInternalTools();

describe("deploy tool exposure", () => {
  it("deploy.production is not a registered station action", () => {
    expect(getStationAction("deploy.production")).toBeUndefined();
  });

  it("deploy.production is not advertised as an agent tool", () => {
    expect(toolRegistry.get("deploy.production")).toBeUndefined();
  });

  it("project.deploy remains enabled for customer deployments", () => {
    const tool = toolRegistry.get("project.deploy");
    expect(tool).toBeDefined();
    expect(tool!.enabled).toBe(true);
    expect(tool!.requiredPermissions).toContain("deploy:create");
  });

  it("deploy.preview remains as the station-bridge publish action, approval-gated", () => {
    const action = getStationAction("deploy.preview");
    expect(action).toBeDefined();
    expect(action!.requiresApproval).toBe(true);
  });

  it("deploy.execute is disabled in a customer environment (no infra opt-in)", () => {
    const tool = toolRegistry.get("deploy.execute");
    expect(tool).toBeDefined();
    expect(tool!.enabled).toBe(false);
  });

  it("deploy.execute is not in the model-facing enabled tool list", () => {
    const ids = toolRegistry.listEnabled().map((t) => t.id);
    expect(ids).not.toContain("deploy.execute");
    expect(ids).toContain("project.deploy");
  });

  it("deploy.execute cannot be invoked directly even with explicit approval", async () => {
    const res = await toolRegistry.execute("deploy.execute", {}, {
      hasApproval: true,
      availableCapabilities: ["deploy:execute"],
    });
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/disabled/i);
    }
  });
});
