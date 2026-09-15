/**
 * Preview inspector bridge.
 *
 * Studio embeds preview pages served by this proxy inside a cross-origin
 * iframe, so the parent page cannot touch the frame's DOM directly. To
 * support element selection we inject a small script into proxied HTML
 * documents that implements a postMessage protocol:
 *
 *   child → parent: { source: "litt-inspector", type: "ready"|"hover"|"select", payload }
 *   parent → child: { source: "litt-inspector", type: "enable"|"disable"|"clear", token }
 *
 * Inbound commands are only accepted from window.parent and must carry
 * the preview access token (the same token already required to load the
 * preview), so arbitrary cross-origin embedders cannot drive the
 * inspector. The child posts to "*" because it cannot know the parent
 * origin; payloads are non-sensitive DOM metadata (label/selector/tag).
 *
 * If a previewed app sets a CSP that blocks inline scripts, the script
 * never runs and Studio reports selection as unavailable — we do not
 * weaken the app's CSP to force instrumentation.
 */

/** Marker used both as the protocol tag and as an idempotence guard. */
export const INSPECTOR_SOURCE = "litt-inspector";

/**
 * Whether a proxied response should carry the inspector. Only successful
 * HTML documents are instrumented — assets, APIs, and error pages pass
 * through untouched.
 */
export function shouldInjectInspector(status: number, contentType: string): boolean {
  return status >= 200 && status < 300 && contentType.toLowerCase().includes("text/html");
}

/**
 * Headers that must not be forwarded when the body is rewritten:
 * content-length is stale after injection and content-encoding no longer
 * describes the (decompressed, modified) payload.
 */
export const INSPECTOR_DROPPED_HEADERS = new Set(["content-length", "content-encoding"]);

const INSPECTOR_SCRIPT = `(function () {
  if (window.__littInspector) return;
  window.__littInspector = true;

  var token = "";
  try {
    token = new URLSearchParams(window.location.search).get("token") || "";
  } catch (e) {}

  var hoverEl = null;
  var hoverPrev = null;
  var selectedEl = null;
  var selectedPrev = null;
  var enabled = false;

  function snapshot(el) {
    return { outline: el.style.outline, outlineOffset: el.style.outlineOffset, boxShadow: el.style.boxShadow };
  }
  function restore(el, prev) {
    if (!el || !prev) return;
    el.style.outline = prev.outline;
    el.style.outlineOffset = prev.outlineOffset;
    el.style.boxShadow = prev.boxShadow;
  }
  function pick(target) {
    if (!(target instanceof Element)) return null;
    var hit = target.closest("nav,header,main,section,footer,form,button,a,[role]");
    return hit || target;
  }
  function describe(el) {
    var explicit = el.getAttribute("aria-label") || el.getAttribute("data-testid") || el.getAttribute("role");
    if (explicit) return explicit.replace(/[-_]/g, " ").replace(/\\s+/g, " ").trim().slice(0, 120);
    var semantic = { nav: "Navigation", header: "Header", main: "Main content", footer: "Footer", form: "Form", button: "Button", a: "Link", img: "Image", h1: "Heading", h2: "Heading", section: "Section" };
    var tag = el.tagName.toLowerCase();
    if (semantic[tag]) return semantic[tag];
    var text = el.textContent ? el.textContent.replace(/\\s+/g, " ").trim() : "";
    return (text ? text.slice(0, 42) : tag).slice(0, 120);
  }
  function selectorFor(el) {
    if (el.id) return "#" + el.id;
    var testId = el.getAttribute("data-testid");
    if (testId) return "[data-testid=\\"" + testId + "\\"]";
    var parts = [];
    var current = el;
    while (current && current.tagName && current.tagName.toLowerCase() !== "body" && parts.length < 4) {
      var tagName = current.tagName.toLowerCase();
      var parent = current.parentElement;
      var siblings = parent ? Array.prototype.filter.call(parent.children, function (c) { return c.tagName === current.tagName; }) : [];
      var index = siblings.indexOf(current) + 1;
      parts.unshift(tagName + (siblings.length > 1 ? ":nth-of-type(" + index + ")" : ""));
      current = parent;
    }
    return (parts.join(" > ") || el.tagName.toLowerCase()).slice(0, 400);
  }
  function payload(el) {
    return { label: describe(el), selector: selectorFor(el), tagName: el.tagName.toLowerCase() };
  }
  function post(type, data) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: "litt-inspector", type: type, payload: data }, "*");
      }
    } catch (e) {}
  }

  function onOver(event) {
    if (!enabled) return;
    var el = pick(event.target);
    if (!el || el === hoverEl || el === selectedEl) return;
    if (hoverEl) restore(hoverEl, hoverPrev);
    hoverEl = el;
    hoverPrev = snapshot(el);
    el.style.outline = "2px dashed #9b4dff";
    el.style.outlineOffset = "2px";
    post("hover", payload(el));
  }
  function onClick(event) {
    if (!enabled) return;
    var el = pick(event.target);
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    if (selectedEl) restore(selectedEl, selectedPrev);
    selectedEl = el;
    selectedPrev = snapshot(el);
    el.style.outline = "2px solid #9b4dff";
    el.style.outlineOffset = "2px";
    el.style.boxShadow = "0 0 0 4px rgba(155,77,255,0.16)";
    post("select", payload(el));
  }
  function enable() {
    if (enabled) return;
    enabled = true;
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("click", onClick, true);
  }
  function disable() {
    enabled = false;
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("click", onClick, true);
    if (hoverEl) { restore(hoverEl, hoverPrev); hoverEl = null; hoverPrev = null; }
  }
  function clear() {
    if (selectedEl) { restore(selectedEl, selectedPrev); selectedEl = null; selectedPrev = null; }
  }

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.source !== "litt-inspector" || typeof data.type !== "string") return;
    if (data.token !== token) return;
    if (data.type === "enable") { enable(); post("ready"); }
    else if (data.type === "disable") disable();
    else if (data.type === "clear") clear();
  });
})();`;

/**
 * Inject the inspector script into an HTML document. Idempotent — pages
 * that already contain the marker are returned unchanged.
 */
export function injectInspector(html: string): string {
  if (html.includes("__littInspector")) return html;
  const snippet = `<script>${INSPECTOR_SCRIPT}</script>`;
  const lower = html.toLowerCase();
  const bodyEnd = lower.lastIndexOf("</body>");
  if (bodyEnd >= 0) return html.slice(0, bodyEnd) + snippet + html.slice(bodyEnd);
  const htmlEnd = lower.lastIndexOf("</html>");
  if (htmlEnd >= 0) return html.slice(0, htmlEnd) + snippet + html.slice(htmlEnd);
  return html + snippet;
}
