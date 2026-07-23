import { describe, expect, it } from "vitest";
import { parseBuilderLocalCommand } from "./builder-command-router";

describe("Builder local command routing", () => {
  it("does not intercept normal AI messages", () => {
    expect(parseBuilderLocalCommand("build me a dashboard")).toBeNull();
  });

  it("routes terminal without producing chat content", () => {
    expect(parseBuilderLocalCommand("/terminal")).toEqual({ type: "terminal" });
  });

  it("parses session management commands locally", () => {
    expect(parseBuilderLocalCommand("/new")).toEqual({ type: "new" });
    expect(parseBuilderLocalCommand("/clear")).toEqual({ type: "clear" });
    expect(parseBuilderLocalCommand("/sessions")).toEqual({ type: "sessions" });
    expect(parseBuilderLocalCommand("/delete")).toEqual({ type: "delete" });
    expect(parseBuilderLocalCommand("/rename Fix terminal connection")).toEqual({ type: "rename", title: "Fix terminal connection" });
  });
});
