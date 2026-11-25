"use client";

/**
 * BoardBrowserPanel — a real embedded browser, shared by both
 * layouts: a board panel in the Board layout and a StudioDock tab in
 * the Regular layout. It is one surface with one home per layout —
 * never mounted twice at once.
 *
 * How it renders pages (rewritten 2026-11-20, Larry's "#2 priority"):
 * The panel used to point an iframe straight at the typed URL and
 * almost nothing loaded: the Studio page's own CSP restricts frame-src
 * to 'self' plus a small allowlist, and many sites additionally refuse
 * framing via X-Frame-Options / CSP frame-ancestors. The frame now
 * loads the same-origin browsing proxy
 * (src/app/api/studio/browser/proxy), which fetches the page
 * server-side, strips the framing refusals, and re-serves it in a
 * CSP-sandboxed opaque origin. See src/lib/studio/browser-proxy.ts for
 * the full diagnosis, security model, and honest limits (login
 * sessions and heavily app-like sites need a real remote browser;
 * that is a product decision above this panel).
 *
 * Navigation model:
 *   - Panel-driven navigation (address bar, back, forward, refresh,
 *     tab switch) sets the frame's src to the proxy URL for the tab's
 *     current real URL, and is tracked in a per-tab local history.
 *   - In-page navigation (link clicks, GET form submits) is
 *     intercepted by the bootstrap script injected into proxied
 *     documents, which postMessages each navigation to the panel;
 *     the panel then drives the load itself, through the same store
 *     patch as an address-bar navigation, so the address bar and
 *     history stay truthful and back/forward work for pages reached
 *     by clicking, not just by typing. The bootstrap deliberately
 *     does NOT navigate the frame: the proxied document runs in an
 *     opaque origin (CSP sandbox without allow-same-origin), so a
 *     self-navigation goes out as a cross-site request, the
 *     SameSite=Lax session cookies are withheld, and the auth-gated
 *     proxy's response is a page the frame must refuse — the
 *     "This content is blocked" failure on every in-page click
 *     (round 3, live-proven 2026-11-22). A parent-set src is a
 *     same-origin request and carries the session, so it loads.
 *   - Remounts (layout flips, tab switches, refresh) restore the
 *     frame from the tab's CURRENT history entry — never from the
 *     stored frameSrc alone. frameSrc names the last load the panel
 *     drove, and a `landed` redirect correction can replace the
 *     current history entry with the URL the frame actually
 *     reached, leaving frameSrc naming the pre-redirect page; a
 *     remounted frame fed from frameSrc would reload that older
 *     page, whose `landed` report would then replace the newest
 *     history entry with that old URL again. The panel snapshots
 *     the current entry's proxy URL when a frame instance mounts
 *     and loads that until the next panel-driven navigation (the
 *     tab's frameGeneration) makes frameSrc authoritative again.
 *   - Messages are trusted only when they come from this panel's own
 *     frame window and carry the proxy's source marker — a proxied
 *     document runs in an opaque origin, so origin alone proves
 *     nothing; the window identity is the check.
 *
 * Tabs: each tab keeps its own history; switching tabs reloads that
 * tab's current page (page state is not kept alive across switches —
 * history and address are). Tab state lives in the studio browser
 * store (stores/useStudioBrowserStore), not in this component: a
 * layout flip unmounts this panel, and the tabs must survive it.
 *
 * Blocked/failed handling: a bounded load watchdog (plus iframe error)
 * still guards every load; when it expires the panel shows an honest
 * couldn't-load state with Try again and Open in a new tab, instead of
 * the unexplained blank page this panel originally shipped.
 *
 * Token-bound surfaces; no pink.
 */

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, Globe, Plus, RefreshCw, X } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { BROWSER_PROXY_MESSAGE_SOURCE, browserProxyUrl } from "@/lib/studio/browser-proxy";
import {
  normalizeBrowserUrl,
  studioBrowserTabCurrentUrl as tabCurrentUrl,
  studioBrowserTabLabel as tabLabel,
  useStudioBrowserStore,
  type StudioBrowserTab,
} from "../../stores/useStudioBrowserStore";

// Kept on this module's surface for existing importers
// (BoardPanels.test.tsx reads it from here).
export { normalizeBrowserUrl };

/**
 * Generous bound for a proxied page to signal a usable load before the
 * panel presents the couldn't-load state. Exported for tests.
 */
export const BROWSER_EMBED_WATCHDOG_MS = 8000;

/**
 * The store patch for a panel-driven load of `url` in `tab`: record
 * the new frameSrc AND bump frameGeneration, which is what makes
 * frameSrc authoritative over the frame instance's mount snapshot
 * again. When the target's proxy URL equals the src the frame
 * already carries (`effectiveSrc` — e.g. re-entering the current
 * address, or a link to the page already showing), the src string
 * would not change and the frame would not move, so bump reloadKey
 * too: a fresh frame instance then actually loads it (its mount
 * snapshot is the target entry).
 *
 * One implementation for every navigation the panel drives —
 * address bar, back, forward, and (round 3) the loads it drives on
 * behalf of in-page clicks and GET form submits. Pure in the tab so
 * the mount-once message listener can use it from its ref mirrors,
 * not just the render body.
 */
function panelLoadPatchFor(
  tab: StudioBrowserTab,
  url: string,
  effectiveSrc: string | null,
): Partial<StudioBrowserTab> {
  const frameSrc = browserProxyUrl(url);
  return {
    input: url,
    frameSrc,
    frameGeneration: tab.frameGeneration + 1,
    ...(frameSrc === effectiveSrc ? { reloadKey: tab.reloadKey + 1 } : {}),
  };
}

export default function BoardBrowserPanel() {
  const { tokens } = useTheme();
  // Tab state lives in the store (see its header comment) so a layout
  // flip — which unmounts this panel — does not lose the user's tabs.
  const tabs = useStudioBrowserStore((s) => s.tabs);
  const activeTabId = useStudioBrowserStore((s) => s.activeTabId);
  const updateTab = useStudioBrowserStore((s) => s.updateTab);
  const setActiveTabId = useStudioBrowserStore((s) => s.setActiveTabId);
  const addTab = useStudioBrowserStore((s) => s.addTab);
  const closeTab = useStudioBrowserStore((s) => s.closeTab);
  const watchdogRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frameNodeRef = useRef<HTMLIFrameElement | null>(null);
  // Mirror of tabs for use inside the message listener without
  // re-subscribing on every state change.
  const tabsRef = useRef(tabs);
  const activeTabIdRef = useRef(activeTabId);
  // Sync the mirrors after commit (refs must not be written during
  // render — react-hooks/refs). The message listener only ever reads
  // them from an event, which fires after the commit that matters.
  useEffect(() => {
    tabsRef.current = tabs;
    activeTabIdRef.current = activeTabId;
  });

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];
  const currentUrl = activeTab ? tabCurrentUrl(activeTab) : null;

  // Frame-instance restore (see the header's Navigation model). A
  // frame instance is one mount of the iframe element: the panel
  // mounting, a tab switch, or a reloadKey bump — all of which
  // change frameInstanceKey. When an instance mounts, snapshot the
  // proxy URL for the tab's CURRENT history entry (restoreSrc); the
  // frame loads the snapshot while the tab's frameGeneration is the
  // one captured here, and the stored frameSrc takes over again as
  // soon as a panel-driven navigation bumps the generation. Before
  // the snapshot effect lands (the first render of a remount) the
  // frame already derives restoreSrc directly, so a stale frameSrc
  // is never even briefly loaded.
  const frameInstanceKey = `${activeTab?.id ?? "none"}:${activeTab?.reloadKey ?? 0}`;
  const restoreSrc = activeTab
    ? currentUrl
      ? browserProxyUrl(currentUrl)
      : activeTab.frameSrc
    : null;
  const [frameMount, setFrameMount] = useState<{
    key: string;
    generation: number;
    src: string | null;
  } | null>(null);
  useEffect(() => {
    if (!activeTab) return;
    setFrameMount({
      key: frameInstanceKey,
      generation: activeTab.frameGeneration,
      src: restoreSrc,
    });
    // Snapshot once per frame instance. In-page navigation changes
    // history (and therefore restoreSrc) but must NOT re-snapshot:
    // its load is driven by the generation bump making frameSrc
    // authoritative, and re-snapshotting mid-session would move
    // the restore point the generation check compares against.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frameInstanceKey]);
  const effectiveFrameSrc = !activeTab
    ? null
    : frameMount && frameMount.key === frameInstanceKey
      ? activeTab.frameGeneration === frameMount.generation
        ? frameMount.src
        : activeTab.frameSrc
      : restoreSrc;

  // Mirror of the frame's current effective src for the message
  // listener (same pattern as tabsRef above): the patch for an
  // in-page `navigate` must know whether its proxy URL differs from
  // the src the frame already carries. Synced after commit, like
  // the other mirrors — the listener only reads it from an event.
  const effectiveFrameSrcRef = useRef<string | null>(null);
  useEffect(() => {
    effectiveFrameSrcRef.current = effectiveFrameSrc;
  });

  const clearWatchdog = () => {
    if (watchdogRef.current !== null) {
      clearTimeout(watchdogRef.current);
      watchdogRef.current = null;
    }
  };

  const armWatchdog = (tabId: number) => {
    clearWatchdog();
    watchdogRef.current = setTimeout(() => {
      watchdogRef.current = null;
      updateTab(tabId, { status: "blocked" });
    }, BROWSER_EMBED_WATCHDOG_MS);
  };

  // Arm the watchdog for panel-driven loads: a new frame src, a
  // refresh (reloadKey remounts the frame), or switching to a tab that
  // has a page in flight. frameGeneration is a dep on purpose: it is
  // the one value that changes on EVERY panel-driven load request,
  // including Back/Forward to a page whose proxy URL the stored
  // frameSrc already names (the remount-restore case: the frame was
  // restored from the history snapshot, frameSrc still names the
  // older page, and the patch finds frameSrc unchanged and reloadKey
  // unbumped because the target differs from effectiveFrameSrc).
  // Without it, leaving the blocked state after such a Back changed
  // nothing this effect watches, so the failure screen stayed up
  // until Try again.
  useEffect(() => {
    if (!activeTab || !activeTab.frameSrc) return;
    updateTab(activeTab.id, { status: "loading" });
    armWatchdog(activeTab.id);
    return clearWatchdog;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeTab?.id,
    activeTab?.frameSrc,
    activeTab?.reloadKey,
    activeTab?.frameGeneration,
  ]);

  // In-page navigation sync from the proxied document's bootstrap.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameNodeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { source?: unknown; type?: unknown; url?: unknown } | null;
      if (!data || data.source !== BROWSER_PROXY_MESSAGE_SOURCE) return;
      // The framed document is attacker-controlled: it can postMessage
      // anything, including "javascript:…" URLs. Only plain http(s)
      // targets may drive navigation, history, or window.open —
      // anything else is dropped before it can reach the panel.
      if (typeof data.url !== "string" || !/^https?:\/\//i.test(data.url)) return;
      const tabId = activeTabIdRef.current;
      const tab = tabsRef.current.find((t) => t.id === tabId);
      if (!tab) return;
      const url = data.url;

      if (data.type === "landed") {
        // Redirect correction: the frame landed somewhere other than
        // the history entry we asked for — replace, don't push.
        if (tabCurrentUrl(tab) !== url) {
          const history = [...tab.history];
          if (tab.historyIndex >= 0) history[tab.historyIndex] = url;
          else history.push(url);
          updateTab(tabId, {
            history,
            historyIndex: history.length - 1,
            input: url,
            status: "loaded",
          });
        } else {
          updateTab(tabId, { status: "loaded" });
        }
        clearWatchdog();
      } else if (data.type === "navigate") {
        // Round 3: the panel drives this load itself, through the
        // same patch as an address-bar navigation. The bootstrap
        // used to navigate the frame directly, but the proxied
        // document runs in an opaque origin, so its self-navigation
        // went out as a cross-site request, the SameSite=Lax session
        // cookies were withheld, and the auth-gated proxy answered
        // with a page the frame must refuse ("This content is
        // blocked", live-proven 2026-11-22). A parent-driven src
        // change is a same-origin request and carries the session.
        // The history push stays exactly as before — one entry per
        // navigation — with the load patch merged into the same
        // store write.
        const patch = panelLoadPatchFor(tab, url, effectiveFrameSrcRef.current);
        if (tabCurrentUrl(tab) !== url) {
          const history = [...tab.history.slice(0, tab.historyIndex + 1), url];
          updateTab(tabId, {
            history,
            historyIndex: history.length - 1,
            status: "loading",
            ...patch,
          });
        } else {
          updateTab(tabId, { status: "loading", ...patch });
        }
        armWatchdog(tabId);
      } else if (data.type === "external") {
        // target=_blank links and POST forms: a real browser tab is
        // the honest home for these.
        window.open(url, "_blank", "noopener,noreferrer");
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!activeTab) return null;

  // Every panel-driven navigation goes through the one shared
  // patch (panelLoadPatchFor, above) — the message listener uses it
  // for in-page navigations too, computed from its ref mirrors.
  const panelLoadPatch = (url: string): Partial<StudioBrowserTab> =>
    panelLoadPatchFor(activeTab, url, effectiveFrameSrc);

  const navigate = (raw: string) => {
    const url = normalizeBrowserUrl(raw);
    if (!url) return;
    const history = [...activeTab.history.slice(0, activeTab.historyIndex + 1), url];
    updateTab(activeTab.id, {
      history,
      historyIndex: history.length - 1,
      ...panelLoadPatch(url),
    });
  };

  const goBack = () => {
    if (activeTab.historyIndex <= 0) return;
    const next = activeTab.historyIndex - 1;
    const url = activeTab.history[next] ?? "";
    updateTab(activeTab.id, {
      historyIndex: next,
      ...panelLoadPatch(url),
    });
  };

  const goForward = () => {
    if (activeTab.historyIndex >= activeTab.history.length - 1) return;
    const next = activeTab.historyIndex + 1;
    const url = activeTab.history[next] ?? "";
    updateTab(activeTab.id, {
      historyIndex: next,
      ...panelLoadPatch(url),
    });
  };

  // React's onError prop alone is not reliably delivered for <iframe>
  // in every environment, so also attach the native onerror property
  // through a ref callback; either path lands in the blocked state.
  const handleFrameError = () => {
    clearWatchdog();
    updateTab(activeTab.id, { status: "blocked" });
  };
  const frameRef = (node: HTMLIFrameElement | null) => {
    frameNodeRef.current = node;
    if (node) node.onerror = handleFrameError;
  };

  const openExternally = () => {
    if (!currentUrl) return;
    window.open(currentUrl, "_blank", "noopener,noreferrer");
  };

  const barButton =
    "flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5 disabled:opacity-40";

  return (
    <div
      className="flex h-full min-h-0 flex-col"
      data-testid="board-browser-panel"
      style={{ backgroundColor: tokens.surface, color: tokens.text }}
    >
      <div
        className="flex shrink-0 items-end gap-1 border-b px-2 pt-1.5"
        style={{ borderColor: tokens.border }}
        data-testid="board-browser-tabs"
      >
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="flex min-w-0 max-w-40 items-center gap-1 rounded-t-md border border-b-0 px-2 py-1"
            style={{
              borderColor: tokens.border,
              backgroundColor: tab.id === activeTab.id ? tokens.surface : "transparent",
              color: tab.id === activeTab.id ? tokens.text : tokens.textMuted,
            }}
          >
            <button
              type="button"
              data-testid="board-browser-tab"
              data-tab-id={tab.id}
              aria-label={`Tab: ${tabLabel(tab)}`}
              className="min-w-0 flex-1 truncate text-left text-[11px]"
              onClick={() => setActiveTabId(tab.id)}
            >
              {tabLabel(tab)}
            </button>
            <button
              type="button"
              data-testid="board-browser-close-tab"
              data-tab-id={tab.id}
              aria-label={`Close tab: ${tabLabel(tab)}`}
              className="flex h-4 w-4 shrink-0 items-center justify-center rounded hover:bg-black/10"
              onClick={() => closeTab(tab.id)}
            >
              <X size={10} aria-hidden />
            </button>
          </div>
        ))}
        <button
          type="button"
          data-testid="board-browser-new-tab"
          aria-label="New tab"
          className="mb-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
          style={{ color: tokens.text }}
          onClick={addTab}
        >
          <Plus size={13} aria-hidden />
        </button>
      </div>

      <div
        className="flex shrink-0 items-center gap-1 border-b px-2 py-1.5"
        style={{ borderColor: tokens.border }}
      >
        <button
          type="button"
          aria-label="Back"
          data-testid="board-browser-back"
          className={barButton}
          style={{ color: tokens.text }}
          disabled={activeTab.historyIndex <= 0}
          onClick={goBack}
        >
          <ArrowLeft size={13} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Forward"
          data-testid="board-browser-forward"
          className={barButton}
          style={{ color: tokens.text }}
          disabled={activeTab.historyIndex >= activeTab.history.length - 1}
          onClick={goForward}
        >
          <ArrowRight size={13} aria-hidden />
        </button>
        <button
          type="button"
          aria-label="Refresh"
          data-testid="board-browser-refresh"
          className={barButton}
          style={{ color: tokens.text }}
          disabled={!currentUrl}
          onClick={() => updateTab(activeTab.id, { reloadKey: activeTab.reloadKey + 1 })}
        >
          <RefreshCw size={12} aria-hidden />
        </button>
        <input
          data-testid="board-browser-input"
          value={activeTab.input}
          onChange={(e) => updateTab(activeTab.id, { input: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter") navigate(activeTab.input);
          }}
          placeholder="Enter a web address…"
          className="min-w-0 flex-1 rounded-full border bg-transparent px-3 py-1 text-xs outline-none"
          style={{ borderColor: tokens.border, color: tokens.text }}
        />
        {currentUrl && (
          <a
            data-testid="board-browser-open"
            href={currentUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="Open in a new tab"
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-black/5"
            style={{ color: tokens.text }}
          >
            <ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>

      {currentUrl ? (
        activeTab.status === "blocked" ? (
          <div
            className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"
            data-testid="board-browser-blocked"
            role="alert"
            style={{ backgroundColor: tokens.surface, color: tokens.text }}
          >
            <Globe size={22} style={{ color: tokens.textMuted }} aria-hidden />
            <p className="max-w-80 text-xs leading-5" style={{ color: tokens.text }}>
              This page couldn&apos;t be loaded in the panel. It may be down, too
              slow, or need a full browser — opening it in a new tab always works.
            </p>
            <p
              className="max-w-full truncate text-xs"
              data-testid="board-browser-blocked-url"
              style={{ color: tokens.textMuted }}
              title={currentUrl}
            >
              {currentUrl}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                data-testid="board-browser-blocked-open"
                onClick={openExternally}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: tokens.border, color: tokens.secondary }}
              >
                <ExternalLink size={12} aria-hidden />
                Open in a new tab
              </button>
              <button
                type="button"
                data-testid="board-browser-blocked-retry"
                onClick={() => updateTab(activeTab.id, { reloadKey: activeTab.reloadKey + 1 })}
                className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium"
                style={{ borderColor: tokens.border, color: tokens.text }}
              >
                <RefreshCw size={12} aria-hidden />
                Try again
              </button>
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col">
            {activeTab.status === "loading" && (
              <p
                data-testid="board-browser-loading"
                className="shrink-0 px-3 py-1.5 text-center text-[11px]"
                style={{ color: tokens.textMuted }}
              >
                Loading {currentUrl}…
              </p>
            )}
            <iframe
              ref={frameRef}
              key={`${activeTab.id}:${activeTab.reloadKey}`}
              data-testid="board-browser-frame"
              title="Board browser"
              src={effectiveFrameSrc ?? undefined}
              className="min-h-0 flex-1 border-0"
              style={{ backgroundColor: "#FFFFFF" }}
              sandbox="allow-scripts allow-forms allow-popups allow-modals"
              onLoad={() => {
                clearWatchdog();
                updateTab(activeTab.id, { status: "loaded" });
              }}
              onError={handleFrameError}
            />
          </div>
        )
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-6 text-center">
          <Globe size={22} style={{ color: tokens.textMuted }} aria-hidden />
          <p className="max-w-60 text-xs leading-5" style={{ color: tokens.textMuted }}>
            Browse the web without leaving Studio. Pages load through
            LiTT&apos;s browser view — most sites work; a few that need a
            full browser can be opened in a new tab instead.
          </p>
        </div>
      )}
    </div>
  );
}
