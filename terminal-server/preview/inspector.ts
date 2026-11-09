/**
 * Preview inspector bridge.
 *
 * Studio embeds preview pages served by this proxy inside a cross-origin
 * iframe, so the parent page cannot touch the frame's DOM directly. To
 * support element selection we inject a small script into proxied HTML
 * documents that implements a postMessage protocol:
 *
 *   child → parent: { source: "litt-inspector", type: "ready"|"hover"|"select"|"style-probe"|"geometry-commit"|"geometry-cancel", payload }
 *   parent → child: { source: "litt-inspector", type: "enable"|"disable"|"clear"|"tool"|"snap"|"align", token, ... }
 *
 * The "style-probe" message reports whether Tailwind utilities actually
 * applied ({ tailwindDetected, styled }): when the page loads the Tailwind
 * browser build but renders unstyled (the v4 @import trap), Studio must not
 * keep showing a green "Preview ready" badge.
 *
 * Inbound commands are only accepted from window.parent and must carry
 * the preview access token (the same token already required to load the
 * preview), so arbitrary cross-origin embedders cannot drive the
 * inspector. The child posts to "*" because it cannot know the parent
 * origin; payloads are non-sensitive DOM metadata (label/selector/tag/
 * attributes/computed styles) used to identify and edit the element.
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
  var ATTR_PROPS = ["id", "class", "data-testid", "src", "href", "alt", "role", "aria-label", "type", "name", "value", "placeholder"];
  var STYLE_PROPS = ["color", "background-color", "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align", "padding", "margin", "display", "gap", "justify-content", "align-items", "border", "border-radius", "width", "height", "opacity"];
  function pathFor(el) {
    var parts = [];
    var current = el;
    while (current && current.tagName && parts.length < 8) {
      var tagName = current.tagName.toLowerCase();
      var parent = current.parentElement;
      var siblings = parent ? Array.prototype.filter.call(parent.children, function (c) { return c.tagName === current.tagName; }) : [];
      var index = siblings.indexOf(current) + 1;
      parts.unshift(tagName + (siblings.length > 1 ? ":nth-of-type(" + index + ")" : ""));
      current = parent;
    }
    return parts.join(" > ").slice(0, 600);
  }
  function textOf(el) {
    if (!el) return "";
    var t = "";
    try {
      t = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim();
    } catch (e) {}
    return t.slice(0, 240);
  }
  function payload(el) {
    var attrs = {};
    for (var i = 0; i < ATTR_PROPS.length; i++) {
      try {
        var v = el.getAttribute(ATTR_PROPS[i]);
        if (v != null && v !== "") attrs[ATTR_PROPS[i]] = String(v).slice(0, 200);
      } catch (e) {}
    }
    var styles = {};
    try {
      var cs = window.getComputedStyle(el);
      for (var j = 0; j < STYLE_PROPS.length; j++) {
        var sv = cs.getPropertyValue(STYLE_PROPS[j]);
        if (sv) styles[STYLE_PROPS[j]] = String(sv).slice(0, 120);
      }
    } catch (e) {}
    var rect = { width: 0, height: 0 };
    try {
      var r = el.getBoundingClientRect();
      rect = { width: Math.round(r.width), height: Math.round(r.height) };
    } catch (e) {}
    return {
      label: describe(el),
      selector: selectorFor(el),
      tagName: el.tagName.toLowerCase(),
      attrs: attrs,
      styles: styles,
      text: textOf(el),
      path: pathFor(el),
      rect: rect,
    };
  }
  function post(type, data) {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ source: "litt-inspector", type: type, payload: data }, "*");
      }
    } catch (e) {}
  }

  function onOver(event) {
    if (!enabled || isUiTarget(event.target)) return;
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
    if (isUiTarget(event.target)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (Date.now() < suppressClickUntil) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
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
    renderHandles();
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
    endGesture(true);
    clearDynamicUi();
    clearHandles();
    if (hoverEl) { restore(hoverEl, hoverPrev); hoverEl = null; hoverPrev = null; }
  }
  function clear() {
    endGesture(true);
    if (selectedEl) { restore(selectedEl, selectedPrev); selectedEl = null; selectedPrev = null; }
    clearHandles();
  }

  // ── Canvas gestures (Design surface) ──────────────────────────────
  // The parent drives these via "tool"/"snap"/"align" commands; commits
  // go out as "geometry-commit" carrying the full element payload plus a
  // semantic change the parent turns into a workspace-file patch.
  // Live-preview styles applied during a drag are tentative: pointer-up
  // restores the element's inline cssText and the real write reloads the
  // frame via files-changed — the DOM is never the persisted truth.
  var tool = "select";
  var snapOn = true;
  var gesture = null;
  var panState = null;
  var suppressClickUntil = 0;
  var uiHost = null;
  var dynamicUi = [];
  var SNAP_PX = 6;
  var HANDLE_DIRS = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  var HANDLE_CURSOR = { nw: "nwse-resize", se: "nwse-resize", ne: "nesw-resize", sw: "nesw-resize", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize" };

  function isUiTarget(t) {
    return !!(t && t.getAttribute && t.getAttribute("data-litt-ui"));
  }
  function ensureUiHost() {
    if (uiHost && uiHost.parentNode) return uiHost;
    uiHost = document.createElement("div");
    uiHost.setAttribute("data-litt-ui", "1");
    uiHost.style.cssText = "position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
    (document.body || document.documentElement).appendChild(uiHost);
    return uiHost;
  }
  function clearDynamicUi() {
    for (var i = 0; i < dynamicUi.length; i++) {
      try { if (dynamicUi[i].parentNode) dynamicUi[i].parentNode.removeChild(dynamicUi[i]); } catch (e) {}
    }
    dynamicUi = [];
  }
  function uiLine(orientation, pos, color) {
    var d = document.createElement("div");
    d.setAttribute("data-litt-ui", "1");
    if (orientation === "v") {
      d.style.cssText = "position:fixed;left:" + pos + "px;top:0;width:0;height:100vh;border-left:2px solid " + color + ";";
    } else {
      d.style.cssText = "position:fixed;top:" + pos + "px;left:0;width:100vw;height:0;border-top:2px solid " + color + ";";
    }
    ensureUiHost().appendChild(d);
    dynamicUi.push(d);
    return d;
  }
  function uiBox(rect, color, dashed) {
    var d = document.createElement("div");
    d.setAttribute("data-litt-ui", "1");
    d.style.cssText = "position:fixed;left:" + rect.left + "px;top:" + rect.top + "px;width:" + rect.width + "px;height:" + rect.height + "px;border:2px " + (dashed ? "dashed" : "solid") + " " + color + ";pointer-events:none;box-sizing:border-box;";
    ensureUiHost().appendChild(d);
    dynamicUi.push(d);
    return d;
  }
  function clearHandles() {
    if (!uiHost) return;
    var kids = uiHost.querySelectorAll ? uiHost.querySelectorAll("[data-litt-handle]") : [];
    for (var i = 0; i < kids.length; i++) {
      try { kids[i].parentNode.removeChild(kids[i]); } catch (e) {}
    }
  }
  function renderHandles() {
    clearHandles();
    if (tool !== "edit" || !enabled || !selectedEl || gesture) return;
    var r;
    try { r = selectedEl.getBoundingClientRect(); } catch (e) { return; }
    if (!r || (!r.width && !r.height)) return;
    var host = ensureUiHost();
    var size = 9;
    for (var i = 0; i < HANDLE_DIRS.length; i++) {
      var dir = HANDLE_DIRS[i];
      var h = document.createElement("div");
      h.setAttribute("data-litt-ui", "1");
      h.setAttribute("data-litt-handle", dir);
      var x = dir.indexOf("w") >= 0 ? r.left - size / 2 : dir.indexOf("e") >= 0 ? r.right - size / 2 : r.left + r.width / 2 - size / 2;
      var y = dir.indexOf("n") >= 0 ? r.top - size / 2 : dir.indexOf("s") >= 0 ? r.bottom - size / 2 : r.top + r.height / 2 - size / 2;
      h.style.cssText = "position:fixed;left:" + x + "px;top:" + y + "px;width:" + size + "px;height:" + size + "px;background:#9b4dff;border:1.5px solid #fff;border-radius:2px;pointer-events:auto;cursor:" + HANDLE_CURSOR[dir] + ";box-sizing:border-box;";
      host.appendChild(h);
    }
  }

  function identityFor(el) {
    var attrs = {};
    var names = ["id", "class", "data-testid"];
    for (var i = 0; i < names.length; i++) {
      var v = null;
      try { v = el.getAttribute(names[i]); } catch (e) {}
      if (v) attrs[names[i]] = String(v).slice(0, 200);
    }
    return { selector: selectorFor(el), tagName: el.tagName.toLowerCase(), attrs: attrs, path: pathFor(el) };
  }

  // Whether 'parent' may validly contain a child of 'childTag' — prevents
  // committing reorders that produce broken markup (li outside ul, div
  // inside p, …). Unknown/edge parents default to allowed; the file-side
  // patch still verifies unique identity before writing.
  function canContain(parent, childTag) {
    var pt = parent.tagName.toLowerCase();
    if (pt === "ul" || pt === "ol") return childTag === "li";
    if (pt === "dl") return childTag === "dt" || childTag === "dd";
    if (pt === "table" || pt === "thead" || pt === "tbody" || pt === "tfoot" || pt === "tr") {
      return ["tr", "td", "th", "thead", "tbody", "tfoot", "caption", "colgroup"].indexOf(childTag) >= 0;
    }
    if (pt === "select" || pt === "optgroup") return childTag === "option" || childTag === "optgroup";
    if (["p", "h1", "h2", "h3", "h4", "h5", "h6", "button", "a", "label", "span", "strong", "em", "small", "li", "td", "th", "option", "textarea", "title", "figcaption"].indexOf(pt) >= 0) return false;
    return true;
  }

  // Drop target for a flow reorder: climb from the element under the
  // pointer to the nearest container that can hold the dragged tag,
  // then pick the sibling slot by pointer position on the parent's
  // main axis (row-flex → x, everything else → y).
  function findDrop(x, y) {
    var dragEl = selectedEl;
    if (!dragEl) return null;
    var under = null;
    try { under = document.elementFromPoint(x, y); } catch (e) { return null; }
    if (!under || under === dragEl || dragEl.contains(under) || isUiTarget(under)) return null;
    var dragTag = dragEl.tagName.toLowerCase();
    var node = under;
    while (node && node !== document.body && node !== document.documentElement) {
      if (node !== dragEl && !dragEl.contains(node) && canContain(node, dragTag)) {
        var cs = window.getComputedStyle(node);
        var horizontal = /row/.test(cs.flexDirection || "");
        var kids = [];
        for (var i = 0; i < node.children.length; i++) {
          var c = node.children[i];
          if (c === dragEl || dragEl.contains(c)) continue;
          kids.push(c);
        }
        if (kids.length === 0) return { parent: node, ref: node, position: "into" };
        var idx = kids.length;
        for (var j = 0; j < kids.length; j++) {
          var cr = kids[j].getBoundingClientRect();
          var mid = horizontal ? cr.left + cr.width / 2 : cr.top + cr.height / 2;
          if ((horizontal ? x : y) < mid) { idx = j; break; }
        }
        if (idx < kids.length) return { parent: node, ref: kids[idx], position: "before" };
        return { parent: node, ref: kids[kids.length - 1], position: "after" };
      }
      node = node.parentElement;
    }
    return null;
  }

  function drawDropLine(d) {
    if (!d || !d.ref || !d.ref.getBoundingClientRect) return;
    var r = d.ref.getBoundingClientRect();
    if (d.position === "into") { uiBox(r, "#9b4dff", true); return; }
    var pcs = window.getComputedStyle(d.parent);
    var horizontal = /row/.test(pcs.flexDirection || "");
    if (horizontal) {
      uiLine("v", d.position === "before" ? r.left - 1 : r.right + 1, "#22d3ee");
    } else {
      uiLine("h", d.position === "before" ? r.top - 1 : r.bottom + 1, "#22d3ee");
    }
  }

  // Snap candidates: parent content edges + center, every sibling's
  // edges/centers, and the viewport frame. All in client (viewport) px.
  function snapTargets() {
    var xs = [], ys = [];
    var el = selectedEl;
    var parent = el ? el.parentElement : null;
    if (parent) {
      var pcs = window.getComputedStyle(parent);
      var pr = parent.getBoundingClientRect();
      function px(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
      var cl = pr.left + px(pcs.borderLeftWidth) + px(pcs.paddingLeft);
      var cr = pr.right - px(pcs.borderRightWidth) - px(pcs.paddingRight);
      var ct = pr.top + px(pcs.borderTopWidth) + px(pcs.paddingTop);
      var cb = pr.bottom - px(pcs.borderBottomWidth) - px(pcs.paddingBottom);
      xs.push(cl, (cl + cr) / 2, cr);
      ys.push(ct, (ct + cb) / 2, cb);
      for (var i = 0; i < parent.children.length; i++) {
        var c = parent.children[i];
        if (c === el || (el && el.contains(c))) continue;
        var r = c.getBoundingClientRect();
        xs.push(r.left, r.left + r.width / 2, r.right);
        ys.push(r.top, r.top + r.height / 2, r.bottom);
      }
    }
    xs.push(0, window.innerWidth / 2, window.innerWidth);
    ys.push(0, window.innerHeight / 2, window.innerHeight);
    return { xs: xs, ys: ys };
  }

  // Whole-element translate snap (offset-positioned drags): snap the
  // element's left/centerX/right (and top/centerY/bottom) edges.
  function snapMove(origRect, dx, dy) {
    var t = snapTargets();
    var ex = [origRect.left + dx, origRect.left + origRect.width / 2 + dx, origRect.right + dx];
    var ey = [origRect.top + dy, origRect.top + origRect.height / 2 + dy, origRect.bottom + dy];
    var bx = null, by = null;
    for (var i = 0; i < ex.length; i++) {
      for (var j = 0; j < t.xs.length; j++) {
        var ddx = t.xs[j] - ex[i];
        if (Math.abs(ddx) <= SNAP_PX && (!bx || Math.abs(ddx) < Math.abs(bx.d))) bx = { d: ddx, pos: t.xs[j] };
      }
    }
    for (var a = 0; a < ey.length; a++) {
      for (var b = 0; b < t.ys.length; b++) {
        var ddy = t.ys[b] - ey[a];
        if (Math.abs(ddy) <= SNAP_PX && (!by || Math.abs(ddy) < Math.abs(by.d))) by = { d: ddy, pos: t.ys[b] };
      }
    }
    return { dx: dx + (bx ? bx.d : 0), dy: dy + (by ? by.d : 0), gx: bx ? bx.pos : null, gy: by ? by.pos : null };
  }

  function startMove(e) {
    var r = selectedEl.getBoundingClientRect();
    var cs = window.getComputedStyle(selectedEl);
    function px(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
    gesture = {
      mode: "move", pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      dx: 0, dy: 0, moved: false,
      offset: cs.position !== "static",
      origLeft: px(cs.left), origTop: px(cs.top),
      origRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      origCss: selectedEl.style.cssText,
      drop: null, sdx: 0, sdy: 0,
    };
    try { selectedEl.style.pointerEvents = "none"; document.body.style.userSelect = "none"; } catch (err) {}
    clearHandles();
    document.documentElement.style.cursor = "grabbing";
  }

  function startResize(e, dir) {
    var r = selectedEl.getBoundingClientRect();
    var cs = window.getComputedStyle(selectedEl);
    function px(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
    gesture = {
      mode: "resize", dir: dir, pointerId: e.pointerId,
      startX: e.clientX, startY: e.clientY,
      moved: false, shift: !!e.shiftKey,
      origW: r.width, origH: r.height,
      origLeft: px(cs.left), origTop: px(cs.top),
      origPos: cs.position,
      borderBox: cs.boxSizing === "border-box",
      padX: px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth),
      padY: px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth),
      origRect: { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height },
      origCss: selectedEl.style.cssText,
      hasW: dir.indexOf("w") >= 0, hasN: dir.indexOf("n") >= 0,
      hasE: dir.indexOf("e") >= 0, hasS: dir.indexOf("s") >= 0,
      r: null,
    };
    try { document.body.style.userSelect = "none"; } catch (err) {}
    document.documentElement.style.cursor = HANDLE_CURSOR[dir] || "nwse-resize";
  }

  // Resolve drag deltas into concrete box styles. 'dx'/'dy' are pointer
  // deltas; w/n handles move the left/top edges (and may introduce
  // position:relative on static elements so the write stays honest).
  function computeResize(g, dx, dy) {
    if (g.hasE) dx = Math.max(dx, 8 - g.origW);
    if (g.hasW) dx = Math.min(dx, g.origW - 8);
    if (g.hasS) dy = Math.max(dy, 8 - g.origH);
    if (g.hasN) dy = Math.min(dy, g.origH - 8);
    if (g.shift && ((g.hasE || g.hasW) && (g.hasS || g.hasN))) {
      if (Math.abs(dx) >= Math.abs(dy)) dy = dx * g.origH / g.origW;
      else dx = dy * g.origW / g.origH;
      if (g.hasE) dx = Math.max(dx, 8 - g.origW);
      if (g.hasW) dx = Math.min(dx, g.origW - 8);
      if (g.hasS) dy = Math.max(dy, 8 - g.origH);
      if (g.hasN) dy = Math.min(dy, g.origH - 8);
    }
    var w = g.origW + (g.hasE ? dx : 0) - (g.hasW ? dx : 0);
    var h = g.origH + (g.hasS ? dy : 0) - (g.hasN ? dy : 0);
    var needRel = g.origPos === "static" && (g.hasW || g.hasN);
    var left = (g.origPos === "static" ? 0 : g.origLeft) + (g.hasW ? dx : 0);
    var top = (g.origPos === "static" ? 0 : g.origTop) + (g.hasN ? dy : 0);
    return {
      w: g.borderBox ? w : Math.max(1, w - g.padX),
      h: g.borderBox ? h : Math.max(1, h - g.padY),
      left: left, top: top, needRel: needRel, dx: dx, dy: dy,
    };
  }

  function applyResizePreview(nd) {
    try {
      selectedEl.style.width = nd.w + "px";
      selectedEl.style.height = nd.h + "px";
      if (nd.needRel) selectedEl.style.position = "relative";
      if (gesture.hasW) selectedEl.style.left = nd.left + "px";
      if (gesture.hasN) selectedEl.style.top = nd.top + "px";
    } catch (e) {}
  }

  // Snap only the edges this resize actually moves.
  function snapResize(g, nd) {
    var t = snapTargets();
    var bx = null, by = null;
    var movingX = [];
    if (g.hasE) movingX.push(g.origRect.right + nd.dx);
    if (g.hasW) movingX.push(g.origRect.left + nd.dx);
    var movingY = [];
    if (g.hasS) movingY.push(g.origRect.bottom + nd.dy);
    if (g.hasN) movingY.push(g.origRect.top + nd.dy);
    for (var i = 0; i < movingX.length; i++) {
      for (var j = 0; j < t.xs.length; j++) {
        var ddx = t.xs[j] - movingX[i];
        if (Math.abs(ddx) <= SNAP_PX && (!bx || Math.abs(ddx) < Math.abs(bx.d))) bx = { d: ddx, pos: t.xs[j] };
      }
    }
    for (var a = 0; a < movingY.length; a++) {
      for (var b = 0; b < t.ys.length; b++) {
        var ddy = t.ys[b] - movingY[a];
        if (Math.abs(ddy) <= SNAP_PX && (!by || Math.abs(ddy) < Math.abs(by.d))) by = { d: ddy, pos: t.ys[b] };
      }
    }
    return {
      dx: nd.dx + (bx ? bx.d : 0),
      dy: nd.dy + (by ? by.d : 0),
      gx: bx ? bx.pos : null,
      gy: by ? by.pos : null,
    };
  }

  function endGesture(cancelled) {
    var g = gesture;
    gesture = null;
    panState = null;
    clearDynamicUi();
    try {
      document.documentElement.style.cursor = "";
      document.body.style.userSelect = "";
    } catch (e) {}
    if (tool === "pan") {
      try { document.documentElement.style.touchAction = ""; } catch (e) {}
    }
    if (!g) { renderHandles(); return; }
    if (!selectedEl) { clearHandles(); return; }
    selectedEl.style.pointerEvents = "";
    if (!g.moved || cancelled) {
      if (g.origCss != null) { try { selectedEl.style.cssText = g.origCss; } catch (e) {} }
      renderHandles();
      return;
    }
    // Restore tentative styles, then describe the semantic change — the
    // parent resolves the element against file bytes and writes it.
    if (g.origCss != null) { try { selectedEl.style.cssText = g.origCss; } catch (e) {} }
    var change = null;
    if (g.mode === "move") {
      if (g.offset) {
        change = { kind: "offset", styles: { left: (g.origLeft + g.sdx) + "px", top: (g.origTop + g.sdy) + "px" } };
      } else if (g.drop && g.drop.ref) {
        change = { kind: "reorder", position: g.drop.position, ref: identityFor(g.drop.ref) };
      }
    } else if (g.mode === "resize" && g.r) {
      var styles = { width: g.r.w + "px", height: g.r.h + "px" };
      if (g.r.needRel) styles.position = "relative";
      if (g.hasW) styles.left = g.r.left + "px";
      if (g.hasN) styles.top = g.r.top + "px";
      change = { kind: "resize", styles: styles };
    }
    if (change) {
      var p = payload(selectedEl);
      p.change = change;
      post("geometry-commit", p);
    }
    renderHandles();
  }

  function onGestureDown(e) {
    if (!enabled || e.button !== 0) return;
    if (isUiTarget(e.target)) {
      var h = e.target.getAttribute ? e.target.getAttribute("data-litt-handle") : null;
      if (h && tool === "edit" && selectedEl && !gesture) {
        e.preventDefault();
        e.stopPropagation();
        startResize(e, h);
      }
      return;
    }
    if (tool === "pan") {
      e.preventDefault();
      panState = { x: e.clientX, y: e.clientY, moved: false };
      try { document.body.style.userSelect = "none"; document.documentElement.style.touchAction = "none"; } catch (err) {}
      document.documentElement.style.cursor = "grab";
      return;
    }
    if (tool !== "edit" || !selectedEl || gesture) return;
    if (pick(e.target) === selectedEl) {
      e.preventDefault();
      e.stopPropagation();
      startMove(e);
    }
  }
  function onGestureMove(e) {
    if (panState) {
      var px = e.clientX - panState.x, py = e.clientY - panState.y;
      if (px || py) {
        panState.moved = true;
        suppressClickUntil = Date.now() + 400;
        try { window.scrollBy(-px, -py); } catch (err) {}
        panState.x = e.clientX;
        panState.y = e.clientY;
      }
      return;
    }
    if (!gesture) return;
    var dx = e.clientX - gesture.startX, dy = e.clientY - gesture.startY;
    if (!gesture.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    if (!gesture.moved) {
      gesture.moved = true;
      suppressClickUntil = Date.now() + 400;
    }
    if (gesture.mode === "move") {
      gesture.dx = dx;
      gesture.dy = dy;
      clearDynamicUi();
      if (gesture.offset) {
        var st = snapOn ? snapMove(gesture.origRect, dx, dy) : { dx: dx, dy: dy, gx: null, gy: null };
        gesture.sdx = st.dx;
        gesture.sdy = st.dy;
        try {
          selectedEl.style.left = (gesture.origLeft + st.dx) + "px";
          selectedEl.style.top = (gesture.origTop + st.dy) + "px";
        } catch (err) {}
        if (st.gx != null) uiLine("v", st.gx, "rgba(155,77,255,0.9)");
        if (st.gy != null) uiLine("h", st.gy, "rgba(155,77,255,0.9)");
      } else {
        try { selectedEl.style.transform = "translate(" + dx + "px," + dy + "px)"; } catch (err) {}
        var d = findDrop(e.clientX, e.clientY);
        if (d) gesture.drop = d;
        drawDropLine(gesture.drop);
      }
    } else if (gesture.mode === "resize") {
      gesture.shift = !!e.shiftKey;
      var nd = computeResize(gesture, dx, dy);
      if (snapOn) {
        var sn = snapResize(gesture, nd);
        nd = computeResize(gesture, sn.dx, sn.dy);
        if (sn.gx != null) uiLine("v", sn.gx, "rgba(245,158,11,0.9)");
        if (sn.gy != null) uiLine("h", sn.gy, "rgba(245,158,11,0.9)");
      }
      gesture.r = nd;
      applyResizePreview(nd);
    }
  }
  function onGestureUp(e) {
    if (panState) {
      if (panState.moved) suppressClickUntil = Date.now() + 400;
      endGesture(true);
      return;
    }
    if (gesture) endGesture(false);
  }
  function handleAlign(a) {
    if (!enabled || !selectedEl) return;
    var el = selectedEl;
    var parent = el.parentElement;
    if (!parent) return;
    var r = el.getBoundingClientRect();
    var pr = parent.getBoundingClientRect();
    var pcs = window.getComputedStyle(parent);
    function px(v) { var n = parseFloat(v); return isFinite(n) ? n : 0; }
    var contentL = pr.left + px(pcs.borderLeftWidth) + px(pcs.paddingLeft);
    var contentR = pr.right - px(pcs.borderRightWidth) - px(pcs.paddingRight);
    var contentT = pr.top + px(pcs.borderTopWidth) + px(pcs.paddingTop);
    var contentB = pr.bottom - px(pcs.borderBottomWidth) - px(pcs.paddingBottom);
    var styles = {};
    if (a === "left") { styles["margin-left"] = "0px"; styles["margin-right"] = "auto"; }
    else if (a === "center") { styles["margin-left"] = "auto"; styles["margin-right"] = "auto"; }
    else if (a === "right") { styles["margin-left"] = "auto"; styles["margin-right"] = "0px"; }
    else if (a === "top" || a === "middle" || a === "bottom") {
      var cs = window.getComputedStyle(el);
      var contentH = contentB - contentT;
      var target = a === "top" ? contentT : a === "middle" ? contentT + contentH / 2 - r.height / 2 : contentB - r.height;
      var curTop = cs.position === "static" ? 0 : px(cs.top);
      var newTop = curTop + (target - r.top);
      if (cs.position === "static") styles.position = "relative";
      styles.top = newTop + "px";
    } else {
      return;
    }
    var p = payload(el);
    p.change = { kind: "align", styles: styles };
    post("geometry-commit", p);
  }
  function setTool(next) {
    tool = next === "pan" || next === "edit" ? next : "select";
    clearDynamicUi();
    if (gesture || panState) endGesture(true);
    try { document.documentElement.style.touchAction = tool === "pan" ? "none" : ""; } catch (e) {}
    renderHandles();
  }

  document.addEventListener("pointerdown", onGestureDown, true);
  document.addEventListener("pointermove", onGestureMove, true);
  document.addEventListener("pointerup", onGestureUp, true);
  document.addEventListener("pointercancel", onGestureUp, true);
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && (gesture || panState)) { endGesture(true); e.preventDefault(); }
  }, true);
  window.addEventListener("scroll", function () { if (tool === "edit" && selectedEl && !gesture && enabled) renderHandles(); }, true);
  window.addEventListener("resize", function () { if (tool === "edit" && selectedEl && !gesture && enabled) renderHandles(); });

  // Style probe (P0: Tailwind v4 @import trap). The Tailwind browser build
  // silently compiles zero utilities when a text/tailwindcss block carries
  // any @import without tailwindcss — the page renders fully unstyled with
  // no error. The parent cannot see the frame's DOM (cross-origin), so the
  // injected script probes itself: if the page intends Tailwind (browser
  // CDN script or a text/tailwindcss block present), drop a hidden probe
  // element carrying a core utility class and check getComputedStyle.
  // Poll briefly because the browser build compiles asynchronously after
  // load — a slow CDN must not be misreported as a styling failure.
  function tailwindIntent() {
    try {
      if (document.querySelector('script[src*="tailwindcss"]')) return true;
      if (document.querySelector('style[type="text/tailwindcss"]')) return true;
    } catch (e) {}
    return false;
  }
  function runStyleProbe() {
    if (!tailwindIntent()) {
      post("style-probe", { tailwindDetected: false, styled: true });
      return;
    }
    var probe = document.createElement("div");
    probe.setAttribute("class", "hidden");
    probe.setAttribute("aria-hidden", "true");
    probe.setAttribute("style", "position:absolute;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;");
    var host = document.body || document.documentElement;
    try { host.appendChild(probe); } catch (e) { post("style-probe", { tailwindDetected: true, styled: false }); return; }
    var attempts = 0;
    function done(styled) {
      try { if (probe.parentNode) probe.parentNode.removeChild(probe); } catch (e) {}
      post("style-probe", { tailwindDetected: true, styled: styled });
    }
    function check() {
      var display = "";
      try { display = window.getComputedStyle(probe).display; } catch (e) {}
      if (display === "none") { done(true); return; }
      attempts++;
      if (attempts >= 10) { done(false); return; }
      window.setTimeout(check, 1000);
    }
    window.setTimeout(check, 1500);
  }
  function scheduleStyleProbe() {
    window.setTimeout(runStyleProbe, 0);
  }
  if (document.readyState === "complete") scheduleStyleProbe();
  else window.addEventListener("load", scheduleStyleProbe);

  window.addEventListener("message", function (event) {
    if (event.source !== window.parent) return;
    var data = event.data;
    if (!data || data.source !== "litt-inspector" || typeof data.type !== "string") return;
    if (data.token !== token) return;
    if (data.type === "enable") { enable(); post("ready"); }
    else if (data.type === "disable") disable();
    else if (data.type === "clear") clear();
    else if (data.type === "tool") setTool(data.tool);
    else if (data.type === "snap") { snapOn = !!data.enabled; }
    else if (data.type === "align") handleAlign(data.align);
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
