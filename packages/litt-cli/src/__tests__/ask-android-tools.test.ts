/**
 * Regression: `litt ask` must expose the android.* and dex.* tool family
 * to its model gateway — the earlier build passed a default-only
 * ToolRegistry, so phone requests could never route. Also proves the
 * approval + boundary layers still govern those tools on this path.
 */

import { describe, it, expect } from "vitest";
import {
  ExecutionGateway,
  CommandExecutor,
  RuntimeStore,
} from "@litt/agent-core";
import { buildAskToolRegistry } from "../commands/ask.js";
import { buildDeviceToolEntries } from "../lib/device-tools.js";
import { FakeShell, shellOk, withDevices, TEST_SERIAL } from "./fixtures/fake-shell.js";

const ID = { tenantId: "t", userId: "u", actorId: "u", trusted: false, interaction: "interactive" as const };

describe("buildAskToolRegistry", () => {
  it("includes the android + dex families alongside defaults", () => {
    const reg = buildAskToolRegistry(true);
    const ids = reg.list().map((d) => d.id);
    for (const t of [
      "android.devices", "android.device_state", "android.screenshot",
      "android.tap", "android.swipe", "android.key", "android.text",
      "android.open_app", "android.push", "android.pull", "dex.status",
      "project.run", "project.read_file",
    ]) {
      expect(ids, t).toContain(t);
    }
  });
  it("exact-answer prompts keep an empty registry (unchanged behavior)", () => {
    expect(buildAskToolRegistry(false).list()).toHaveLength(0);
  });
});

describe("ask-path gateway enforcement", () => {
  function gw(shell: FakeShell, cb?: () => Promise<boolean>) {
    return new ExecutionGateway({
      tools: buildAskToolRegistry(true),
      shell,
      executor: new CommandExecutor(shell, new RuntimeStore()),
      onApprovalRequired: cb ?? null,
    });
  }
  const ex = (g: ExecutionGateway, t: string, i: Record<string, unknown>, m: "plan"|"act"|"auto") =>
    g.execute({ toolId: t, inputs: i, cwd: "C:\proj", mode: m, identity: ID });

  it("read-only android.devices runs on the ask path", async () => {
    const r = await ex(gw(withDevices(new FakeShell())), "android.devices", {}, "act");
    expect(r.result.success).toBe(true);
  });
  it("mutating android.tap is denied in PLAN", async () => {
    const r = await ex(gw(new FakeShell()), "android.tap", { x: 1, y: 2 }, "plan");
    expect(r.result.success).toBe(false);
  });
  it("android.screenshot needs approval on the ask path too", async () => {
    const r = await ex(gw(withDevices(new FakeShell())), "android.screenshot", {}, "act");
    expect(r.result.success).toBe(false); // no callback -> denied
  });
  it("unknown serial rejected via tool inputs before spawn", async () => {
    const shell = withDevices(new FakeShell());
    const r = await ex(gw(shell, async () => true), "android.tap", { x: 1, y: 2, serial: "EVILSERIAL99" }, "act");
    expect(r.result.success).toBe(false);
    expect(String(r.result.message)).toContain("allowlist");
  });
  it("device-tools entries and ask registry agree on the tool set", () => {
    const deviceIds = Object.keys(buildDeviceToolEntries());
    const askIds = new Set(buildAskToolRegistry(true).list().map((d) => d.id));
    for (const id of deviceIds) expect(askIds.has(id)).toBe(true);
  });

  it("routes fresh screenshot requests to capture, not file transfer", () => {
    const defs = new Map(buildAskToolRegistry(true).list().map((d) => [d.id, d]));
    const screenshot = defs.get("android.screenshot")!;
    const pull = defs.get("android.pull")!;

    expect(screenshot.description).toContain("fresh screenshot");
    expect(screenshot.description).toContain("must use this tool");
    expect(pull.description).toContain("already-existing");
    expect(pull.description).toContain("never captures");
    expect(pull.description).toContain("do not invent");
  });
});
