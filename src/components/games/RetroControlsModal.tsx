"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { X, Gamepad2, Keyboard, RotateCcw } from "lucide-react";
import {
  type EmulatorSystemId,
  type ControlProfile,
  EMULATOR_SHORTCUTS,
  defaultProfileForSystem,
  sixButtonVariant,
  standardGamepadLabel,
  loadSavedMapping,
  saveMapping,
  clearSavedMapping,
} from "@/lib/emulator/control-profiles";

// A stable "anonymous" user id for the local arcade (no Clerk user context
// here). Namespacing by user is still honored so multi-account scenarios keep
// separate mappings; the local arcade just uses a constant.
const LOCAL_USER_ID = "local-arcade";

type ControllerType = "3-button" | "6-button";

/**
 * Resolve the active control profile for a system + controller type.
 * For Sega Genesis, 3-button/6-button selects between the two profiles.
 * Other systems ignore the selector and use their default profile.
 */
function resolveProfile(
  systemId: EmulatorSystemId,
  controllerType: ControllerType,
): ControlProfile {
  const base = defaultProfileForSystem(systemId);
  if (base.systemId !== "segaMD") return base;
  // Sega Genesis: honor the 3/6-button selector.
  if (controllerType === "6-button") {
    const six = sixButtonVariant(base);
    return six ?? base;
  }
  return base;
}

export function RetroControlsModal({
  systemId: _systemId,
  systemName: _systemName,
  systemShort,
  emulatorSystemId,
  controllerType,
  onControllerTypeChange,
  open,
  onClose,
}: {
  /** Legacy display system id (from retro-arcade RETRO_SYSTEMS). */
  systemId: string;
  systemName: string;
  systemShort: string;
  /** Canonical EmulatorSystemId used to resolve the control profile. */
  emulatorSystemId: EmulatorSystemId;
  controllerType: ControllerType;
  onControllerTypeChange: (t: ControllerType) => void;
  open: boolean;
  onClose: () => void;
}) {
  const profile = useMemo(
    () => resolveProfile(emulatorSystemId, controllerType),
    [emulatorSystemId, controllerType],
  );

  // Whether this system offers the 3-button/6-button selector.
  const isSegaGenesis = profile.systemId === "segaMD";

  // Detected physical gamepad (Standard Gamepad layout).
  const [detectedGamepadId, setDetectedGamepadId] = useState<string | null>(null);
  const [remappingId, setRemappingId] = useState<string | null>(null);
  const remapButtonRef = useRef<HTMLButtonElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);

  // Per-control mapping state: keyboard key + gamepad button index.
  // Initialized from the profile defaults, overridden by any saved mapping.
  const [mapping, setMapping] = useState<Record<string, { keyboard: string | null; gamepad: number | null }>>({});

  // Reset mapping when the profile changes (system or controller type).
  useEffect(() => {
    if (!open) return;
    const saved = loadSavedMapping(LOCAL_USER_ID, emulatorSystemId, detectedGamepadId ?? "keyboard");
    const base: Record<string, { keyboard: string | null; gamepad: number | null }> = {};
    for (const c of profile.controls) {
      const s = saved?.[c.id];
      base[c.id] = {
        keyboard: s?.keyboard ?? c.keyboardDefault,
        gamepad: s?.gamepad ?? c.standardGamepadButton,
      };
    }
    setMapping(base);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, profile.profileId, emulatorSystemId, detectedGamepadId]);

  // Detect connected gamepads via the Standard Gamepad API.
  useEffect(() => {
    if (!open) return;
    let active = true;
    const poll = () => {
      if (!active) return;
      try {
        const pads = navigator.getGamepads?.() ?? [];
        const first = Array.from(pads).find((p) => p != null);
        if (first && first.id) {
          setDetectedGamepadId(first.id.substring(0, 48));
        } else {
          setDetectedGamepadId(null);
        }
      } catch {
        setDetectedGamepadId(null);
      }
    };
    poll();
    const onConnect = (e: GamepadEvent) => {
      if (e.gamepad?.id) setDetectedGamepadId(e.gamepad.id.substring(0, 48));
    };
    const onDisconnect = (e: GamepadEvent) => {
      if (e.gamepad?.id && detectedGamepadId?.startsWith(e.gamepad.id.substring(0, 16))) {
        setDetectedGamepadId(null);
      }
    };
    window.addEventListener("gamepadconnected", onConnect);
    window.addEventListener("gamepaddisconnected", onDisconnect);
    return () => {
      active = false;
      window.removeEventListener("gamepadconnected", onConnect);
      window.removeEventListener("gamepaddisconnected", onDisconnect);
    };
  }, [open, detectedGamepadId]);

  // Escape closes; capture focus on open; restore focus on close.
  // While a remap button is waiting for input, game input is disabled by
  // virtue of the modal capturing all keydown events (we don't forward them).
  useEffect(() => {
    if (!open) return;
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        cancelRemap();
        onClose();
        return;
      }
      // If a remap is active, capture the next key as the new binding.
      if (remappingId && e.key !== "Escape") {
        e.preventDefault();
        e.stopPropagation();
        const key = normalizeKeyboardKey(e.key);
        if (key) {
          setMapping((prev) => ({
            ...prev,
            [remappingId]: { ...prev[remappingId], keyboard: key },
          }));
          persistMapping(remappingId, { keyboard: key });
        }
        cancelRemap();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, onClose, remappingId]);

  // Restore emulator input focus when the modal closes.
  useEffect(() => {
    if (open) return;
    setRemappingId(null);
    // Restore focus to whatever had it before the modal opened (typically the
    // Controls button), then refocus the emulator iframe so gamepad/keyboard
    // events route back to the game.
    const t = setTimeout(() => {
      try {
        previouslyFocusedRef.current?.focus?.();
        const iframe = document.querySelector<HTMLIFrameElement>("iframe[title*='emulator']");
        iframe?.contentWindow?.focus();
      } catch {
        /* iframe may be cross-origin or gone */
      }
    }, 0);
    return () => clearTimeout(t);
  }, [open]);

  function startRemap(controlId: string) {
    setRemappingId(controlId);
    // Focus the remap button so the keydown listener is in context.
    requestAnimationFrame(() => remapButtonRef.current?.focus());
  }

  function cancelRemap() {
    setRemappingId(null);
  }

  function persistMapping(controlId: string, partial: { keyboard?: string | null; gamepad?: number | null }) {
    setMapping((prev) => {
      const next = {
        ...prev,
        [controlId]: { ...prev[controlId], ...partial },
      };
      saveMapping(LOCAL_USER_ID, emulatorSystemId, detectedGamepadId ?? "keyboard", next);
      return next;
    });
  }

  function handleResetDefaults() {
    clearSavedMapping(LOCAL_USER_ID, emulatorSystemId, detectedGamepadId ?? "keyboard");
    const base: Record<string, { keyboard: string | null; gamepad: number | null }> = {};
    for (const c of profile.controls) {
      base[c.id] = { keyboard: c.keyboardDefault, gamepad: c.standardGamepadButton };
    }
    setMapping(base);
  }

  if (!open) return null;

  const heading = isSegaGenesis ? "Sega Genesis Controls" : `${profile.displayName} Controls`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          cancelRemap();
          onClose();
        }
      }}
    >
      <div
        className="flex max-h-[80dvh] w-full max-w-[760px] flex-col overflow-hidden rounded-2xl border border-white/15 bg-[#0a0b12] shadow-2xl"
        style={{ width: "min(760px, calc(100vw - 24px))" }}
        role="dialog"
        aria-modal="true"
        aria-label={heading}
      >
        {/* Sticky title */}
        <div className="sticky top-0 z-10 flex shrink-0 items-center justify-between border-b border-white/10 bg-[#0a0b12]/95 px-5 py-4 backdrop-blur">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-fuchsia-400/30 bg-fuchsia-400/10">
              <Gamepad2 size={16} className="text-fuchsia-300" />
            </div>
            <div>
              <div className="text-sm font-black text-white">{heading}</div>
              <div className="text-[10px] text-white/45">
                Keyboard &amp; gamepad mapping · {systemShort}
                {detectedGamepadId ? ` · ${detectedGamepadId}` : " · no gamepad detected"}
              </div>
            </div>
          </div>
          <button
            onClick={() => {
              cancelRemap();
              onClose();
            }}
            className="rounded-lg p-1.5 text-white/45 transition hover:bg-white/10 hover:text-white"
            aria-label="Close controls"
          >
            <X size={16} />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {/* Controller type selector (Sega Genesis only) */}
          {isSegaGenesis && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-white/[.03] p-3">
              <span className="text-[11px] font-bold text-white/60">Controller type:</span>
              <div className="flex overflow-hidden rounded-lg border border-white/15">
                <button
                  type="button"
                  onClick={() => onControllerTypeChange("3-button")}
                  className={`px-3 py-1.5 text-[11px] font-bold transition ${
                    controllerType === "3-button"
                      ? "bg-fuchsia-500/20 text-fuchsia-200"
                      : "text-white/55 hover:bg-white/5"
                  }`}
                >
                  Genesis 3-button
                </button>
                <button
                  type="button"
                  onClick={() => onControllerTypeChange("6-button")}
                  className={`px-3 py-1.5 text-[11px] font-bold transition ${
                    controllerType === "6-button"
                      ? "bg-fuchsia-500/20 text-fuchsia-200"
                      : "text-white/55 hover:bg-white/5"
                  }`}
                >
                  Genesis 6-button
                </button>
              </div>
            </div>
          )}

          {/* Compact controller diagram (Sega Genesis) */}
          {isSegaGenesis && (
            <div className="mb-4 rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="flex flex-col items-center gap-2 font-mono text-[11px] text-white/70">
                <div className="text-white/45">Start</div>
                <div className="flex gap-3">
                  {(controllerType === "6-button"
                    ? (["X", "Y", "Z"] as const)
                    : []
                  ).map((b) => (
                    <span key={b} className="rounded border border-white/15 px-2 py-1 text-white/55">{b}</span>
                  ))}
                </div>
                <div className="flex gap-3">
                  {(controllerType === "6-button" ? (["A", "B", "C"] as const) : (["A", "B", "C"] as const)).map((b) => (
                    <span key={b} className="rounded border border-fuchsia-400/30 bg-fuchsia-400/10 px-2 py-1 font-bold text-fuchsia-200">{b}</span>
                  ))}
                </div>
                <div className="mt-1 text-white/45">D-Pad</div>
                {controllerType === "6-button" && (
                  <div className="text-white/45">Mode</div>
                )}
              </div>
            </div>
          )}

          {/* Controller layout section */}
          <h3 className="mb-2 text-[11px] font-black uppercase tracking-wider text-white/40">
            {profile.controllerName}
          </h3>
          <div className="space-y-1.5">
            {profile.controls.map((c) => {
              const m = mapping[c.id];
              const isRemapping = remappingId === c.id;
              return (
                <div
                  key={c.id}
                  className="flex flex-col gap-2 rounded-xl border border-white/8 bg-white/3 px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-white/85">{c.label}</span>
                    {c.required && (
                      <span className="rounded bg-white/10 px-1 text-[9px] font-bold text-white/40">required</span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {/* Detected physical gamepad button */}
                    <span className="flex items-center gap-1 rounded-md border border-emerald-400/20 bg-emerald-400/5 px-2 py-0.5 font-mono text-[10px] font-bold text-emerald-300/80">
                      <Gamepad2 size={10} />
                      {standardGamepadLabel(m?.gamepad ?? c.standardGamepadButton)}
                    </span>
                    {/* Keyboard mapping (click to remap) */}
                    <button
                      type="button"
                      ref={isRemapping ? remapButtonRef : undefined}
                      onClick={() => (isRemapping ? cancelRemap() : startRemap(c.id))}
                      className={`flex min-h-[28px] items-center gap-1 rounded-md border px-2 py-0.5 font-mono text-[10px] font-bold transition ${
                        isRemapping
                          ? "border-fuchsia-400 bg-fuchsia-500/20 text-fuchsia-100 animate-pulse"
                          : "border-white/10 bg-black/40 text-fuchsia-300 hover:border-fuchsia-400/40"
                      }`}
                      aria-label={isRemapping ? `Press a key for ${c.label}` : `Remap ${c.label} keyboard key`}
                    >
                      <Keyboard size={10} />
                      {isRemapping ? "Press a key…" : (m?.keyboard ?? "—")}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Emulator shortcuts — separate section, never mixed with controller layout */}
          <h3 className="mb-2 mt-5 text-[11px] font-black uppercase tracking-wider text-white/40">
            Emulator shortcuts
          </h3>
          <div className="space-y-1.5">
            {EMULATOR_SHORTCUTS.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-xl border border-white/8 bg-white/[.02] px-3 py-2"
              >
                <span className="text-xs font-bold text-white/70">{s.label}</span>
                <span className="flex items-center gap-1 rounded-md border border-white/10 bg-black/40 px-2 py-0.5 font-mono text-[10px] font-bold text-white/55">
                  <Keyboard size={10} />
                  {s.keyboardDefault}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 z-10 flex shrink-0 items-center justify-between gap-3 border-t border-white/10 bg-[#0a0b12]/95 px-5 py-3 backdrop-blur">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/15 px-3 py-1.5 text-[11px] font-bold text-white/70 transition hover:bg-white/10"
          >
            <RotateCcw size={12} />
            Restore {isSegaGenesis ? "Sega" : profile.displayName} defaults
          </button>
          <button
            type="button"
            onClick={() => {
              cancelRemap();
              onClose();
            }}
            className="min-h-[40px] rounded-lg bg-fuchsia-500/20 px-4 py-1.5 text-[11px] font-bold text-fuchsia-100 transition hover:bg-fuchsia-500/30"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Normalize a KeyboardEvent.key to the lowercase form EmulatorJS expects. */
function normalizeKeyboardKey(key: string): string | null {
  if (!key || key === "Unidentified") return null;
  // EmulatorJS uses lowercase names like "up arrow", "enter", "z".
  const lower = key.toLowerCase();
  if (lower === " ") return "space";
  if (lower === "control") return "ctrl";
  if (lower === "escape") return null; // escape cancels, not a binding
  return lower;
}
