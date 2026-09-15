/**
 * Preview inspector bridge tests.
 *
 * The /preview/:workspaceId proxy injects the inspector into successful
 * HTML responses so Studio's cross-origin iframe can offer element
 * selection over postMessage. These tests pin the injection policy and
 * the protocol the injected script implements.
 */

import { describe, it, expect } from "vitest";
import {
  shouldInjectInspector,
  injectInspector,
  INSPECTOR_DROPPED_HEADERS,
  INSPECTOR_SOURCE,
} from "../preview/inspector";

describe("shouldInjectInspector", () => {
  it("injects into successful HTML responses", () => {
    expect(shouldInjectInspector(200, "text/html; charset=utf-8")).toBe(true);
    expect(shouldInjectInspector(200, "text/html")).toBe(true);
    expect(shouldInjectInspector(204, "text/html")).toBe(true);
  });

  it("does not inject into non-HTML or non-2xx responses", () => {
    expect(shouldInjectInspector(200, "application/json")).toBe(false);
    expect(shouldInjectInspector(200, "text/css")).toBe(false);
    expect(shouldInjectInspector(200, "image/png")).toBe(false);
    expect(shouldInjectInspector(302, "text/html")).toBe(false);
    expect(shouldInjectInspector(404, "text/html")).toBe(false);
    expect(shouldInjectInspector(500, "text/html")).toBe(false);
    expect(shouldInjectInspector(200, "")).toBe(false);
  });
});

describe("injectInspector", () => {
  it("injects the script before </body>", () => {
    const html = "<html><body><h1>Hi</h1></body></html>";
    const out = injectInspector(html);
    const scriptIdx = out.indexOf("<script>");
    const bodyEnd = out.indexOf("</body>");
    expect(scriptIdx).toBeGreaterThan(-1);
    expect(scriptIdx).toBeLessThan(bodyEnd);
    expect(out).toContain("window.__littInspector");
  });

  it("falls back to </html> or end-of-document when </body> is missing", () => {
    const noBody = "<html><div>Hi</div></html>";
    const outNoBody = injectInspector(noBody);
    expect(outNoBody.indexOf("<script>")).toBeLessThan(outNoBody.indexOf("</html>"));

    const fragment = "<div>Hi</div>";
    expect(injectInspector(fragment).endsWith("</script>")).toBe(true);
  });

  it("is idempotent — already-instrumented pages pass through", () => {
    const once = injectInspector("<html><body></body></html>");
    const twice = injectInspector(once);
    expect(twice).toBe(once);
    expect(twice.match(/__littInspector/g)!.length).toBe(2); // guard check + assignment
  });

  it("implements the postMessage protocol (token-gated commands, tagged events)", () => {
    const script = injectInspector("<html><body></body></html>");
    // Commands are gated on the preview access token from location.search
    // and only accepted from the embedding parent window.
    expect(script).toContain('data.token !== token');
    expect(script).toContain("event.source !== window.parent");
    // Outbound events are tagged so the parent can distinguish them.
    expect(script).toContain(`source: "${INSPECTOR_SOURCE}"`);
    // Handshake: enable doubles as init and elicits "ready".
    expect(script).toContain('data.type === "enable"');
    expect(script).toContain('post("ready")');
    // Selection reports label/selector/tagName only — no secrets or HTML.
    expect(script).toContain("tagName");
    expect(script).toContain("selector");
    expect(script).toContain("label");
    // The injected script must be plain JS — no TypeScript-only syntax
    // leaks into the browser payload.
    expect(script).not.toContain(": string");
  });
});

describe("INSPECTOR_DROPPED_HEADERS", () => {
  it("drops stale framing headers when the body is rewritten", () => {
    expect(INSPECTOR_DROPPED_HEADERS.has("content-length")).toBe(true);
    expect(INSPECTOR_DROPPED_HEADERS.has("content-encoding")).toBe(true);
  });
});
