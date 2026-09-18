import { describe, expect, it, vi } from "vitest";
import {
  buildIntentResponseMessage,
  detectIntent,
  dispatchStudioIntent,
  type StudioIntentHandlers,
} from "./studio-intent";

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

  it("sends an edit that also mentions preview through the agent loop", () => {
    const intent = detectIntent(
      'For the frozen Ember Roast project, make one approved modification: change the hero paragraph to exactly "Small-batch coffee, roasted with care and delivered fresh." Show the approval before applying it, apply it once, report the exact diff, refresh the preview, and stop before deploying.',
    );
    expect(intent).toBeNull();
  });

  it("routes health and approval requests to their dedicated surfaces", () => {
    expect(detectIntent("Run project health checks")?.intent).toBe("project_health");
    expect(detectIntent("What needs approval?")?.intent).toBe("open_approvals");
  });

  it("lets deploy and publish requests reach the agent loop", () => {
    // Deployment runs through the real project.deploy tool (approval gate,
    // resume, verified URL). A deterministic intent would short-circuit to
    // canned text without ever deploying, so these must NOT match an intent.
    expect(detectIntent("Deploy this site")).toBeNull();
    expect(detectIntent("Deploy this project to a live public URL")).toBeNull();
    expect(detectIntent("Publish this site")).toBeNull();
    expect(detectIntent("deploy")).toBeNull();
  });

  it("opens Terminal only for explicit shell requests", () => {
    expect(detectIntent("Open the terminal")?.intent).toBe("open_terminal");
    expect(detectIntent("Run pnpm test")?.intent).toBe("run_command");
    expect(detectIntent("Please review this code")).not.toMatchObject({ tool: "terminal" });
  });
});

describe("P1-1: studio intent dead flows", () => {
  const runtime = { terminalConnected: true };

  function spies() {
    return {
      onRouteToolAction: vi.fn(),
      onRouteInspectorAction: vi.fn(),
      onRunHealthChecks: vi.fn(),
      onOpenProjectNameDialog: vi.fn(),
      onNavigate: vi.fn(),
    } satisfies StudioIntentHandlers;
  }

  describe("intent classification → correct routing", () => {
    it("classifies image requests as generate_image routed to the image tool", () => {
      for (const text of [
        "generate an image of a sunset",
        "create an image of a dog",
        "create a wallpaper",
      ]) {
        const intent = detectIntent(text);
        expect(intent?.intent).toBe("generate_image");
        // The tool is what the dispatch chain routes on — without it the
        // intent dies locally after printing a confirmation.
        expect(intent?.tool).toBe("image");
      }
    });

    it("classifies blank-project and settings requests", () => {
      expect(detectIntent("start a blank project")?.intent).toBe("start_blank_project");
      expect(detectIntent("start a new blank project")?.intent).toBe("start_blank_project");
      expect(detectIntent("open settings")?.intent).toBe("open_settings");
      expect(detectIntent("show settings")?.intent).toBe("open_settings");
    });
  });

  describe("success path — the real surface-open action fires", () => {
    it("generate_image opens the real image surface", () => {
      const h = spies();
      const intent = detectIntent("generate an image of a sunset");
      expect(intent).not.toBeNull();
      dispatchStudioIntent(intent!, h);
      expect(h.onRouteToolAction).toHaveBeenCalledTimes(1);
      expect(h.onRouteToolAction).toHaveBeenCalledWith("image");
      expect(h.onNavigate).not.toHaveBeenCalled();
    });

    it("start_blank_project opens the real project-name dialog", () => {
      const h = spies();
      const intent = detectIntent("start a blank project");
      expect(intent).not.toBeNull();
      dispatchStudioIntent(intent!, h);
      expect(h.onOpenProjectNameDialog).toHaveBeenCalledTimes(1);
      expect(h.onRouteToolAction).not.toHaveBeenCalled();
    });

    it("open_settings navigates to the real settings surface", () => {
      const h = spies();
      const intent = detectIntent("open settings");
      expect(intent).not.toBeNull();
      dispatchStudioIntent(intent!, h);
      expect(h.onNavigate).toHaveBeenCalledTimes(1);
      expect(h.onNavigate).toHaveBeenCalledWith("/settings");
    });

    it("connect_github still navigates to the GitHub install route", () => {
      const h = spies();
      const intent = detectIntent("connect github");
      expect(intent?.intent).toBe("connect_github");
      dispatchStudioIntent(intent!, h);
      expect(h.onNavigate).toHaveBeenCalledWith("/api/github/install");
    });
  });

  describe("no false-confirmation copy for unroutable intents", () => {
    it("every dispatched P1-1 intent fires at least one real handler", () => {
      for (const text of [
        "generate an image of a sunset",
        "start a blank project",
        "open settings",
      ]) {
        const h = spies();
        const intent = detectIntent(text);
        expect(intent).not.toBeNull();
        dispatchStudioIntent(intent!, h);
        const fired = Object.values(h).some((spy) => spy.mock.calls.length > 0);
        expect(fired).toBe(true);
      }
    });

    it("the false blank-project confirmation is gone", () => {
      const intent = detectIntent("start a blank project");
      expect(intent?.message).toBe("Opening the new-project dialog.");
      expect(intent?.message).not.toContain("ready in a moment");
      const uiMessage = buildIntentResponseMessage(intent!, runtime);
      expect(uiMessage).not.toContain("ready in a moment");
    });
  });

  describe("truthful UI state — assistant message matches what actually happened", () => {
    it.each([
      {
        text: "generate an image of a sunset",
        firedHandler: "onRouteToolAction",
        firedWith: ["image"],
        message: "Opening the image generator.",
      },
      {
        text: "start a blank project",
        firedHandler: "onOpenProjectNameDialog",
        firedWith: [],
        message: "Opening the new-project dialog.",
      },
      {
        text: "open settings",
        firedHandler: "onNavigate",
        firedWith: ["/settings"],
        message: "Opening Settings.",
      },
    ])(
      "$text → $firedHandler fires and the message says exactly that",
      ({ text, firedHandler, firedWith, message }) => {
        const h = spies();
        const intent = detectIntent(text);
        expect(intent).not.toBeNull();
        dispatchStudioIntent(intent!, h);
        const spy = h[firedHandler as keyof typeof h];
        expect(spy).toHaveBeenCalledTimes(1);
        if (firedWith.length > 0) expect(spy).toHaveBeenCalledWith(...firedWith);
        expect(buildIntentResponseMessage(intent!, runtime)).toBe(message);
      },
    );
  });
});
