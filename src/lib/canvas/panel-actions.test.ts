/**
 * Tests for the ActionPanel registry (src/lib/canvas/panel-actions.ts)
 * and the studio.* executeAction cases in useCanvasStore.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ArtifactActionSchema } from "./types";
import {
  getPanelActionDefinitions,
  resolvePanelActionAvailability,
  STUDIO_EVENT_ACTIVATE_INSPECTOR,
  STUDIO_EVENT_OPEN_DOCK,
  STUDIO_EVENT_REQUEST_DEPLOY,
} from "./panel-actions";
import { executeAction } from "@/app/(app)/studio/stores/useCanvasStore";

function mockFetchJson(data: unknown, ok = true, status = 200) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(data), { status: ok ? 200 : status }),
  );
}

describe("getPanelActionDefinitions", () => {
  it("registers the three existing-capability actions", () => {
    const defs = getPanelActionDefinitions();
    expect(defs.map((d) => d.id)).toEqual(["inspect_element", "open_terminal", "deploy_site"]);
  });

  it("uses the spec'd chip labels and categories", () => {
    const defs = getPanelActionDefinitions();
    const byId = Object.fromEntries(defs.map((d) => [d.id, d]));
    expect(byId.inspect_element.chipLabel).toBe("Inspect element");
    expect(byId.inspect_element.category).toBe("inspect");
    expect(byId.open_terminal.chipLabel).toBe("Open terminal");
    expect(byId.open_terminal.category).toBe("build");
    expect(byId.deploy_site.chipLabel).toBe("Publish site");
    expect(byId.deploy_site.category).toBe("deploy");
  });
});

describe("buildAction payloads", () => {
  const ctx = { projectId: "proj-123" };

  it("builds studio.inspect_element", () => {
    const def = getPanelActionDefinitions().find((d) => d.id === "inspect_element")!;
    const action = def.buildAction(ctx);
    expect(action).toEqual({ type: "studio.inspect_element" });
    expect(ArtifactActionSchema.safeParse(action).success).toBe(true);
  });

  it("builds studio.open_terminal", () => {
    const def = getPanelActionDefinitions().find((d) => d.id === "open_terminal")!;
    const action = def.buildAction(ctx);
    expect(action).toEqual({ type: "studio.open_terminal" });
    expect(ArtifactActionSchema.safeParse(action).success).toBe(true);
  });

  it("builds studio.deploy_site with the projectId", () => {
    const def = getPanelActionDefinitions().find((d) => d.id === "deploy_site")!;
    const action = def.buildAction(ctx);
    expect(action).toEqual({ type: "studio.deploy_site", projectId: "proj-123" });
    expect(ArtifactActionSchema.safeParse(action).success).toBe(true);
  });

  it("deploy_site throws without a projectId instead of building a broken action", () => {
    const def = getPanelActionDefinitions().find((d) => d.id === "deploy_site")!;
    expect(() => def.buildAction({ projectId: null })).toThrow();
  });
});

describe("availability", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("inspect_element is always available", async () => {
    const items = await resolvePanelActionAvailability({ projectId: null });
    expect(items.find((i) => i.def.id === "inspect_element")!.availability).toEqual({
      available: true,
    });
  });

  it("open_terminal needs a project", async () => {
    const without = await resolvePanelActionAvailability({ projectId: null });
    expect(without.find((i) => i.def.id === "open_terminal")!.availability.available).toBe(false);
    const withProj = await resolvePanelActionAvailability({ projectId: "proj-123" });
    expect(withProj.find((i) => i.def.id === "open_terminal")!.availability.available).toBe(true);
  });

  it("deploy_site is available when readiness is clean", async () => {
    mockFetchJson({ checkable: true, warnings: [] });
    const items = await resolvePanelActionAvailability({ projectId: "proj-123" });
    const deploy = items.find((i) => i.def.id === "deploy_site")!;
    expect(deploy.availability.available).toBe(true);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "/api/studio-projects/proj-123/publish-readiness",
    );
  });

  it("deploy_site is unavailable with a reason when readiness has warnings", async () => {
    mockFetchJson({
      checkable: true,
      warnings: [{ code: "missing-index", message: "No index.html at workspace root" }],
    });
    const items = await resolvePanelActionAvailability({ projectId: "proj-123" });
    const deploy = items.find((i) => i.def.id === "deploy_site")!;
    expect(deploy.availability.available).toBe(false);
    expect(deploy.availability.reason).toContain("No index.html");
  });

  it("deploy_site is unavailable when the workspace is not checkable", async () => {
    mockFetchJson({ checkable: false, reason: "workspace-not-ready" });
    const items = await resolvePanelActionAvailability({ projectId: "proj-123" });
    const deploy = items.find((i) => i.def.id === "deploy_site")!;
    expect(deploy.availability.available).toBe(false);
    expect(deploy.availability.reason).toBe("workspace-not-ready");
  });

  it("deploy_site is unavailable when the readiness fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const items = await resolvePanelActionAvailability({ projectId: "proj-123" });
    const deploy = items.find((i) => i.def.id === "deploy_site")!;
    expect(deploy.availability.available).toBe(false);
    expect(deploy.availability.reason).toBeTruthy();
  });
});

describe("executeAction — studio.* actions dispatch DOM events", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("studio.inspect_element dispatches studio:activate-inspector", async () => {
    const seen: string[] = [];
    const listener = () => seen.push("fired");
    window.addEventListener(STUDIO_EVENT_ACTIVATE_INSPECTOR, listener);
    try {
      const result = await executeAction({ type: "studio.inspect_element" });
      expect(result.ok).toBe(true);
      expect(seen).toEqual(["fired"]);
    } finally {
      window.removeEventListener(STUDIO_EVENT_ACTIVATE_INSPECTOR, listener);
    }
  });

  it("studio.open_terminal dispatches studio:open-dock with the terminal tab", async () => {
    const details: unknown[] = [];
    const listener = (e: Event) => details.push((e as CustomEvent).detail);
    window.addEventListener(STUDIO_EVENT_OPEN_DOCK, listener);
    try {
      const result = await executeAction({ type: "studio.open_terminal" });
      expect(result.ok).toBe(true);
      expect(details).toEqual([{ tab: "terminal" }]);
    } finally {
      window.removeEventListener(STUDIO_EVENT_OPEN_DOCK, listener);
    }
  });

  it("studio.deploy_site dispatches studio:request-deploy with the projectId", async () => {
    const details: unknown[] = [];
    const listener = (e: Event) => details.push((e as CustomEvent).detail);
    window.addEventListener(STUDIO_EVENT_REQUEST_DEPLOY, listener);
    try {
      const result = await executeAction({ type: "studio.deploy_site", projectId: "proj-123" });
      expect(result.ok).toBe(true);
      expect(details).toEqual([{ projectId: "proj-123" }]);
    } finally {
      window.removeEventListener(STUDIO_EVENT_REQUEST_DEPLOY, listener);
    }
  });
});
