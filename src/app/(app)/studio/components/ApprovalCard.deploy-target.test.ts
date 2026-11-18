import { describe, it, expect } from "vitest";

/**
 * Approval-card deploy target — a project.deploy gate must name WHERE
 * the site will be published (Larry, 2026-11-11: the deploy card showed
 * a bare tool name). The frozen inputs carry the user's chosen target.
 */
import { deriveApprovalDetailsForTool } from "./ApprovalCard";

describe("deriveApprovalDetailsForTool — project.deploy target subject", () => {
  it("names Netlify when the frozen inputs target netlify", () => {
    const details = deriveApprovalDetailsForTool("project.deploy", { target: "netlify" });
    expect(details.subject).toEqual({ label: "publish to", value: "Netlify" });
    // The raw target value is the subject — it must not repeat as a chip.
    expect(details.params.some((p) => p.key === "target")).toBe(false);
  });

  it("names LiTT Hosting for the default deploy (no target input)", () => {
    const details = deriveApprovalDetailsForTool("project.deploy", {});
    expect(details.subject).toEqual({ label: "publish to", value: "LiTT Hosting" });
  });

  it("names LiTT Hosting when the target input is litt", () => {
    const details = deriveApprovalDetailsForTool("project.deploy", { target: "litt" });
    expect(details.subject?.value).toBe("LiTT Hosting");
  });

  it("does not impose a deploy subject on other tools", () => {
    const details = deriveApprovalDetailsForTool("files.write", { target: "netlify" });
    expect(details.subject?.value).not.toBe("Netlify");
    expect(details.subject?.label).not.toBe("publish to");
  });
});
