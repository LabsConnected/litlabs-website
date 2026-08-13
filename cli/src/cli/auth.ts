import http from "node:http";
import { spawn } from "node:child_process";
import { loadConfig, saveConfig } from "./config.js";

export interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  token: string | null;
}

/**
 * Resolve auth state for CLI requests.
 *
 * Priority:
 * 1. Explicit Bearer token from env/config
 * 2. Dev anonymous mode (local only)
 * 3. Unauthenticated — server may reject depending on route config
 */
export function resolveAuth(): AuthState {
  const config = loadConfig();

  // Check env first (highest priority — useful for CI / scripts)
  const envToken = process.env.LITT_CODE_TOKEN?.trim();
  if (envToken) {
    return { isAuthenticated: true, userId: null, token: envToken };
  }

  // Then check stored config
  if (config.clerkToken) {
    return { isAuthenticated: true, userId: null, token: config.clerkToken };
  }

  // Local dev fallback: anonymous dev mode
  const allowAnonymous =
    process.env.NODE_ENV !== "production" &&
    process.env.ALLOW_ANONYMOUS_DEV === "true";

  if (allowAnonymous) {
    return { isAuthenticated: true, userId: "anonymous-dev", token: null };
  }

  return { isAuthenticated: false, userId: null, token: null };
}

export function getAuthHeaders(): Record<string, string> {
  const { token } = resolveAuth();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function saveToken(token: string): void {
  saveConfig({ clerkToken: token });
}

export function clearToken(): void {
  const config = loadConfig();
  delete config.clerkToken;
  saveConfig(config);
}

export function hasStoredToken(): boolean {
  const config = loadConfig();
  return !!config.clerkToken;
}

/**
 * Simple interactive login helper.
 * Opens the LiTTree sign-in page in the default browser and instructs
 * the user to paste a session token back.
 */
export async function interactiveLogin(baseUrl: string): Promise<string> {
  const signInUrl = `${baseUrl}/sign-in?redirect=${encodeURIComponent(baseUrl + "/settings/cli")}`;

  console.log(`\n🔑  LiTT Code needs a session token.`);
  console.log(`\n   1. Opening: ${signInUrl}`);
  console.log(`\n   2. Sign in with your LiTTree account.`);
  console.log(`\n   3. After signing in, copy the session token from: ${baseUrl}/settings/cli`);
  console.log(`\n   4. Paste it here.\n`);

  openBrowser(signInUrl);

  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question("Token: ", (answer) => {
      rl.close();
      const token = answer.trim();
      if (token) {
        saveToken(token);
      }
      resolve(token);
    });
  });
}

function openBrowser(url: string): void {
  const platform = process.platform;
  const command =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "cmd.exe"
        : "xdg-open";

  const args = platform === "win32" ? ["/c", "start", "", url] : [url];

  try {
    if (platform === "win32") {
      spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return;
    }
    http.get(url, () => {
      // probe reached — browser likely opened
    });
    spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  } catch {
    // fallback: just print the URL
  }
}