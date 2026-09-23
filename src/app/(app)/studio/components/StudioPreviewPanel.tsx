"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, ExternalLink, Eye, Loader2, Monitor, MousePointer2, RefreshCw, RotateCcw, Smartphone, Square, Tablet, X } from "lucide-react";
import { useClerkAuth } from "@/hooks/useClerkAuth";
import { formatSourceSummary } from "@/lib/projects/project-source";
import { useExecutionStore } from "../stores/useExecutionStore";

/**
 * Preview states — the five canonical states the UI explicitly supports.
 * These are NEVER collapsed into a generic "Preview unavailable":
 *   not_started  — workspace/runtime never provisioned (auto-starts)
 *   starting      — workspace provisioning + dev server starting + health check
 *   ready         — dev server healthy, preview URL available
 *   unreachable   — runtime status check failed (terminal server down/network)
 *   failed        — startup or health check failed (reason exposed)
 *
 * Internal transitional states (loading, stale, restarting) are kept for
 * UX but map onto the canonical five for display.
 */
type PreviewState = "loading" | "not_started" | "starting" | "ready" | "stale" | "unreachable" | "failed" | "restarting";
type DeviceMode = "desktop" | "tablet" | "mobile";

export interface PreviewSelection {
  label: string;
  selector: string;
  tagName: string;
}

const DEVICE_DIMENSIONS: Record<DeviceMode, { w: number; h: number; label: string }> = {
  desktop: { w: 0, h: 0, label: "1280 × 720" },
  tablet: { w: 768, h: 1024, label: "768 × 1024" },
  mobile: { w: 390, h: 844, label: "390 × 844" },
};

/** Runtime status indicator color by state. */
const STATUS_DOT_COLOR: Record<PreviewState, string> = {
  loading: "#8b5cf6",
  starting: "#e3b341",
  restarting: "#e3b341",
  ready: "#48EE38",
  stale: "#e3b341",
  unreachable: "#6b7280",
  failed: "#EF4444",
  not_started: "#6b7280",
};

/**
 * Startup phase for the staged loading display. The runtime reports one
 * aggregated "starting" state — the only HONEST distinctions derivable from
 * the existing status logic are:
 *   provision  — the workspace lifecycle itself is still provisioning
 *                (workspaceStatus "preparing"/"provisioning")
 *   devserver  — workspace provisioning is done (workspaceStatus "ready")
 *                while the runtime still reports "starting"
 * "Health check" is never marked current: nothing in the status payload
 * distinguishes it, so it stays upcoming until the preview is ready.
 * null means the stage cannot be distinguished — the panel then renders the
 * single honest "Preparing preview…" state instead of inventing stages.
 */
type StartPhase = "provision" | "devserver" | null;
const START_STAGES = ["Provision", "Dev server", "Health check"] as const;

function deriveStartPhase(state: PreviewState, workspaceStatus: string | null, runtimeStatusRaw: string | null): StartPhase {
  if (state !== "starting" && state !== "restarting") return null;
  // A restart re-starts the dev server; provisioning is not repeated.
  if (state === "restarting") return "devserver";
  if (workspaceStatus === "preparing" || workspaceStatus === "provisioning") return "provision";
  if (workspaceStatus === "ready" && runtimeStatusRaw === "starting") return "devserver";
  return null;
}

interface PreviewPayload {
  runtimeStatus?: unknown;
  previewUrl?: unknown;
  runtimeError?: unknown;
  runtimeErrorCode?: unknown;
  framework?: unknown;
  developmentCommand?: unknown;
  packageManager?: unknown;
  logs?: unknown;
  port?: unknown;
}

function describePreviewElement(element: HTMLElement): string {
  const explicitLabel = element.getAttribute("aria-label") || element.getAttribute("data-testid") || element.getAttribute("role");
  if (explicitLabel) return explicitLabel.replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  const semanticLabels: Record<string, string> = {
    nav: "Navigation",
    header: "Header",
    main: "Main content",
    footer: "Footer",
    form: "Form",
    button: "Button",
    a: "Link",
    img: "Image",
    h1: "Heading",
    h2: "Heading",
    section: "Section",
  };
  if (semanticLabels[element.tagName.toLowerCase()]) return semanticLabels[element.tagName.toLowerCase()];
  const text = element.textContent?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 42) : element.tagName.toLowerCase();
}

function selectorForPreviewElement(element: HTMLElement): string {
  if (element.id) return `#${element.id}`;
  const testId = element.getAttribute("data-testid");
  if (testId) return `[data-testid=\"${testId}\"]`;
  const parts: string[] = [];
  let current: HTMLElement | null = element;
  while (current && current.tagName.toLowerCase() !== "body" && parts.length < 4) {
    const tag = current.tagName.toLowerCase();
    const currentTagName = current.tagName;
    const parent: HTMLElement | null = current.parentElement;
    const siblings: Element[] = parent ? Array.from(parent.children).filter((child: Element) => child.tagName === currentTagName) : [];
    const index = siblings.indexOf(current) + 1;
    parts.unshift(`${tag}${siblings.length > 1 ? `:nth-of-type(${index})` : ""}`);
    current = parent;
  }
  return parts.join(" > ") || element.tagName.toLowerCase();
}

function statusFromPayload(payload: PreviewPayload, workspaceStatus: string | null): { state: PreviewState; url: string | null; error: string | null; errorCode: string | null } {
  const runtimeStatus = typeof payload.runtimeStatus === "string" ? payload.runtimeStatus : "stopped";
  const url = typeof payload.previewUrl === "string" && payload.previewUrl ? payload.previewUrl : null;
  const error = typeof payload.runtimeError === "string" && payload.runtimeError ? payload.runtimeError : null;
  const errorCode = typeof payload.runtimeErrorCode === "string" && payload.runtimeErrorCode ? payload.runtimeErrorCode : null;
  if (runtimeStatus === "ready" && url) return { state: "ready", url, error: null, errorCode: null };
  if (runtimeStatus === "starting") return { state: "starting", url, error, errorCode };
  if (runtimeStatus === "restarting") return { state: "restarting", url, error, errorCode };
  if (runtimeStatus === "failed") return { state: "failed", url, error: error ?? "Preview dev server crashed or failed to start", errorCode };
  if (runtimeStatus === "unreachable") return { state: "unreachable", url, error: error ?? "Preview runtime is unreachable", errorCode };
  if (runtimeStatus === "not_started") return { state: "not_started", url, error, errorCode };
  if (["preparing", "provisioning"].includes(workspaceStatus ?? "")) return { state: "starting", url, error, errorCode };
  if (workspaceStatus === "failed" || workspaceStatus === "error") return { state: "failed", url, error: error ?? "Workspace preparation failed", errorCode };
  if (runtimeStatus === "stopped") {
    // Workspace exists but dev server isn't running — treat as not_started so
    // the auto-start flow kicks in (it's idempotent for an existing workspace).
    return { state: "not_started", url, error, errorCode };
  }
  if (workspaceStatus !== "ready") return { state: "not_started", url, error, errorCode };
  return { state: "unreachable", url, error, errorCode };
}

export default function StudioPreviewPanel({
  projectId,
  projectName,
  repositoryName,
  branch,
  workspaceStatus,
  sourceKind = null,
  sourceStatus = null,
  versionControl = "none",
  refreshKey = 0,
  onSelectionChange,
}: {
  projectId: string | null;
  projectName: string | null;
  /** Connected GitHub repository ("owner/repo"), or null. OPTIONAL. */
  repositoryName: string | null;
  branch: string | null;
  workspaceStatus: string | null;
  /** Who owns the durable source: LiTT ("managed") or GitHub. */
  sourceKind?: "managed" | "github" | null;
  /** Provisioning state of the source itself. */
  sourceStatus?: "provisioning" | "ready" | "error" | "needs_setup" | null;
  /** Whether the workspace has a Git repository. Managed projects do. */
  versionControl?: "git" | "none";
  refreshKey?: number;
  onSelectionChange?: (selection: PreviewSelection | null) => void;
}) {
  const { getToken } = useClerkAuth();
  const [state, setState] = useState<PreviewState>(projectId ? "loading" : "not_started");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [deviceMode, setDeviceMode] = useState<DeviceMode>("desktop");
  const [maximized, setMaximized] = useState(false);
  const [framework, setFramework] = useState<string | null>(null);
  const [devCommand, setDevCommand] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [iframeFailed, setIframeFailed] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [selectionMode, setSelectionMode] = useState(true);
  const [selectedElement, setSelectedElement] = useState<PreviewSelection | null>(null);
  const [selectionError, setSelectionError] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [startPhase, setStartPhase] = useState<StartPhase>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const selectionCleanupRef = useRef<(() => void) | null>(null);
  const selectedElementRef = useRef<PreviewSelection | null>(null);
  const selectedNodeRef = useRef<HTMLElement | null>(null);
  const selectedNodeStyleRef = useRef<{ outline: string; outlineOffset: string; boxShadow: string } | null>(null);
  // Cross-origin inspector bridge state. The preview iframe is served from
  // the terminal-server host, so iframe.contentDocument is inaccessible;
  // the proxy injects a postMessage bridge (terminal-server/preview/
  // inspector.ts) that reports hover/select events instead.
  const bridgeRef = useRef<{ origin: string; token: string; ready: boolean; target: Window | null } | null>(null);
  const bridgeTimerRef = useRef<number | null>(null);
  // Single-flight guard: ensures only one preview start is in flight at a
  // time. Mobile rerenders and rapid prop changes cannot launch duplicate
  // runtimes. The guard persists across renders (useRef) and is checked at
  // the start of preparePreview and auto-start.
  const startInFlightRef = useRef(false);
  // Track which projectId we've auto-started for so we don't re-trigger on
  // every render of the same project (e.g. after it reaches "ready").
  const autoStartedForRef = useRef<string | null>(null);
  // Sequence counter for status fetches — late responses from an older
  // request must never overwrite newer state.
  const statusSeqRef = useRef(0);
  // Bounded startup polling: a start that never resolves must become a
  // terminal failure, never an infinite spinner.
  const startPollAttemptsRef = useRef(0);
  const MAX_START_POLL_ATTEMPTS = 40; // 40 × 3s ≈ 2 minutes
  // Set by the files-changed handler so the next status check that reports
  // ready also reloads the iframe (a "stale" preview must actually refresh).
  const reloadFrameOnNextReadyRef = useRef(false);

  const postInspectorCommand = useCallback((type: "enable" | "disable" | "clear") => {
    const bridge = bridgeRef.current;
    if (!bridge?.target) return;
    try {
      bridge.target.postMessage({ source: "litt-inspector", type, token: bridge.token }, bridge.origin);
    } catch {
      // Frame navigated away mid-flight — the next load re-attaches.
    }
  }, []);

  const clearSelection = useCallback((notify = true) => {
    postInspectorCommand("clear");
    if (!selectedNodeRef.current && !selectedElementRef.current) return;
    if (selectedNodeRef.current && selectedNodeStyleRef.current) {
      selectedNodeRef.current.style.outline = selectedNodeStyleRef.current.outline;
      selectedNodeRef.current.style.outlineOffset = selectedNodeStyleRef.current.outlineOffset;
      selectedNodeRef.current.style.boxShadow = selectedNodeStyleRef.current.boxShadow;
    }
    selectedNodeRef.current = null;
    selectedNodeStyleRef.current = null;
    selectedElementRef.current = null;
    setSelectedElement(null);
    if (notify) onSelectionChange?.(null);
  }, [onSelectionChange, postInspectorCommand]);

  const attachSelection = useCallback(() => {
    selectionCleanupRef.current?.();
    selectionCleanupRef.current = null;
    if (!selectionMode) return;
    let documentInFrame: Document | null = null;
    try {
      documentInFrame = iframeRef.current?.contentDocument ?? null;
    } catch {
      documentInFrame = null;
    }

    if (!documentInFrame) {
      // Cross-origin preview (the normal case — previews are served by the
      // terminal-server host). Try the injected inspector bridge; if the
      // frame is not instrumented the bridge never answers and we report
      // selection as unavailable rather than pretending it works.
      let origin: string;
      let token: string;
      try {
        const parsed = new URL(previewUrl ?? "", window.location.href);
        origin = parsed.origin;
        token = parsed.searchParams.get("token") ?? "";
      } catch {
        setSelectionError("Element selection is unavailable for this preview.");
        return;
      }
      const target = iframeRef.current?.contentWindow ?? null;
      if (!target) {
        setSelectionError("Element selection is unavailable for this preview.");
        return;
      }
      const bridge = { origin, token, ready: false, target };
      bridgeRef.current = bridge;
      const onMessage = (event: MessageEvent) => {
        if (bridgeRef.current !== bridge) return;
        if (event.source !== bridge.target || event.origin !== bridge.origin) return;
        const data = event.data as { source?: unknown; type?: unknown; payload?: unknown } | null;
        if (!data || data.source !== "litt-inspector" || typeof data.type !== "string") return;
        if (data.type === "ready") {
          bridge.ready = true;
          if (bridgeTimerRef.current) {
            window.clearTimeout(bridgeTimerRef.current);
            bridgeTimerRef.current = null;
          }
          setSelectionError(null);
          return;
        }
        if (data.type === "select") {
          const p = data.payload as Record<string, unknown> | null;
          if (p && typeof p.label === "string" && typeof p.selector === "string" && typeof p.tagName === "string") {
            const nextSelection: PreviewSelection = {
              label: p.label.slice(0, 120),
              selector: p.selector.slice(0, 400),
              tagName: p.tagName.slice(0, 40),
            };
            selectedElementRef.current = nextSelection;
            setSelectedElement(nextSelection);
            onSelectionChange?.(nextSelection);
          }
        }
      };
      window.addEventListener("message", onMessage);
      // "enable" doubles as the handshake: the injected script replies
      // "ready" on receipt. No reply within the window means the preview
      // is not instrumented (external URL, CSP block, older terminal
      // server) — surface that truthfully.
      try {
        target.postMessage({ source: "litt-inspector", type: "enable", token }, origin);
      } catch {
        // Frame navigated away; the load handler will re-attach.
      }
      bridgeTimerRef.current = window.setTimeout(() => {
        bridgeTimerRef.current = null;
        if (!bridge.ready) {
          setSelectionError("Element selection is unavailable for this preview.");
        }
      }, 2500);
      selectionCleanupRef.current = () => {
        window.removeEventListener("message", onMessage);
        if (bridgeTimerRef.current) {
          window.clearTimeout(bridgeTimerRef.current);
          bridgeTimerRef.current = null;
        }
        bridgeRef.current = null;
      };
      return;
    }

    // Same-origin preview — direct DOM instrumentation.
    setSelectionError(null);
    const handleClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const element = (target.closest("nav,header,main,section,footer,form,button,a,[role]") ?? target) as HTMLElement;
      event.preventDefault();
      event.stopPropagation();
      clearSelection(false);
      selectedNodeRef.current = element;
      selectedNodeStyleRef.current = {
        outline: element.style.outline,
        outlineOffset: element.style.outlineOffset,
        boxShadow: element.style.boxShadow,
      };
      element.style.outline = "2px solid #9b4dff";
      element.style.outlineOffset = "2px";
      element.style.boxShadow = "0 0 0 4px rgba(155,77,255,0.16)";
      const nextSelection: PreviewSelection = {
        label: describePreviewElement(element),
        selector: selectorForPreviewElement(element),
        tagName: element.tagName.toLowerCase(),
      };
      selectedElementRef.current = nextSelection;
      setSelectedElement(nextSelection);
      onSelectionChange?.(nextSelection);
    };
    documentInFrame.addEventListener("click", handleClick, true);
    selectionCleanupRef.current = () => documentInFrame.removeEventListener("click", handleClick, true);
  }, [clearSelection, onSelectionChange, selectionMode, previewUrl]);

  const handleIframeLoad = useCallback(() => {
    setIframeFailed(false);
    clearSelection(false);
    window.setTimeout(attachSelection, 0);
  }, [attachSelection, clearSelection]);

  useEffect(() => () => {
    selectionCleanupRef.current?.();
    clearSelection(false);
  }, [clearSelection]);

  const authHeaders = useCallback(async (): Promise<HeadersInit> => {
    const token = await getToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, [getToken]);

  const loadStatus = useCallback(async (stale = false) => {
    if (!projectId) {
      setState("not_started");
      setPreviewUrl(null);
      setError(null);
      clearSelection(false);
      return;
    }
    const seq = ++statusSeqRef.current;
    if (stale) setState((current) => current === "ready" ? "stale" : current);
    else setState("loading");
    setIframeFailed(false);
    try {
      const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/preview`, {
        cache: "no-store",
        credentials: "include",
        headers: await authHeaders(),
        // A hung status check must not wedge the panel in "loading" forever.
        signal: AbortSignal.timeout(15000),
      });
      // Ignore late responses — a newer request has already superseded this one.
      if (seq !== statusSeqRef.current) return;
      const payload = await response.json().catch(() => null) as PreviewPayload | null;
      if (!response.ok || !payload) {
        throw new Error(typeof payload?.runtimeError === "string" ? payload.runtimeError : `Preview status failed (${response.status})`);
      }
      const next = statusFromPayload(payload, workspaceStatus);
      const runtimeStatusRaw = typeof payload.runtimeStatus === "string" ? payload.runtimeStatus : null;
      // Display-only: pin the staged-loading indicator to what the status
      // logic can truthfully distinguish. null → the honest single state.
      setStartPhase(deriveStartPhase(next.state, workspaceStatus, runtimeStatusRaw));
      setState((prevState) => {
        // Only reload iframe when transitioning from non-ready to ready,
        // or when a file change explicitly requested a refresh.
        const shouldReloadFrame =
          (next.state === "ready" && prevState !== "ready" && prevState !== "stale") ||
          (next.state === "ready" && reloadFrameOnNextReadyRef.current);
        if (shouldReloadFrame) {
          reloadFrameOnNextReadyRef.current = false;
          setFrameKey((value) => value + 1);
        }
        return next.state;
      });
      setPreviewUrl(next.url);
      setError(next.error);
      setErrorCode(next.errorCode);
      setFramework(typeof payload.framework === "string" ? payload.framework : null);
      setDevCommand(typeof payload.developmentCommand === "string" ? payload.developmentCommand : null);
      setLogs(Array.isArray(payload.logs) ? payload.logs as string[] : []);
    } catch (loadError) {
      if (seq !== statusSeqRef.current) return;
      setState("unreachable");
      setError(loadError instanceof Error ? loadError.message : "Preview runtime is unreachable");
    }
  }, [authHeaders, clearSelection, projectId, workspaceStatus]);

  useEffect(() => {
    // Reset auto-start tracking when the project changes so a new project
    // gets a fresh auto-start.
    autoStartedForRef.current = null;
    startPollAttemptsRef.current = 0;
    reloadFrameOnNextReadyRef.current = false;
    statusSeqRef.current++;
    setStartPhase(null);
    void loadStatus();
  }, [loadStatus]);

  // Refresh when refreshKey prop changes (used by CodeWorkspace split view
  // and the permanent preview column's workspaceRevision prop)
  useEffect(() => {
    if (refreshKey > 0) void loadStatus(true);
  }, [loadStatus, refreshKey]);

  // Welcome-screen bridge: the blank-state preview (terminal-server/
  // workspace/welcome-screen.ts) posts `litt-welcome` messages when the user
  // taps a starter prompt or the Start Building CTA. Turn those into the
  // canonical `studio:ask-litt` event so LiTT chat opens with the prompt
  // pre-filled. The message is only honored when it comes from this panel's
  // own preview iframe — anything else is ignored.
  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const frame = iframeRef.current?.contentWindow ?? null;
      if (!frame || event.source !== frame) return;
      const data = event.data as { source?: unknown; type?: unknown; prompt?: unknown } | null;
      if (!data || data.source !== "litt-welcome" || typeof data.type !== "string") return;
      if (data.type === "starter-prompt") {
        if (typeof data.prompt !== "string") return;
        const prompt = data.prompt.slice(0, 500).trim();
        if (!prompt) return;
        window.dispatchEvent(new CustomEvent("studio:ask-litt", { detail: { prompt } }));
        return;
      }
      if (data.type === "welcome-cta") {
        window.dispatchEvent(new CustomEvent("studio:ask-litt", { detail: {} }));
      }
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, []);

  // The terminal-server proxy serves an honest error page (instead of the
  // backend's white "Cannot GET /") when the dev server 404s the entry
  // path at proxy time, and that page postMessages us. Flip the badge
  // immediately instead of waiting for the 30s status poll — the user
  // must never see "Preview ready" over a dead iframe.
  useEffect(() => {
    if (!projectId || !previewUrl) return;
    let previewOrigin: string | null = null;
    try {
      previewOrigin = new URL(previewUrl, window.location.href).origin;
    } catch {
      return;
    }
    const handler = (event: MessageEvent) => {
      if (event.origin !== previewOrigin) return;
      const data = event.data as { source?: unknown; type?: unknown } | null;
      if (!data || data.source !== "litt-preview" || data.type !== "preview-entry-missing") return;
      void loadStatus(true);
    };
    window.addEventListener("message", handler);
    return () => window.removeEventListener("message", handler);
  }, [projectId, previewUrl, loadStatus]);

  // Listen for file change events from CodeWorkspace or other sources.
  // This covers the standalone Preview tab which doesn't receive refreshKey.
  // A file change while the preview is live marks it stale and re-checks
  // status; when the check reports ready the iframe is actually reloaded
  // (reloadFrameOnNextReadyRef) so "stale" is a real transition, not a
  // dead end.
  useEffect(() => {
    if (!projectId) return;
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.projectId === projectId) {
        reloadFrameOnNextReadyRef.current = true;
        void loadStatus(true);
      }
    };
    window.addEventListener("studio:files-changed", handler);
    return () => window.removeEventListener("studio:files-changed", handler);
  }, [projectId, loadStatus]);

  // The canvas ActionPanel's "Inspect element" action dispatches this event.
  // Enabling selection mode is enough — the inspector bridge enables itself
  // on iframe load, so this just turns the click-to-select UI back on.
  useEffect(() => {
    const handler = () => setSelectionMode(true);
    window.addEventListener("studio:activate-inspector", handler);
    return () => window.removeEventListener("studio:activate-inspector", handler);
  }, []);

  // Auto-poll while starting, restarting, or loading — BOUNDED. A start that
  // never resolves becomes a terminal "failed" instead of an infinite
  // spinner. The counter resets whenever the panel leaves the polling set
  // (e.g. reaching ready) or the project changes.
  useEffect(() => {
    if (state !== "starting" && state !== "restarting" && state !== "loading") {
      startPollAttemptsRef.current = 0;
      return;
    }
    const interval = setInterval(() => {
      startPollAttemptsRef.current += 1;
      if (startPollAttemptsRef.current >= MAX_START_POLL_ATTEMPTS) {
        clearInterval(interval);
        statusSeqRef.current++;
        setState("failed");
        setStartPhase(null);
        setError("The preview took too long to start. The dev server may have crashed during startup — check the logs, then try restarting.");
        setErrorCode(null);
        return;
      }
      void loadStatus(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [state, loadStatus]);

  // Health check while ready. A dev server that dies AFTER reaching ready
  // must not keep the green "Preview ready" dot over a dead iframe.
  // Polls lightly (30s), pauses while the tab is hidden, and surfaces a
  // truthful terminal state with a working Retry if the runtime is gone.
  useEffect(() => {
    if (state !== "ready" || !projectId) return;
    let cancelled = false;
    const check = async () => {
      if (cancelled || document.hidden) return;
      try {
        const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/preview`, {
          cache: "no-store",
          credentials: "include",
          headers: await authHeaders(),
          signal: AbortSignal.timeout(15000),
        });
        if (cancelled) return;
        const payload = await response.json().catch(() => null) as PreviewPayload | null;
        if (!response.ok || !payload) return;
        const next = statusFromPayload(payload, workspaceStatus);
        if (next.state !== "ready") {
          // The runtime died post-ready. statusFromPayload maps a stopped
          // dev server to not_started — but auto-start is already spent for
          // this project, so surface it as failed with an honest message
          // and a working Retry instead of a dead "auto-preparing" state.
          const died = next.state === "not_started";
          statusSeqRef.current++;
          const nextState = died ? "failed" : next.state;
          setState(nextState);
          setStartPhase(deriveStartPhase(nextState, workspaceStatus, typeof payload.runtimeStatus === "string" ? payload.runtimeStatus : null));
          setError(died ? "The preview dev server stopped unexpectedly." : next.error);
          setErrorCode(next.errorCode);
          if (!died) setPreviewUrl(next.url);
        }
      } catch {
        // Transient network blip — stay ready; the next 30s tick retries.
        // A persistently dead runtime is caught by the iframe onError and
        // by the user-visible Retry path.
      }
    };
    const interval = setInterval(check, 30000);
    const onVisible = () => { if (!document.hidden) void check(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [state, projectId, authHeaders, workspaceStatus]);

  // Keyboard shortcut: Cmd/Ctrl+R refreshes preview when the panel is focused.
  // This matches the universal "refresh" mental model without hijacking the
  // browser's native reload (we preventDefault to avoid full-page reload).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "r" && state !== "loading" && state !== "starting" && state !== "restarting") {
        e.preventDefault();
        setFrameKey((v) => v + 1);
        void loadStatus(true);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [loadStatus, state]);

  const setPreviewPreparing = useExecutionStore((s) => s.setPreviewPreparing);

  const preparePreview = useCallback(async () => {
    if (!projectId) return;
    // Single-flight guard: only one preview start in flight at a time.
    // Mobile rerenders and rapid prop changes cannot launch duplicate runtimes.
    if (startInFlightRef.current) return;
    startInFlightRef.current = true;
    setState("starting");
    setError(null);
    setIframeFailed(false);
    setPreviewPreparing(true);
    try {
      // Pre-flight status check: a remount (or a second panel instance)
      // racing the first start must NOT fire a duplicate POST. If the
      // server already reports starting/restarting/ready, adopt that
      // state and let the poll effect take over.
      try {
        const preflight = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/preview`, {
          cache: "no-store",
          credentials: "include",
          headers: await authHeaders(),
          signal: AbortSignal.timeout(15000),
        });
        const preflightPayload = await preflight.json().catch(() => null) as PreviewPayload | null;
        if (preflight.ok && preflightPayload) {
          const adopted = statusFromPayload(preflightPayload, workspaceStatus);
          if (adopted.state === "starting" || adopted.state === "restarting" || adopted.state === "ready") {
            setState(adopted.state);
            setPreviewUrl(adopted.url);
            setError(adopted.error);
            setErrorCode(adopted.errorCode);
            return;
          }
        }
      } catch {
        // Pre-flight is best-effort — a failed check falls through to POST.
      }
      const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/preview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...(await authHeaders()) },
        // Starting a dev server can take a while (workspace provisioning);
        // 2 minutes is generous, but it must still terminate.
        signal: AbortSignal.timeout(120000),
      });
      const payload = await response.json().catch(() => null) as PreviewPayload | null;
      if (!response.ok || !payload) throw new Error(typeof payload?.runtimeError === "string" ? payload.runtimeError : `Preview preparation failed (${response.status})`);
      const next = statusFromPayload(payload, workspaceStatus);
      setState(next.state);
      setPreviewUrl(next.url);
      setError(next.error);
      setErrorCode(next.errorCode);
      if (next.state === "ready") setFrameKey((value) => value + 1);
    } catch (prepareError) {
      setState("failed");
      setError(prepareError instanceof Error ? prepareError.message : "Preview preparation failed");
      setErrorCode(null);
    } finally {
      startInFlightRef.current = false;
      setPreviewPreparing(false);
    }
  }, [authHeaders, projectId, setPreviewPreparing, workspaceStatus]);

  // Auto-start: when the preview is not_started (workspace/runtime never
  // provisioned or dev server not running), automatically start it. The
  // normal user path must NOT require pressing "Prepare preview".
  //
  // Single-flight is enforced by startInFlightRef (checked in preparePreview)
  // and autoStartedForRef (prevents re-triggering for the same project after
  // the first attempt, regardless of outcome). A ready preview does not
  // restart — auto-start only fires for the not_started state.
  useEffect(() => {
    if (state !== "not_started") return;
    if (!projectId) return;
    if (autoStartedForRef.current === projectId) return;
    if (startInFlightRef.current) return;
    autoStartedForRef.current = projectId;
    void preparePreview();
  }, [state, projectId, preparePreview]);

  const handleCopyUrl = useCallback(async () => {
    if (!previewUrl) return;
    try {
      await navigator.clipboard.writeText(previewUrl);
      setUrlCopied(true);
      setTimeout(() => setUrlCopied(false), 2000);
    } catch {
      // Clipboard API may be blocked — ignore silently
    }
  }, [previewUrl]);

  const stopPreview = async () => {
    if (!projectId) return;
    setState("loading");
    setError(null);
    try {
      const response = await fetch(`/api/studio-projects/${encodeURIComponent(projectId)}/preview`, {
        method: "DELETE",
        credentials: "include",
        headers: await authHeaders(),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as PreviewPayload | null;
        throw new Error(typeof payload?.runtimeError === "string" ? payload.runtimeError : `Preview stop failed (${response.status})`);
      }
      setState("not_started");
      setPreviewUrl(null);
      setError(null);
      setLogs([]);
    } catch (stopError) {
      setState("failed");
      setError(stopError instanceof Error ? stopError.message : "Preview stop failed");
    }
  };

  const handleHardRefresh = useCallback(() => {
    // Force iframe reload by incrementing frameKey, then re-check status
    setFrameKey((v) => v + 1);
    void loadStatus(true);
  }, [loadStatus]);

  const displayUrl = previewUrl ? `${previewUrl}${previewUrl.includes("?") ? "&" : "?"}studioRefresh=${frameKey}` : null;
  const isAuthConfigError = errorCode === "preview_clerk_config_error" || errorCode === "preview_auth_config_error";
  const label = !projectId ? "Select a project" : state === "loading" ? "Checking preview status…" : state === "starting" ? "Preparing preview…" : state === "restarting" ? "Restarting dev server…" : state === "ready" ? (iframeFailed ? "Preview failed to load" : "Preview ready") : state === "stale" ? "Preview may be stale" : state === "not_started" ? "Preview not started" : state === "unreachable" ? "Preview runtime unreachable" : state === "failed" ? (isAuthConfigError ? "Authentication configuration error" : "Preview failed to start") : "Preview runtime unreachable";
  const detail = !projectId ? "Choose an existing project or start a blank project to launch a preview." : state === "not_started" ? "Preparing your preview automatically…" : state === "unreachable" ? (error ?? "The preview runtime could not be reached. It may be starting up or temporarily unavailable. Try refreshing.") : state === "starting" ? "Provisioning the workspace and starting the dev server…" : state === "restarting" ? "Restarting the dev server…" : state === "stale" ? "A file changed — reloading the preview…" : state === "failed" ? (isAuthConfigError ? (error ?? "The Clerk secret key or publishable key is invalid, stale, or mismatched. This is NOT a generic preview failure — add both keys to this project's Studio secrets or the workspace .env.local, then restart the preview.") : error ?? "The dev server failed to start. Try restarting it.") : error ?? "The preview surface reports only real project runtime state.";
  const dotColor = STATUS_DOT_COLOR[state];
  const isLive = state === "ready" || state === "stale";
  const sourceSummary = formatSourceSummary({
    kind: sourceKind,
    status: sourceStatus,
    versionControl,
    branch,
    githubRepository: repositoryName,
  });

  return (
    <div className={`flex h-full min-h-0 flex-col ${maximized ? "fixed inset-0 z-[300] p-3" : ""}`} data-testid="studio-preview-panel">
      {/* Compact header — optimized for permanent side column.
          Horizontally scrollable: on narrow phones the action buttons
          (refresh/restart/stop/copy/maximize) would otherwise be cut off
          with no way to reach them. */}
      <div className="no-scrollbar flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-2 py-1.5" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }} data-testid="preview-toolbar">
        {/* Runtime status dot */}
        <div
          className="h-2 w-2 shrink-0 rounded-full"
          style={{
            backgroundColor: dotColor,
            boxShadow: isLive ? `0 0 6px ${dotColor}80` : "none",
          }}
          aria-label={`Runtime status: ${label}`}
          data-testid="preview-status-dot"
        />
        <div className="min-w-[96px] flex-1">
          <div className="flex items-center gap-1">
            <span className="truncate text-[10px] font-bold" style={{ color: "var(--text-primary)" }}>{projectName ?? "Project preview"}</span>
            {/*
              `framework` is the RUNTIME technology (static, nextjs, vite,
              expo) — never source ownership. Titled so that "STATIC"
              sitting above the source line cannot read as "no source".
            */}
            {framework && (
              <span className="shrink-0 rounded px-1 py-0.5 text-[8px] font-bold uppercase" style={{ backgroundColor: "rgba(139,92,246,0.12)", color: "#9b4dff" }} title={`Runtime: ${framework}`} data-testid="preview-runtime-badge">
                {framework}
              </span>
            )}
          </div>
          {/*
            Source line. A managed project has durable source, Git
            history and a branch without any GitHub repository, so this
            must never render "No repository · —" — that reads as "this
            project is empty" for a perfectly healthy project.
          */}
          <div className="truncate text-[9px]" style={{ color: "var(--text-muted)" }} title={sourceSummary} data-testid="preview-source-summary">{sourceSummary}</div>
        </div>
        {/* Device mode selector — compact */}
        {isLive && (
          <div className="flex items-center gap-0.5 rounded-lg border p-0.5" style={{ borderColor: "var(--studio-border)" }}>
            {([
              { mode: "desktop" as const, icon: Monitor, label: "Desktop (1280×720)" },
              { mode: "tablet" as const, icon: Tablet, label: "Tablet (768×1024)" },
              { mode: "mobile" as const, icon: Smartphone, label: "Mobile (390×844)" },
            ]).map(({ mode, icon: Icon, label: modeLabel }) => (
              <button
                key={mode}
                type="button"
                onClick={() => setDeviceMode(mode)}
                className="grid min-h-9 min-w-9 place-items-center rounded-md transition"
                style={{
                  backgroundColor: deviceMode === mode ? "rgba(114,242,56,0.12)" : "transparent",
                  color: deviceMode === mode ? "var(--litt-primary)" : "var(--text-muted)",
                }}
                aria-label={modeLabel}
                aria-pressed={deviceMode === mode}
                title={modeLabel}
              >
                <Icon size={11} className="pointer-events-none" />
              </button>
            ))}
          </div>
        )}
        {/* Lightweight visual selection — the preview remains the source of truth. */}
        {isLive && (
          <button
            type="button"
            onClick={() => {
              const next = !selectionMode;
              setSelectionMode(next);
              if (!next) {
                clearSelection();
                postInspectorCommand("disable");
              } else {
                attachSelection();
              }
            }}
            className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/8"
            style={{
              backgroundColor: selectionMode ? "rgba(155,77,255,0.14)" : "transparent",
              color: selectionMode ? "#c4b5fd" : "var(--text-muted)",
            }}
            aria-label={selectionMode ? "Disable preview element selection" : "Select an element in the preview"}
            aria-pressed={selectionMode}
            title={selectionMode ? "Element selection on" : "Select an element in the preview"}
            data-testid="preview-select"
          >
            <MousePointer2 size={13} className="pointer-events-none" />
          </button>
        )}
        {/* Refresh — hard reload iframe + re-check status */}
        <button
          type="button"
          onClick={handleHardRefresh}
          disabled={state === "loading" || state === "starting" || state === "restarting"}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg transition hover:bg-white/8 disabled:opacity-40"
          aria-label="Refresh preview"
          title="Refresh preview (Ctrl+R)"
          data-testid="preview-refresh"
        >
          <RefreshCw size={12} className={`pointer-events-none ${state === "stale" ? "animate-spin" : ""}`} />
        </button>
        {/* Restart dev server */}
        {(isLive || state === "failed") && (
          <button
            type="button"
            onClick={() => void preparePreview()}
            className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/8"
            aria-label="Restart preview"
            title="Restart preview runtime"
            data-testid="preview-restart"
          >
            <RotateCcw size={12} className="pointer-events-none" />
          </button>
        )}
        {/* Stop dev server */}
        {isLive && (
          <button
            type="button"
            onClick={() => void stopPreview()}
            className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/8"
            aria-label="Stop preview"
            title="Stop preview runtime"
            data-testid="preview-stop"
          >
            <Square size={12} className="pointer-events-none" />
          </button>
        )}
        {/* Copy URL */}
        {isLive && previewUrl && (
          <button
            type="button"
            onClick={() => void handleCopyUrl()}
            className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/8"
            aria-label="Copy preview URL"
            title="Copy preview URL"
            data-testid="preview-copy-url"
          >
            {urlCopied ? <Check size={12} className="pointer-events-none" style={{ color: "#48EE38" }} /> : <Copy size={12} className="pointer-events-none" />}
          </button>
        )}
        {/* Maximize */}
        {isLive && (
          <button
            type="button"
            onClick={() => setMaximized((v) => !v)}
            className="grid min-h-9 min-w-9 shrink-0 place-items-center rounded-lg transition hover:bg-white/8"
            aria-label={maximized ? "Exit fullscreen" : "Maximize preview"}
            title={maximized ? "Exit fullscreen" : "Maximize"}
            data-testid="preview-maximize"
          >
            {maximized ? <span className="text-[12px]">⤓</span> : <span className="text-[12px]">⤢</span>}
          </button>
        )}
      </div>
      {selectedElement && (
        <div
          className="flex shrink-0 items-center gap-2 border-b px-2.5 py-1.5 text-[10px]"
          style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(155,77,255,0.06)" }}
          role="status"
          aria-live="polite"
          data-testid="preview-selection"
        >
          <MousePointer2 size={11} className="shrink-0" style={{ color: "#c4b5fd" }} aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate" style={{ color: "var(--text-secondary)" }}>
            Selected: <strong style={{ color: "#c4b5fd" }}>{selectedElement.label}</strong>
          </span>
          <button
            type="button"
            onClick={() => clearSelection()}
            className="grid min-h-8 min-w-8 shrink-0 place-items-center rounded-md hover:bg-white/8"
            aria-label="Clear selected preview element"
            title="Clear selection"
          >
            <X size={12} className="pointer-events-none" />
          </button>
        </div>
      )}
      {selectionError && selectionMode && (
        <div className="shrink-0 border-b px-2.5 py-1 text-[9px]" style={{ borderColor: "rgba(227,179,65,0.2)", color: "#e3b341" }} role="status">
          {selectionError}
        </div>
      )}

      {/* Preview surface */}
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden" style={{ backgroundColor: "rgba(0,0,0,0.2)" }}>
        {isLive && displayUrl ? (
          <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto p-2">
            <iframe
              key={frameKey}
              ref={iframeRef}
              title={`${projectName ?? "Project"} preview`}
              src={displayUrl}
              className="border-0 bg-white transition-all duration-200"
              style={{
                width: deviceMode === "desktop" ? "100%" : `${DEVICE_DIMENSIONS[deviceMode].w}px`,
                height: deviceMode === "desktop" ? "100%" : `${DEVICE_DIMENSIONS[deviceMode].h}px`,
                maxWidth: "100%",
                borderRadius: deviceMode === "desktop" ? "0" : "8px",
                boxShadow: deviceMode === "desktop" ? "none" : "0 4px 24px rgba(0,0,0,0.4)",
              }}
              sandbox="allow-scripts allow-forms allow-modals allow-same-origin allow-popups"
              onLoad={handleIframeLoad}
              onError={() => setIframeFailed(true)}
              data-testid="preview-iframe"
            />
          </div>
        ) : (
          <div className="flex min-h-[200px] flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <div
              className="grid h-10 w-10 place-items-center rounded-xl"
              style={{
                backgroundColor: state === "failed" ? "rgba(239,68,68,0.08)" : "rgba(114,242,56,0.08)",
                color: state === "failed" ? "#EF4444" : "var(--litt-primary)",
              }}
            >
              {state === "loading" || state === "starting" || state === "restarting" ? (
                <Loader2 size={18} className="animate-spin" />
              ) : (
                <Eye size={18} />
              )}
            </div>
            <div className="text-[11px] font-bold" style={{ color: "var(--text-primary)" }}>{label}</div>
            <div className="max-w-[220px] text-[10px] leading-4" style={{ color: "var(--text-muted)" }}>{detail}</div>
            {/* Retry button for unreachable/failed states. not_started is
                handled by auto-start — no manual button needed. */}
            {["unreachable", "failed"].includes(state) && (
              <button
                type="button"
                onClick={() => void preparePreview()}
                disabled={!projectId || state === "starting" || state === "restarting"}
                className="flex min-h-9 items-center gap-1.5 rounded-lg px-3 text-[10px] font-bold disabled:opacity-40"
                style={{ backgroundColor: "var(--litt-primary)", color: "#000" }}
                data-testid="preview-prepare"
              >
                <RotateCcw size={11} className="pointer-events-none" />
                {state === "failed" ? "Restart preview" : "Retry"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Status footer — compact, shows runtime + device info */}
      {isLive && (
        <div className="flex shrink-0 items-center gap-1.5 border-t px-2 py-1" style={{ borderColor: "var(--studio-border)", backgroundColor: "var(--studio-card)" }}>
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: dotColor }}
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-[9px]" style={{ color: state === "stale" ? "#e3b341" : "var(--text-muted)" }}>
            {deviceMode !== "desktop" ? `${DEVICE_DIMENSIONS[deviceMode].label} · ` : ""}
            {label}
            {devCommand && <span style={{ color: "var(--text-muted)", opacity: 0.7 }}> · {devCommand}</span>}
          </span>
          {logs.length > 0 && (
            <button
              type="button"
              onClick={() => setLogsOpen((v) => !v)}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold transition hover:bg-white/8"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Toggle logs"
              data-testid="preview-logs-toggle"
            >
              Logs
            </button>
          )}
          {previewUrl && (
            <button
              type="button"
              onClick={() => window.open(previewUrl, "_blank", "noopener,noreferrer")}
              className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9px] font-bold transition hover:bg-white/8"
              style={{ color: "var(--text-secondary)" }}
              aria-label="Open preview in new tab"
              data-testid="preview-open-external"
            >
              <ExternalLink size={10} className="pointer-events-none" />
              Open
            </button>
          )}
        </div>
      )}
      {logsOpen && logs.length > 0 && (
        <div className="max-h-28 shrink-0 overflow-auto border-t px-2 py-1 font-mono text-[9px] leading-3" style={{ borderColor: "var(--studio-border)", backgroundColor: "rgba(0,0,0,0.15)", color: "var(--text-muted)" }} data-testid="preview-logs">
          {logs.slice(-50).map((line, i) => (
            <div key={i} className="truncate">{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
