"use client";

/**
 * Studio shell visual harness (client). Composes the real shell components
 * against fixtures:
 *   - WorkspaceRail + WorktabBar (real, fixture tabs)
 *   - A same-origin fixture page in an iframe (a hero section) with the
 *     real SelectionOverlay on top — click any element to select it;
 *     the overlay measures the live node (same path as production
 *     same-origin previews)
 *   - ContextInspector (real) with the real ElementInspectorPanel as its
 *     editor, fed by an injected stub edit pipeline (visual verification
 *     only — the real pipeline is untouched)
 *   - The real CommandComposer with the thin ComposerContextStrip:
 *     Design · HeroSection · h2 · Desktop
 *
 * No auth, no backend. Dev-only (the route 404s in production).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import WorkspaceRail from "../(app)/studio/components/shell/WorkspaceRail";
import WorktabBar from "../(app)/studio/components/WorktabBar";
import ContextInspector from "../(app)/studio/components/shell/ContextInspector";
import ElementInspectorPanel, {
  type ElementEdits,
} from "../(app)/studio/components/shell/ElementInspectorPanel";
import SelectionOverlay from "../(app)/studio/components/shell/SelectionOverlay";
import CommandComposer from "../(app)/studio/components/CommandComposer";
import ComposerContextStrip from "../(app)/studio/components/shell/ComposerContextStrip";
import { STAGE_SURFACE_META, type StudioStageSurface } from "../(app)/studio/components/shell/stage-surfaces";
import type { StudioSelectionPayload } from "../(app)/studio/context/StudioContext";
import type { Worktab } from "../(app)/studio/hooks/useServerWorktabs";

/* ── Fixture page (same-origin via srcDoc) ─────────────────────────── */

const FIXTURE_HTML = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: ui-sans-serif, system-ui, sans-serif; background: #0b0714; color: #f2ecff; }
  .hero { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; padding: 72px 48px;
    background: radial-gradient(900px 480px at 20% 10%, rgba(155,77,255,0.22), transparent 60%),
                radial-gradient(700px 420px at 85% 80%, rgba(56,189,248,0.14), transparent 60%), #0b0714; }
  .eyebrow { font-size: 12px; letter-spacing: 0.28em; text-transform: uppercase; color: #b794ff; margin-bottom: 20px; }
  h2.hero-title { font-size: 64px; line-height: 1.05; font-weight: 800; letter-spacing: -0.02em; max-width: 14ch; }
  h2.hero-title .accent { color: #b794ff; }
  .lede { margin-top: 20px; font-size: 18px; line-height: 1.6; color: rgba(242,236,255,0.72); max-width: 52ch; }
  .cta-row { margin-top: 36px; display: flex; gap: 12px; }
  .cta { font-size: 15px; font-weight: 700; padding: 14px 28px; border-radius: 12px; border: 0; cursor: pointer;
    background: #9b4dff; color: #fff; box-shadow: 0 8px 32px rgba(155,77,255,0.4); }
  .ghost { font-size: 15px; font-weight: 700; padding: 14px 28px; border-radius: 12px; cursor: pointer;
    background: transparent; color: #f2ecff; border: 1px solid rgba(255,255,255,0.2); }
  .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; padding: 48px; }
  .card { border: 1px solid rgba(255,255,255,0.1); border-radius: 16px; padding: 24px; background: rgba(255,255,255,0.03); }
  .card h3 { font-size: 18px; margin-bottom: 8px; }
  .card p { font-size: 14px; color: rgba(242,236,255,0.6); line-height: 1.5; }
  @media (max-width: 560px) {
    .hero { padding: 56px 24px; }
    h2.hero-title { font-size: 44px; overflow-wrap: break-word; }
    .lede { font-size: 16px; }
    .cards { grid-template-columns: 1fr; padding: 32px 24px; }
  }
</style></head>
<body>
  <section class="hero" data-component="HeroSection">
    <div class="eyebrow">LiTT Studio · Fixture site</div>
    <h2 class="hero-title" data-harness-hero>Build something <span class="accent">extraordinary</span> tonight.</h2>
    <p class="lede">Describe what you want in plain English. LiTT designs it, builds it, and shows you the real thing — then you refine it by pointing and chatting.</p>
    <div class="cta-row">
      <button class="cta">Start building</button>
      <button class="ghost">Watch it work</button>
    </div>
  </section>
  <section class="cards">
    <div class="card"><h3>Describe once</h3><p>No config gauntlet. Say what you want and LiTT takes it from there.</p></div>
    <div class="card"><h3>Point to change</h3><p>Click any element to inspect and edit its real properties.</p></div>
    <div class="card"><h3>Ship it live</h3><p>Preview, verify, and deploy without touching a terminal.</p></div>
  </section>
</body></html>`;

/* ── Stub edit pipeline (harness visual verification only) ──────────── */

function makeStubEdits(): ElementEdits {
  return {
    status: "ready",
    statusReason: null,
    filePath: "src/app/page.tsx",
    history: [],
    historyIndex: -1,
    canUndo: false,
    canRedo: false,
    resolve: async () => undefined,
    applyPatch: async () => true,
    undo: async () => true,
    redo: async () => true,
    reset: () => undefined,
  };
}

const FIXTURE_TABS: Worktab[] = [
  { id: "task-1", title: "Build the hero section", conversationId: null, surface: "studio/design", selection: null, createdAt: Date.now() - 3600_000 },
  { id: "task-2", title: "Untitled 2", conversationId: null, surface: "studio/preview", selection: null, createdAt: Date.now() - 600_000 },
];

const STYLE_PROPS = [
  "font-size", "font-weight", "font-style", "line-height", "letter-spacing", "text-align",
  "color", "background-color", "padding", "margin", "width", "height", "display",
  "border", "border-radius", "box-shadow", "position", "flex-direction", "flex-wrap",
  "justify-content", "align-items", "gap", "visibility",
];

function selectionFromElement(el: HTMLElement): StudioSelectionPayload {
  const win = el.ownerDocument.defaultView ?? window;
  const cs = win.getComputedStyle(el);
  const styles: Record<string, string> = {};
  for (const prop of STYLE_PROPS) {
    const v = cs.getPropertyValue(prop);
    if (v) styles[prop] = v.trim();
  }
  const section = el.closest("[data-component]");
  const componentName = section?.getAttribute("data-component") ?? undefined;
  const tag = el.tagName.toLowerCase();
  const text = (el as HTMLElement).innerText?.slice(0, 120) ?? "";
  return {
    kind: "preview-element",
    label: text ? `${componentName ?? "Element"} ${tag}` : `${componentName ?? tag}`,
    selector: `[data-harness-hero], .hero-title`,
    tagName: tag,
    componentName,
    styles,
    text: el instanceof HTMLButtonElement || /^h[1-6]$|p$/.test(tag) ? text : undefined,
    projectId: "harness",
    timestamp: Date.now(),
  };
}

export default function HarnessClient() {
  const [surface, setSurface] = useState<StudioStageSurface>("design");
  const [tabs] = useState<Worktab[]>(FIXTURE_TABS);
  const [activeTabId, setActiveTabId] = useState<string>("task-1");
  const [inspectorOpen, setInspectorOpen] = useState<boolean>(() =>
    typeof window === "undefined" ? true : window.innerWidth >= 768,
  );
  const [composerValue, setComposerValue] = useState("");
  const [selection, setSelection] = useState<StudioSelectionPayload | null>(null);
  const [anchorNode, setAnchorNode] = useState<HTMLElement | null>(null);
  const [stubEdits] = useState<ElementEdits>(makeStubEdits);
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  const selectElement = useCallback((el: HTMLElement | null) => {
    if (!el) {
      setSelection(null);
      setAnchorNode(null);
      return;
    }
    setSelection(selectionFromElement(el));
    setAnchorNode(el);
  }, []);

  // Same-origin fixture instrumentation: click-to-select, like the real
  // preview panel's same-origin path. Defaults to the hero heading.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const onLoad = () => {
      const doc = iframe.contentDocument;
      if (!doc) return;
      const hero = doc.querySelector<HTMLElement>("[data-harness-hero]");
      selectElement(hero);
      const onClick = (e: MouseEvent) => {
        const t = e.target as HTMLElement | null;
        const el = t?.closest?.("h1,h2,h3,h4,p,button,a,section,div") as HTMLElement | null;
        if (!el || el === doc.body || el === doc.documentElement) return;
        e.preventDefault();
        selectElement(el);
      };
      doc.addEventListener("click", onClick, true);
      (iframe as unknown as { _harnessCleanup?: () => void })._harnessCleanup = () =>
        doc.removeEventListener("click", onClick, true);
    };
    iframe.addEventListener("load", onLoad);
    // srcDoc iframes can finish loading before this effect runs — in that
    // case the load event already fired and we select immediately.
    if (iframe.contentDocument?.readyState === "complete") {
      onLoad();
    }
    return () => {
      iframe.removeEventListener("load", onLoad);
      (iframe as unknown as { _harnessCleanup?: () => void })._harnessCleanup?.();
    };
  }, [selectElement]);

  const askLitt = useCallback(() => {
    window.dispatchEvent(new CustomEvent("studio:ask-litt", { detail: { selection } }));
  }, [selection]);

  const clearSelection = useCallback(() => selectElement(null), [selectElement]);

  return (
    <div
      className="flex h-screen w-screen flex-col overflow-hidden"
      style={{ backgroundColor: "#0b0714", color: "var(--text-main, #f2ecff)" }}
      data-testid="studio-shell-harness"
    >
      <WorktabBar
        tabs={tabs}
        activeId={activeTabId}
        badges={{}}
        onSwitch={setActiveTabId}
        onClose={() => undefined}
        onNew={() => undefined}
        closedTabs={[]}
        onReopen={() => undefined}
      />
      <div className="flex min-h-0 flex-1">
        <WorkspaceRail active={surface} onSelect={setSurface} />

        {/* Preview zone — the website owns the screen */}
        <div className="relative flex min-w-0 flex-1 flex-col">
          <div
            ref={wrapRef}
            className="relative min-h-0 flex-1 overflow-auto"
            style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
            data-testid="harness-preview-wrap"
          >
            <iframe
              ref={iframeRef}
              title="Harness fixture site"
              srcDoc={FIXTURE_HTML}
              className="h-full w-full border-0 bg-white"
              sandbox="allow-scripts allow-same-origin"
              data-testid="harness-iframe"
            />
            <SelectionOverlay
              selection={
                selection
                  ? {
                      ...selection,
                      selector: selection.selector ?? "",
                      tagName: selection.tagName ?? "",
                    }
                  : null
              }
              projectId={null}
              anchorNode={anchorNode}
              iframeRef={iframeRef}
              containerRef={wrapRef}
              onAskAboutSelection={askLitt}
              edits={stubEdits}
            />
          </div>
        </div>

        {/* Inspector — side panel on desktop, overlay drawer on small screens */}
        <div
          className={
            inspectorOpen
              ? "absolute inset-y-0 right-0 z-30 shadow-2xl md:static md:z-auto md:shadow-none"
              : "md:contents"
          }
        >
        <ContextInspector
          open={inspectorOpen}
          onToggle={() => setInspectorOpen((v) => !v)}
          selection={
            selection
              ? { label: selection.label, tagName: selection.tagName }
              : null
          }
          onAskAboutSelection={askLitt}
          onClearSelection={clearSelection}
          propertiesContent={null}
          editor={
            selection ? (
              <ElementInspectorPanel
                selection={selection}
                projectId={null}
                route="/"
                onAskAboutSelection={askLitt}
                onClearSelection={clearSelection}
                edits={stubEdits}
              />
            ) : undefined
          }
          defaultContent={
            <div className="p-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
              Select an element in the preview.
            </div>
          }
        />
        </div>
      </div>

      {/* LiTT — thin task-aware command bar */}
      <CommandComposer
        value={composerValue}
        onChange={setComposerValue}
        onSend={async () => undefined}
        contextStrip={
          <ComposerContextStrip
            surfaceLabel={STAGE_SURFACE_META[surface].label}
            componentName={selection?.componentName ?? null}
            tagName={selection?.tagName ?? null}
            viewport="Desktop"
            projectName="Harness"
          />
        }
      />
    </div>
  );
}
