/**
 * Credential storage — abstracted behind one CredentialStore interface.
 *
 * Desktop (Windows/macOS/Linux):
 *   KeychainCredentialStore — uses @napi-rs/keyring (Windows Credential
 *   Manager, macOS Keychain, Linux Secret Service). Falls back to file
 *   if the native keychain is unavailable.
 *
 * Termux/Android:
 *   FileCredentialStore — ~/.config/litt/auth.json
 *   - parent directory mode 700
 *   - credential file mode 600
 *   - atomic writes (write to temp, rename)
 *
 * The keychain is loaded via dynamic import — if @napi-rs/keyring is not
 * installed or fails to load (e.g. on Android where no prebuilt binary
 * exists), the file fallback is used automatically. This keeps the CLI
 * working on Termux without native dependencies.
 */

import { chmod, mkdir, readFile, writeFile, rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { CredentialStore, StorageKind } from "./types.js";
import { AuthError } from "./types.js";

export interface CreateStoreOptions {
  keychainService?: string;
  environment?: string;
  filePath?: string;
}

type KeyringModule = typeof import("@napi-rs/keyring");

function storageError(message: string, error: unknown): AuthError {
  if (error instanceof AuthError) return error;
  const detail = error instanceof Error ? error.message : String(error);
  return new AuthError("storage", `${message}: ${detail}`);
}

function environmentName(options?: CreateStoreOptions): string {
  return options?.environment ?? "default";
}

/** Default file path: ~/.config/litt/auth.json (Termux-compatible). */
function defaultFilePath(environment: string): string {
  return join(homedir(), ".config", "litt", `${environment}.json`);
}

// ─── Memory store (testing only) ──────────────────────────────────

class MemoryCredentialStore implements CredentialStore {
  private readonly values = new Map<string, string>();

  async get(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.values.delete(key);
  }
}

// ─── File store (Termux fallback + keychain fallback) ─────────────

class FileCredentialStore implements CredentialStore {
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly filePath: string) {}

  /** Serialize operations to prevent race conditions. */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private async readAll(): Promise<Record<string, string>> {
    try {
      const content = await readFile(this.filePath, "utf8");
      if (!content.trim()) return {};
      const parsed = JSON.parse(content) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === "string") result[key] = value;
      }
      return result;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw storageError(`Failed to read credential file ${this.filePath}`, error);
    }
  }

  /** Atomic write: write to temp file, then rename. */
  private async writeAll(values: Record<string, string>): Promise<void> {
    try {
      const dir = dirname(this.filePath);
      await mkdir(dir, { recursive: true, mode: 0o700 });
      // Try to set directory permissions to 700 (best-effort — may fail on some FS)
      await chmod(dir, 0o700).catch(() => {});

      const tmpPath = `${this.filePath}.tmp`;
      await writeFile(tmpPath, `${JSON.stringify(values, null, 2)}\n`, { mode: 0o600 });
      await chmod(tmpPath, 0o600);
      // Atomic rename
      await rename(tmpPath, this.filePath);
      // Ensure final file mode is 600 (rename may preserve tmp mode)
      await chmod(this.filePath, 0o600).catch(() => {});
    } catch (error) {
      throw storageError(`Failed to write credential file ${this.filePath}`, error);
    }
  }

  async get(key: string): Promise<string | null> {
    return this.enqueue(async () => {
      const values = await this.readAll();
      return values[key] ?? null;
    });
  }

  async set(key: string, value: string): Promise<void> {
    return this.enqueue(async () => {
      const values = await this.readAll();
      values[key] = value;
      await this.writeAll(values);
    });
  }

  async delete(key: string): Promise<void> {
    return this.enqueue(async () => {
      const values = await this.readAll();
      delete values[key];
      // If the store is now empty, remove the file entirely
      if (Object.keys(values).length === 0) {
        await unlink(this.filePath).catch(() => {});
      } else {
        await this.writeAll(values);
      }
    });
  }
}

// ─── Keychain store (desktop — wraps @napi-rs/keyring) ────────────

class KeychainCredentialStore implements CredentialStore {
  private keyringPromise: Promise<KeyringModule | null> | null = null;

  constructor(
    private readonly service: string,
    private readonly environment: string,
    private readonly fallback: CredentialStore,
  ) {}

  private account(key: string): string {
    return `${this.environment}:${key}`;
  }

  private warnFallback(operation: string, error: unknown): void {
    const detail = error instanceof Error ? error.message : String(error);
    // Don't print during tests — this is informational only
    if (process.env.LITT_AUTH_DEBUG === "1") {
      console.warn(`Keychain ${operation} failed; falling back to file store. ${detail}`);
    }
  }

  /** Lazy-load @napi-rs/keyring — if it fails, fall back to file. */
  private async loadKeyring(): Promise<KeyringModule | null> {
    this.keyringPromise ??= import("@napi-rs/keyring").catch((error: unknown) => {
      this.warnFallback("initialization", error);
      return null;
    });
    return this.keyringPromise;
  }

  async get(key: string): Promise<string | null> {
    try {
      const keyring = await this.loadKeyring();
      if (!keyring) return this.fallback.get(key);

      const entry = new keyring.Entry(this.service, this.account(key));
      const password = entry.getPassword();
      if (password) return password;
      // Not in keychain — check fallback (migration path)
      return this.fallback.get(key);
    } catch (error) {
      this.warnFallback("get", error);
      return this.fallback.get(key);
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const keyring = await this.loadKeyring();
      if (!keyring) {
        await this.fallback.set(key, value);
        return;
      }

      const entry = new keyring.Entry(this.service, this.account(key));
      entry.setPassword(value);
    } catch (error) {
      this.warnFallback("set", error);
      await this.fallback.set(key, value);
    }
  }

  async delete(key: string): Promise<void> {
    // Delete from both keychain and fallback
    try {
      const keyring = await this.loadKeyring();
      if (keyring) {
        const entry = new keyring.Entry(this.service, this.account(key));
        entry.deletePassword();
      }
    } catch (error) {
      this.warnFallback("delete", error);
    }
    await this.fallback.delete(key);
  }
}

// ─── Factory ──────────────────────────────────────────────────────

function createFileStore(options?: CreateStoreOptions): CredentialStore {
  const environment = environmentName(options);
  return new FileCredentialStore(options?.filePath ?? defaultFilePath(environment));
}

/**
 * Create a credential store.
 *
 *   "keychain" → KeychainCredentialStore with file fallback (desktop default)
 *   "file"     → FileCredentialStore only (Termux)
 *   "memory"   → MemoryCredentialStore (testing)
 */
export function createCredentialStore(
  kind: StorageKind,
  options?: CreateStoreOptions,
): CredentialStore {
  if (kind === "memory") return new MemoryCredentialStore();
  if (kind === "file") return createFileStore(options);

  // "keychain" — try native keychain, fall back to file
  const fallback = createFileStore(options);
  const service = options?.keychainService ?? "litt-cli-auth";
  const environment = environmentName(options);
  return new KeychainCredentialStore(service, environment, fallback);
}

/** Get the default file path for diagnostics (e.g. `litt doctor`). */
export function getCredentialFilePath(environment = "default"): string {
  return defaultFilePath(environment);
}
