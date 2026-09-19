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

describe("ApprovalCard — approval lifecycle phases", () => {
  it("disables Approve/Deny and shows submitting state while the POST is in flight", () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard approval={baseApproval} onResolve={onResolve} phase="submitting" />
    );
    expect(screen.getByTestId("approval-status").textContent).toContain("Submitting");
    expect(screen.getByTestId("approval-approve")).toHaveProperty("disabled", true);
    expect(screen.getByTestId("approval-deny")).toHaveProperty("disabled", true);
    // The card is still mounted — nothing silently cleared.
    expect(screen.getByTestId("approval-card")).toBeTruthy();
  });

  it("shows the executing state while the resumed run is running", () => {
    const onResolve = vi.fn();
    render(
      <ApprovalCard approval={baseApproval} onResolve={onResolve} phase="executing" />
    );
    expect(screen.getByTestId("approval-status").textContent).toContain("running");
    expect(screen.getByTestId("approval-card")).toBeTruthy();
  });

  it("shows the backend error and a Retry button on failure — never a silent clear", () => {
    const onRetry = vi.fn();
    const onResolve = vi.fn();
    render(
      <ApprovalCard
        approval={baseApproval}
        onResolve={onResolve}
        phase="failed"
        error="Resume worker crashed"
        onRetry={onRetry}
      />
    );
    const err = screen.getByTestId("approval-error");
    expect(err.textContent).toContain("Resume worker crashed");
    // The decision buttons are gone — the gate was consumed; Retry is the path.
    expect(screen.queryByTestId("approval-approve")).toBeNull();
    expect(screen.queryByTestId("approval-deny")).toBeNull();
    fireEvent.click(screen.getByTestId("approval-retry"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onResolve).not.toHaveBeenCalled();
  });

  it("omits the Retry button when the failure is not retryable", () => {
    render(
      <ApprovalCard
        approval={baseApproval}
        phase="failed"
        error="This approval expired before it could be resumed."
        retryable={false}
        onRetry={vi.fn()}
      />
    );
    expect(screen.getByTestId("approval-error")).toBeTruthy();
    expect(screen.queryByTestId("approval-retry")).toBeNull();
    expect(screen.getByText("This approval can no longer be retried.")).toBeTruthy();
  });

  it("keeps the default idle rendering unchanged", () => {
    const onResolve = vi.fn();
    render(<ApprovalCard approval={baseApproval} onResolve={onResolve} />);
    expect(screen.getByTestId("approval-approve")).toHaveProperty("disabled", false);
    expect(screen.queryByTestId("approval-status")).toBeNull();
    expect(screen.queryByTestId("approval-error")).toBeNull();
  });
});

describe("ApprovalCard — mode pill", () => {
  it("renders the ACT pill in lime when mode is act", () => {
    render(<ApprovalCard approval={baseApproval} mode="act" />);
    const pill = screen.getByTestId("approval-mode");
    expect(pill.textContent).toBe("Act");
    expect(pill.className).toContain("text-accent");
  });

  it("renders Plan and Auto pills for the other modes", () => {
    const { rerender } = render(<ApprovalCard approval={baseApproval} mode="plan" />);
    expect(screen.getByTestId("approval-mode").textContent).toBe("Plan");
    rerender(<ApprovalCard approval={baseApproval} mode="auto" />);
    expect(screen.getByTestId("approval-mode").textContent).toBe("Auto");
  });

  it("renders no pill when mode is absent — never guesses", () => {
    render(<ApprovalCard approval={baseApproval} />);
    expect(screen.queryByTestId("approval-mode")).toBeNull();
  });
});

describe("ApprovalCard — image request preview", () => {
  const imageApproval = {
    toolId: "image.generate",
    reason: "Image generation requires approval",
    inputs: { prompt: "a golden retriever getting groomed, photorealistic", size: "16:9" },
  };

  it("shows the prompt and params instead of faked pixels", () => {
    render(<ApprovalCard approval={imageApproval} onResolve={vi.fn()} />);
    expect(screen.getByTestId("approval-image-request")).toBeTruthy();
    expect(screen.getByTestId("approval-image-prompt").textContent).toContain(
      "a golden retriever getting groomed"
    );
    expect(screen.getByText("size: 16:9")).toBeTruthy();
    // Honest empty state — no <img> without a real image.
    expect(screen.queryByTestId("approval-image-thumbnail")).toBeNull();
    expect(screen.getByText(/No image generated yet/)).toBeTruthy();
  });

  it("renders a real attached image as a thumbnail, labeled as attached", () => {
    render(
      <ApprovalCard
        approval={{
          ...imageApproval,
          inputs: {
            ...imageApproval.inputs,
            referenceImageUrl: "https://example.com/dog.png",
          },
        }}
        onResolve={vi.fn()}
      />
    );
    const img = screen.getByTestId("approval-image-thumbnail");
    expect(img).toHaveProperty("src", "https://example.com/dog.png");
    expect(screen.getByText(/came with the request, not generated/)).toBeTruthy();
    // The prompt still shows alongside the attachment, and the
    // "not generated yet" line is suppressed — there IS an image.
    expect(screen.getByTestId("approval-image-prompt").textContent).toContain(
      "a golden retriever getting groomed"
    );
    expect(screen.queryByText(/No image generated yet/)).toBeNull();
  });

  it("does not render the image block for non-image tools", () => {
    render(
      <ApprovalCard
        approval={{ ...baseApproval, inputs: { prompt: "not an image tool" } }}
        onResolve={vi.fn()}
      />
    );
    expect(screen.queryByTestId("approval-image-request")).toBeNull();
  });

  it("omits the prompt line when inputs carry no prompt", () => {
    render(
      <ApprovalCard
        approval={{ toolId: "image.generate", reason: "r", inputs: { size: "1:1" } }}
        onResolve={vi.fn()}
      />
    );
    expect(screen.getByTestId("approval-image-request")).toBeTruthy();
    expect(screen.queryByTestId("approval-image-prompt")).toBeNull();
    expect(screen.getByText(/No image generated yet/)).toBeTruthy();
  });
});
