import { describe, it, expect } from "vitest";
import { translateCapabilities, type RawCapabilities } from "./translate";

describe("translateCapabilities — workspace-aware status", () => {
  it("reports connected repository with exact name and branch", () => {
    const caps: RawCapabilities = {
      repository: "connected",
      repositoryIndexed: true,
      repositoryName: "LabsConnected/litlabs-website",
      activeBranch: "main",
      writeAccess: true,
      workspaceStatus: "ready",
      selectedModelLabel: "Auto Best",
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("LabsConnected/litlabs-website");
    expect(result.contextBlock).toContain("main");
    expect(result.contextBlock).toContain("Write access: permitted");
    expect(result.contextBlock).toContain("Auto Best");
    expect(result.githubState).toContain("Repository connected and ready");
  });

  it("reports write-requires-approval when writeAccess is false", () => {
    const caps: RawCapabilities = {
      repository: "connected",
      repositoryIndexed: true,
      repositoryName: "owner/repo",
      activeBranch: "dev",
      writeAccess: false,
      workspaceStatus: "ready",
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("Write access: not permitted");
    expect(result.contextBlock).toContain("require user approval");
    expect(result.contextBlock).toContain("Approval:");
  });

  it("reports disconnected terminal separately from repository", () => {
    const caps: RawCapabilities = {
      repository: "connected",
      repositoryIndexed: true,
      repositoryName: "owner/repo",
      activeBranch: "main",
      terminalExecution: "unavailable",
      terminalStatus: "disconnected",
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("Terminal: Project terminal is not connected.");
    expect(result.githubState).toContain("Repository connected and ready");
    // Terminal and repo are reported separately
    expect(result.terminalState).toContain("not connected");
  });

  it("reports fully disconnected state honestly", () => {
    const caps: RawCapabilities = {
      repository: "none",
      terminalExecution: "unavailable",
    };
    const result = translateCapabilities(caps);
    expect(result.githubState).toContain("No repository is connected.");
    expect(result.terminalState).toContain("not connected");
    expect(result.contextBlock).not.toContain("Write access:");
  });

  it("does not claim write access based only on repository connection", () => {
    const caps: RawCapabilities = {
      repository: "connected",
      repositoryIndexed: true,
      repositoryName: "owner/repo",
      // writeAccess not set — should default to no write access
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("Write access: not permitted");
  });

  it("includes approval rules for destructive commands", () => {
    const caps: RawCapabilities = {
      repository: "connected",
      repositoryIndexed: true,
      writeAccess: false,
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("file-changing");
    expect(result.contextBlock).toContain("git-changing");
    expect(result.contextBlock).toContain("destructive");
    expect(result.contextBlock).toContain("deployment");
  });

  it("includes the rule about distinguishing GitHub connected vs repository selected vs writes permitted", () => {
    const caps: RawCapabilities = {
      repository: "connected",
      repositoryIndexed: true,
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("Distinguish: GitHub connected, repository selected, repository readable, and writes permitted");
  });

  it("includes the rule about reporting exact repository name and branch", () => {
    const caps: RawCapabilities = {
      repository: "connected",
      repositoryIndexed: true,
      repositoryName: "owner/repo",
      activeBranch: "main",
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("report the exact repository name and branch");
  });

  it("includes selected model label when provided", () => {
    const caps: RawCapabilities = {
      selectedModelLabel: "GPT-4 Turbo",
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("Selected model: GPT-4 Turbo");
  });

  it("does not include write access section when no repository is connected", () => {
    const caps: RawCapabilities = {
      repository: "none",
      writeAccess: true,
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).not.toContain("Write access:");
  });

  // ── Truthful voice response rules ──

  it("includes rule: never say 'I can hear you' from transcript alone", () => {
    const caps: RawCapabilities = {
      voiceHealth: { configured: true, tokenService: "healthy", available: true },
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("NEVER say \"Yes, I can hear you\"");
    expect(result.contextBlock).toContain("merely because a text transcript arrived");
  });

  it("includes rule: voice is push-to-talk only", () => {
    const caps: RawCapabilities = {
      voiceHealth: { configured: true, tokenService: "healthy", available: true },
    };
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("push-to-talk only");
    expect(result.contextBlock).toContain("Do not tell the user you are continuously listening");
  });

  it("includes rule: do not respond to rejected transcripts", () => {
    const caps: RawCapabilities = {};
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("rejected");
    expect(result.contextBlock).toContain("filler");
    expect(result.contextBlock).toContain("duplicate");
  });

  it("includes rule: report only verified voice states", () => {
    const caps: RawCapabilities = {};
    const result = translateCapabilities(caps);
    expect(result.contextBlock).toContain("microphone permission granted");
    expect(result.contextBlock).toContain("microphone actively listening");
    expect(result.contextBlock).toContain("transcript received");
  });
});
