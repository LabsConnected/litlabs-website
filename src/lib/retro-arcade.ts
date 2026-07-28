export type RetroSystemId = "nes" | "snes" | "gb" | "gbc" | "gba" | "segaMD";

/**
 * Game classification — NOT derived from file extension alone.
 * Metadata takes priority over filename detection.
 */
export type SystemVariant = "standard" | "satellaview" | "super-game-boy" | "special-hardware";

/**
 * Compatibility status — how well the game runs in the emulator.
 * "requires-bios" is NOT a failure — it means the user must supply
 * their own legally obtained firmware.
 */
export type CompatibilityStatus = "standard" | "requires-bios" | "experimental" | "unsupported";

/**
 * Visibility — hidden games don't appear in the normal arcade list.
 * BS-X titles default to "hidden" so they don't clutter the main UI.
 */
export type Visibility = "visible" | "hidden";

export interface RetroSystem {
  id: RetroSystemId;
  name: string;
  shortName: string;
  extensions: string[];
  color: string;
}

export interface RetroGameRecord {
  id: string;
  title: string;
  fileName: string;
  system: RetroSystemId;
  /** Sub-classification within a system (e.g. Satellaview within SNES). */
  systemVariant?: SystemVariant;
  /** How well the game runs — "requires-bios" is not a failure. */
  compatibility?: CompatibilityStatus;
  /** Hidden games don't appear in the normal arcade list. */
  visibility?: Visibility;
  size: number;
  rom: Blob;
  addedAt: number;
  lastPlayedAt?: number;
  launches: number;
  favorite: boolean;
}

export const RETRO_SYSTEMS: RetroSystem[] = [
  { id: "nes", name: "Nintendo Entertainment System", shortName: "NES", extensions: ["nes"], color: "#ff4d67" },
  { id: "snes", name: "Super Nintendo", shortName: "SNES", extensions: ["sfc", "smc", "swc", "fig"], color: "#a78bfa" },
  { id: "gb", name: "Game Boy", shortName: "GB", extensions: ["gb"], color: "#a3e635" },
  { id: "gbc", name: "Game Boy Color", shortName: "GBC", extensions: ["gbc"], color: "#fbbf24" },
  { id: "gba", name: "Game Boy Advance", shortName: "GBA", extensions: ["gba"], color: "#38bdf8" },
  { id: "segaMD", name: "Sega Genesis / Mega Drive", shortName: "GEN", extensions: ["gen", "md", "smd"], color: "#22d3ee" },
];

export const EMULATOR_CORE_BY_SYSTEM: Record<RetroSystemId, string> = {
  nes: "fceumm",
  snes: "snes",
  gb: "gb",
  gbc: "gb",
  gba: "gba",
  segaMD: "segaMD",
};

// ---------------------------------------------------------------------------
// Cover art — Libretro thumbnail CDN (free, public, no API key)
// ---------------------------------------------------------------------------
// Libretro/RetroArch maintains a public thumbnail repository at:
//   https://thumbnails.libretro.com/<System>/Named_Boxarts/<Game>.png
// It has box art for thousands of retro games. We map our RetroSystemId
// to Libretro's system folder names and build a URL from the game's
// fileName (which usually matches the No-Intro naming convention that
// Libretro uses).
//
// If the cover isn't found (404), the <img> onError fallback shows the
// system-colored gradient with the system short name as before.

const LIBRETRO_SYSTEM_MAP: Record<RetroSystemId, string> = {
  nes: "Nintendo - Nintendo Entertainment System",
  snes: "Nintendo - Super Nintendo Entertainment System",
  gb: "Nintendo - Game Boy",
  gbc: "Nintendo - Game Boy Color",
  gba: "Nintendo - Game Boy Advance",
  segaMD: "Sega - Mega Drive - Genesis",
};

/**
 * Build a Libretro thumbnail URL for a retro game.
 * Uses the fileName (without extension) as the lookup key, since Libretro
 * uses the No-Intro naming convention which matches typical ROM filenames.
 *
 * @param game The retro game record
 * @returns A URL to the box art PNG, or null if the system is unknown
 */
export function getCoverArtUrl(game: RetroGameRecord): string | null {
  const systemFolder = LIBRETRO_SYSTEM_MAP[game.system];
  if (!systemFolder) return null;

  // Libretro uses the filename without extension as the thumbnail name.
  // The filename typically matches the No-Intro convention (e.g. "Sonic Spinball (USA)").
  const baseName = game.fileName.replace(/\.[^.]+$/, "");

  return `https://thumbnails.libretro.com/${encodeURIComponent(systemFolder)}/Named_Boxarts/${encodeURIComponent(baseName)}.png`;
}

const DB_NAME = "litt-retro-arcade";
const STORE_NAME = "roms";
const DB_VERSION = 1;

/**
 * Open the retro arcade IndexedDB without forcing a specific version.
 *
 * Previously this called `indexedDB.open(DB_NAME, 1)` unconditionally. If the
 * browser already had a newer-version database (e.g. from a prior build),
 * IndexedDB threw a VersionError and the user could not add or list games.
 *
 * Now we first probe the existing database version with an open-without-version
 * call (which opens at the current version without requesting an upgrade), then
 * re-open at that version so `onupgradeneeded` still fires for fresh databases
 * that need the object store created.
 */
function openRetroDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local game storage is not available in this browser."));
      return;
    }

    // First, open without specifying a version to discover what already exists.
    const probe = indexedDB.open(DB_NAME);
    probe.onupgradeneeded = () => {
      // Fresh database — create the object store at version 1.
      const db = probe.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("lastPlayedAt", "lastPlayedAt");
        store.createIndex("system", "system");
      }
    };
    probe.onsuccess = () => {
      const db = probe.result;
      // If the existing version already has our store, we are done.
      if (db.objectStoreNames.contains(STORE_NAME)) {
        resolve(db);
        return;
      }
      // Existing database is missing the store — bump to the next version and
      // create it in the upgrade callback.
      const targetVersion = Math.max(db.version + 1, DB_VERSION);
      db.close();
      const upgrade = indexedDB.open(DB_NAME, targetVersion);
      upgrade.onupgradeneeded = () => {
        const udb = upgrade.result;
        if (!udb.objectStoreNames.contains(STORE_NAME)) {
          const store = udb.createObjectStore(STORE_NAME, { keyPath: "id" });
          store.createIndex("lastPlayedAt", "lastPlayedAt");
          store.createIndex("system", "system");
        }
      };
      upgrade.onsuccess = () => resolve(upgrade.result);
      upgrade.onerror = () =>
        reject(upgrade.error ?? new Error("Could not open the local game library."));
    };
    probe.onerror = () =>
      reject(probe.error ?? new Error("Could not open the local game library."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local storage request failed."));
  });
}

export function detectRetroSystem(fileName: string): RetroSystemId | null {
  const extension = fileName.split(".").pop()?.toLowerCase();
  if (!extension) return null;
  return RETRO_SYSTEMS.find((system) => system.extensions.includes(extension))?.id ?? null;
}

export function titleFromFileName(fileName: string): string {
  return fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getRetroSystem(id: RetroSystemId): RetroSystem {
  return RETRO_SYSTEMS.find((system) => system.id === id) ?? RETRO_SYSTEMS[0];
}

export async function addRetroGame(file: File, title: string, system: RetroSystemId): Promise<RetroGameRecord> {
  // Auto-classify the game based on filename + system
  const { systemVariant, compatibility } = classifyGame(file.name, system);

  // BS-X / Satellaview titles default to hidden so they don't
  // clutter the normal arcade list. Advanced users can find them
  // in the "Advanced Systems" section.
  const visibility: Visibility = systemVariant === "satellaview" ? "hidden" : "visible";

  const record: RetroGameRecord = {
    id: crypto.randomUUID(),
    title: title.trim() || titleFromFileName(file.name),
    fileName: file.name,
    system,
    systemVariant,
    compatibility,
    visibility,
    size: file.size,
    rom: file,
    addedAt: Date.now(),
    launches: 0,
    favorite: false,
  };
  const db = await openRetroDatabase();
  try {
    await requestResult(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).add(record));
    return record;
  } finally {
    db.close();
  }
}

export async function listRetroGames(): Promise<RetroGameRecord[]> {
  const db = await openRetroDatabase();
  try {
    const records = await requestResult(db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll()) as RetroGameRecord[];
    return records.sort((a, b) => (b.lastPlayedAt ?? b.addedAt) - (a.lastPlayedAt ?? a.addedAt));
  } finally {
    db.close();
  }
}

export async function getRetroGame(id: string): Promise<RetroGameRecord | undefined> {
  const db = await openRetroDatabase();
  try {
    return await requestResult(db.transaction(STORE_NAME).objectStore(STORE_NAME).get(id)) as RetroGameRecord | undefined;
  } finally {
    db.close();
  }
}

export async function updateRetroGame(id: string, patch: Partial<Omit<RetroGameRecord, "id" | "rom">>): Promise<RetroGameRecord> {
  const db = await openRetroDatabase();
  try {
    const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
    const current = await requestResult(store.get(id)) as RetroGameRecord | undefined;
    if (!current) throw new Error("Game not found in this browser.");
    const updated = { ...current, ...patch };
    await requestResult(store.put(updated));
    return updated;
  } finally {
    db.close();
  }
}

export async function deleteRetroGame(id: string): Promise<void> {
  const db = await openRetroDatabase();
  try {
    await requestResult(db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).delete(id));
  } finally {
    db.close();
  }
}

export function formatRomSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function readRomAsBase64(rom: Blob): Promise<string> {
  const buffer = await rom.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
  }
  return btoa(binary);
}

/**
 * Detect Satellaview / BS-X content from the filename.
 *
 * BS-X games are specialist content that requires a user-provided
 * BS-X system BIOS. They should NOT be treated as normal SNES games.
 *
 * Matches:
 * - File extensions: .bs, .bsa
 * - Filename keywords: "BS", "BS-X", "BSX", "Satellaview",
 *   "SoundLink", "Broadcast"
 * - The common "BS " prefix pattern (e.g. "BS Mario Collection")
 *
 * Metadata (systemVariant) takes priority over this heuristic.
 */
export function detectSatellaview(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  // File extensions unique to Satellaview
  if (lower.endsWith(".bs") || lower.endsWith(".bsa")) return true;
  // Explicit keywords
  if (lower.includes("satellaview")) return true;
  if (lower.includes("bs-x")) return true;
  if (lower.includes("bsx")) return true;
  if (lower.includes("soundlink")) return true;
  if (lower.includes("broadcast")) return true;
  // "BS " prefix pattern — e.g. "BS Mario Collection", "BS Zelda"
  // Match "bs " at start or after a separator, followed by a word char
  if (/(^|[\s._-])bs[\s._-]/i.test(lower)) return true;
  return false;
}

/**
 * Classify a game based on filename + system.
 * Returns the system variant and compatibility status.
 *
 * Standard SNES games → standard / standard
 * Satellaview titles → satellaview / requires-bios
 */
export function classifyGame(
  fileName: string,
  system: RetroSystemId,
): { systemVariant: SystemVariant; compatibility: CompatibilityStatus } {
  // SNES: check for Satellaview
  if (system === "snes" && detectSatellaview(fileName)) {
    return { systemVariant: "satellaview", compatibility: "requires-bios" };
  }
  // Default: standard game
  return { systemVariant: "standard", compatibility: "standard" };
}

/**
 * Check if a game should appear in the normal arcade list.
 * Hidden games and Satellaview titles are excluded.
 */
export function isStandardPlayable(game: RetroGameRecord): boolean {
  if (game.visibility === "hidden") return false;
  if (game.systemVariant === "satellaview") return false;
  if (game.compatibility === "unsupported") return false;
  return true;
}

/**
 * Check if a game requires external firmware (BIOS).
 */
export function requiresBios(game: RetroGameRecord): boolean {
  return game.compatibility === "requires-bios" || game.systemVariant === "satellaview";
}
