import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { render, screen } from "@testing-library/react";
import { StudioFilePreview, type FileSelectionState } from "./StudioFilePreview";

// Mock URL.createObjectURL for jsdom
const originalCreateObjectURL = URL.createObjectURL;
beforeAll(() => {
  URL.createObjectURL = (() => "blob:mock-url") as typeof URL.createObjectURL;
});
afterAll(() => {
  URL.createObjectURL = originalCreateObjectURL;
});

// Helper to create selection state
function makeSelection(overrides: Partial<FileSelectionState> = {}): FileSelectionState {
  return {
    path: null,
    content: null,
    size: null,
    loading: false,
    error: null,
    dirty: false,
    ...overrides,
  };
}

describe("StudioFilePreview", () => {
  it("shows empty state when no file selected", () => {
    render(<StudioFilePreview projectId="test-proj" selection={makeSelection()} />);
    expect(screen.getByTestId("file-preview-empty")).toBeTruthy();
    expect(screen.getByText("Select a file to inspect or preview it.")).toBeTruthy();
  });

  it("shows loading state", () => {
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "test.json", loading: true })}
      />,
    );
    expect(screen.getByTestId("file-preview-loading")).toBeTruthy();
    expect(screen.getByText("Loading test.json…")).toBeTruthy();
  });

  it("shows error state with retry button", () => {
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "test.json", error: "File not found" })}
      />,
    );
    expect(screen.getByTestId("file-preview-error")).toBeTruthy();
    expect(screen.getByText("Failed to load file")).toBeTruthy();
    expect(screen.getByText("File not found")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("renders JSON with formatting", () => {
    const jsonContent = '{"name":"test","value":42}';
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "config.json", content: jsonContent, size: 22 })}
      />,
    );
    expect(screen.getByTestId("file-preview-json")).toBeTruthy();
    // Formatted JSON should be present
    expect(screen.getByText(/"name"/)).toBeTruthy();
    expect(screen.getByText(/"test"/)).toBeTruthy();
  });

  it("shows JSON syntax error for invalid JSON", () => {
    const invalidJson = '{name: test}';
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "bad.json", content: invalidJson })}
      />,
    );
    expect(screen.getByTestId("file-preview-json")).toBeTruthy();
    expect(screen.getByText(/JSON syntax error/)).toBeTruthy();
  });

  it("renders code files as preformatted text", () => {
    const code = "function hello() {\n  return 'world';\n}";
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "utils.ts", content: code, size: 36 })}
      />,
    );
    expect(screen.getByTestId("file-preview-code")).toBeTruthy();
    expect(screen.getByText(/function hello/)).toBeTruthy();
  });

  it("renders markdown as HTML", () => {
    const md = "# Hello World\n\nThis is **bold** text.";
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "README.md", content: md })}
      />,
    );
    expect(screen.getByTestId("file-preview-markdown")).toBeTruthy();
    const heading = screen.getByText("Hello World");
    expect(heading.tagName).toBe("H1");
  });

  it("renders SVG with sanitized content", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><circle cx="50" cy="50" r="40" fill="red"/></svg>';
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "logo.svg", content: svg })}
      />,
    );
    expect(screen.getByTestId("file-preview-svg")).toBeTruthy();
  });

  it("removes script tags from SVG", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert("xss")</script><circle cx="50" cy="50" r="40"/></svg>';
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "evil.svg", content: svg })}
      />,
    );
    const container = screen.getByTestId("file-preview-svg");
    expect(container.innerHTML).not.toContain("script");
    expect(container.innerHTML).not.toContain("alert");
  });

  it("masks ENV secrets by default", () => {
    const envContent = [
      "# Comment line",
      "API_KEY=sk-1234567890abcdef",
      "TOKEN=ghp_abcdef123456",
      "PUBLIC_VAR=hello",
      "",
    ].join("\n");
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: ".env", content: envContent })}
      />,
    );
    expect(screen.getByTestId("file-preview-env")).toBeTruthy();
    expect(screen.getByText("Secrets are masked for safety")).toBeTruthy();
    // Should not contain the actual secret values
    const container = screen.getByTestId("file-preview-env");
    expect(container.textContent).not.toContain("sk-1234567890abcdef");
    expect(container.textContent).not.toContain("ghp_abcdef123456");
    // Should contain masked values
    expect(container.textContent).toContain("********");
    // Should contain non-secret values
    expect(container.textContent).toContain("hello");
    expect(container.textContent).toContain("# Comment line");
  });

  it("renders YAML as preformatted text", () => {
    const yaml = "name: test\nvalue: 42\nlist:\n  - item1\n  - item2";
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "config.yaml", content: yaml })}
      />,
    );
    expect(screen.getByTestId("file-preview-yaml")).toBeTruthy();
  });

  it("shows unsupported message for binary files", () => {
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "archive.zip", size: 1024 })}
      />,
    );
    expect(screen.getByTestId("file-preview-binary")).toBeTruthy();
    expect(screen.getByText("Preview isn't available for this file type.")).toBeTruthy();
    expect(screen.getByText("Download")).toBeTruthy();
  });

  it("shows file header with name, extension, and size", () => {
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "src/config.json", content: "{}", size: 2 })}
      />,
    );
    expect(screen.getByText("config.json")).toBeTruthy();
    expect(screen.getByText("JSON")).toBeTruthy();
    expect(screen.getByText("2 B")).toBeTruthy();
  });

  it("shows dirty indicator when file has unsaved changes", () => {
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "test.ts", content: "let x = 1;", dirty: true })}
      />,
    );
    const indicator = document.querySelector('[title="Unsaved changes"]');
    expect(indicator).toBeTruthy();
  });

  it("renders text files (.txt) as code", () => {
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "notes.txt", content: "Hello world" })}
      />,
    );
    expect(screen.getByTestId("file-preview-code")).toBeTruthy();
  });

  it("renders HTML in sandboxed container", () => {
    const html = "<!DOCTYPE html><html><body><h1>Test</h1></body></html>";
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "page.html", content: html })}
      />,
    );
    expect(screen.getByTestId("file-preview-html")).toBeTruthy();
  });

  it("does not crash for unknown file types", () => {
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "data.dat", size: 512 })}
      />,
    );
    expect(screen.getByTestId("file-preview-binary")).toBeTruthy();
  });

  it("formats file sizes correctly", () => {
    render(
      <StudioFilePreview
        projectId="test-proj"
        selection={makeSelection({ path: "big.bin", size: 1048576 })}
      />,
    );
    expect(screen.getByText("1.0 MB")).toBeTruthy();
  });
});
