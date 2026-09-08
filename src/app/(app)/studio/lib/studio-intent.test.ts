import { describe, expect, it } from "vitest";
import { detectIntent } from "./studio-intent";

describe("Studio intent routing", () => {
  it("routes ordinary chat to no workspace surface", () => {
    expect(detectIntent("Explain this architecture")).toBeNull();
  });

  it("routes file questions to the Files inspector intent", () => {
    expect(detectIntent("Show me the project files")?.intent).toBe("file_question");
    expect(detectIntent("Read the main component file")?.intent).toBe("file_question");
  });

  it("routes visual requests to Preview instead of Terminal", () => {
    expect(detectIntent("Show me the rendered preview")?.intent).toBe("visual_output");
    expect(detectIntent("Open the preview")?.intent).toBe("open_preview");
  });

  it("does not let a trailing preview request hijack a build brief", () => {
    const intent = detectIntent(
      "Create a responsive landing page for a fictional Michigan music venue. Show me the finished preview.",
    );
    expect(intent?.intent).toBe("generate_code");
  });

  it("routes health and approval requests to their dedicated surfaces", () => {
    expect(detectIntent("Run project health checks")?.intent).toBe("project_health");
    expect(detectIntent("What needs approval?")?.intent).toBe("open_approvals");
  });

  it("opens Terminal only for explicit shell requests", () => {
    expect(detectIntent("Open the terminal")?.intent).toBe("open_terminal");
    expect(detectIntent("Run pnpm test")?.intent).toBe("run_command");
    expect(detectIntent("Please review this code")).not.toMatchObject({ tool: "terminal" });
  });
});
