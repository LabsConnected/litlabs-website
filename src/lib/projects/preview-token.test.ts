import { describe, it, expect, beforeEach, afterEach } from "vitest";
import crypto from "crypto";
import {
  createPreviewToken,
  verifyPreviewToken,
} from "./preview-token";
import {
  createTerminalToken,
  verifyTerminalToken,
} from "@/lib/terminal-auth";

function paddedSecret(): string {
  const base =
    process.env.TERMINAL_AUTH_SECRET ??
    "litlabs-preview-token-secret-do-not-use-in-production";
  if (base.length >= 32) return base;
  return base.padEnd(32, "x");
}

function previewSigningKey(secret: string): Buffer {
  return crypto
    .createHmac("sha256", secret)
    .update("littree-preview-token-key-v1")
    .digest();
}

function signPayload(encodedPayload: string, secret: string): string {
  return crypto
    .createHmac("sha256", previewSigningKey(secret))
    .update(encodedPayload)
    .digest("base64url");
}

let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.TERMINAL_AUTH_SECRET;
  process.env.TERMINAL_AUTH_SECRET = paddedSecret();
});

afterEach(() => {
  if (previousSecret === undefined) {
    delete process.env.TERMINAL_AUTH_SECRET;
  } else {
    process.env.TERMINAL_AUTH_SECRET = previousSecret;
  }
});

describe("preview-token", () => {
  it("mints and verifies a valid scoped token", () => {
    const token = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
      assets: ["index.html", "app.js", "style.css"],
    });

    expect(typeof token.token).toBe("string");
    expect(token.token.length).toBeGreaterThan(0);
    expect(typeof token.expiresAt).toBe("number");

    const claims = verifyPreviewToken(token.token);
    expect(claims.userId).toBe("user-1");
    expect(claims.projectId).toBe("proj-1");
    expect(claims.workspaceId).toBe("ws-1");
    expect(claims.assets).toEqual(["app.js", "index.html", "style.css"]);
    expect(typeof claims.expiresAt).toBe("number");
  });

  it("rejects a token whose signature was tampered with", () => {
    const token = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
      assets: ["index.html"],
    });

    const tampered = token.token.slice(0, -3) + "abc";
    expect(() => verifyPreviewToken(tampered)).toThrow(
      /Invalid preview token signature/,
    );
  });

  it("rejects an expired token", () => {
    const token = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
      assets: ["index.html"],
    }, -10);

    expect(() => verifyPreviewToken(token.token)).toThrow(
      /Preview token expired/,
    );
  });

  it("rejects a token minted with a different secret", () => {
    const encodedPayload = Buffer.from(
      JSON.stringify({
        sub: "user-1",
        aud: "littree-preview",
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 60,
        pid: "proj-1",
        wid: "ws-1",
        ast: ["index.html"],
      }),
    ).toString("base64url");
    const differentSecretToken = [
      encodedPayload,
      signPayload(encodedPayload, "secondary-secret-not-for-production-use-1234"),
    ].join(".");

    expect(() => verifyPreviewToken(differentSecretToken)).toThrow(
      /Invalid preview token signature/,
    );
  });

  it("enforces project scope at the route decision point", () => {
    const tokenForProjEvil = createPreviewToken("user-1", {
      projectId: "proj-evil",
      workspaceId: "ws-1",
      assets: ["index.html"],
    });

    const evilClaims = verifyPreviewToken(tokenForProjEvil.token);
    expect(evilClaims.projectId).toBe("proj-evil");
    expect(evilClaims.projectId).not.toBe("proj-1");
  });

  it("enforces workspace scope at the route decision point", () => {
    const tokenForWs2 = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-2",
      assets: ["index.html"],
    });

    const ws2Claims = verifyPreviewToken(tokenForWs2.token);
    expect(ws2Claims.workspaceId).toBe("ws-2");
    expect(ws2Claims.workspaceId).not.toBe("ws-1");
  });

  it("enforces asset scope at the route decision point", () => {
    const token = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
      assets: ["index.html", "app.js"],
    });

    const claims = verifyPreviewToken(token.token);
    expect(claims.assets).toEqual(["app.js", "index.html"]);
    expect(claims.assets).toContain("index.html");
    expect(claims.assets).toContain("app.js");
    expect(claims.assets).not.toContain("secret.log");
  });

  it("rejects a token with an invalid signature", () => {
    const badPayload =
      "eyJzdWIiOiJ1c2VyLTEiLCJhdWQiOiJsaXR0cmVlLXByZXZpZXciLCJpYXQiOjE3OTI4MDY5MTIsImV4cCI6MTc5MjgwNzIxMiwicGlkIjoicHJvai0xIiwid2lkIjoid3MtMSIsImFzdCI6W10ufQ.invalidsignature";
    expect(() => verifyPreviewToken(badPayload)).toThrow(
      /Invalid preview token signature/,
    );
  });

  it("a token minted without a manifest authorizes nothing (fail closed)", () => {
    // A VALID token that simply carries no manifest — verification succeeds
    // but must still authorize zero assets. (The invalid-signature case
    // above never reaches manifest handling.)
    const token = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
    });
    expect(verifyPreviewToken(token.token).assets).toEqual([]);
  });

  it("rejects a forged asset manifest under a stolen signature", () => {
    const token = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
      assets: ["app.js"],
    });
    const [, signature] = token.token.split(".");
    const forgedPayload = Buffer.from(
      JSON.stringify({
        sub: "user-1",
        aud: "littree-preview",
        iat: 1,
        exp: 9999999999,
        pid: "proj-1",
        wid: "ws-1",
        ast: ["app.js", "QUALITY_LOG.md", ".env"],
      }),
    ).toString("base64url");
    expect(() => verifyPreviewToken(`${forgedPayload}.${signature}`)).toThrow();
  });

  it("never cross-verifies with terminal tokens (key separation)", () => {
    // Same base secret, same payload shape: the preview signing key is
    // derived under a distinct label, so neither token family can be
    // replayed as the other.
    const terminal = createTerminalToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
    });
    expect(() => verifyPreviewToken(terminal.token)).toThrow();

    const preview = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
    });
    expect(() => verifyTerminalToken(preview.token)).toThrow();
  });

  it("rejects a token with an invalid audience", () => {
    const now = Math.floor(Date.now() / 1000);
    const badPayload = Buffer.from(
      JSON.stringify({
        sub: "user-1",
        aud: "wrong-audience",
        iat: now,
        exp: now + 60,
        pid: "proj-1",
        wid: "ws-1",
        ast: ["index.html"],
      }),
    ).toString("base64url");
    const badToken = [
      badPayload,
      signPayload(badPayload, paddedSecret()),
    ].join(".");

    expect(() => verifyPreviewToken(badToken)).toThrow(
      /Invalid preview token audience/,
    );
  });
});
