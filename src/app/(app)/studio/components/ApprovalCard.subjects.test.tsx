import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApprovalCard, deriveApprovalRequestDetails } from "./ApprovalCard";

/**
 * Subject coverage for EVERY gated tool family (ART-20261111-080).
 * Larry's rule: an approval card shows WHAT is being approved — tool +
 * subject/args — for every gate; a bare tool name is a defect. Proven on
 * staging (0d380e74): project.deploy rendered tool name only because its
 * schema is empty, the launch-flow pause synthesizes inputs:{}, and the
 * derivation had no per-tool subject knowledge.
 */
describe("deriveApprovalRequestDetails — per-tool subjects", () => {
  it("project.deploy with empty inputs yields a structural deploy subject", () => {
    const d = deriveApprovalRequestDetails({}, [], { toolId: "project.deploy" });
    expect(d.subject).toBeTruthy();
    expect(d.subject!.value.toLowerCase()).toContain("publish");
    expect(d.subject!.value.toLowerCase()).toContain("public");
  });

  it("project.deploy names the project when the surface supplies it", () => {
    const d = deriveApprovalRequestDetails({}, [], {
      toolId: "project.deploy",
      projectName: "LiTT Food Court",
    });
    expect(d.subject).toBeTruthy();
    expect(d.subject!.value).toContain("LiTT Food Court");
  });

  it("deploy.execute and deploy.preview (zero-arg) yield subjects", () => {
    for (const toolId of ["deploy.execute", "deploy.preview"]) {
      const d = deriveApprovalRequestDetails({}, [], { toolId });
      expect(d.subject, toolId).toBeTruthy();
    }
  });

  it("terminal.execute: the command IS the subject, not duplicated as a param", () => {
    const d = deriveApprovalRequestDetails(
      { command: "npm run build && npm test" },
      [],
      { toolId: "terminal.execute" },
    );
    expect(d.subject).toEqual({ label: "command", value: "npm run build && npm test" });
    expect(d.params.some((p) => p.key === "command")).toBe(false);
  });

  it("git.commit: the commit message is the subject", () => {
    const d = deriveApprovalRequestDetails(
      { message: "feat: add hero section", files: ["index.html"] },
      ["index.html"],
      { toolId: "git.commit" },
    );
    expect(d.subject).toEqual({ label: "message", value: "feat: add hero section" });
  });

  it("memory.store: the stored content previews as the subject", () => {
    const d = deriveApprovalRequestDetails(
      { content: "Larry prefers dark hero sections", category: "preference" },
      [],
      { toolId: "memory.store" },
    );
    expect(d.subject).toEqual({ label: "content", value: "Larry prefers dark hero sections" });
  });

  it("site.patch: heading is the subject, path the destination", () => {
    const d = deriveApprovalRequestDetails(
      { path: "index.html", section: "hero", heading: "Taste the World" },
      [],
      { toolId: "site.patch" },
    );
    expect(d.subject!.value).toBe("Taste the World");
    expect(d.destination).toBe("index.html");
  });

  it("files.rename: newPath is the destination", () => {
    const d = deriveApprovalRequestDetails(
      { path: "draft.html", newPath: "index.html" },
      ["draft.html"],
      { toolId: "files.rename" },
    );
    expect(d.destination).toBe("index.html");
  });

  it("files.move (station): `to` is the destination", () => {
    const d = deriveApprovalRequestDetails(
      { from: "draft.html", to: "pages/index.html" },
      ["draft.html"],
      { toolId: "files.move" },
    );
    expect(d.destination).toBe("pages/index.html");
  });

  it("checkpoint.restore: truncated checkpoint id is the subject; full id never renders", () => {
    const id = "12345678-1234-1234-1234-123456789012";
    const d = deriveApprovalRequestDetails({ checkpointId: id }, [], { toolId: "checkpoint.restore" });
    expect(d.subject).toBeTruthy();
    expect(d.subject!.value).toContain("12345678");
    expect(JSON.stringify(d)).not.toContain(id);
  });

  it("checkpoint.create: the label is the subject", () => {
    const d = deriveApprovalRequestDetails({ label: "before redesign" }, [], { toolId: "checkpoint.create" });
    expect(d.subject).toEqual({ label: "label", value: "before redesign" });
  });

  it("project.insert_asset: the asset name is the subject", () => {
    const d = deriveApprovalRequestDetails(
      { url: "https://example.com/hero.png", name: "hero.png", directory: "assets" },
      [],
      { toolId: "project.insert_asset" },
    );
    expect(d.subject).toEqual({ label: "name", value: "hero.png" });
  });

  it("zero-arg creator tools yield structural subjects (music/video/preview)", () => {
    for (const toolId of ["music.generate", "video.generate", "preview.open", "preview.stop"]) {
      const d = deriveApprovalRequestDetails({}, [], { toolId });
      expect(d.subject, toolId).toBeTruthy();
    }
  });

  it("video.imageToVideo: structural subject; the asset id never renders in full", () => {
    const assetId = "abcdef1234567890fedcba";
    const d = deriveApprovalRequestDetails({ assetId }, [], { toolId: "video.imageToVideo" });
    expect(d.subject).toBeTruthy();
    expect(JSON.stringify(d)).not.toContain(assetId);
  });

  it("canvas.editNode: truncated node id is the subject; full id never renders", () => {
    const nodeId = "node-abcdef1234567890";
    const d = deriveApprovalRequestDetails({ nodeId, props: {} }, [], { toolId: "canvas.editNode" });
    expect(d.subject).toBeTruthy();
    expect(JSON.stringify(d)).not.toContain(nodeId);
  });

  it("regression: image.stock keeps its query subject and hides projectId", () => {
    const d = deriveApprovalRequestDetails(
      { projectId: "proj-1", query: "coffee beans closeup warm light" },
      [],
      { toolId: "image.stock" },
    );
    expect(d.subject).toEqual({ label: "query", value: "coffee beans closeup warm light" });
    expect(JSON.stringify(d)).not.toContain("proj-1");
  });

  it("secret-shaped values never reach the details, whatever the tool", () => {
    const d = deriveApprovalRequestDetails(
      { command: "echo ok", apiKey: "sk-live-123456", accessToken: "tok-abcdef" },
      [],
      { toolId: "terminal.execute" },
    );
    expect(JSON.stringify(d)).not.toContain("sk-live-123456");
    expect(JSON.stringify(d)).not.toContain("tok-abcdef");
    expect(d.subject!.value).toBe("echo ok");
  });
});

describe("ApprovalCard — deploy gate shows its subject", () => {
  it("renders the structural deploy subject with the project name", () => {
    render(
      <ApprovalCard
        approval={{
          toolId: "project.deploy",
          reason: "Sensitive action — requires explicit approval",
          inputs: {},
        }}
        isDeploy
        projectName="LiTT Food Court"
        onResolve={() => {}}
      />,
    );
    const subject = screen.getByTestId("approval-request-subject");
    expect(subject.textContent).toContain("LiTT Food Court");
  });

  it("renders a deploy subject even without a project name", () => {
    render(
      <ApprovalCard
        approval={{
          toolId: "project.deploy",
          reason: "Sensitive action — requires explicit approval",
          inputs: {},
        }}
        isDeploy
        onResolve={() => {}}
      />,
    );
    expect(screen.getByTestId("approval-request-subject")).toBeTruthy();
  });

  it("station image.generate with no staged args shows what will be generated", () => {
    render(
      <ApprovalCard
        approval={{ toolId: "image.generate", reason: "Approval required", inputs: {} }}
        onResolve={() => {}}
      />,
    );
    expect(screen.getByTestId("approval-image-structural")).toBeTruthy();
  });
});
