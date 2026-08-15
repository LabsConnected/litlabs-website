/**
 * First-run config initialization.
 *
 * On first launch, creates ~/.litt/config.json with sensible defaults.
 * This is NOT a settings manager — it's a one-time bootstrap that
 * records that LiTT has been initialized and stores basic identity.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface LittConfig {
  /** Schema version */
  version: 1;
  /** When the config was first created (ISO string) */
  createdAt: string;
  /** Default mode: plan, act, or auto */
  defaultMode: "plan" | "act" | "auto";
  /** Default model profile (auto = LiTT routes based on task) */
  defaultModel: string;
  /** Whether the user has completed first-run */
  initialized: boolean;
}

const DEFAULT_CONFIG: LittConfig = {
  version: 1,
  createdAt: new Date().toISOString(),
  defaultMode: "act",
  defaultModel: "auto",
  initialized: true,
};

/**
 * Get the LiTT home directory (~/.litt or LITT_HOME env var).
 */
export function getLittHome(): string {
  return process.env.LITT_HOME ?? join(homedir(), ".litt");
}

/**
 * Get the config file path.
 */
export function getConfigPath(): string {
  return join(getLittHome(), "config.json");
}

/**
 * Ensure the first-run config exists. Creates it if missing.
 * Returns the config (existing or newly created).
 */
export function ensureConfig(): LittConfig {
  const configPath = getConfigPath();
  const littHome = getLittHome();

  if (existsSync(configPath)) {
    try {
      const raw = readFileSync(configPath, "utf-8");
      return JSON.parse(raw) as LittConfig;
    } catch {
      // Corrupt config — rewrite with defaults
    }
  }

  // Create ~/.litt directory if needed
  if (!existsSync(littHome)) {
    mkdirSync(littHome, { recursive: true });
  }

  // Write default config
  // Model truth: OPENROUTER_API_KEY means OpenRouter is available as a
  // provider — it does NOT mean Claude (or any specific model) is selected.
  // The default model is resolved at runtime via resolveConfiguredModel().
  const config: LittConfig = {
    ...DEFAULT_CONFIG,
    createdAt: new Date().toISOString(),
    defaultModel: "auto",
  };

  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");
  return config;
}

/**
 * Check if first-run config exists (without creating it).
 */
export function hasConfig(): boolean {
  return existsSync(getConfigPath());
}
