import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createPreviewToken, verifyPreviewToken } from "./preview-token";
import { createTerminalToken, verifyTerminalToken } from "@/lib/terminal-auth";

const SECRET = "preview-token-test-secret-with-32+chars";

beforeAll(() => {
  vi.stubEnv("TERMINAL_AUTH_SECRET", SECRET);
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("preview capability token", () => {
  it("round-trips its (user, project, workspace) binding", () => {
    const { token } = createPreviewToken("user-1", { projectId: "proj-1", workspaceId: "ws-1" });
    expect(verifyPreviewToken(token)).toMatchObject({
      userId: "user-1",
      projectId: "proj-1",
      workspaceId: "ws-1",
    });
  });

  it("rejects a tampered payload", () => {
    const { token } = createPreviewToken("user-1", { projectId: "proj-1", workspaceId: "ws-1" });
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({
      sub: "attacker", aud: "littree-preview", iat: 1, exp: 9999999999, pid: "proj-1", wid: "ws-1",
    })).toString("base64url");
    expect(() => verifyPreviewToken(`${forgedPayload}.${signature}`)).toThrow();
  });

  it("rejects a tampered signature", () => {
    const { token } = createPreviewToken("user-1", { projectId: "proj-1", workspaceId: "ws-1" });
    const [payload] = token.split(".");
    expect(() => verifyPreviewToken(`${payload}.${"A".repeat(43)}`)).toThrow();
  });

  it("rejects an expired token", () => {
    const { token } = createPreviewToken("user-1", { projectId: "proj-1", workspaceId: "ws-1" }, -5);
    expect(() => verifyPreviewToken(token)).toThrow(/expired/i);
  });

  it("rejects malformed tokens", () => {
    expect(() => verifyPreviewToken("not-a-token")).toThrow();
    expect(() => verifyPreviewToken("")).toThrow();
  });

  it("binds the signed asset manifest, normalized (sorted, deduplicated)", () => {
    const { token } = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
      assets: ["lib/b.js", "index.html", "app.js", "lib/b.js"],
    });
    expect(verifyPreviewToken(token).assets).toEqual(["app.js", "index.html", "lib/b.js"]);
  });

  it("a token minted without a manifest authorizes nothing (fail closed)", () => {
    const { token } = createPreviewToken("user-1", { projectId: "proj-1", workspaceId: "ws-1" });
    expect(verifyPreviewToken(token).assets).toEqual([]);
  });

  it("rejects a forged asset manifest under a stolen signature", () => {
    const { token } = createPreviewToken("user-1", {
      projectId: "proj-1",
      workspaceId: "ws-1",
      assets: ["app.js"],
    });
    const [, signature] = token.split(".");
    const forgedPayload = Buffer.from(JSON.stringify({
      sub: "user-1", aud: "littree-preview", iat: 1, exp: 9999999999,
      pid: "proj-1", wid: "ws-1", ast: ["app.js", "QUALITY_LOG.md", ".env"],
    })).toString("base64url");
    expect(() => verifyPreviewToken(`${forgedPayload}.${signature}`)).toThrow();
  });

  it("never cross-verifies with terminal tokens (key separation)", () => {
    // Same base secret, same payload shape: the preview signing key is
    // derived under a distinct label, so neither token family can be
    // replayed as the other.
    const terminal = createTerminalToken("user-1", { projectId: "proj-1", workspaceId: "ws-1" });
    expect(() => verifyPreviewToken(terminal.token)).toThrow();

    const preview = createPreviewToken("user-1", { projectId: "proj-1", workspaceId: "ws-1" });
    expect(() => verifyTerminalToken(preview.token)).toThrow();
  });
});
