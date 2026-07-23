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
}

export const RETRO_SYSTEMS: RetroSystem[] = [
  { id: "nes", name: "Nintendo Entertainment System", shortName: "NES", extensions: ["nes"], color: "#ff4d67" },
  { id: "snes", name: "Super Nintendo", shortName: "SNES", extensions: ["sfc", "smc"], color: "#a78bfa" },
  { id: "gb", name: "Game Boy", shortName: "GB", extensions: ["gb"], color: "#a3e635" },
  { id: "gbc", name: "Game Boy Color", shortName: "GBC", extensions: ["gbc"], color: "#fbbf24" },
  { id: "gba", name: "Game Boy Advance", shortName: "GBA", extensions: ["gba"], color: "#38bdf8" },
  { id: "segaMD", name: "Sega Genesis / Mega Drive", shortName: "GEN", extensions: ["gen", "md", "smd"], color: "#22d3ee" },
];

const DB_NAME = "litt-retro-arcade";
const STORE_NAME = "roms";
const DB_VERSION = 1;

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

export async function addRetroGame(file: File, title: string, system: RetroSystemId): Promise<RetroGameRecord> {
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
