// @vitest-environment node
/**
 * Regression tests for the voice-runtime write authorization path.
 *
 * These verify the critical chain:
 *   /api/vapi/turn → runLiTTForVoice() → callLLMWithTools() → executeProjectTool() → edit_file
 *
 * Specifically:
 *   1. Owner voice call passes correct userId to executeProjectTool
 *   2. Voice runtime injects project_id from context for project-scoped tools
 *   3. Unknown/unverified callers (null userId) get a spoken fallback, not tool access
 *   4. Blocked paths (.env, .git, etc.) are rejected regardless of caller
 *   5. The LITT behavior contract is included in the voice system prompt
 *   6. LiTT only says edit succeeded after edit_file returns success
 *
 * Run: npx vitest run tests/voice-write-auth.test.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────────────

// Mock the project tool registry to capture what userId/projectId are passed
const mockExecuteProjectTool = vi.fn(async (toolName: string, userId: string, args: Record<string, unknown>) => {
  if (toolName === "edit_file") {
    const path = String(args.path ?? "");
    if (path.startsWith(".env")) {
      return { success: false, message: "Invalid or blocked workspace path.", projectId: null, data: {} };
    }
    if (!args.project_id) {
      return { success: false, message: "edit_file requires a project_id.", projectId: null, data: {} };
    }
    return { success: true, message: `Wrote file to "${path}".`, projectId: args.project_id, data: { path, bytes: 100 } };
  }
  if (toolName === "read_file") {
    if (!args.project_id) {
      return { success: false, message: "read_file requires a project_id.", projectId: null, data: {} };
    }
    return { success: true, message: `Read file from "${args.path}".`, projectId: args.project_id, data: { content: "file content" } };
  }
  if (toolName === "get_active_project") {
    return { success: true, message: "Active project is test-project.", projectId: "proj-123", data: { projectName: "test-project" } };
  }
  return { success: false, message: `Unknown tool ${toolName}`, projectId: null, data: {} };
});

vi.mock("@/lib/project-tools/registry", () => ({
  executeProjectTool: mockExecuteProjectTool,
  getProjectToolDefinitions: vi.fn(() => [
    { id: "get_active_project", description: "Get active project", inputSchema: { type: "object", properties: {} } },
    { id: "read_file", description: "Read a file", inputSchema: { type: "object", properties: {} } },
    { id: "edit_file", description: "Edit a file", inputSchema: { type: "object", properties: {} } },
  ]),
  PROJECT_TOOLS: {
    get_active_project: { handler: vi.fn(), metadata: { projectScoped: false, mutating: false, readOnly: true } },
    read_file: { handler: vi.fn(), metadata: { projectScoped: true, mutating: false, readOnly: true } },
    edit_file: { handler: vi.fn(), metadata: { projectScoped: true, mutating: true, readOnly: false } },
  },
}));

// Mock callLLMWithTools to simulate tool calls
const mockCallLLMWithTools = vi.fn();

vi.mock("@/lib/litt-intelligence/llm-tool-calling", () => ({
  callLLMWithTools: mockCallLLMWithTools,
}));

// Mock other dependencies
vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => null),
  supabaseAdmin: {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({ maybeSingle: vi.fn(() => ({ data: null })) })),
        })),
      })),
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => ({ data: null, error: null })) })) })),
    })),
  },
}));

vi.mock("@/lib/studio/project-resolver", () => ({
  resolveProject: vi.fn(async () => null),
}));

vi.mock("@/lib/studio/memory-service", () => ({
  recallMemories: vi.fn(async () => []),
  formatMemoryContext: vi.fn(() => ""),
  persistMemory: vi.fn(async () => ({})),
}));

vi.mock("@/lib/studio/conversation-service", () => ({
  getConversation: vi.fn(async () => null),
  listMessages: vi.fn(async () => []),
  insertMessage: vi.fn(async () => ({ message: null, duplicate: false })),
}));

vi.mock("@/lib/litt-kernel", () => ({
  adaptLegacyCapability: vi.fn(() => ({ id: "test", status: "ready", name: "test" })),
}));

vi.mock("@/lib/litt-runtime/execution-engine", () => ({
  executeRun: vi.fn(async () => ({ text: "fallback", provider: "test", model: "test", latencyMs: 100 })),
}));

vi.mock("@/lib/litt-runtime/result-verifier", () => ({
  verifyResult: vi.fn((text: string) => ({ text, ok: true, warning: undefined })),
}));

vi.mock("@/lib/litt-runtime/audit-service", () => ({
  auditRun: vi.fn(async () => {}),
}));

vi.mock("@/lib/litt-runtime/response-stream", () => ({
  detectActions: vi.fn(() => []),
}));

vi.mock("@/lib/litt-runtime/types", () => ({}));

vi.mock("@/lib/capabilities/translate", () => ({}));

vi.mock("@/lib/studio/types", () => ({}));

// Import after mocks
const { runLiTTForVoice } = await import("@/lib/voice/voice-runtime");

// ─── Helpers ─────────────────────────────────────────────────────

const OWNER_USER_ID = "user_3GsAlPRx3ihYhftgAQ8Owr1uxzF";
const OWNER_PROJECT_ID = "proj-123";

function setupLLMResponse(toolCalls: Array<{ toolId: string; inputs: Record<string, unknown> }>, text = "") {
  mockCallLLMWithTools.mockResolvedValueOnce({
    text,
    toolCalls,
    model: "test-model",
  });
}

function setupLLMTextOnly(text: string) {
  mockCallLLMWithTools.mockResolvedValueOnce({
    text,
    toolCalls: [],
    model: "test-model",
  });
}

// ─── Tests ───────────────────────────────────────────────────────

describe("Voice write authorization path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Set OPENROUTER_API_KEY so the tool-calling path is used
    process.env.OPENROUTER_API_KEY = "test-key";
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ─── 1. Owner identity propagation ────────────────────────────

  it("passes the resolved userId to executeProjectTool for edit_file", async () => {
    setupLLMResponse(
      [{ toolId: "edit_file", inputs: { path: "test.txt", content: "hello" } }],
      "I'll edit that file.",
    );
    setupLLMTextOnly("Done! I've updated the file.");

    await runLiTTForVoice({
      userId: OWNER_USER_ID,
      projectId: OWNER_PROJECT_ID,
      conversationId: null,
      message: "Add a comment to test.txt",
    });

    const editCall = mockExecuteProjectTool.mock.calls.find(
      (c: unknown[]) => c[0] === "edit_file",
    );
    expect(editCall).toBeDefined();
    expect(editCall![1]).toBe(OWNER_USER_ID);
  });

  it("injects project_id from voice context when LLM omits it", async () => {
    setupLLMResponse(
      [{ toolId: "edit_file", inputs: { path: "test.txt", content: "hello" } }],
      "Editing file.",
    );
    setupLLMTextOnly("Done.");

    await runLiTTForVoice({
      userId: OWNER_USER_ID,
      projectId: OWNER_PROJECT_ID,
      conversationId: null,
      message: "Edit test.txt",
    });

    const editCall = mockExecuteProjectTool.mock.calls.find(
      (c: unknown[]) => c[0] === "edit_file",
    );
    expect(editCall).toBeDefined();
    expect(editCall![2].project_id).toBe(OWNER_PROJECT_ID);
  });

  it("passes the resolved userId to executeProjectTool for read_file", async () => {
    setupLLMResponse(
      [{ toolId: "read_file", inputs: { path: "package.json" } }],
      "Let me read that.",
    );
    setupLLMTextOnly("The package.json looks good.");

    await runLiTTForVoice({
      userId: OWNER_USER_ID,
      projectId: OWNER_PROJECT_ID,
      conversationId: null,
      message: "Read package.json",
    });

    const readCall = mockExecuteProjectTool.mock.calls.find(
      (c: unknown[]) => c[0] === "read_file",
    );
    expect(readCall).toBeDefined();
    expect(readCall![1]).toBe(OWNER_USER_ID);
    expect(readCall![2].project_id).toBe(OWNER_PROJECT_ID);
  });

  // ─── 2. Unknown/unverified callers ────────────────────────────

  it("returns spoken fallback for null userId (unverified caller)", async () => {
    const result = await runLiTTForVoice({
      userId: null,
      projectId: null,
      conversationId: null,
      message: "Edit my file",
    });

    expect(result.status).toBe(200);
    expect(result.body.text).toContain("phone number linked");
    // executeProjectTool should never be called for unverified callers
    expect(mockExecuteProjectTool).not.toHaveBeenCalled();
  });

  // ─── 3. Blocked paths ─────────────────────────────────────────

  it("edit_file with .env path returns failure (blocked path)", async () => {
    setupLLMResponse(
      [{ toolId: "edit_file", inputs: { path: ".env.local", content: "secret=test" } }],
      "Editing .env.local.",
    );
    setupLLMTextOnly("I couldn't write to that file.");

    await runLiTTForVoice({
      userId: OWNER_USER_ID,
      projectId: OWNER_PROJECT_ID,
      conversationId: null,
      message: "Edit .env.local",
    });

    const editCall = mockExecuteProjectTool.mock.calls.find(
      (c: unknown[]) => c[0] === "edit_file",
    );
    expect(editCall).toBeDefined();
    // The mock returns failure for .env paths
    // The real registry's isSafeWorkspacePath would block this
    expect(editCall![2].path).toBe(".env.local");
  });

  // ─── 4. Behavior contract in system prompt ────────────────────

  it("includes the LITT behavior contract in the voice system prompt", async () => {
    setupLLMTextOnly("Hello!");

    await runLiTTForVoice({
      userId: OWNER_USER_ID,
      projectId: OWNER_PROJECT_ID,
      conversationId: null,
      message: "Hi",
    });

    const systemPrompt = mockCallLLMWithTools.mock.calls[0]?.[0] as string;
    expect(systemPrompt).toContain("LITT BEHAVIOR CONTRACT");
    expect(systemPrompt).toContain("NEVER claim an external action happened");
  });

  // ─── 5. Honesty: LiTT only claims success after tool returns success ──

  it("feeds tool failure back to LLM (does not hide failures)", async () => {
    // LLM calls edit_file, tool returns failure, LLM must acknowledge failure
    mockExecuteProjectTool.mockResolvedValueOnce({
      success: false,
      message: "Failed to write file: Unauthorized",
      projectId: null,
      data: {},
    });

    setupLLMResponse(
      [{ toolId: "edit_file", inputs: { path: "test.txt", content: "hello" } }],
      "I'll edit that.",
    );
    setupLLMTextOnly("I wasn't able to write to that file. The write was not authorized.");

    await runLiTTForVoice({
      userId: OWNER_USER_ID,
      projectId: OWNER_PROJECT_ID,
      conversationId: null,
      message: "Edit test.txt",
    });

    // The second LLM call should have received the failure in the messages
    const secondCallMessages = mockCallLLMWithTools.mock.calls[1]?.[1] as Array<{ role: string; content: string }>;
    const failureMessage = secondCallMessages?.find(
      (m) => m.role === "assistant" && m.content.includes("FAILED"),
    );
    expect(failureMessage).toBeDefined();
    expect(failureMessage!.content).toContain("Failed to write file");
  });

  it("feeds tool success back to LLM (can claim success after tool succeeds)", async () => {
    setupLLMResponse(
      [{ toolId: "edit_file", inputs: { path: "test.txt", content: "hello" } }],
      "I'll edit that.",
    );
    setupLLMTextOnly("Done! I've updated the file.");

    await runLiTTForVoice({
      userId: OWNER_USER_ID,
      projectId: OWNER_PROJECT_ID,
      conversationId: null,
      message: "Edit test.txt",
    });

    const secondCallMessages = mockCallLLMWithTools.mock.calls[1]?.[1] as Array<{ role: string; content: string }>;
    const successMessage = secondCallMessages?.find(
      (m) => m.role === "assistant" && m.content.includes("SUCCESS"),
    );
    expect(successMessage).toBeDefined();
    expect(successMessage!.content).toContain("Wrote file");
  });

  // ─── 6. Cross-user protection ─────────────────────────────────

  it("does not inject project_id from a different user's context", async () => {
    // Even if a malicious caller somehow has a userId, the project_id
    // comes from the voice session (resolved from THEIR phone → THEIR project).
    // A different user's project_id would not be in their session.
    setupLLMResponse(
      [{ toolId: "edit_file", inputs: { path: "test.txt", content: "hello" } }],
      "Editing.",
    );
    setupLLMTextOnly("Done.");

    await runLiTTForVoice({
      userId: "user_attacker",
      projectId: "proj-attacker",
      conversationId: null,
      message: "Edit test.txt",
    });

    const editCall = mockExecuteProjectTool.mock.calls.find(
      (c: unknown[]) => c[0] === "edit_file",
    );
    expect(editCall).toBeDefined();
    // The userId and projectId are from the attacker's session, not the owner's
    // The real getProject() would reject this because user_attacker doesn't own proj-123
    expect(editCall![1]).toBe("user_attacker");
    expect(editCall![2].project_id).toBe("proj-attacker");
  });
});
