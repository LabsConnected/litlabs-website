"use client";

/**
 * UnifiedSelector — the unified agent + model selector popover.
 *
 * Moved out of CommandComposer (chat-bar cleanup, Larry 2026-11-20):
 * the round avatar trigger that used to sit in the composer row is
 * gone — the composer row is text box, + (add), mic, and one clear
 * send button, matching the approved mock-up. The selector itself is
 * unchanged; it is now opened on demand from the chat header menu
 * (desktop Conversation menu) and the mobile Tools sheet, and
 * CommandStudio owns its open state and renders it portaled, anchored
 * to the composer.
 */

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Check, Lock, Search, X } from "lucide-react";
import { AGENT_META, type AgentId } from "../stores/useStudioAgentStore";
import { MODELS, type SelectedModel, type ProviderHealth } from "../stores/useStudioModelStore";
import { useUserPlan } from "../hooks/useUserPlan";
import { useHiddenAgents, visibleAgents } from "@/lib/agent-visibility";

/**
 * Structural subset of DOMRect the popover's placement math reads —
 * callers may pass a real getBoundingClientRect() result or a plain
 * object (e.g. when the selector is opened from a menu, anchored to
 * the composer element).
 */
export interface SelectorAnchorRect {
  top: number;
  bottom: number;
  left: number;
  right: number;
  width: number;
  height: number;
}
/* ── Unified agent + model selector popover ─────────────────────── */
function planLabel(plan: string): string {
  switch (plan) {
    case "creator_lite": return "Creator Lite";
    case "creator_beta": return "Creator";
    case "pro_builder_beta": return "Pro Builder";
    case "founder": return "Founding Member";
    default: return plan;
  }
}

/** MODE items — the main assistant modes. */
const MODE_ITEMS: { id: AgentId; label: string; description: string }[] = [
  { id: "litt", label: "LiTT", description: "Normal main assistant" },
];

/** MODEL items — BYOK engines shown in the MODEL section. */
const BYOK_MODEL_IDS = ["gpt-4o", "claude-sonnet"];

/** Advanced LiTT aliases shown in a collapsible ADVANCED section. */
const ADVANCED_LITT_IDS = ["litt-fast", "litt-balanced", "litt-reasoning", "litt-code", "litt-research"];

function providerHealthColor(health: ProviderHealth): string {
  return health === "available"
    ? "#72f238"
    : health === "degraded"
      ? "#e3b341"
      : health === "locked"
        ? "#a78bfa"
        : health === "unknown"
          ? "#8a8f98"
          : "#ef4444";
}

export default function UnifiedSelectorPopover({
  rect,
  activeAgentId,
  selectedModelId,
  providerHealth,
  onAgentSelect,
  onModelSelect,
  onClose,
}: {
  rect: SelectorAnchorRect;
  activeAgentId: AgentId;
  selectedModelId: string;
  providerHealth: Record<string, ProviderHealth>;
  onAgentSelect: (id: AgentId) => void;
  onModelSelect: (model: SelectedModel) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { hasAccess, loading } = useUserPlan();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [tab, setTab] = useState<"model" | "assistant">("model");
  const [query, setQuery] = useState("");

  // Live viewport, visualViewport-aware: when the on-screen keyboard
  // opens, visualViewport shrinks and reports the keyboard inset, so a
  // bottom sheet can sit directly above the keyboard instead of behind
  // it or floating at a stale height.
  const [viewport, setViewport] = useState(() => ({
    width: typeof window !== "undefined" ? window.innerWidth : 1024,
    height: typeof window !== "undefined" ? window.innerHeight : 768,
    keyboardInset: 0,
  }));
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => {
      setViewport({
        width: vv ? vv.width : window.innerWidth,
        height: vv ? vv.height : window.innerHeight,
        keyboardInset: vv
          ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop)
          : 0,
      });
    };
    update();
    vv?.addEventListener("resize", update);
    vv?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      vv?.removeEventListener("resize", update);
      vv?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  // Under the sm breakpoint the selector becomes a bottom sheet; above
  // it, a compact popover anchored to the composer.
  const isSheet = viewport.width < 640;

  // Scroll-lock the background conversation while the sheet is open so
  // swiping the model list never drags the chat behind it.
  useEffect(() => {
    if (!isSheet) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isSheet]);

  // Live local Ollama models from /api/llm/health — fetched when the picker
  // opens so availability + capabilities reflect the device right now, not
  // a static catalog. Unreachable/unauthenticated → section stays hidden.
  const [localModels, setLocalModels] = useState<SelectedModel[] | null>(null);
  useEffect(() => {
    let live = true;
    fetch("/api/llm/health", { cache: "no-store", credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!live || !d?.local?.reachable || !Array.isArray(d.local.models)) return;
        setLocalModels(
          d.local.models
            .filter((m: { name?: string }) => !!m?.name)
            .map((m: { name: string; sizeMb?: number; capabilities?: string[]; toolCapable?: boolean; recommended?: boolean }): SelectedModel => ({
              id: `ollama/${m.name}`,
              label: m.name,
              provider: "ollama",
              name: "Ollama (local)",
              model: `ollama/${m.name}`,
              cost: "free",
              speed: "medium",
              icon: "🖥️",
              apiModel: `ollama/${m.name}`,
              apiProvider: "ollama",
              category: "local",
              description:
                `${(m.sizeMb ?? 0) >= 1024 ? `${(m.sizeMb! / 1024).toFixed(1)} GB` : `${m.sizeMb ?? "?"} MB`} on this device` +
                (m.toolCapable ? " · tool-capable" : "") +
                (m.recommended ? " · recommended" : ""),
            })),
        );
      })
      .catch(() => {});
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  // Selecting a model applies it through the existing store (the parent
  // calls selectModel) and closes the selector — one tap, done.
  const handleModelSelect = (m: SelectedModel) => {
    onModelSelect(m);
    onClose();
  };
  // Picking an assistant keeps the selector open on the Model tab so the
  // two choices stay one short flow.
  const handleAgentSelect = (id: AgentId) => {
    onAgentSelect(id);
    setTab("model");
  };

  // ── Model groups, search-filtered ────────────────────────────────
  const q = query.trim().toLowerCase();
  const searching = q.length > 0;
  const matches = (m: SelectedModel) =>
    !searching || `${m.label} ${m.name} ${m.provider}`.toLowerCase().includes(q);

  const littAutoModel = MODELS.find((m) => m.id === "litt-auto");
  const showLittAuto = !!littAutoModel && matches(littAutoModel);

  const byokModels = MODELS.filter((m) => BYOK_MODEL_IDS.includes(m.id)).filter(matches);
  // Free provider models get their own section up top — they were
  // previously buried inside Advanced even though they are the
  // commonly-used free options.
  const freeModels = MODELS.filter(
    (m) => m.category === "advanced" && m.cost === "free",
  ).filter(matches);
  const localFiltered = (localModels ?? []).filter(matches);
  const advancedModels = MODELS.filter((m) => ADVANCED_LITT_IDS.includes(m.id)).filter(matches);
  const advancedProviderModels = MODELS.filter(
    (m) => m.category === "advanced" && m.cost !== "free",
  ).filter(matches);
  // While searching, Advanced matches surface immediately — making the
  // user expand a collapsed section mid-search would hide the answer.
  const advancedVisible = showAdvanced || searching;
  const hasAdvanced =
    advancedModels.length > 0 || advancedProviderModels.length > 0;
  const noModelResults =
    searching &&
    !showLittAuto &&
    byokModels.length === 0 &&
    freeModels.length === 0 &&
    localFiltered.length === 0 &&
    !hasAdvanced;

  // Hidden built-in agents (e.g. Spark) stay out of the mode list.
  const { hiddenAgents } = useHiddenAgents();
  const visibleModes = visibleAgents(MODE_ITEMS, hiddenAgents);

  // Current-selection summary for the header: the active assistant and
  // the active model, named on every open.
  const selectedModelLabel =
    MODELS.find((m) => m.id === selectedModelId)?.label ??
    localModels?.find((m) => m.id === selectedModelId)?.label ??
    selectedModelId;
  const activeAgentLabel = AGENT_META[activeAgentId]?.displayName ?? activeAgentId;

  // Reopening shows the active selection: scroll the active model row
  // into view inside the (only) scrolling list.
  useEffect(() => {
    if (tab !== "model" || searching) return;
    const active = listRef.current?.querySelector('[data-active-model="true"]');
    active?.scrollIntoView?.({ block: "nearest" });
  }, [tab, searching, localModels]);

  // ── Placement ────────────────────────────────────────────────────
  // Desktop popover: anchored to the trigger, sized from the ACTUAL
  // space on the chosen side of the viewport, and clamped so it can
  // never render outside the viewport. When the space above is short
  // it opens below with its height capped to the space below — never
  // at a fixed height spilling past the screen edge (the old 420px
  // fallback bug).
  const POPOVER_WIDTH = 320;
  const VIEWPORT_MARGIN = 8;
  const ANCHOR_GAP = 8;
  const DESKTOP_MAX_HEIGHT = 480;
  const roomAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;
  const roomBelow = viewport.height - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
  const placeAbove = roomAbove >= roomBelow;
  const desktopMaxHeight = Math.max(
    200,
    Math.min(DESKTOP_MAX_HEIGHT, placeAbove ? roomAbove : roomBelow),
  );
  const desktopLeft = Math.max(
    VIEWPORT_MARGIN,
    Math.min(
      rect.left,
      Math.max(VIEWPORT_MARGIN, viewport.width - POPOVER_WIDTH - VIEWPORT_MARGIN),
    ),
  );
  const placementStyle: CSSProperties = isSheet
    ? {
        bottom: viewport.keyboardInset,
        // ~70% of the visible screen (visualViewport height, so the
        // keyboard-open state shrinks the sheet with the visible area).
        maxHeight: Math.min(viewport.height, Math.round(viewport.height * 0.7)),
        paddingBottom: "env(safe-area-inset-bottom)",
      }
    : {
        left: desktopLeft,
        width: POPOVER_WIDTH,
        maxHeight: desktopMaxHeight,
        ...(placeAbove
          ? {
              bottom:
                (typeof window !== "undefined" ? window.innerHeight : viewport.height) -
                rect.top +
                ANCHOR_GAP,
            }
          : { top: rect.bottom + ANCHOR_GAP }),
      };

  const sectionHeader = (label: string) => (
    <div
      className="px-3 pb-1 pt-2.5 text-[9px] font-black uppercase tracking-[0.18em]"
      style={{ color: "var(--text-muted)" }}
    >
      {label}
    </div>
  );

  const modelRow = (
    m: SelectedModel,
    opts?: { dot?: string; small?: boolean; meta?: ReactNode; title?: string },
  ) => {
    const isActive = selectedModelId === m.id;
    return (
      <button
        key={m.id}
        type="button"
        onClick={() => handleModelSelect(m)}
        title={opts?.title}
        data-active-model={isActive || undefined}
        aria-current={isActive || undefined}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-black/5"
        style={{ backgroundColor: isActive ? "color-mix(in srgb, var(--color-accent) 8%, transparent)" : "transparent" }}
      >
        <span className={`${opts?.small ? "text-sm" : "text-base"} shrink-0`}>{m.icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>{m.label}</div>
          {opts?.meta}
        </div>
        {opts?.dot && (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: opts.dot }} aria-hidden />
        )}
        {isActive && <Check size={12} className="shrink-0" style={{ color: "var(--litt-primary)" }} />}
      </button>
    );
  };

  const costMeta = (m: SelectedModel) => (
    <div className="flex items-center gap-1.5 text-[9px]" style={{ color: "var(--text-muted)" }}>
      <span>{m.provider}</span>
      <span>·</span>
      <span style={{ color: m.cost === "paid" ? "#e3b341" : "var(--text-muted)" }}>
        {m.cost === "paid" ? "PAID" : m.cost === "free" ? "FREE" : "AUTO"}
      </span>
      <span>·</span>
      <span>{m.speed}</span>
    </div>
  );

  return (
    <>
      {isSheet && (
        <div
          data-testid="unified-selector-backdrop"
          onClick={onClose}
          className="fixed inset-0 z-[199]"
          style={{ backgroundColor: "rgba(10, 20, 12, 0.35)" }}
        />
      )}
      <div
        ref={ref}
        role="dialog"
        aria-modal={isSheet || undefined}
        aria-label="Select assistant and model"
        data-testid="unified-selector"
        className={
          isSheet
            ? "fixed inset-x-0 z-[200] flex flex-col rounded-t-2xl border-t shadow-2xl studio-anim-dropdown"
            : "fixed z-[200] flex flex-col rounded-xl border shadow-2xl backdrop-blur-md studio-anim-dropdown"
        }
        style={{
          ...placementStyle,
          // Portaled to <body> — outside .studio-shell, so the palette
          // is carried explicitly from the theme's published root
          // variables (ThemeProvider sets them from the resolved skin),
          // which follow the effective mode: the light Signature whites
          // in Light, Larry's charcoal in Dark.
          backgroundColor: "var(--box-bg)",
          borderColor: "var(--border-color)",
          color: "var(--text-color)",
          ["--text-primary" as string]: "var(--text-color)",
          ["--text-secondary" as string]: "color-mix(in srgb, var(--text-color) 76%, var(--bg-color))",
          ["--text-muted" as string]: "color-mix(in srgb, var(--text-color) 58%, var(--bg-color))",
          ["--studio-elevated" as string]: "var(--box-bg)",
          ["--studio-border" as string]: "var(--border-color)",
          ["--studio-border-strong" as string]: "color-mix(in srgb, var(--border-color) 55%, var(--text-color) 45%)",
          ["--color-accent" as string]: "var(--accent-color)",
        }}
      >
        {/* ── Header: current selection + sections + search.
               Never scrolls — only the list below does. ─────────── */}
        <div className="shrink-0" style={{ borderBottom: "1px solid var(--studio-border)" }}>
          <div className="flex items-center gap-2 px-3 pb-1 pt-2.5">
            <div className="min-w-0 flex-1">
              <div className="text-[9px] font-black uppercase tracking-[0.18em]" style={{ color: "var(--text-muted)" }}>
                Now using
              </div>
              <div className="truncate text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
                {activeAgentLabel} · {selectedModelLabel}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-lg transition hover:bg-black/5"
              style={{ color: "var(--text-muted)" }}
              aria-label="Close assistant and model selector"
            >
              <X size={14} className="pointer-events-none" />
            </button>
          </div>

          {/* Assistant Mode and Model are separate sections — two tabs,
              never one crammed list. */}
          <div role="tablist" aria-label="Assistant or model" className="flex gap-1 px-3 pb-2">
            {(
              [
                { id: "model", label: "Model" },
                { id: "assistant", label: "Assistant" },
              ] as const
            ).map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                data-testid={`selector-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className="rounded-lg px-3 py-1.5 text-[11px] font-bold transition"
                style={{
                  backgroundColor: tab === t.id ? "color-mix(in srgb, var(--color-accent) 12%, transparent)" : "transparent",
                  color: tab === t.id ? "var(--text-primary)" : "var(--text-muted)",
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "model" && (
            <div className="px-3 pb-2.5">
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2"
                  style={{ color: "var(--text-muted)" }}
                />
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search models"
                  aria-label="Search models"
                  data-testid="model-search-input"
                  className="w-full rounded-lg border py-2 pl-8 pr-2 text-[12px] outline-none"
                  style={{
                    borderColor: "var(--studio-border)",
                    backgroundColor: "var(--studio-elevated)",
                    color: "var(--text-primary)",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── The ONLY scrolling region ─────────────────────────── */}
        <div
          ref={listRef}
          data-testid="unified-selector-list"
          className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-1"
        >
          {tab === "assistant" ? (
            <>
              {sectionHeader("Assistant mode")}
              {visibleModes.map((item) => {
                const meta = AGENT_META[item.id];
                if (!meta) return null;
                const accent = meta.color;
                const isActive = activeAgentId === item.id;
                const unlocked = loading || hasAccess(meta.minimumPlan);
                return (
                  <div key={item.id}>
                    <button
                      type="button"
                      disabled={!unlocked}
                      onClick={() => unlocked && handleAgentSelect(item.id)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ backgroundColor: isActive ? `${accent}10` : "transparent" }}
                    >
                      <span
                        className="relative grid h-7 w-7 shrink-0 place-items-center rounded-lg overflow-hidden text-[11px] font-black"
                        style={{ backgroundColor: `${accent}20`, color: accent }}
                      >
                        {unlocked ? (
                          <Image
                            src="/brand/litt-robot-avatar-96.png"
                            alt={meta.displayName}
                            fill
                            sizes="28px"
                            className="object-cover"
                          />
                        ) : (
                          <Lock size={11} />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-bold" style={{ color: "var(--text-primary)" }}>
                          {meta.displayName}
                        </div>
                        <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                          {unlocked ? item.description : `Requires ${planLabel(meta.minimumPlan)}`}
                        </div>
                      </div>
                      {isActive && unlocked && (
                        <Check size={12} className="shrink-0" style={{ color: accent }} />
                      )}
                    </button>
                    {!unlocked && (
                      <Link
                        href={`/pricing?upgrade=${meta.minimumPlan}`}
                        onClick={onClose}
                        className="flex items-center gap-1 px-3 pb-2 pl-[3.25rem] text-[10px] font-bold transition hover:opacity-80"
                        style={{ color: accent }}
                      >
                        Upgrade to {planLabel(meta.minimumPlan)} →
                      </Link>
                    )}
                  </div>
                );
              })}
            </>
          ) : (
            <>
              {/* LiTT Auto — the recommended default, always first. */}
              {showLittAuto &&
                modelRow(littAutoModel!, {
                  meta: (
                    <div className="truncate text-[10px]" style={{ color: "var(--text-muted)" }}>
                      Autonomous mode — routes automatically
                    </div>
                  ),
                })}

              {byokModels.length > 0 && (
                <>
                  {sectionHeader("Your keys — BYOK")}
                  {byokModels.map((m) => modelRow(m, { dot: providerHealthColor(providerHealth[m.provider] ?? "unknown"), meta: costMeta(m) }))}
                </>
              )}

              {freeModels.length > 0 && (
                <>
                  {sectionHeader("Free models")}
                  {freeModels.map((m) => modelRow(m, { dot: providerHealthColor(providerHealth[m.provider] ?? "unknown"), meta: costMeta(m) }))}
                </>
              )}

              {localFiltered.length > 0 && (
                <>
                  {sectionHeader("Local — this device")}
                  {localFiltered.map((m) =>
                    modelRow(m, {
                      dot: "#72f238",
                      title: m.description,
                      meta: (
                        <div className="flex items-center gap-1.5 text-[9px]" style={{ color: "var(--text-muted)" }}>
                          <span>{m.name}</span>
                          <span>·</span>
                          <span>FREE</span>
                          {m.description && (
                            <>
                              <span>·</span>
                              <span className="truncate">{m.description}</span>
                            </>
                          )}
                        </div>
                      ),
                    }),
                  )}
                </>
              )}

              {hasAdvanced && !searching && (
                <button
                  type="button"
                  onClick={() => setShowAdvanced((v) => !v)}
                  aria-expanded={showAdvanced}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left transition hover:bg-black/5"
                  style={{ color: "var(--text-muted)" }}
                >
                  <ChevronDown
                    size={10}
                    className="pointer-events-none transition-transform"
                    style={{ transform: showAdvanced ? "rotate(180deg)" : "rotate(0deg)" }}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider">Advanced Models</span>
                </button>
              )}
              {hasAdvanced && searching && sectionHeader("Advanced models")}

              {advancedVisible && (
                <>
                  {advancedModels.map((m) =>
                    modelRow(m, {
                      small: true,
                      meta: (
                        <div className="truncate text-[9px]" style={{ color: "var(--text-muted)" }}>
                          {m.description}
                        </div>
                      ),
                    }),
                  )}
                  {advancedProviderModels.map((m) =>
                    modelRow(m, {
                      dot: providerHealthColor(providerHealth[m.provider] ?? "unknown"),
                      small: true,
                      meta: (
                        <div className="text-[9px]" style={{ color: "var(--text-muted)" }}>
                          {m.provider} · {m.cost === "free" ? "FREE" : "PAID"}
                        </div>
                      ),
                    }),
                  )}
                </>
              )}

              {noModelResults && (
                <div className="px-3 py-4 text-[11px]" style={{ color: "var(--text-muted)" }}>
                  No models match “{query.trim()}”.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
