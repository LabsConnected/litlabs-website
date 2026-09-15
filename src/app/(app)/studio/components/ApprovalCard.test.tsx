import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ApprovalCard } from "./ApprovalCard";

const baseApproval = {
  toolId: "edit_file",
  reason: "File modification requires approval",
};

describe("ApprovalCard", () => {
  it("renders the tool summary and reason", () => {
    render(<ApprovalCard approval={baseApproval} />);
    expect(screen.getByTestId("approval-card")).toBeTruthy();
    // toolId underscores become spaces
    expect(screen.getByText("edit file")).toBeTruthy();
    expect(screen.getByText("File modification requires approval")).toBeTruthy();
    expect(screen.getByText("Approval required")).toBeTruthy();
  });

  it("calls onResolve with 'approved' when Approve is clicked", () => {
    const onResolve = vi.fn();
    render(<ApprovalCard approval={baseApproval} onResolve={onResolve} />);
    fireEvent.click(screen.getByTestId("approval-approve"));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith("approved");
  });

  it("calls onResolve with 'rejected' when Deny is clicked", () => {
    const onResolve = vi.fn();
    render(<ApprovalCard approval={baseApproval} onResolve={onResolve} />);
    fireEvent.click(screen.getByTestId("approval-deny"));
    expect(onResolve).toHaveBeenCalledTimes(1);
    expect(onResolve).toHaveBeenCalledWith("rejected");
  });

  it("shows the Edit button only when onEdit is provided", () => {
    const onResolve = vi.fn();
    const { rerender } = render(
      <ApprovalCard approval={baseApproval} onResolve={onResolve} />
    );
    expect(screen.queryByTestId("approval-edit")).toBeNull();

    const onEdit = vi.fn();
    rerender(
      <ApprovalCard
        approval={baseApproval}
        onResolve={onResolve}
        onEdit={onEdit}
      />
    );
    fireEvent.click(screen.getByTestId("approval-edit"));
    expect(onEdit).toHaveBeenCalledTimes(1);
  });

  it("renders no buttons and shows the auto-approved line when autoApproved", () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard
        approval={baseApproval}
        onResolve={onResolve}
        autoApproved
      />
    );
    expect(screen.queryByTestId("approval-approve")).toBeNull();
    expect(screen.queryByTestId("approval-deny")).toBeNull();
    expect(screen.getByText("Auto-approved in AUTO mode")).toBeTruthy();
  });

  it("uses the deploy title and emphasis when isDeploy", () => {
    render(<ApprovalCard approval={baseApproval} isDeploy />);
    expect(screen.getByText("Deploy approval — always requires you")).toBeTruthy();
    expect(screen.queryByText("Approval required")).toBeNull();
  });

  it("shows the affected-files count when derivable from inputs", () => {
    render(
      <ApprovalCard
        approval={{
          ...baseApproval,
          inputs: { files: ["src/a.ts", "src/b.ts", "src/c.ts"] },
        }}
      />
    );
    expect(screen.getByText("· 3 files affected")).toBeTruthy();
  });

  it("uses the singular form for one file", () => {
    render(
      <ApprovalCard
        approval={{ ...baseApproval, inputs: { file: "src/a.ts" } }}
      />
    );
    expect(screen.getByText("· 1 file affected")).toBeTruthy();
  });

  it("omits the affected-files line when inputs carry no file info", () => {
    render(
      <ApprovalCard
        approval={{ ...baseApproval, inputs: { query: "hello" } }}
      />
    );
    expect(screen.queryByText(/files? affected/)).toBeNull();
  });

  it("shows the truncated pausedRunId when present", () => {
    render(
      <ApprovalCard
        approval={{ ...baseApproval, pausedRunId: "a1b2c3d4e5f6g7h8" }}
      />
    );
    expect(screen.getByText("run a1b2c3d4")).toBeTruthy();
  });

  it("renders no buttons when onResolve is not provided", () => {
    render(<ApprovalCard approval={baseApproval} />);
    expect(screen.queryByTestId("approval-approve")).toBeNull();
    expect(screen.queryByTestId("approval-deny")).toBeNull();
  });
});
