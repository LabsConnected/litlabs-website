import { afterEach, describe, expect, it } from "vitest";
import {
  isOnboardingComplete,
  markFirstRunPromptConsumed,
  markOnboardingComplete,
  onboardingStorageKey,
  peekFirstRunProjectId,
  peekFirstRunPrompt,
  resolveActiveProjectIdForUrl,
  resolveStudioProjectId,
  takeFirstRunPrompt,
  writeFirstRunHandoff,
} from "./first-run-handoff";

afterEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

describe("first-run handoff", () => {
  it("writes prompt and project before CommandStudio would mount", () => {
    writeFirstRunHandoff({
      prompt: "  A coffee cart site  ",
      projectId: "proj_1",
      userId: "user_1",
    });
    expect(peekFirstRunPrompt()).toBe("A coffee cart site");
    expect(peekFirstRunProjectId()).toBe("proj_1");
    expect(isOnboardingComplete("user_1", "proj_1")).toBe(true);
  });

  it("survives delayed router navigation that drops ?prompt= and ?project=", () => {
    writeFirstRunHandoff({
      prompt: "A coffee cart site",
      projectId: "proj_1",
      userId: "user_1",
    });

    const afterUrlClobber = takeFirstRunPrompt(null);
    expect(afterUrlClobber).toBe("A coffee cart site");
    expect(resolveStudioProjectId(null)).toBe("proj_1");
  });

  it("survives remount before consume and applies exactly once", () => {
    writeFirstRunHandoff({
      prompt: "A coffee cart site",
      projectId: "proj_1",
    });

    const firstMount = takeFirstRunPrompt("A coffee cart site");
    expect(firstMount).toBe("A coffee cart site");

    const remountBeforeConsume = takeFirstRunPrompt(null);
    expect(remountBeforeConsume).toBe("A coffee cart site");

    markFirstRunPromptConsumed();

    expect(takeFirstRunPrompt(null)).toBeNull();
    expect(takeFirstRunPrompt("A coffee cart site")).toBeNull();
    expect(peekFirstRunPrompt()).toBeNull();
    expect(peekFirstRunProjectId()).toBe("proj_1");
  });

  it("prefers URL project when present, else session handoff", () => {
    writeFirstRunHandoff({ prompt: "x", projectId: "from-storage" });
    expect(resolveStudioProjectId("from-url")).toBe("from-url");
    expect(resolveStudioProjectId(null)).toBe("from-storage");
    expect(resolveStudioProjectId("")).toBe("from-storage");
  });

  it("scopes onboarding complete to user and project", () => {
    markOnboardingComplete("user_1", "proj_1");
    expect(isOnboardingComplete("user_1", "proj_1")).toBe(true);
    expect(isOnboardingComplete("user_1", "proj_2")).toBe(false);
    expect(isOnboardingComplete("user_2", "proj_1")).toBe(false);
    expect(localStorage.getItem("litt:onboarding-complete")).toBeNull();
    expect(localStorage.getItem(onboardingStorageKey("user_1", "proj_1"))).toBe("true");
  });
});

describe("resolveActiveProjectIdForUrl — project pinned into the Studio URL", () => {
  it("prefers the explicit URL project over the server-resolved project", () => {
    expect(resolveActiveProjectIdForUrl("from-url", "from-server")).toBe("from-url");
  });

  it("prefers the first-run handoff over the server-resolved project", () => {
    writeFirstRunHandoff({ prompt: "x", projectId: "from-handoff" });
    expect(resolveActiveProjectIdForUrl(null, "from-server")).toBe("from-handoff");
  });

  it("falls back to the server-resolved project so a bare landing still pins context", () => {
    expect(resolveActiveProjectIdForUrl(null, "from-server")).toBe("from-server");
    expect(resolveActiveProjectIdForUrl("", "from-server")).toBe("from-server");
  });

  it("returns null when no source knows a project (never invents one)", () => {
    expect(resolveActiveProjectIdForUrl(null, null)).toBeNull();
    expect(resolveActiveProjectIdForUrl(null, undefined)).toBeNull();
    expect(resolveActiveProjectIdForUrl(null, "   ")).toBeNull();
  });
});
