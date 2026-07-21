export type ProjectReadiness = {
  projectId: string;

  github: {
    status: "missing" | "connected" | "error";
    installationId: number | null;
  };

  repository: {
    status: "missing" | "imported" | "error";
    fullName: string | null;
    defaultBranch: string | null;
    commitSha: string | null;
  };

  scan: {
    status: "pending" | "scanning" | "ready" | "failed";
    error: string | null;
  };

  workspace: {
    status: "not_prepared" | "provisioning" | "ready" | "failed";
    workspaceId: string | null;
    root: string | null;
    error: string | null;
  };

  terminal: {
    status: "local_only" | "project_ready" | "failed";
  };

  runtime: {
    status: "stopped" | "starting" | "ready" | "failed";
    previewUrl: string | null;
  };
};

export function isProjectBuilderReady(
  readiness: ProjectReadiness,
): boolean {
  return (
    readiness.repository.status === "imported" &&
    readiness.scan.status === "ready" &&
    readiness.workspace.status === "ready" &&
    readiness.terminal.status === "project_ready"
  );
}
