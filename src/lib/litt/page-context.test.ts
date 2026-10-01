import { describe, expect, it } from "vitest";
import { buildLittPageContext, resolveLittNavigation, studioBridgeUrl } from "./page-context";

describe("Global LiTT page bridge", () => {
  it("clears project and entity when navigation leaves the project", () => {
    expect(buildLittPageContext("/projects/roof", new URLSearchParams(), "u").projectId).toBe("roof");
    const settings = buildLittPageContext("/settings", new URLSearchParams("project=stale"), "u");
    expect(settings).toMatchObject({ pathname: "/settings", surface: "settings", projectId: null, selectedEntity: null, role: null, permissions: "server-resolved" });
  });
  it("uses only the current Studio URL project and current deployment entity", () => {
    expect(buildLittPageContext("/studio", new URLSearchParams("project=roof"), "u").projectId).toBe("roof");
    expect(buildLittPageContext("/deployments/live", new URLSearchParams(), "u").selectedEntity).toEqual({ kind: "deployment", id: "live" });
  });
  it.each([
    ["Go home", "/dashboard"], ["Open Studio", "/studio"], ["Open my projects", "/projects"],
    ["Open Deployments", "/deployments"], ["Open Marketplace", "/marketplace"],
    ["Go to settings", "/settings"], ["Open connections", "/settings/connections"],
    ["Open billing", "/settings?section=billing"],
  ])("resolves %s through existing destinations", (request, href) => {
    expect(resolveLittNavigation(request)).toBe(href);
  });
  it("rejects arbitrary URLs and mutations", () => {
    expect(resolveLittNavigation("open https://attacker.example")).toBeNull();
    expect(resolveLittNavigation("delete my projects")).toBeNull();
  });
  it("continues the existing conversation using canonical Studio URL keys", () => {
    const context = buildLittPageContext("/dashboard", new URLSearchParams(), "u");
    const url = new URL(studioBridgeUrl(context, "Help me", { id: "chat", projectId: "roof" }), "https://test.example");
    expect(url.searchParams.get("conversation")).toBe("chat");
    expect(url.searchParams.get("project")).toBe("roof");
    expect(url.searchParams.get("prompt")).toContain('"pathname":"/dashboard"');
  });
  it("does not carry a conversation across project boundaries", () => {
    const context = buildLittPageContext("/projects/new", new URLSearchParams(), "u");
    const url = new URL(studioBridgeUrl(context, "Help", { id: "old-chat", projectId: "old" }), "https://test.example");
    expect(url.searchParams.get("conversation")).toBeNull();
    expect(url.searchParams.get("project")).toBe("new");
  });
  it("returns to the canonical project preview without starting a model action", () => {
    const context = buildLittPageContext("/dashboard", new URLSearchParams(), "u");
    expect(resolveLittNavigation("Open current project's preview", context, { id: "chat", projectId: "roof" })).toBe("/studio?project=roof&conversation=chat&tool=preview");
    expect(resolveLittNavigation("Open preview", context)).toBeNull();
  });
});
