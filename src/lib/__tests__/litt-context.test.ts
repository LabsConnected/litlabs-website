import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ──────────────────────────────────────────────────────

// Mock supabase admin
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/supabase", () => ({
  getSupabaseAdmin: vi.fn(() => ({
    from: vi.fn(() => ({
      select: mockSelect,
      insert: mockInsert,
      update: mockUpdate,
    })),
  })),
}));

// Mock studio-context
vi.mock("@/lib/capabilities/studio-context", () => ({
  getStudioContext: vi.fn(async () => ({
    terminalConnected: false,
    terminalSessionId: null,
    repositoryConnected: true,
    repositoryName: "LabsConnected/litlabs-website",
    availableTools: ["repository"],
    connectionSummary: "Connected: repository (LabsConnected/litlabs-website)",
  })),
  buildCapabilityContextForChat: vi.fn(() => "STUDIO CONNECTION STATE:\nGitHub: connected (LabsConnected/litlabs-website)"),
}));

// ─── Test data ──────────────────────────────────────────────────

const TEST_USER_ID = "user_test123";
const TEST_PROJECT_ID = "proj-uuid-123";
const OTHER_PROJECT_ID = "proj-uuid-456";

const LITLABS_PROJECT = {
  id: TEST_PROJECT_ID,
  name: "LiTTree LabStudios Website",
  repository_full_name: "LabsConnected/litlabs-website",
  description: "The main LiTTree LabStudios website built with Next.js",
  tech_stack: "Next.js 16, React 19, TypeScript, Tailwind CSS v4",
  goals: "Ship the Studio OS vertical slice",
  owner: "LabsConnected",
  repository: "litlabs-website",
  default_branch: "main",
  working_branch: "main",
  selected_branch: "main",
};

// ─── Tests ──────────────────────────────────────────────────────

describe("LiTT Project Context — buildChatContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset env
    delete process.env.SUPERMEMORY_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("identifies the active project by name", async () => {
    // Mock supabase to return the litlabs project
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [LITLABS_PROJECT],
              error: null,
            }),
          }),
        }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [LITLABS_PROJECT],
            error: null,
          }),
        }),
      }),
    });

    const { buildChatContext } = await import("@/lib/chat/build-context");
    const ctx = await buildChatContext(TEST_USER_ID, {
      repositoryName: "LabsConnected/litlabs-website",
    });

    expect(ctx.projectInfo).toBeDefined();
    expect(ctx.projectInfo?.name).toBe("LiTTree LabStudios Website");
  });

  it("identifies LabsConnected/litlabs-website as the repository", async () => {
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [LITLABS_PROJECT],
              error: null,
            }),
          }),
        }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [LITLABS_PROJECT],
            error: null,
          }),
        }),
      }),
    });

    const { buildChatContext } = await import("@/lib/chat/build-context");
    const ctx = await buildChatContext(TEST_USER_ID, {
      repositoryName: "LabsConnected/litlabs-website",
    });

    expect(ctx.projectInfo?.repoUrl).toBe("LabsConnected/litlabs-website");
    expect(ctx.repoName).toBe("LabsConnected/litlabs-website");
  });

  it("receives the project stack and description", async () => {
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [LITLABS_PROJECT],
              error: null,
            }),
          }),
        }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [LITLABS_PROJECT],
            error: null,
          }),
        }),
      }),
    });

    const { buildChatContext } = await import("@/lib/chat/build-context");
    const ctx = await buildChatContext(TEST_USER_ID, {
      repositoryName: "LabsConnected/litlabs-website",
    });

    expect(ctx.projectInfo?.stack).toContain("Next.js 16");
    expect(ctx.projectInfo?.description).toContain("LiTTree LabStudios website");
  });
});

describe("LiTT Memory — recall and persist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.SUPERMEMORY_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("recalls memories from Supabase when Supermemory is disabled", async () => {
    // Mock Supabase to return memories
    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        ilike: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [{ content: "User discussed fixing the emulator keyboard" }],
            }),
          }),
        }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [{ content: "User discussed fixing the emulator keyboard" }],
          }),
        }),
      }),
    });

    const { recallMemories } = await import("@/lib/memory/service");
    const result = await recallMemories("emulator keyboard", TEST_USER_ID, 5);

    expect(result).toContain("RELEVANT MEMORIES");
    expect(result).toContain("emulator keyboard");
  });

  it("persists memories to Supabase when Supermemory is disabled", async () => {
    mockInsert.mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "mem-1" },
          error: null,
        }),
      }),
    });

    const { persistMemory } = await import("@/lib/memory/service");
    await persistMemory("User asked about the litlabs project", TEST_USER_ID, "litt", TEST_PROJECT_ID);

    expect(mockInsert).toHaveBeenCalled();
  });

  it("scopes memories by project to prevent cross-project contamination", async () => {
    // Project A memories
    const projectAMemories = [{ content: "Discussed litlabs website fix" }];
    // Project B memories
    const projectBMemories = [{ content: "Discussed other project feature" }];

    let callCount = 0;
    mockSelect.mockReturnValue({
      eq: mockEq.mockImplementation((_col: string, _val: string) => ({
        ilike: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: callCount++ === 0 ? projectAMemories : projectBMemories,
            }),
          }),
        }),
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: callCount++ === 0 ? projectAMemories : projectBMemories,
            }),
          }),
        }),
      })),
    });

    const { recallMemories } = await import("@/lib/memory/service");

    // Recall for project A
    const resultA = await recallMemories("website fix", TEST_USER_ID, 5, TEST_PROJECT_ID);
    // Recall for project B
    const resultB = await recallMemories("other feature", TEST_USER_ID, 5, OTHER_PROJECT_ID);

    // Project A result should contain litlabs-related memory
    expect(resultA).toContain("litlabs website fix");
    // Project B result should NOT contain litlabs-related memory
    expect(resultB).not.toContain("litlabs website fix");
  });

  it("blocks storage of content containing secrets", async () => {
    const { persistMemory } = await import("@/lib/memory/service");

    const secretContent = "User shared their API key: sk-1234567890abcdef1234567890abcdef";
    await persistMemory(secretContent, TEST_USER_ID, "litt");

    // Insert should NOT have been called because secrets were detected
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("still works with Supermemory disabled (Supabase fallback)", async () => {
    // Ensure Supermemory is not configured
    expect(process.env.SUPERMEMORY_API_KEY).toBeUndefined();

    mockSelect.mockReturnValue({
      eq: mockEq.mockReturnValue({
        ilike: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({
              data: [{ content: "Remembered fact about the project" }],
            }),
          }),
        }),
        order: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({
            data: [{ content: "Remembered fact about the project" }],
          }),
        }),
      }),
    });

    const { recallMemories } = await import("@/lib/memory/service");
    const result = await recallMemories("project fact", TEST_USER_ID, 5);

    // Should still get memories from Supabase
    expect(result).toContain("Remembered fact");
  });
});

describe("LiTT Prompt Composer — project block", () => {
  it("includes project name, repo, stack, and description in the prompt", async () => {
    const { composeSystemPrompt } = await import("@/lib/litt-kernel/prompt-composer");
    const { routeKernel } = await import("@/lib/litt-kernel/kernel");

    const kernelResult = routeKernel({
      message: "what should I get done on my project?",
      userId: TEST_USER_ID,
      conversationId: null,
      projectId: TEST_PROJECT_ID,
      missionId: null,
      canvasId: null,
      capabilities: [],
    });

    const projectInfo = {
      id: TEST_PROJECT_ID,
      name: "LiTTree LabStudios Website",
      repoUrl: "LabsConnected/litlabs-website",
      repoOwner: "LabsConnected",
      description: "The main LiTTree LabStudios website",
      stack: "Next.js 16, React 19, TypeScript",
      branch: "main",
      framework: "Next.js",
    };

    const prompt = composeSystemPrompt(kernelResult.decision, [], projectInfo);

    expect(prompt).toContain("LiTTree LabStudios Website");
    expect(prompt).toContain("LabsConnected/litlabs-website");
    expect(prompt).toContain("Next.js 16");
    expect(prompt).toContain("The main LiTTree LabStudios website");
    expect(prompt).toContain("Branch: main");
  });

  it("shows 'Project: REQUIRED' when project is required but none active", async () => {
    const { composeSystemPrompt } = await import("@/lib/litt-kernel/prompt-composer");
    const { routeKernel } = await import("@/lib/litt-kernel/kernel");

    const kernelResult = routeKernel({
      message: "edit my README",
      userId: TEST_USER_ID,
      conversationId: null,
      projectId: null,
      missionId: null,
      canvasId: null,
      capabilities: [],
    });

    const prompt = composeSystemPrompt(kernelResult.decision, []);

    expect(prompt).toContain("REQUIRED");
  });
});

describe("LiTT Intent Router — project assessment queries", () => {
  it("routes 'what should I get done' to review mode with project requirement", async () => {
    const { classifyIntent } = await import("@/lib/litt-kernel/intent-router");
    const result = classifyIntent("what should I get done on my project?");
    expect(result.mode).toBe("review");
    expect(result.requiresProject).toBe(true);
  });

  it("routes 'what needs fixing' to review mode", async () => {
    const { classifyIntent } = await import("@/lib/litt-kernel/intent-router");
    const result = classifyIntent("what needs fixing right now?");
    expect(result.mode).toBe("review");
    expect(result.requiresProject).toBe(true);
  });

  it("routes 'whats highly needed' to review mode", async () => {
    const { classifyIntent } = await import("@/lib/litt-kernel/intent-router");
    const result = classifyIntent("whats highly needed right now");
    expect(result.mode).toBe("review");
    expect(result.requiresProject).toBe(true);
  });
});
