import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { CliConfig } from "./types.js";

const CONFIG_DIR = path.join(os.homedir(), ".litt-code");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig(): CliConfig {
  ensureConfigDir();
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const raw = fs.readFileSync(CONFIG_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // corrupt config — start fresh
  }
  return {};
}

export function saveConfig(config: CliConfig): void {
  ensureConfigDir();
  const existing = loadConfig();
  const merged = { ...existing, ...config };
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2) + "\n");
}

export function clearConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
    }
  } catch {
    // ignore
  }
}

export function getConfigPath(): string {
  return CONFIG_FILE;
}
