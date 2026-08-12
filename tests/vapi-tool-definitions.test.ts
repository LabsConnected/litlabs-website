// @vitest-environment node
import { describe, it, expect } from "vitest";
import {
  VAPI_TOOL_DEFINITIONS,
  ALL_VAPI_TOOL_NAMES,
  LITT_BEHAVIOR_CONTRACT,
  buildVapiToolPayload,
} from "@/lib/vapi-tool-definitions";
import { TOOL_NAMES } from "@/lib/vapi-tools";

// ─── Tool definitions exist for all new tools ─────────────────────

describe("new Vapi tool definitions", () => {
  const newTools = [
    "git_status",
    "create_branch",
    "commit_changes",
    "push_branch",
    "create_pull_request",
    "search_code",
    "remember_project_context",
    "request_approval",
    "browser_test",
  ] as const;

  it("TOOL_NAMES includes all 9 new tools", () => {
    for (const name of newTools) {
      expect(TOOL_NAMES).toContain(name);
    }
  });

  it("VAPI_TOOL_DEFINITIONS has a definition for each new tool", () => {
    for (const name of newTools) {
      expect(VAPI_TOOL_DEFINITIONS[name]).toBeDefined();
      expect(VAPI_TOOL_DEFINITIONS[name].name).toBe(name);
      expect(VAPI_TOOL_DEFINITIONS[name].description.length).toBeGreaterThan(20);
    }
  });

  it("ALL_VAPI_TOOL_NAMES matches TOOL_NAMES", () => {
    expect(ALL_VAPI_TOOL_NAMES).toEqual([...TOOL_NAMES]);
  });
});

// ─── Git tool definitions ─────────────────────────────────────────

describe("git tool definitions", () => {
  it("git_status requires only project_id", () => {
    const def = VAPI_TOOL_DEFINITIONS.git_status;
    expect(def.parameters.required).toEqual(["project_id"]);
  });

  it("create_branch requires project_id and branch_name", () => {
    const def = VAPI_TOOL_DEFINITIONS.create_branch;
    expect(def.parameters.required).toContain("project_id");
    expect(def.parameters.required).toContain("branch_name");
  });

  it("commit_changes requires project_id and message", () => {
    const def = VAPI_TOOL_DEFINITIONS.commit_changes;
    expect(def.parameters.required).toContain("project_id");
    expect(def.parameters.required).toContain("message");
  });

  it("push_branch requires only project_id (branch optional)", () => {
    const def = VAPI_TOOL_DEFINITIONS.push_branch;
    expect(def.parameters.required).toEqual(["project_id"]);
  });

  it("create_pull_request requires project_id and title", () => {
    const def = VAPI_TOOL_DEFINITIONS.create_pull_request;
    expect(def.parameters.required).toContain("project_id");
    expect(def.parameters.required).toContain("title");
  });
});

// ─── Search + memory tool definitions ─────────────────────────────

describe("search + memory tool definitions", () => {
  it("search_code requires project_id and pattern", () => {
    const def = VAPI_TOOL_DEFINITIONS.search_code;
    expect(def.parameters.required).toContain("project_id");
    expect(def.parameters.required).toContain("pattern");
  });

  it("remember_project_context requires project_id and content", () => {
    const def = VAPI_TOOL_DEFINITIONS.remember_project_context;
    expect(def.parameters.required).toContain("project_id");
    expect(def.parameters.required).toContain("content");
  });

  it("remember_project_context has memory_type enum", () => {
    const def = VAPI_TOOL_DEFINITIONS.remember_project_context;
    const props = def.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.memory_type?.enum).toContain("project_fact");
    expect(props.memory_type?.enum).toContain("architecture");
  });
});

// ─── Approval gate definition ─────────────────────────────────────

describe("request_approval definition", () => {
  it("requires action, description, and risk_level", () => {
    const def = VAPI_TOOL_DEFINITIONS.request_approval;
    expect(def.parameters.required).toContain("action");
    expect(def.parameters.required).toContain("description");
    expect(def.parameters.required).toContain("risk_level");
  });

  it("risk_level enum includes medium, high, critical", () => {
    const def = VAPI_TOOL_DEFINITIONS.request_approval;
    const props = def.parameters.properties as Record<string, { enum?: string[] }>;
    expect(props.risk_level?.enum).toEqual(["medium", "high", "critical"]);
  });

  it("project_id is optional for request_approval", () => {
    const def = VAPI_TOOL_DEFINITIONS.request_approval;
    expect(def.parameters.required).not.toContain("project_id");
  });
});

// ─── Browser test definition ──────────────────────────────────────

describe("browser_test definition", () => {
  it("requires url", () => {
    const def = VAPI_TOOL_DEFINITIONS.browser_test;
    expect(def.parameters.required).toEqual(["url"]);
  });

  it("does not require project_id (can test any URL)", () => {
    const def = VAPI_TOOL_DEFINITIONS.browser_test;
    expect(def.parameters.required).not.toContain("project_id");
  });
});

// ─── Behavior contract ────────────────────────────────────────────

describe("LITT_BEHAVIOR_CONTRACT", () => {
  it("is a non-empty string", () => {
    expect(LITT_BEHAVIOR_CONTRACT.length).toBeGreaterThan(100);
  });

  it("includes the honesty rule", () => {
    expect(LITT_BEHAVIOR_CONTRACT).toContain("NEVER claim an external action happened");
  });

  it("includes the tool-call requirement", () => {
    expect(LITT_BEHAVIOR_CONTRACT).toContain("MUST call");
  });

  it("mentions pending_approval behavior", () => {
    expect(LITT_BEHAVIOR_CONTRACT).toContain("pending_approval");
  });

  it("mentions get_active_project", () => {
    expect(LITT_BEHAVIOR_CONTRACT).toContain("get_active_project");
  });
});

// ─── buildVapiToolPayload works for new tools ─────────────────────

describe("buildVapiToolPayload for new tools", () => {
  it("builds a valid payload for git_status", () => {
    const payload = buildVapiToolPayload("git_status", {
      serverUrl: "https://litlabs.net/api/vapi/tools",
      authHeader: "Bearer test-token",
    });
    expect(payload.type).toBe("function");
    expect(payload.function.name).toBe("git_status");
    expect(payload.server.url).toBe("https://litlabs.net/api/vapi/tools");
    expect(payload.server.headers?.Authorization).toBe("Bearer test-token");
  });

  it("builds a valid payload for browser_test", () => {
    const payload = buildVapiToolPayload("browser_test", {
      serverUrl: "https://litlabs.net/api/vapi/tools",
      authHeader: "Bearer test-token",
    });
    expect(payload.function.name).toBe("browser_test");
    expect(payload.messages.length).toBeGreaterThan(0);
  });

  it("throws for unknown tool name", () => {
    expect(() =>
      buildVapiToolPayload("delete_everything" as never, {
        serverUrl: "https://litlabs.net/api/vapi/tools",
      }),
    ).toThrow(/Unknown Vapi tool/);
  });
});
