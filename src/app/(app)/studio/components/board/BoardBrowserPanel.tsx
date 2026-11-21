"use client";

/**
 * BoardBrowserPanel — a real embedded browser on the board.
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
 *   - In-page navigation (link clicks, GET form submits) is routed
 *     through the proxy by the bootstrap script injected into proxied
 *     documents; that script postMessages each navigation back, so the
 *     address bar and history stay truthful and back/forward work for
 *     pages reached by clicking, not just by typing.
 *   - Messages are trusted only when they come from this panel's own
 *     frame window and carry the proxy's source marker — a proxied
 *     document runs in an opaque origin, so origin alone proves
 *     nothing; the window identity is the check.
 *
 * Tabs: each tab keeps its own history; switching tabs reloads that
 * tab's current page (page state is not kept alive across switches —
 * history and address are).
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

/**
 * Generous bound for a proxied page to signal a usable load before the
 * panel presents the couldn't-load state. Exported for tests.
 */
export const BROWSER_EMBED_WATCHDOG_MS = 8000;

type EmbedStatus = "loading" | "loaded" | "blocked";

interface BrowserTabState {
  id: number;
  history: string[];
  historyIndex: number;
  input: string;
  reloadKey: number;
  /** Proxy URL the frame should load; null when the tab has no page yet. */
  frameSrc: string | null;
  status: EmbedStatus;
}

/** Normalize a typed address into a loadable URL, or null if empty. */
export function normalizeBrowserUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^about:/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function tabCurrentUrl(tab: BrowserTabState): string | null {
  return tab.historyIndex >= 0 ? tab.history[tab.historyIndex] : null;
}

function tabLabel(tab: BrowserTabState): string {
  const url = tabCurrentUrl(tab);
  if (!url) return "New tab";
  try {
    return new URL(url).hostname || url;
  } catch {
    return url;
  }
}

let nextTabId = 1;
function freshTab(): BrowserTabState {
  return {
    id: nextTabId++,
    history: [],
    historyIndex: -1,
    input: "",
    reloadKey: 0,
    frameSrc: null,
    status: "loaded",
  };
}

export default function BoardBrowserPanel() {
  const { tokens } = useTheme();
  const [tabs, setTabs] = useState<BrowserTabState[]>(() => [freshTab()]);
  const [activeTabId, setActiveTabId] = useState<number>(() => tabs[0]?.id ?? 1);
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

  const updateTab = (tabId: number, patch: Partial<BrowserTabState>) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...patch } : t)));
  };

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
  // has a page in flight.
  useEffect(() => {
    if (!activeTab || !activeTab.frameSrc) return;
    updateTab(activeTab.id, { status: "loading" });
    armWatchdog(activeTab.id);
    return clearWatchdog;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id, activeTab?.frameSrc, activeTab?.reloadKey]);

  // In-page navigation sync from the proxied document's bootstrap.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameNodeRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as { source?: unknown; type?: unknown; url?: unknown } | null;
      if (!data || data.source !== BROWSER_PROXY_MESSAGE_SOURCE) return;
      if (typeof data.url !== "string" || !data.url) return;
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
        // The frame is already navigating itself (the bootstrap set
        // its location); record the destination so back/forward and
        // the address bar stay truthful, and guard the load.
        if (tabCurrentUrl(tab) !== url) {
          const history = [...tab.history.slice(0, tab.historyIndex + 1), url];
          updateTab(tabId, { history, historyIndex: history.length - 1, input: url, status: "loading" });
        } else {
          updateTab(tabId, { status: "loading" });
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

  const navigate = (raw: string) => {
    const url = normalizeBrowserUrl(raw);
    if (!url) return;
    const history = [...activeTab.history.slice(0, activeTab.historyIndex + 1), url];
    updateTab(activeTab.id, {
      history,
      historyIndex: history.length - 1,
      input: url,
      frameSrc: browserProxyUrl(url),
    });
  };

  const goBack = () => {
    if (activeTab.historyIndex <= 0) return;
    const next = activeTab.historyIndex - 1;
    const url = activeTab.history[next] ?? "";
    updateTab(activeTab.id, {
      historyIndex: next,
      input: url,
      frameSrc: browserProxyUrl(url),
    });
  };

  const goForward = () => {
    if (activeTab.historyIndex >= activeTab.history.length - 1) return;
    const next = activeTab.historyIndex + 1;
    const url = activeTab.history[next] ?? "";
    updateTab(activeTab.id, {
      historyIndex: next,
      input: url,
      frameSrc: browserProxyUrl(url),
    });
  };

  const addTab = () => {
    const tab = freshTab();
    setTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  };

  const closeTab = (tabId: number) => {
    const idx = tabs.findIndex((t) => t.id === tabId);
    if (idx < 0) return;
    const next = tabs.filter((t) => t.id !== tabId);
    if (next.length === 0) {
      const replacement = freshTab();
      setTabs([replacement]);
      setActiveTabId(replacement.id);
      return;
    }
    if (tabId === activeTabId) {
      const neighbor = next[Math.min(idx, next.length - 1)];
      setActiveTabId(neighbor.id);
    }
    setTabs(next);
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
              src={activeTab.frameSrc ?? undefined}
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
