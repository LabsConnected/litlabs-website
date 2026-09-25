import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MockInstance } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { apiFetch } from "@/lib/api-response";
import ImageTool from "./ImageTool";

/**
 * P1-2 regression tests: the "Use in Project" tap must save the generated
 * image into the real project workspace via
 * POST /api/studio-projects/[projectId]/assets/insert — and must NEVER
 * close the preview or claim success unless the write actually happened.
 */

const PROJECT_ID = "proj-test-1";
const FILE_URL = "https://cdn.example.com/img.png";

const studioCtx = vi.hoisted(() => ({
  projectId: "proj-test-1" as string | null,
  setActiveAssetId: vi.fn(),
}));
const notifyAssetsChanged = vi.hoisted(() => vi.fn());

vi.mock("@/context/ThemeContext", () => ({
  useTheme: () => ({ resolvedColors: new Proxy({}, { get: () => "#111111" }) }),
}));
vi.mock("@/context/WalletContext", () => ({
  useWallet: () => ({ balance: 100, refresh: () => Promise.resolve() }),
}));
vi.mock("../context/StudioContext", () => ({
  useStudioContext: () => studioCtx,
}));
vi.mock("../hooks/useAssetsRefresh", () => ({
  notifyAssetsChanged,
}));
vi.mock("../components/GenerationHistoryCard", () => ({
  default: () => null,
}));
vi.mock("@/lib/api-response", () => ({
  apiFetch: vi.fn(),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    return <img {...props} />;
  },
}));

// ImageTool is imported at top-level; vi.mock calls above are hoisted by vitest
// so the component under test gets the mocked contexts.

function seedHistory() {
  localStorage.setItem(
    "litlabs-generate-history",
    JSON.stringify([
      {
        id: "gen-1",
        prompt: "a test image",
        negativePrompt: "",
        provider: "auto-free",
        fileUrl: FILE_URL,
        status: "succeeded",
        createdAt: Date.now(),
        cost: 0,
      },
    ]),
  );
}

/** Open the mobile full-screen preview for the seeded generation. */
function openPreview() {
  render(<ImageTool />);
  fireEvent.click(screen.getByLabelText("Preview: a test image"));
  expect(screen.getByTestId("image-preview")).toBeInTheDocument();
  // Reveal the generation log panel so log assertions can find entries.
  fireEvent.click(screen.getByTitle("Toggle generation log"));
  return screen.getByTestId("use-in-project-button");
}

const EXPECTED_PATH = "public/assets/images/a-test-image-gen-1.png";

describe("ImageTool 'Use in Project'", () => {
  let fetchMock: MockInstance<typeof fetch>;

  beforeEach(() => {
    vi.clearAllMocks();
    studioCtx.projectId = PROJECT_ID;
    localStorage.clear();
    seedHistory();
    fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/assets/insert")) {
        return new Response(JSON.stringify({ saved: true, path: EXPECTED_PATH }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });
  });

  it("saves via the real assets/insert flow and closes the preview only on success", async () => {
    const button = openPreview();
    fireEvent.click(button);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/studio-projects/${PROJECT_ID}/assets/insert`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
        }),
      );
    });

    // Assert the write payload: real URL + real workspace path + image kind
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).includes("/assets/insert"))!;
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload).toEqual({
      url: FILE_URL,
      path: EXPECTED_PATH,
      kind: "image",
      name: "a test image",
    });

    // Honest confirmation naming where it landed — and the preview closed.
    await waitFor(() => {
      expect(screen.getByText(`Saved to project: ${EXPECTED_PATH}`)).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();
    });
    expect(notifyAssetsChanged).toHaveBeenCalled();
    // The old fake toast must be gone.
    expect(screen.queryByText("Sent to project canvas")).not.toBeInTheDocument();
  });

  it("shows a saving state while the write is in flight", async () => {
    let resolveFetch!: (r: Response) => void;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/assets/insert")) {
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const button = openPreview();
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId("use-in-project-button")).toBeDisabled();
    });
    expect(screen.getByText("Saving…")).toBeInTheDocument();

    resolveFetch(new Response(JSON.stringify({ saved: true, path: EXPECTED_PATH }), { status: 200 }));
    await waitFor(() => {
      expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();
    });
  });

  it("backend failure: shows the error, keeps the preview open, claims nothing", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/assets/insert")) {
        return new Response(JSON.stringify({ error: "Workspace recovery failed" }), { status: 503 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const button = openPreview();
    fireEvent.click(button);

    // Error banner is shown inline; the preview stays open for retry.
    await waitFor(() => {
      expect(screen.getByTestId("use-in-project-error")).toHaveTextContent("Workspace recovery failed");
    });
    expect(screen.getByTestId("image-preview")).toBeInTheDocument();
    // No fake success anywhere.
    expect(screen.queryByText(/Saved to project:/)).not.toBeInTheDocument();
    expect(screen.queryByText("Sent to project canvas")).not.toBeInTheDocument();
  });

  it("retry after failure succeeds and closes the preview", async () => {
    let fail = true;
    fetchMock.mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes("/assets/insert")) {
        if (fail) {
          return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
        }
        return new Response(JSON.stringify({ saved: true, path: EXPECTED_PATH }), { status: 200 });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    });

    const button = openPreview();
    fireEvent.click(button);
    await waitFor(() => {
      expect(screen.getByTestId("use-in-project-error")).toBeInTheDocument();
    });
    expect(screen.getByTestId("image-preview")).toBeInTheDocument();

    // Retry — the button is enabled again after the failure.
    fail = false;
    fireEvent.click(screen.getByTestId("use-in-project-button"));
    await waitFor(() => {
      expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();
    });
    expect(screen.getByText(`Saved to project: ${EXPECTED_PATH}`)).toBeInTheDocument();
  });

  it("with no project open: honest error, no API call, preview stays open", async () => {
    studioCtx.projectId = null;

    const button = openPreview();
    fireEvent.click(button);

    await waitFor(() => {
      expect(screen.getByTestId("use-in-project-error")).toHaveTextContent("No project open");
    });
    expect(screen.getByTestId("image-preview")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/assets/insert"),
      expect.anything(),
    );
    expect(screen.queryByText(/Saved to project:/)).not.toBeInTheDocument();
  });

  it("non-https image URL is rejected honestly without calling the API", async () => {
    localStorage.clear();
    localStorage.setItem(
      "litlabs-generate-history",
      JSON.stringify([
        {
          id: "gen-2",
          prompt: "a local blob image",
          negativePrompt: "",
          provider: "auto-free",
          fileUrl: "blob:https://app.local/123",
          status: "succeeded",
          createdAt: Date.now(),
          cost: 0,
        },
      ]),
    );

    render(<ImageTool />);
    fireEvent.click(screen.getByLabelText("Preview: a local blob image"));
    fireEvent.click(screen.getByTestId("use-in-project-button"));

    await waitFor(() => {
      expect(screen.getByTestId("use-in-project-error")).toHaveTextContent("no public URL");
    });
    expect(screen.getByTestId("image-preview")).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/assets/insert"),
      expect.anything(),
    );
  });

  it("data:image/* fileUrl — the free-provider shape — saves via assets/insert", async () => {
    const dataUrl = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff]).toString("base64")}`;
    localStorage.setItem(
      "litlabs-generate-history",
      JSON.stringify([
        {
          id: "gen-data-1",
          prompt: "a data image",
          negativePrompt: "",
          provider: "auto-free",
          fileUrl: dataUrl,
          status: "succeeded",
          createdAt: Date.now(),
          cost: 0,
        },
      ]),
    );

    render(<ImageTool />);
    fireEvent.click(screen.getByLabelText("Preview: a data image"));
    fireEvent.click(screen.getByTestId("use-in-project-button"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        `/api/studio-projects/${PROJECT_ID}/assets/insert`,
        expect.objectContaining({ method: "POST" }),
      );
    });
    const [, init] = fetchMock.mock.calls.find(([url]) => String(url).includes("/assets/insert"))!;
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.url).toBe(dataUrl);
    // Extension comes from the data URL MIME type, not the URL text.
    expect(payload.path).toBe("public/assets/images/a-data-image-gen-data.jpeg");
    await waitFor(() => {
      expect(screen.queryByTestId("image-preview")).not.toBeInTheDocument();
    });
  });
});

describe("P1-1: chat image intent prefill", () => {
  const promptInputs = () => screen.getAllByTestId("image-prompt-input");

  it("prefills the prompt box when opened from the chat image intent", () => {
    render(<ImageTool initialPrompt="generate an image of a red pickup truck at sunset" />);
    const inputs = promptInputs();
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).toHaveValue("generate an image of a red pickup truck at sunset");
    }
  });

  it("starts empty without a prefill", () => {
    render(<ImageTool />);
    for (const input of promptInputs()) {
      expect(input).toHaveValue("");
    }
  });

  it("syncs a NEW prefill while already open without clobbering in-progress typing", () => {
    const { rerender } = render(<ImageTool initialPrompt="first prompt" />);
    const input = promptInputs()[0] as HTMLTextAreaElement;
    expect(input).toHaveValue("first prompt");
    // A new intent arrives with a new prompt — it lands in the box.
    rerender(<ImageTool initialPrompt="second prompt" />);
    expect(input).toHaveValue("second prompt");
    // Re-render with the SAME prefill does not reset what the user typed.
    fireEvent.change(input, { target: { value: "second prompt — edited" } });
    rerender(<ImageTool initialPrompt="second prompt" />);
    expect(input).toHaveValue("second prompt — edited");
  });
});

describe("P1-1: generate flow (idempotency, no double-submit, honest errors)", () => {
  const apiFetchMock = vi.mocked(apiFetch);
  const UUID_RE =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  beforeEach(() => {
    vi.clearAllMocks();
    studioCtx.projectId = PROJECT_ID;
    localStorage.clear();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({}), { status: 200 }),
    );
    apiFetchMock.mockImplementation((async (input: string | URL) => {
      if (String(input).includes("/api/media/generate")) {
        return {
          downloadUrl: "https://cdn.example.com/gen.png",
          free: true,
          cost: 0,
        };
      }
      return {};
    }) as typeof apiFetch);
  });

  function startGenerate(promptText = "a sunset over the lake") {
    render(<ImageTool />);
    const input = screen.getAllByTestId("image-prompt-input")[0];
    fireEvent.change(input, { target: { value: promptText } });
    fireEvent.click(screen.getAllByTestId("generate-image-button")[0]);
  }

  function generateCalls() {
    return apiFetchMock.mock.calls.filter(([url]) =>
      String(url).includes("/api/media/generate"),
    );
  }

  it("sends a stable client requestId with a long timeout and no auto-retry", async () => {
    startGenerate();
    await waitFor(() => {
      expect(generateCalls().length).toBe(1);
    });
    const [, options] = generateCalls()[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.requestId).toMatch(UUID_RE);
    expect(options).toMatchObject({ timeoutMs: 120_000, retries: 0 });
  });

  it("ignores a rapid double-submit — exactly one billed request", async () => {
    render(<ImageTool />);
    const input = screen.getAllByTestId("image-prompt-input")[0];
    fireEvent.change(input, { target: { value: "a sunset over the lake" } });
    const btn = screen.getAllByTestId("generate-image-button")[0];
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => {
      expect(generateCalls().length).toBe(1);
    });
    // Let the first request fully resolve — a duplicate billed request
    // would show up as a second /api/media/generate call.
    await new Promise((r) => setTimeout(r, 150));
    expect(generateCalls().length).toBe(1);
  });

  it("Regenerate issues a fresh idempotent request with the loaded prompt", async () => {
    seedHistory();
    render(<ImageTool />);
    fireEvent.click(screen.getByLabelText("Preview: a test image"));
    expect(screen.getByTestId("image-preview")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Regenerate"));
    await waitFor(() => {
      expect(generateCalls().length).toBe(1);
    });
    const [, options] = generateCalls()[0];
    const body = JSON.parse((options as RequestInit).body as string);
    expect(body.prompt).toContain("a test image");
    expect(body.requestId).toMatch(UUID_RE);
  });

  it("provider failure shows the error honestly — no fake success", async () => {
    apiFetchMock.mockImplementation((async (input: string | URL) => {
      if (String(input).includes("/api/media/generate")) {
        throw new Error("Provider overloaded");
      }
      return {};
    }) as typeof apiFetch);
    startGenerate();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("Provider overloaded");
    });
  });
});
