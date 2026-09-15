import type { ConnectionCapabilities } from "../hooks/useConnectionSummary";

/**
 * Project facts for the metadata panel, derived from the canonical
 * source model.
 *
 * Git is NOT GitHub. A managed project reports Source "LiTT Managed",
 * Version control "Git", Branch "main" and GitHub "Not connected" — all
 * simultaneously true. The old panel had a single "Repository" row that
 * read "Not connected" and made a healthy project look broken.
 */
export function describeSourceRows(
  capabilities: Pick<
    ConnectionCapabilities,
    "sourceKind" | "sourceLabel" | "sourceStatus" | "versionControl" | "activeBranch" | "repositoryName" | "githubConnected" | "workspaceStatus"
  >,
): { source: string; versionControl: string; branch: string; workspace: string; github: string } {
  const source =
    capabilities.sourceStatus === "provisioning" ? "Provisioning…"
    : capabilities.sourceStatus === "error" ? "Error"
    : capabilities.sourceStatus === "needs_setup" ? "Needs setup"
    : capabilities.sourceLabel ?? (capabilities.sourceKind === "github" ? "GitHub" : "LiTT Managed");

  const workspace =
    capabilities.workspaceStatus === "ready" ? "Ready"
    : capabilities.workspaceStatus === "provisioning" || capabilities.workspaceStatus === "preparing" ? "Starting…"
    : capabilities.workspaceStatus === "failed" || capabilities.workspaceStatus === "error" ? "Failed"
    : "Not prepared";

  return {
    source,
    versionControl: capabilities.versionControl === "git" ? "Git" : "Not initialized",
    // A managed project always has a branch. "—" is only correct when
    // no source has been provisioned at all.
    branch: capabilities.activeBranch ?? (capabilities.sourceStatus === "ready" ? "main" : "—"),
    workspace,
    github: capabilities.githubConnected ? (capabilities.repositoryName ?? "Connected") : "Not connected",
  };
}
