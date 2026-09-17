/**
 * Canvas → HTML export — form node rendering tests (step 3.2).
 *
 * Form nodes must emit a self-submitting form wired to the platform
 * form backend (/api/forms/submit) with a hidden deploymentId, a
 * honeypot field, and an inline script that POSTs JSON without
 * navigating. Without a deploymentId (builder preview) the form
 * renders honestly — the script tells the visitor it connects on
 * publish instead of posting anywhere. The /sites/[deploymentId]
 * serving route fills the deploymentId in at serve time.
 *
 * Run: npx vitest run src/app/(app)/studio/components/canvas/builder/canvas-to-html-forms.test.ts
 */

import { describe, it, expect } from "vitest";
import { canvasToHtml } from "./canvas-to-html";
import type { CanvasDocument, CanvasNode } from "./types";

function makeNode(id: string, type: CanvasNode["type"], props: object = {}): CanvasNode {
  return {
    id,
    type,
    parentId: null,
    children: [],
    props: { ...props },
    styles: {},
    metadata: { createdAt: 0, updatedAt: 0 },
  };
}

function makeDoc(nodes: CanvasNode[], rootNodeIds: string[]): CanvasDocument {
  return {
    id: "doc_test",
    projectId: null,
    conversationId: null,
    route: "/contact",
    nodes: Object.fromEntries(nodes.map((n) => [n.id, n])),
    rootNodeIds,
    version: 1,
    updatedAt: 0,
  };
}

function formDoc(): CanvasDocument {
  const input = makeNode("input1", "input", {
    inputName: "email",
    inputType: "email",
    placeholder: "Email",
  });
  const textarea = makeNode("ta1", "textarea", { inputName: "message", placeholder: "Message" });
  const button = makeNode("btn1", "button", { text: "Send" });
  const form = makeNode("form1", "form", { text: "Contact us" });
  form.children = ["input1", "ta1", "btn1"];
  // Form nodes carry their display name in metadata (set by section blocks).
  form.metadata = { createdAt: 0, updatedAt: 0, name: "Roofing Quote" };
  return makeDoc([form, input, textarea, button], ["form1"]);
}

describe("canvasToHtml — form nodes", () => {
  it("wires the form to the platform form backend", () => {
    const html = canvasToHtml(formDoc(), { deploymentId: "dep_test_123" });
    expect(html).toContain('action="/api/forms/submit"');
    expect(html).toContain('data-litt-form="1"');
    expect(html).toContain('data-litt-form-name="Roofing Quote"');
    // Hidden deployment id — the server resolves the owner from this.
    expect(html).toContain('name="deploymentId"');
    expect(html).toContain('value="dep_test_123"');
    // Honeypot for bots.
    expect(html).toContain('name="website"');
  });

  it("renders the submit button as type=submit inside the form", () => {
    const html = canvasToHtml(formDoc(), { deploymentId: "dep_test_123" });
    expect(html).toContain('type="submit"');
  });

  it("names inputs and textareas so their values submit", () => {
    const html = canvasToHtml(formDoc(), { deploymentId: "dep_test_123" });
    expect(html).toContain('name="email"');
    expect(html).toContain('name="message"');
  });

  it("includes the inline form script for form documents", () => {
    const html = canvasToHtml(formDoc(), { deploymentId: "dep_test_123" });
    expect(html).toContain("data-litt-form-status");
    expect(html).toContain("/api/forms/submit");
  });

  it("renders honestly without a deployment id (builder preview)", () => {
    const html = canvasToHtml(formDoc());
    // Empty deployment id — the /sites serving route fills it in at
    // serve time; the inline script tells the visitor it connects on
    // publish instead of posting anywhere.
    expect(html).toContain('name="deploymentId" value=""');
    expect(html).toContain("connects automatically when the site is published");
  });
});

describe("canvasToHtml — no forms", () => {
  it("injects no behavior scripts for plain content", () => {
    const text = makeNode("t1", "text", { text: "Hello" });
    const html = canvasToHtml(makeDoc([text], ["t1"]), { deploymentId: "dep_test_123" });
    expect(html).not.toContain("data-litt-form-status");
    expect(html).not.toContain("/api/forms/submit");
    expect(html).toContain("Hello");
  });
});
