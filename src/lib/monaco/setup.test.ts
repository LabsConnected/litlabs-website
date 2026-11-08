import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@monaco-editor/react", () => ({ loader: { config: vi.fn() } }));
vi.mock("monaco-editor", () => ({ MarkerSeverity: {}, Uri: {} }));

import { loader } from "@monaco-editor/react";
import { configureBundledMonaco } from "./setup";

const configMock = loader.config as unknown as ReturnType<typeof vi.fn>;

describe("configureBundledMonaco", () => {
  beforeEach(() => {
    configMock.mockClear();
  });

  it("binds the loader to the bundled monaco-editor — no CDN paths", () => {
    configureBundledMonaco();
    expect(configMock).toHaveBeenCalledTimes(1);
    const arg = configMock.mock.calls[0][0] as Record<string, unknown>;
    expect(arg).toHaveProperty("monaco");
    expect(arg.paths).toBeUndefined();
  });
});
