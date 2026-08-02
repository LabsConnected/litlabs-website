/**
 * Preview port gateway for Terminal V1.
 *
 * Allows sandboxes to expose internal ports (e.g. dev servers) to the
 * outside world via a proxy. Each exposed port gets a unique preview
 * URL with a token for access control.
 *
 * The proxy verifies the preview token before forwarding requests to
 * the sandbox container's port.
 */

import { randomUUID } from "crypto";
import type { Server as HTTPServer, IncomingMessage, ServerResponse } from "http";
import { createProxyServer, type ProxyTargetUrl } from "http-proxy";
import { getSandboxProvider } from "./providers";
import { isTerminalEnabled } from "./control-plane";
import type { PreviewEndpoint, PreviewPortState } from "./types";

// ─── In-memory preview registry (PR 7 will add database persistence) ─

interface PreviewRecord {
  sandboxId: string;
  port: number;
  state: PreviewPortState;
  previewToken: string;
  containerIp: string | null;
  containerPort: number;
  expiresAt: string;
  createdAt: string;
}

const previews = new Map<string, PreviewRecord>();

function previewKey(sandboxId: string, port: number): string {
  return `${sandboxId}:${port}`;
}

// ─── Preview port manager ────────────────────────────────────────

export class PreviewPortManager {
  /**
   * Expose a port on a sandbox. Returns the preview endpoint info.
   */
  async expose(
    sandboxId: string,
    port: number,
    options?: { state?: PreviewPortState; ttlMinutes?: number },
  ): Promise<PreviewEndpoint> {
    if (!isTerminalEnabled()) {
      throw new Error("FEATURE_DISABLED");
    }

    if (port < 1 || port > 65535) {
      throw new Error("Invalid port number");
    }

    const state: PreviewPortState = options?.state ?? "private";
    const ttlMinutes = options?.ttlMinutes ?? 30;
    const previewToken = randomUUID();
    const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000).toISOString();
    const now = new Date().toISOString();

    // Try to get the sandbox's container IP
    const provider = getSandboxProvider();
    const sandbox = await provider.get(sandboxId);
    if (!sandbox) throw new Error("Sandbox not found");

    const record: PreviewRecord = {
      sandboxId,
      port,
      state,
      previewToken,
      containerIp: null, // PR 2's Docker provider will provide this
      containerPort: port,
      expiresAt,
      createdAt: now,
    };

    previews.set(previewKey(sandboxId, port), record);

    return {
      port,
      url: this.buildPreviewUrl(sandboxId, port, previewToken),
      state,
      previewToken,
      expiresAt,
    };
  }

  /**
   * Get the preview record for a sandbox + port.
   */
  get(sandboxId: string, port: number): PreviewRecord | null {
    const record = previews.get(previewKey(sandboxId, port));
    if (!record) return null;
    if (new Date(record.expiresAt) < new Date()) {
      previews.delete(previewKey(sandboxId, port));
      return null;
    }
    return record;
  }

  /**
   * Make a private preview public (removes token requirement).
   */
  makePublic(sandboxId: string, port: number): PreviewEndpoint | null {
    const record = previews.get(previewKey(sandboxId, port));
    if (!record) return null;
    record.state = "public";
    return {
      port,
      url: this.buildPreviewUrl(sandboxId, port, record.previewToken),
      state: "public",
      previewToken: record.previewToken,
      expiresAt: record.expiresAt,
    };
  }

  /**
   * Make a public preview private again.
   */
  makePrivate(sandboxId: string, port: number): PreviewEndpoint | null {
    const record = previews.get(previewKey(sandboxId, port));
    if (!record) return null;
    record.state = "private";
    return {
      port,
      url: this.buildPreviewUrl(sandboxId, port, record.previewToken),
      state: "private",
      previewToken: record.previewToken,
      expiresAt: record.expiresAt,
    };
  }

  /**
   * Close a preview port.
   */
  close(sandboxId: string, port: number): boolean {
    return previews.delete(previewKey(sandboxId, port));
  }

  /**
   * List all preview ports for a sandbox.
   */
  listBySandbox(sandboxId: string): PreviewEndpoint[] {
    const result: PreviewEndpoint[] = [];
    for (const [key, record] of previews) {
      if (record.sandboxId !== sandboxId) continue;
      if (new Date(record.expiresAt) < new Date()) {
        previews.delete(key);
        continue;
      }
      result.push({
        port: record.port,
        url: this.buildPreviewUrl(record.sandboxId, record.port, record.previewToken),
        state: record.state,
        previewToken: record.previewToken,
        expiresAt: record.expiresAt,
      });
    }
    return result;
  }

  /**
   * Verify a preview token.
   */
  verify(sandboxId: string, port: number, token: string): boolean {
    const record = this.get(sandboxId, port);
    if (!record) return false;
    if (record.state === "public") return true;
    return record.previewToken === token;
  }

  private buildPreviewUrl(sandboxId: string, port: number, token: string): string {
    const base = process.env.NEXT_PUBLIC_APP_URL ?? "https://studio.littree.dev";
    return `${base}/preview/${sandboxId}/${port}/${token}`;
  }
}

// ─── HTTP proxy server ───────────────────────────────────────────

export function createPreviewProxyServer(
  httpServer: HTTPServer,
): { manager: PreviewPortManager; proxy: ReturnType<typeof createProxyServer> } {
  const manager = new PreviewPortManager();
  const proxy = createProxyServer({
    ws: true,
    changeOrigin: true,
    xfwd: true,
  });

  httpServer.on("request", (req: IncomingMessage, res: ServerResponse) => {
    if (!isTerminalEnabled()) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Terminal is disabled" }));
      return;
    }

    // Parse URL: /preview/:sandboxId/:port/:token
    const urlParts = req.url?.split("/").filter(Boolean) ?? [];
    if (urlParts.length < 3 || urlParts[0] !== "preview") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not found" }));
      return;
    }

    const sandboxId = urlParts[1];
    const port = parseInt(urlParts[2], 10);
    const token = urlParts[3] ?? "";

    if (isNaN(port)) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid port" }));
      return;
    }

    // Verify preview access
    if (!manager.verify(sandboxId, port, token)) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Forbidden" }));
      return;
    }

    // Get the preview record
    const record = manager.get(sandboxId, port);
    if (!record) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Preview not found" }));
      return;
    }

    // Proxy to the sandbox container
    const targetIp = record.containerIp ?? "localhost";
    const target: ProxyTargetUrl = {
      host: targetIp,
      port: String(record.containerPort),
      path: "/",
      protocol: "http:",
    };

    // Rewrite URL to strip the preview prefix
    const remainingPath = "/" + urlParts.slice(4).join("/");
    req.url = remainingPath;

    proxy.web(req, res, { target }, (err: Error) => {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Bad gateway", details: err.message }));
    });
  });

  // Handle WebSocket upgrades for live reload
  httpServer.on("upgrade", (req, socket, head) => {
    const urlParts = req.url?.split("/").filter(Boolean) ?? [];
    if (urlParts.length < 4 || urlParts[0] !== "preview") {
      socket.destroy();
      return;
    }

    const sandboxId = urlParts[1];
    const port = parseInt(urlParts[2], 10);
    const token = urlParts[3] ?? "";

    if (!manager.verify(sandboxId, port, token)) {
      socket.destroy();
      return;
    }

    const record = manager.get(sandboxId, port);
    if (!record) {
      socket.destroy();
      return;
    }

    const targetIp = record.containerIp ?? "localhost";
    const remainingPath = "/" + urlParts.slice(4).join("/");
    req.url = remainingPath;

    proxy.ws(req, socket, head, {
      target: `ws://${targetIp}:${record.containerPort}`,
    });
  });

  return { manager, proxy };
}
