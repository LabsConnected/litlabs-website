import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  redactText,
  redactUrl,
  redactValue,
  redactArtifactTree,
} from "../scripts/final-acceptance/redact-secrets.mjs";

const PREVIEW =
  "https://terminal.example.test/preview/ws-1?token=fixture-preview-token&x=1";
const USER = "user_fixtureClerkId12345";

describe("acceptance log redaction", () => {
  it("strips sensitive query values and keeps the rest of the URL", () => {
    const redacted = redactUrl(PREVIEW);
    expect(redacted).not.toContain("fixture-preview-token");
    expect(redacted).toContain("token=REDACTED");
    expect(redacted).toContain("x=1");
    expect(redacted).toContain("terminal.example.test");
  });

  it("redacts bearer tokens, preview URLs, and an extra Clerk user id in text", () => {
    const raw = `signed in ${USER} via ${PREVIEW} Authorization: Bearer fixture-bearer-token-value`;
    const redacted = redactText(raw, [USER]);
    expect(redacted).not.toContain("fixture-preview-token");
    expect(redacted).not.toContain(USER);
    expect(redacted).not.toContain("fixture-bearer-token-value");
    expect(redacted).toContain("Bearer REDACTED");
    expect(redacted).toContain("[redacted]");
  });

  it("redacts nested artifact JSON without dropping unrelated fields", () => {
    const redacted = redactValue(
      {
        userId: USER,
        previewUrl: PREVIEW,
        nested: { note: `see ${PREVIEW}` },
        ok: true,
      },
      [USER],
    ) as { userId: string; previewUrl: string; nested: { note: string }; ok: boolean };
    expect(JSON.stringify(redacted)).not.toContain("fixture-preview-token");
    expect(JSON.stringify(redacted)).not.toContain(USER);
    expect(redacted.ok).toBe(true);
    expect(redacted.previewUrl).toContain("token=REDACTED");
  });

  it("rewrites text artifacts in place and leaves screenshots alone", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "litt-redact-"));
    try {
      writeFileSync(path.join(dir, "sse-events.json"), JSON.stringify({ previewUrl: PREVIEW }));
      writeFileSync(path.join(dir, "shot.png"), "not-a-real-png");
      const result = await redactArtifactTree(dir);
      const json = readFileSync(path.join(dir, "sse-events.json"), "utf8");
      expect(json).not.toContain("fixture-preview-token");
      expect(json).toContain("token=REDACTED");
      expect(readFileSync(path.join(dir, "shot.png"), "utf8")).toBe("not-a-real-png");
      expect(result.changed).toBe(1);
      expect(result.files).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
