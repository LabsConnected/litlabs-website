/**
 * ModelPicker — the /model surface: pick a model, fast.
 *
 * Opens directly on the MODELS list with the active model highlighted —
 * no routing screen in between. Models are grouped by truth:
 *
 *   LOCAL       — installed on the reachable Ollama daemon (verified
 *                 present by the lane probe, not assumed)
 *   CLOUD       — catalog models from configured providers
 *   UNAVAILABLE — discovered offline or otherwise not routable
 *
 * The routing policy itself (AUTO/FIXED/BUDGET/MAX) lives behind Tab —
 * available, never in the way.
 *
 * Keyboard:
 *   type     — filter the model list (search)
 *   ↑↓       — move the cursor
 *   Enter    — select the highlighted model
 *   Tab      — switch between Models / Routing
 *   Esc      — close WITHOUT changing the selection
 *
 * Uses the OverlayManager — no direct useInput call.
 */

import React, { useState, useCallback, useEffect, useMemo } from "react";
import { Box, Text } from "ink";
import { useOverlayKeyboard } from "./overlay-manager.js";
import { isEnter, isEscape, isTab, isUpArrow, isDownArrow } from "./keyboard-utils.js";
import { COLORS, costTier } from "./colors.js";
import { ModelRuntime } from "../lib/model-runtime.js";
import { probeLocalLane } from "../lib/local-lane.js";
import { OLLAMA_CANONICAL_PREFIX, type LocalModelResolution } from "../lib/local-model-resolution.js";
import type { ModelDefinition } from "@litt/models";
import type { RoutingMode, ModelChoice } from "../lib/model-routing.js";

export interface ModelPickerProps {
  selectedModelId: string | null;
  routingMode: RoutingMode;
  onSelectModel: (model: ModelChoice) => void;
  onSelectRoutingMode: (mode: RoutingMode) => void;
  onCancel: () => void;
  /** Active model label (what the runtime is actually using) */
  activeModel?: string | null;
  /** Provider source string (e.g. "Ollama · local") */
  source?: string;
  /** Injected ModelRuntime (shared with controller). Optional. */
  modelRuntime?: ModelRuntime;
  /** Which tab to open on — "/model" lands on models, "/routing" on routing. */
  initialTab?: "models" | "routing";
}

const ROUTING_MODES: { id: RoutingMode; label: string; description: string }[] = [
  { id: "auto", label: "AUTO", description: "LiTT chooses the best engine" },
  { id: "fixed", label: "FIXED", description: "Always use the selected model" },
  { id: "budget", label: "BUDGET", description: "Lowest-cost capable engine" },
  { id: "max", label: "MAX", description: "Strongest available engine" },
];

type ModelGroup = "local" | "cloud" | "unavailable";

interface Row {
  model: ModelDefinition;
  group: ModelGroup;
  selectable: boolean;
  /** Status text — truthful to discovery, never claimed on assumption. */
  status: string;
  statusColor: string;
}

function contextLabel(ctx: number): string {
  if (ctx >= 1000) {
    const k = Math.round(ctx / 1000);
    return `${k}k`;
  }
  return `${ctx}`;
}

export function ModelPicker({
  selectedModelId,
  routingMode,
  onSelectModel,
  onSelectRoutingMode,
  onCancel,
  activeModel,
  source,
  modelRuntime: injectedRuntime,
  initialTab = "models",
}: ModelPickerProps): React.ReactElement {
  const [tab, setTab] = useState<"models" | "routing">(initialTab);
  // Stable runtime for the picker's lifetime — the injected shared
  // ModelRuntime when provided, otherwise a picker-local instance.
  const [runtime] = useState(() => injectedRuntime ?? new ModelRuntime());

  const [allModels, setAllModels] = useState<ModelDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  // Discover real model availability (async, non-blocking). The local
  // lane probe is cached (~10s) so opening the picker never causes a
  // stampede of daemon requests. Installed tags are merged into the
  // registry so they appear as first-class LOCAL rows.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      // Local lane first — installed models are the default surface.
      try {
        const lane = await probeLocalLane();
        if (lane.available) {
          for (const tag of lane.models) {
            const resolution: LocalModelResolution = {
              tag,
              canonicalId: `${OLLAMA_CANONICAL_PREFIX}${tag}`,
              provider: "ollama",
              endpoint: lane.endpoint,
              reason: "installed local model",
              configuredInput: null,
              configuredSource: "none",
              isRouteChange: false,
            };
            runtime.registerLocalModel(resolution);
          }
        }
      } catch { /* lane probe is best-effort; registry state still renders */ }
      if (!cancelled) {
        setAllModels(runtime.getAllModels());
        setLoading(false);
      }
      // Refresh remote discovery in the background — results merge in.
      runtime.refresh().then(() => {
        if (!cancelled) setAllModels(runtime.getAllModels());
      }).catch(() => {});
    };

    // Show whatever is already cached immediately, then load.
    setAllModels(runtime.getAllModels());
    setLoading(false);
    void load();
    return () => { cancelled = true; };
  }, [runtime]);

  // Build grouped, truthful rows. Selectable = LOCAL installed or a
  // cloud model discovery verified online (or at least routable).
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    for (const m of allModels) {
      const isLocal = m.provider === "ollama";
      const isOnline = m.availability === "online";
      const isOffline = m.availability === "offline";
      const routable = runtime.isRoutable(m.canonicalId);
      const selectable = isLocal ? isOnline : (isOnline || (!isOffline && routable));
      const group: ModelGroup = isLocal ? "local" : selectable ? "cloud" : "unavailable";
      const status = isLocal
        ? (isOnline ? "installed" : "not found")
        : isOnline ? "ready" : isOffline ? "offline" : "unverified";
      const statusColor = isLocal || isOnline ? COLORS.success
        : isOffline ? COLORS.error : COLORS.warning;
      out.push({ model: m, group, selectable, status, statusColor });
    }
    return out;
  }, [allModels, runtime]);

  // Search filter — name, id, or provider.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      r.model.displayName.toLowerCase().includes(q)
      || r.model.canonicalId.toLowerCase().includes(q)
      || r.model.provider.toLowerCase().includes(q));
  }, [rows, query]);

  // Group order: LOCAL → CLOUD → UNAVAILABLE. Selectable rows share one
  // flat cursor space so ↑↓ walks through groups seamlessly.
  const groups = useMemo(() => {
    const local = filtered.filter((r) => r.group === "local" && r.selectable);
    const cloud = filtered.filter((r) => r.group === "cloud" && r.selectable);
    const unavailable = filtered.filter((r) => r.group === "unavailable" || !r.selectable);
    return { local, cloud, unavailable };
  }, [filtered]);

  const selectableModels = useMemo(
    () => [...groups.local, ...groups.cloud],
    [groups],
  );

  const [selectedIdx, setSelectedIdx] = useState(0);
  // Land the cursor on the currently-selected model — re-resolve when
  // the list lands or the filter changes so the highlight is always on
  // the real active model.
  useEffect(() => {
    const idx = selectableModels.findIndex((r) => r.model.canonicalId === selectedModelId);
    setSelectedIdx(idx >= 0 ? idx : 0);
  }, [selectableModels, selectedModelId]);

  const [routingIdx, setRoutingIdx] = useState(() => {
    const idx = ROUTING_MODES.findIndex((m) => m.id === routingMode);
    return idx >= 0 ? idx : 0;
  });

  // Keyboard handler — registered with OverlayManager
  const KEY_DEBUG = process.env.LITT_KEY_DEBUG === "1";
  useOverlayKeyboard("model-picker", useCallback((input, key) => {
    if (KEY_DEBUG) {
      process.stderr.write(`[KEY] model-picker input=${JSON.stringify(input)} return=${key.return} escape=${key.escape} tab=${key.tab} up=${key.upArrow} down=${key.downArrow} ctrl=${key.ctrl} currentTab=${tab}\n`);
    }
    if (isTab(key)) {
      setTab((prev) => (prev === "models" ? "routing" : "models"));
      return;
    }
    if (isEscape(key, input)) {
      onCancel();
      return;
    }

    if (tab === "routing") {
      if (isUpArrow(key)) {
        setRoutingIdx((prev) => Math.max(0, prev - 1));
      } else if (isDownArrow(key)) {
        setRoutingIdx((prev) => Math.min(ROUTING_MODES.length - 1, prev + 1));
      } else if (isEnter(key, input)) {
        onSelectRoutingMode(ROUTING_MODES[routingIdx].id);
      }
      return;
    }

    // Models tab — search + navigate + select.
    if (isUpArrow(key)) {
      setSelectedIdx((prev) => Math.max(0, prev - 1));
      return;
    }
    if (isDownArrow(key)) {
      setSelectedIdx((prev) => Math.min(selectableModels.length - 1, prev + 1));
      return;
    }
    if (isEnter(key, input)) {
      const row = selectableModels[selectedIdx];
      if (row) {
        const model = row.model;
        onSelectModel({
          id: model.canonicalId,
          label: model.displayName,
          provider: model.provider,
          description: model.description,
          strengths: model.recommendedFor ?? [],
          cost: model.pricing ? model.pricing.inputPer1M + model.pricing.outputPer1M : 0,
          power: model.intelligence === "frontier" ? 5 : model.intelligence === "balanced" ? 3 : 1,
          contextK: Math.round(model.contextWindow / 1000),
        } as ModelChoice);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((prev) => prev.slice(0, -1));
      return;
    }
    // Printable input → search query (space allowed — "qwen 4b").
    if (input && !key.ctrl && !key.meta) {
      setQuery((prev) => prev + input);
      return;
    }
  }, [KEY_DEBUG, tab, onCancel, onSelectRoutingMode, routingIdx, selectableModels, selectedIdx, onSelectModel]));

  // Build the active model display
  const activeLabel = activeModel ?? (selectedModelId
    ? runtime.getLabel(selectedModelId)
    : "LiTT Auto");

  const renderRow = (row: Row, cursor: number) => {
    const { model } = row;
    const flatIdx = selectableModels.findIndex((r) => r.model.canonicalId === model.canonicalId);
    const isCursor = flatIdx === cursor && row.selectable;
    const isActive = model.canonicalId === selectedModelId;
    const ctx = contextLabel(model.contextWindow);
    return (
      <Box key={model.canonicalId}>
        <Text color={isCursor ? COLORS.brand : undefined}>
          {isCursor ? ">" : " "}
        </Text>
        <Text color={isCursor ? COLORS.brand : row.selectable ? COLORS.text : COLORS.secondary} bold={isCursor}>
          {" "}{model.displayName}
        </Text>
        <Text dimColor>{"  "}{ctx.padEnd(5)}</Text>
        <Text color={row.statusColor}>{row.status.padEnd(10)}</Text>
        <Text color={COLORS.warning}>
          {model.provider === "ollama" ? "local " : costTier(model.pricing ? model.pricing.inputPer1M + model.pricing.outputPer1M : 0).padEnd(5)}
        </Text>
        {isActive && <Text color={COLORS.success}> ✓ active</Text>}
      </Box>
    );
  };

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={COLORS.secondaryDim} paddingX={2} paddingY={1}>
      {/* Title bar with tab indicator */}
      <Box marginBottom={1}>
        <Text bold color={COLORS.text}>MODELS</Text>
        <Text dimColor>  </Text>
        <Text color={tab === "models" ? COLORS.brand : COLORS.secondary} bold={tab === "models"}>
          {tab === "models" ? "[Models]" : " Models "}
        </Text>
        <Text dimColor>  </Text>
        <Text color={tab === "routing" ? COLORS.brand : COLORS.secondary} bold={tab === "routing"}>
          {tab === "routing" ? "[Routing]" : " Routing "}
        </Text>
        <Text dimColor>   active: </Text>
        <Text color={COLORS.brand} bold>{activeLabel}</Text>
      </Box>

      {/* ─── MODELS TAB ─── */}
      {tab === "models" && (
        <Box flexDirection="column">
          {/* Search line — only shown when filtering */}
          {query.length > 0 && (
            <Box marginBottom={0}>
              <Text dimColor>filter: </Text>
              <Text color={COLORS.text}>{query}</Text>
            </Box>
          )}

          {groups.local.length > 0 && (
            <Box flexDirection="column">
              <Text dimColor bold>LOCAL{query ? "" : " — installed"}</Text>
              {groups.local.map((row) => renderRow(row, selectedIdx))}
            </Box>
          )}

          {groups.cloud.length > 0 && (
            <Box flexDirection="column" marginTop={groups.local.length > 0 ? 1 : 0}>
              <Text dimColor bold>CLOUD</Text>
              {groups.cloud.map((row) => renderRow(row, selectedIdx))}
            </Box>
          )}

          {groups.unavailable.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text dimColor bold>UNAVAILABLE</Text>
              {groups.unavailable.map((row) => renderRow(row, selectedIdx))}
            </Box>
          )}

          {filtered.length === 0 && !loading && (
            <Text dimColor>No models match “{query}”.</Text>
          )}
          {loading && <Text dimColor>Discovering models...</Text>}
        </Box>
      )}

      {/* ─── ROUTING TAB ─── */}
      {tab === "routing" && (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Box width={14}><Text dimColor bold>POLICY</Text></Box>
            <Text color={COLORS.brand} bold>{routingMode.toUpperCase()}</Text>
          </Box>
          <Box marginBottom={1}>
            <Box width={14}><Text dimColor>ACTIVE</Text></Box>
            <Text color={COLORS.text} bold>{activeLabel}</Text>
          </Box>

          {ROUTING_MODES.map((mode, idx) => {
            const isSelected = idx === routingIdx;
            const isActive = mode.id === routingMode;
            return (
              <Box key={mode.id}>
                <Text color={isSelected ? COLORS.brand : undefined}>
                  {isSelected ? ">" : " "}
                </Text>
                <Text color={isSelected ? COLORS.brand : COLORS.text} bold={isSelected}>
                  {" "}{mode.label.padEnd(10)}
                </Text>
                <Text dimColor>  {mode.description}</Text>
                {isActive && <Text color={COLORS.success}> ✓</Text>}
              </Box>
            );
          })}

          {source && (
            <Box marginTop={1}>
              <Text dimColor>Provider   </Text>
              <Text color={COLORS.secondaryBright}>{source}</Text>
            </Box>
          )}
        </Box>
      )}

      {/* Footer — keyboard help */}
      <Box marginTop={1}>
        <Text dimColor>
          {tab === "models" ? "type to filter · ↑↓ move · Enter select · Tab routing · Esc close" : "↑↓ move · Enter apply · Tab models · Esc close"}
        </Text>
      </Box>
    </Box>
  );
}
