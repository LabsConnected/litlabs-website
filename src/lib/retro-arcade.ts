export type RetroSystemId = "nes" | "snes" | "gb" | "gbc" | "gba" | "segaMD";

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
  size: number;
  rom: Blob;
  addedAt: number;
  lastPlayedAt?: number;
  launches: number;
  favorite: boolean;
  /** Optional custom artwork stored as a data URL or blob URL. */
  customArtworkUrl?: string;
  /** Optional accent color override for generated artwork. */
  artworkAccent?: string;
  /** Optional subtitle / tagline shown on artwork. */
  subtitle?: string;
  /** Optional Quick Play source id, used to prevent duplicate installs. */
  quickPlayId?: string;
}

export const RETRO_SYSTEMS: RetroSystem[] = [
  { id: "nes", name: "Nintendo Entertainment System", shortName: "NES", extensions: ["nes"], color: "#ff4d67" },
  { id: "snes", name: "Super Nintendo", shortName: "SNES", extensions: ["sfc", "smc", "swc", "bs", "fig"], color: "#a78bfa" },
  { id: "gb", name: "Game Boy", shortName: "GB", extensions: ["gb"], color: "#a3e635" },
  { id: "gbc", name: "Game Boy Color", shortName: "GBC", extensions: ["gbc"], color: "#fbbf24" },
  { id: "gba", name: "Game Boy Advance", shortName: "GBA", extensions: ["gba"], color: "#38bdf8" },
  { id: "segaMD", name: "Sega Genesis / Mega Drive", shortName: "GEN", extensions: ["gen", "md", "smd"], color: "#22d3ee" },
];

const DB_NAME = "litt-retro-arcade";
const STORE_NAME = "roms";
const DB_VERSION = 2;

function openRetroDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("Local game storage is not available in this browser."));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("lastPlayedAt", "lastPlayedAt");
        store.createIndex("system", "system");
        store.createIndex("quickPlayId", "quickPlayId");
      } else if (request.result.version < 2) {
        const store = request.transaction!.objectStore(STORE_NAME);
        if (!store.indexNames.contains("quickPlayId")) {
          store.createIndex("quickPlayId", "quickPlayId");
        }
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open the local game library."));
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

export async function addRetroGame(
  file: File,
  title: string,
  system: RetroSystemId,
  options?: { quickPlayId?: string; subtitle?: string; customArtworkUrl?: string },
): Promise<RetroGameRecord> {
  const record: RetroGameRecord = {
    id: crypto.randomUUID(),
    title: title.trim() || titleFromFileName(file.name),
    fileName: file.name,
    system,
    size: file.size,
    rom: file,
    addedAt: Date.now(),
    launches: 0,
    favorite: false,
    quickPlayId: options?.quickPlayId,
    subtitle: options?.subtitle,
    customArtworkUrl: options?.customArtworkUrl,
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

/** Check whether a Quick Play game has already been imported. */
export async function findQuickPlayInstall(quickPlayId: string): Promise<RetroGameRecord | undefined> {
  const db = await openRetroDatabase();
  try {
    const index = db.transaction(STORE_NAME).objectStore(STORE_NAME).index("quickPlayId");
    return await requestResult(index.get(quickPlayId)) as RetroGameRecord | undefined;
  } catch {
    const all = await requestResult(db.transaction(STORE_NAME).objectStore(STORE_NAME).getAll()) as RetroGameRecord[];
    return all.find((g) => g.quickPlayId === quickPlayId);
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

/**
 * Encode a ROM Blob into a base64 data URL. Used by the player page so the
 * file can be loaded inside a `srcDoc` iframe (which gets an opaque origin
 * and cannot read parent-created `blob:` URLs).
 */
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

export function detectSatellaview(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.endsWith(".bs") || lower.endsWith(".bsa") || lower.endsWith(".fig") || lower.includes("satellaview") || lower.includes("bs-x") || lower.includes("bsx");
}
