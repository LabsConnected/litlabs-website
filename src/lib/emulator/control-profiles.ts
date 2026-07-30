/**
 * System-specific control profiles for the EmulatorJS runtime.
 *
 * WHY THIS EXISTS
 * ---------------
 * EmulatorJS keys its in-emulator "Control Settings" menu off the *control
 * scheme*, resolved by `getControlScheme()`:
 *
 *   1. If `config.controlScheme` (i.e. `EJS_controlScheme`) is set, use it.
 *   2. Otherwise fall back to `getCore(true)` — which reverse-maps the raw
 *      core name through the `getCores()` table to a system alias.
 *
 * That fallback is *ambiguous* for Sega: `genesis_plus_gx` appears in BOTH the
 * `segaMS` and `segaMD` core lists, and `segaMS` is declared first, so
 * `getCore(true)` resolves `genesis_plus_gx` → `"segaMS"`. The `segaMS`
 * control scheme renders generic `"BUTTON 1 / START"` / `"BUTTON 2"` labels —
 * which is exactly what users saw for Sega Genesis titles like Lion King.
 *
 * THE FIX (layered, no vendored patch required)
 * ---------------------------------------------
 * LiTTree keeps two distinct identities:
 *   - `systemId`   — the product-facing system/control identity (e.g. "segaMD")
 *   - `coreId`     — the actual libretro core to load (e.g. "genesis_plus_gx")
 *
 * The runtime adapter injects `EJS_controlScheme = systemId` so EmulatorJS
 * loads the right core AND renders the correct Sega controller layout, without
 * relying on the ambiguous reverse-mapping.
 *
 * This module is the single source of truth for those profiles. The visible UI
 * (RetroControlsModal) and the runtime contract (emulator-session.html) both
 * consume it, so semantic Sega names (A/B/C/Start/D-Pad) are shown everywhere
 * even when EmulatorJS internally uses `BUTTON_N` identifiers.
 */

// ─── System identity ──────────────────────────────────────────────

export type EmulatorSystemId =
  | "segaMD"
  | "segaMS"
  | "segaGG"
  | "segaCD"
  | "sega32x"
  | "nes"
  | "snes"
  | "gb"
  | "gbc"
  | "gba"
  | "n64"
  | "psx"
  | "arcade";

/**
 * The EmulatorJS control-scheme string passed as `EJS_controlScheme`.
 * This is the value EmulatorJS's `getControlScheme()` switches on, so it must
 * match one of the branches in `createControlSettingMenu()` / the virtual
 * gamepad layout. For most systems it equals the systemId; arcade is special.
 */
export function controlSchemeForSystem(systemId: EmulatorSystemId): string {
  // EmulatorJS uses "arcade"/"mame" as the control-scheme key for FBNeo/MAME.
  if (systemId === "arcade") return "arcade";
  return systemId;
}

// ─── Control definitions ──────────────────────────────────────────

/**
 * A single semantic control on a controller.
 *
 * - `emulatorBinding` is the EmulatorJS 4.2.3 internal button id (the numeric
 *   RetroPad index used in `defaultControllers` and `createControlSettingMenu`).
 *   These were verified against `public/emulatorjs/4.2.3/data/src/emulator.js`
 *   — do NOT guess; the segaMD branch maps A=1, B=0, C=8, X=10, Y=9, Z=11,
 *   Mode=2, Start=3, D-Pad=4/5/6/7.
 * - `standardGamepadButton` is the W3C Standard Gamepad layout button index
 *   used as the ergonomic default (Xbox-style mapping).
 */
export interface ControlDefinition {
  id: string;
  label: string;
  /** Default keyboard key (lowercase, as EmulatorJS expects), or null. */
  keyboardDefault: string | null;
  /** W3C Standard Gamepad button index, or null for axes/dpad. */
  standardGamepadButton: number | null;
  /** EmulatorJS 4.2.3 internal RetroPad button id. */
  emulatorBinding: number;
  required: boolean;
}

export type ControlProfileId =
  | "sega-genesis-3-button"
  | "sega-genesis-6-button"
  | "sega-master-system"
  | "sega-game-gear"
  | "nes"
  | "snes"
  | "game-boy"
  | "gba";

export interface ControlProfile {
  profileId: ControlProfileId;
  systemId: EmulatorSystemId;
  displayName: string;
  controllerName: string;
  controls: ControlDefinition[];
}

// ─── Sega Genesis three-button (default for Lion King) ────────────

export const SEGA_GENESIS_3_BUTTON: ControlProfile = {
  profileId: "sega-genesis-3-button",
  systemId: "segaMD",
  displayName: "Sega Genesis",
  controllerName: "Genesis 3-button",
  controls: [
    { id: "up", label: "D-Pad Up", keyboardDefault: "up arrow", standardGamepadButton: 12, emulatorBinding: 4, required: true },
    { id: "down", label: "D-Pad Down", keyboardDefault: "down arrow", standardGamepadButton: 13, emulatorBinding: 5, required: true },
    { id: "left", label: "D-Pad Left", keyboardDefault: "left arrow", standardGamepadButton: 14, emulatorBinding: 6, required: true },
    { id: "right", label: "D-Pad Right", keyboardDefault: "right arrow", standardGamepadButton: 15, emulatorBinding: 7, required: true },
    // Genesis A → Xbox X (west), B → Xbox A (south), C → Xbox B (east)
    { id: "a", label: "A", keyboardDefault: "z", standardGamepadButton: 2, emulatorBinding: 1, required: true },
    { id: "b", label: "B", keyboardDefault: "x", standardGamepadButton: 0, emulatorBinding: 0, required: true },
    { id: "c", label: "C", keyboardDefault: "c", standardGamepadButton: 1, emulatorBinding: 8, required: true },
    { id: "start", label: "Start", keyboardDefault: "enter", standardGamepadButton: 9, emulatorBinding: 3, required: true },
  ],
};

// ─── Sega Genesis six-button extension ────────────────────────────

export const SEGA_GENESIS_6_BUTTON: ControlProfile = {
  profileId: "sega-genesis-6-button",
  systemId: "segaMD",
  displayName: "Sega Genesis",
  controllerName: "Genesis 6-button",
  controls: [
    ...SEGA_GENESIS_3_BUTTON.controls,
    // X → Xbox Y (north), Y → Left bumper, Z → Right bumper, Mode → View/Back
    { id: "x", label: "X", keyboardDefault: "s", standardGamepadButton: 3, emulatorBinding: 10, required: false },
    { id: "y", label: "Y", keyboardDefault: "a", standardGamepadButton: 4, emulatorBinding: 9, required: false },
    { id: "z", label: "Z", keyboardDefault: "d", standardGamepadButton: 5, emulatorBinding: 11, required: false },
    { id: "mode", label: "Mode", keyboardDefault: "shift", standardGamepadButton: 8, emulatorBinding: 2, required: false },
  ],
};

// ─── Other systems (kept stable — not the focus of this fix) ──────

export const NES_PROFILE: ControlProfile = {
  profileId: "nes",
  systemId: "nes",
  displayName: "NES / Famicom",
  controllerName: "NES controller",
  controls: [
    { id: "up", label: "D-Pad Up", keyboardDefault: "up arrow", standardGamepadButton: 12, emulatorBinding: 4, required: true },
    { id: "down", label: "D-Pad Down", keyboardDefault: "down arrow", standardGamepadButton: 13, emulatorBinding: 5, required: true },
    { id: "left", label: "D-Pad Left", keyboardDefault: "left arrow", standardGamepadButton: 14, emulatorBinding: 6, required: true },
    { id: "right", label: "D-Pad Right", keyboardDefault: "right arrow", standardGamepadButton: 15, emulatorBinding: 7, required: true },
    { id: "a", label: "A", keyboardDefault: "z", standardGamepadButton: 0, emulatorBinding: 8, required: true },
    { id: "b", label: "B", keyboardDefault: "x", standardGamepadButton: 1, emulatorBinding: 0, required: true },
    { id: "start", label: "Start", keyboardDefault: "enter", standardGamepadButton: 9, emulatorBinding: 3, required: true },
    { id: "select", label: "Select", keyboardDefault: "shift", standardGamepadButton: 8, emulatorBinding: 2, required: true },
  ],
};

export const SNES_PROFILE: ControlProfile = {
  profileId: "snes",
  systemId: "snes",
  displayName: "SNES / Super Famicom",
  controllerName: "SNES controller",
  controls: [
    { id: "up", label: "D-Pad Up", keyboardDefault: "up arrow", standardGamepadButton: 12, emulatorBinding: 4, required: true },
    { id: "down", label: "D-Pad Down", keyboardDefault: "down arrow", standardGamepadButton: 13, emulatorBinding: 5, required: true },
    { id: "left", label: "D-Pad Left", keyboardDefault: "left arrow", standardGamepadButton: 14, emulatorBinding: 6, required: true },
    { id: "right", label: "D-Pad Right", keyboardDefault: "right arrow", standardGamepadButton: 15, emulatorBinding: 7, required: true },
    { id: "a", label: "A", keyboardDefault: "z", standardGamepadButton: 0, emulatorBinding: 8, required: true },
    { id: "b", label: "B", keyboardDefault: "x", standardGamepadButton: 1, emulatorBinding: 0, required: true },
    { id: "x", label: "X", keyboardDefault: "s", standardGamepadButton: 2, emulatorBinding: 9, required: true },
    { id: "y", label: "Y", keyboardDefault: "a", standardGamepadButton: 3, emulatorBinding: 1, required: true },
    { id: "l", label: "L", keyboardDefault: "q", standardGamepadButton: 4, emulatorBinding: 10, required: true },
    { id: "r", label: "R", keyboardDefault: "w", standardGamepadButton: 5, emulatorBinding: 11, required: true },
    { id: "start", label: "Start", keyboardDefault: "enter", standardGamepadButton: 9, emulatorBinding: 3, required: true },
    { id: "select", label: "Select", keyboardDefault: "shift", standardGamepadButton: 8, emulatorBinding: 2, required: true },
  ],
};

export const GAME_BOY_PROFILE: ControlProfile = {
  profileId: "game-boy",
  systemId: "gb",
  displayName: "Game Boy",
  controllerName: "Game Boy",
  controls: [
    { id: "up", label: "D-Pad Up", keyboardDefault: "up arrow", standardGamepadButton: 12, emulatorBinding: 4, required: true },
    { id: "down", label: "D-Pad Down", keyboardDefault: "down arrow", standardGamepadButton: 13, emulatorBinding: 5, required: true },
    { id: "left", label: "D-Pad Left", keyboardDefault: "left arrow", standardGamepadButton: 14, emulatorBinding: 6, required: true },
    { id: "right", label: "D-Pad Right", keyboardDefault: "right arrow", standardGamepadButton: 15, emulatorBinding: 7, required: true },
    { id: "a", label: "A", keyboardDefault: "z", standardGamepadButton: 0, emulatorBinding: 8, required: true },
    { id: "b", label: "B", keyboardDefault: "x", standardGamepadButton: 1, emulatorBinding: 0, required: true },
    { id: "start", label: "Start", keyboardDefault: "enter", standardGamepadButton: 9, emulatorBinding: 3, required: true },
    { id: "select", label: "Select", keyboardDefault: "shift", standardGamepadButton: 8, emulatorBinding: 2, required: true },
  ],
};

export const GBA_PROFILE: ControlProfile = {
  profileId: "gba",
  systemId: "gba",
  displayName: "Game Boy Advance",
  controllerName: "GBA",
  controls: [
    { id: "up", label: "D-Pad Up", keyboardDefault: "up arrow", standardGamepadButton: 12, emulatorBinding: 4, required: true },
    { id: "down", label: "D-Pad Down", keyboardDefault: "down arrow", standardGamepadButton: 13, emulatorBinding: 5, required: true },
    { id: "left", label: "D-Pad Left", keyboardDefault: "left arrow", standardGamepadButton: 14, emulatorBinding: 6, required: true },
    { id: "right", label: "D-Pad Right", keyboardDefault: "right arrow", standardGamepadButton: 15, emulatorBinding: 7, required: true },
    { id: "a", label: "A", keyboardDefault: "z", standardGamepadButton: 0, emulatorBinding: 8, required: true },
    { id: "b", label: "B", keyboardDefault: "x", standardGamepadButton: 1, emulatorBinding: 0, required: true },
    { id: "l", label: "L", keyboardDefault: "a", standardGamepadButton: 4, emulatorBinding: 10, required: true },
    { id: "r", label: "R", keyboardDefault: "s", standardGamepadButton: 5, emulatorBinding: 11, required: true },
    { id: "start", label: "Start", keyboardDefault: "enter", standardGamepadButton: 9, emulatorBinding: 3, required: true },
    { id: "select", label: "Select", keyboardDefault: "shift", standardGamepadButton: 8, emulatorBinding: 2, required: true },
  ],
};

export const SEGA_MASTER_SYSTEM_PROFILE: ControlProfile = {
  profileId: "sega-master-system",
  systemId: "segaMS",
  displayName: "Sega Master System",
  controllerName: "Master System",
  controls: [
    { id: "up", label: "D-Pad Up", keyboardDefault: "up arrow", standardGamepadButton: 12, emulatorBinding: 4, required: true },
    { id: "down", label: "D-Pad Down", keyboardDefault: "down arrow", standardGamepadButton: 13, emulatorBinding: 5, required: true },
    { id: "left", label: "D-Pad Left", keyboardDefault: "left arrow", standardGamepadButton: 14, emulatorBinding: 6, required: true },
    { id: "right", label: "D-Pad Right", keyboardDefault: "right arrow", standardGamepadButton: 15, emulatorBinding: 7, required: true },
    { id: "button1", label: "Button 1", keyboardDefault: "z", standardGamepadButton: 0, emulatorBinding: 0, required: true },
    { id: "button2", label: "Button 2", keyboardDefault: "x", standardGamepadButton: 1, emulatorBinding: 8, required: true },
  ],
};

export const SEGA_GAME_GEAR_PROFILE: ControlProfile = {
  profileId: "sega-game-gear",
  systemId: "segaGG",
  displayName: "Sega Game Gear",
  controllerName: "Game Gear",
  controls: [
    { id: "up", label: "D-Pad Up", keyboardDefault: "up arrow", standardGamepadButton: 12, emulatorBinding: 4, required: true },
    { id: "down", label: "D-Pad Down", keyboardDefault: "down arrow", standardGamepadButton: 13, emulatorBinding: 5, required: true },
    { id: "left", label: "D-Pad Left", keyboardDefault: "left arrow", standardGamepadButton: 14, emulatorBinding: 6, required: true },
    { id: "right", label: "D-Pad Right", keyboardDefault: "right arrow", standardGamepadButton: 15, emulatorBinding: 7, required: true },
    { id: "button1", label: "Button 1", keyboardDefault: "z", standardGamepadButton: 0, emulatorBinding: 0, required: true },
    { id: "button2", label: "Button 2", keyboardDefault: "x", standardGamepadButton: 1, emulatorBinding: 8, required: true },
    { id: "start", label: "Start", keyboardDefault: "enter", standardGamepadButton: 9, emulatorBinding: 3, required: true },
  ],
};

// ─── Registry ─────────────────────────────────────────────────────

export const CONTROL_PROFILES: Readonly<Record<ControlProfileId, ControlProfile>> = {
  "sega-genesis-3-button": SEGA_GENESIS_3_BUTTON,
  "sega-genesis-6-button": SEGA_GENESIS_6_BUTTON,
  "sega-master-system": SEGA_MASTER_SYSTEM_PROFILE,
  "sega-game-gear": SEGA_GAME_GEAR_PROFILE,
  nes: NES_PROFILE,
  snes: SNES_PROFILE,
  "game-boy": GAME_BOY_PROFILE,
  gba: GBA_PROFILE,
};

/**
 * Emulator shortcuts shown in a separate section of the controls modal —
 * never mixed into the console controller layout.
 */
export interface EmulatorShortcut {
  id: string;
  label: string;
  keyboardDefault: string;
}

export const EMULATOR_SHORTCUTS: readonly EmulatorShortcut[] = [
  { id: "quick-save", label: "Quick Save", keyboardDefault: "F2" },
  { id: "quick-load", label: "Quick Load", keyboardDefault: "F4" },
  { id: "state-slot", label: "Change State Slot", keyboardDefault: "F3" },
  { id: "fast-forward", label: "Fast Forward", keyboardDefault: "F5" },
  { id: "slow-motion", label: "Slow Motion", keyboardDefault: "F6" },
  { id: "rewind", label: "Rewind", keyboardDefault: "F7" },
];

// ─── System normalization ─────────────────────────────────────────

/**
 * Normalize a free-form system string (from ROM metadata, filename, or user
 * input) to a canonical `EmulatorSystemId`. Handles common aliases:
 *   Genesis / Mega Drive / MD / GEN → "segaMD"
 *   Master System / SMS             → "segaMS"
 *   Game Gear / GG                  → "segaGG"
 *   Sega CD / Mega CD               → "segaCD"
 *   32X                             → "sega32x"
 *
 * Returns null when the system cannot be confidently identified.
 */
export function normalizeSystemId(raw: string): EmulatorSystemId | null {
  const s = raw.trim().toLowerCase();
  if (!s) return null;
  if (["segamd", "mega drive", "megadrive", "genesis", "md", "gen"].includes(s)) return "segaMD";
  if (["segams", "master system", "mastersystem", "sms"].includes(s)) return "segaMS";
  if (["segagg", "game gear", "gamegear", "gg"].includes(s)) return "segaGG";
  if (["segacd", "sega cd", "mega cd", "megacd"].includes(s)) return "segaCD";
  if (["sega32x", "32x"].includes(s)) return "sega32x";
  if (["nes", "famicom"].includes(s)) return "nes";
  if (["snes", "super nintendo", "super famicom"].includes(s)) return "snes";
  if (["gb", "game boy", "gameboy"].includes(s)) return "gb";
  if (["gbc", "game boy color", "gameboy color"].includes(s)) return "gbc";
  if (["gba", "game boy advance", "gameboy advance"].includes(s)) return "gba";
  if (["n64", "nintendo 64"].includes(s)) return "n64";
  if (["psx", "playstation", "ps1"].includes(s)) return "psx";
  if (["arcade", "fbneo", "mame"].includes(s)) return "arcade";
  return null;
}

/**
 * The actual libretro core to load for a given system. This is the value
 * passed as `EJS_core` (the core that runs the game), distinct from the
 * `systemId`/control-scheme that determines labels and controller shape.
 */
export function coreIdForSystem(systemId: EmulatorSystemId): string {
  switch (systemId) {
    case "segaMD":
    case "segaMS":
    case "segaGG":
    case "segaCD":
      return "genesis_plus_gx";
    case "sega32x":
      return "picodrive";
    case "nes":
      return "fceumm";
    case "snes":
      return "snes9x";
    case "gb":
    case "gbc":
      return "gambatte";
    case "gba":
      return "mgba";
    case "n64":
      return "mupen64plus_next";
    case "psx":
      return "pcsx_rearmed";
    case "arcade":
      return "fbneo";
  }
}

/**
 * The default control profile for a system. Lion King (Sega Genesis) defaults
 * to the three-button profile.
 */
export function defaultProfileForSystem(systemId: EmulatorSystemId): ControlProfile {
  switch (systemId) {
    case "segaMD":
      return SEGA_GENESIS_3_BUTTON;
    case "segaMS":
      return SEGA_MASTER_SYSTEM_PROFILE;
    case "segaGG":
      return SEGA_GAME_GEAR_PROFILE;
    case "nes":
      return NES_PROFILE;
    case "snes":
      return SNES_PROFILE;
    case "gb":
    case "gbc":
      return GAME_BOY_PROFILE;
    case "gba":
      return GBA_PROFILE;
    // segaCD/sega32x/n64/psx/arcade reuse the 3-button/genesis defaults where
    // a dedicated profile isn't defined yet — they still get a correct
    // controlScheme injected so EmulatorJS renders the right layout.
    case "segaCD":
    case "sega32x":
      return SEGA_GENESIS_6_BUTTON;
    default:
      return SEGA_GENESIS_3_BUTTON;
  }
}

export function getProfile(profileId: ControlProfileId): ControlProfile {
  return CONTROL_PROFILES[profileId];
}

/**
 * The six-button counterpart for a profile, when one exists. Used by the
 * 3-button/6-button selector: switching preserves D-Pad/A/B/C/Start and
 * adds/removes X/Y/Z/Mode.
 */
export function sixButtonVariant(profile: ControlProfile): ControlProfile | null {
  if (profile.profileId === "sega-genesis-3-button") return SEGA_GENESIS_6_BUTTON;
  if (profile.profileId === "sega-genesis-6-button") return SEGA_GENESIS_3_BUTTON;
  return null;
}

// ─── Saved mapping persistence (namespaced) ───────────────────────

/**
 * Build a namespaced localStorage key for a user's saved controller mapping.
 * Mappings are namespaced by user + systemId + controller id so that Genesis
 * mappings are never shared with NES/SNES/Game Gear, and different controllers
 * each get their own saved profile.
 */
export function mappingStorageKey(
  userId: string,
  systemId: EmulatorSystemId,
  controllerId: string,
): string {
  return `litt-arcade-controls:${userId}:${systemId}:${controllerId}`;
}

/** Load a saved mapping, or null if none exists. */
export function loadSavedMapping(
  userId: string,
  systemId: EmulatorSystemId,
  controllerId: string,
): Record<string, { keyboard: string | null; gamepad: number | null }> | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(mappingStorageKey(userId, systemId, controllerId));
    if (!raw) return null;
    return JSON.parse(raw) as Record<string, { keyboard: string | null; gamepad: number | null }>;
  } catch {
    return null;
  }
}

/**
 * Save a mapping. Only persists user remaps — defaults are never written, so
 * "Restore Sega defaults" simply clears the stored entry.
 */
export function saveMapping(
  userId: string,
  systemId: EmulatorSystemId,
  controllerId: string,
  mapping: Record<string, { keyboard: string | null; gamepad: number | null }>,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(
      mappingStorageKey(userId, systemId, controllerId),
      JSON.stringify(mapping),
    );
  } catch {
    /* storage may be unavailable (private mode) — non-fatal */
  }
}

/** Clear a saved mapping, restoring the system defaults. */
export function clearSavedMapping(
  userId: string,
  systemId: EmulatorSystemId,
  controllerId: string,
): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(mappingStorageKey(userId, systemId, controllerId));
  } catch {
    /* non-fatal */
  }
}

// ─── Standard Gamepad label helper ────────────────────────────────

/**
 * Human-readable label for a W3C Standard Gamepad button index, used to show
 * the detected physical button beside each mapping (e.g. "A → Xbox X").
 */
export function standardGamepadLabel(buttonIndex: number | null): string {
  if (buttonIndex === null) return "—";
  // W3C Standard Gamepad layout → Xbox-style names
  const labels = [
    "Xbox A",   // 0  south
    "Xbox B",   // 1  east
    "Xbox X",   // 2  west
    "Xbox Y",   // 3  north
    "Left Bumper",  // 4
    "Right Bumper", // 5
    "Left Trigger", // 6
    "Right Trigger",// 7
    "View / Back",  // 8
    "Menu / Start", // 9
    "Left Stick",   // 10
    "Right Stick",  // 11
    "D-Pad Up",      // 12
    "D-Pad Down",    // 13
    "D-Pad Left",    // 14
    "D-Pad Right",   // 15
  ];
  return labels[buttonIndex] ?? `Button ${buttonIndex}`;
}

// ─── EJS_defaultControls builder ──────────────────────────────────

/**
 * Build the `EJS_defaultControls` object for EmulatorJS 4.2.3 from a control
 * profile. This sets keyboard + gamepad defaults for player 1 *before*
 * loader.js executes, but only applies them when no saved user mapping exists
 * (so user remaps are preserved across launches).
 *
 * EmulatorJS expects `EJS_defaultControls` as:
 *   { <playerNum>: { <retropadId>: { value: <key>, value2: "<LABEL>" } } }
 *
 * We only inject keyboard defaults here (`value`); gamepad defaults are left
 * to EmulatorJS's auto-detection, which already maps the Standard Gamepad.
 * The `value2` label is the EmulatorJS internal name (e.g. "BUTTON_1") — it is
 * NOT shown to users; the visible UI uses `ControlDefinition.label` instead.
 */
export function buildEjsDefaultControls(
  profile: ControlProfile,
): Record<number, Record<number, { value: string; value2: string }>> {
  const player1: Record<number, { value: string; value2: string }> = {};
  for (const c of profile.controls) {
    if (c.keyboardDefault) {
      player1[c.emulatorBinding] = {
        value: c.keyboardDefault,
        value2: ejsInternalLabel(c.emulatorBinding),
      };
    }
  }
  return { 0: player1 };
}

/**
 * Map an EmulatorJS RetroPad button id to its internal `value2` label, as used
 * in `initControlVars()` (emulator.js ~line 3082). Verified against the
 * vendored 4.2.3 source — these are the internal identifiers, never shown to
 * users directly.
 */
function ejsInternalLabel(retropadId: number): string {
  const map: Record<number, string> = {
    0: "BUTTON_2",
    1: "BUTTON_4",
    2: "SELECT",
    3: "START",
    4: "DPAD_UP",
    5: "DPAD_DOWN",
    6: "DPAD_LEFT",
    7: "DPAD_RIGHT",
    8: "BUTTON_1",
    9: "BUTTON_3",
    10: "LEFT_TOP_SHOULDER",
    11: "RIGHT_TOP_SHOULDER",
  };
  return map[retropadId] ?? `BUTTON_${retropadId}`;
}
