/**
 * ProjectStructurePanel — the Canvas & Design stage's structure view.
 * Contract: it renders the project's REAL entry-HTML element tree
 * (from the files API, no preview needed), and clicking a node emits
 * the bridge-identical PreviewSelection the inspector/write path
 * consume. A project with no HTML page gets an honest empty state.
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { ProjectStructurePanel } from "./ProjectStructurePanel";

vi.mock("@/hooks/useClerkAuth", () => ({
  useClerkAuth: () => ({ getToken: async () => "tok" }),
}));

const INDEX_HTML = `<!DOCTYPE html>
<html><body>
  <header class="site-header"><nav><a href="/">Home</a></nav></header>
  <main><section class="hero"><h1 id="hero-title">Hello world</h1></section></main>
</body></html>`;

function stubWorkspace(entries: { name: string; type: string }[], contents: Record<string, string>) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/files") && !init) {
      return { ok: true, json: async () => ({ entries }) } as Response;
    }
    if (url.endsWith("/files") && init?.method === "POST") {
      const body = JSON.parse(init.body as string);
      if (body.action === "read" && typeof contents[body.path] === "string") {
        return { ok: true, json: async () => ({ content: contents[body.path] }) } as Response;
      }
    }
    return { ok: false, status: 404, json: async () => ({}) } as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("ProjectStructurePanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the project's page structure from its entry HTML file", async () => {
    stubWorkspace(
      [
        { name: "index.html", type: "file" },
        { name: "style.css", type: "file" },
      ],
      { "index.html": INDEX_HTML },
    );
    render(<ProjectStructurePanel projectId="p1" selectedPath={null} onSelect={vi.fn()} />);

    expect(await screen.findByText("index.html")).toBeInTheDocument();
    const nodes = await screen.findAllByTestId("structure-node");
    const tags = nodes.map((n) => n.getAttribute("data-path"));
    expect(tags.some((p) => p?.endsWith("header"))).toBe(true);
    expect(tags.some((p) => p?.endsWith("main"))).toBe(true);
    // Nested elements are present (first two levels start expanded).
    expect(tags.some((p) => p?.includes("h1"))).toBe(true);
  });

  it("emits a bridge-identical selection when a node is clicked", async () => {
    stubWorkspace([{ name: "index.html", type: "file" }], { "index.html": INDEX_HTML });
    const onSelect = vi.fn();
    render(<ProjectStructurePanel projectId="p1" selectedPath={null} onSelect={onSelect} />);

    const nodes = await screen.findAllByTestId("structure-node");
    const h1Node = nodes.find((n) => n.getAttribute("data-path")?.endsWith("h1"));
    expect(h1Node).toBeDefined();
    await userEvent.click(h1Node!);
    expect(onSelect).toHaveBeenCalledTimes(1);
    const selection = onSelect.mock.calls[0][0];
    expect(selection.tagName).toBe("h1");
    expect(selection.selector).toBe("#hero-title");
    expect(selection.path).toBe("html > body > main > section > h1");
    expect(selection.text).toBe("Hello world");
  });

  it("shows an honest empty state when the project has no HTML page", async () => {
    stubWorkspace(
      [
        { name: "src/app/page.tsx", type: "file" },
        { name: "package.json", type: "file" },
      ],
      {},
    );
    render(<ProjectStructurePanel projectId="p1" selectedPath={null} onSelect={vi.fn()} />);
    expect(await screen.findByText(/no HTML page to map/i)).toBeInTheDocument();
    expect(screen.queryAllByTestId("structure-node")).toHaveLength(0);
  });
});
