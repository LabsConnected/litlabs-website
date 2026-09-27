/**
 * ElementInspectorPanel — the end-to-end element edit contract at the
 * component level: selection → file resolution → patch → POST write →
 * files-changed → undo restores the previous file content.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import ElementInspectorPanel from "./ElementInspectorPanel";

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: async () => "tok" }),
}));

const INDEX_HTML = `<!DOCTYPE html>
<html><body>
  <main><section class="hero"><h1 id="hero-title">Hello world</h1></section></main>
</body></html>`;

const SELECTION = {
  label: "Hero heading",
  selector: "main > section.hero > h1#hero-title",
  tagName: "h1",
  attrs: { id: "hero-title" },
  text: "Hello world",
  path: "html > body > main > section > h1",
  styles: { color: "rgb(255, 255, 255)", "font-size": "48px" },
  rect: { width: 400, height: 60 },
};

/** Fetch mock: GET files list → index.html; POST read → file content;
    POST write → captured into `written` for assertions. */
function stubWorkspace(written: { path?: string; content?: string }[]) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/files") && !init) {
      return { ok: true, json: async () => ({ entries: [{ name: "index.html", type: "file" }] }) } as Response;
    }
    if (url.endsWith("/files") && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      if (body.action === "read") {
        return { ok: true, json: async () => ({ content: INDEX_HTML }) } as Response;
      }
      if (body.action === "write") {
        written.push({ path: body.path, content: body.content });
        return { ok: true, json: async () => ({ saved: true }) } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ElementInspectorPanel — real element edit write path", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("resolves the element to a workspace file and shows its real values", async () => {
    stubWorkspace([]);
    render(<ElementInspectorPanel selection={SELECTION} projectId="p1" route="/" />);
    await waitFor(() => {
      expect(screen.getByTestId("element-edit-status").textContent).toContain("index.html");
    });
    expect(screen.getByTestId("element-edit-text")).toHaveValue("Hello world");
  });

  it("writes a text edit into index.html and fires files-changed", async () => {
    const written: { path?: string; content?: string }[] = [];
    stubWorkspace(written);
    const changed = vi.fn();
    window.addEventListener("studio:files-changed", changed);

    const user = userEvent.setup();
    render(<ElementInspectorPanel selection={SELECTION} projectId="p1" route="/" />);
    await waitFor(() => expect(screen.getByTestId("element-edit-status").textContent).toContain("index.html"));

    const field = screen.getByTestId("element-edit-text");
    await user.clear(field);
    await user.type(field, "New headline");
    await user.tab(); // commit on blur

    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0].path).toBe("index.html");
    expect(written[0].content).toContain(">New headline</h1>");
    expect(changed).toHaveBeenCalled();
    window.removeEventListener("studio:files-changed", changed);
  });

  it("undo writes the previous file content back", async () => {
    const written: { path?: string; content?: string }[] = [];
    stubWorkspace(written);
    const user = userEvent.setup();
    render(<ElementInspectorPanel selection={SELECTION} projectId="p1" route="/" />);
    await waitFor(() => expect(screen.getByTestId("element-edit-status").textContent).toContain("index.html"));

    await user.click(screen.getByTestId("element-edit-display"));
    await user.selectOptions(screen.getByTestId("element-edit-display"), "flex");
    await waitFor(() => expect(written.length).toBe(1));
    expect(written[0].content).toContain("display: flex");

    await user.click(screen.getByTestId("element-edit-undo"));
    await waitFor(() => expect(written.length).toBe(2));
    expect(written[0].content).not.toEqual(written[1].content);
    expect(written[1].content).not.toContain("display: flex");
  });

  it("shows the honest unavailable state when no HTML file contains the element", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.endsWith("/files") && !init) {
        return { ok: true, json: async () => ({ entries: [{ name: "app/page.tsx", type: "file" }] }) } as Response;
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ElementInspectorPanel selection={SELECTION} projectId="p1" route="/" />);
    await waitFor(() => {
      expect(screen.getByTestId("element-edit-status").textContent).toContain("Not directly editable");
    });
    // No fake controls when we can't write:
    expect(screen.queryByTestId("element-edit-text")).toBeNull();
  });
});
